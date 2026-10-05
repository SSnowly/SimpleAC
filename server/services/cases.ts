import {
  type CaseDetail,
  type CaseRecord,
  type CreateCaseRequest,
  caseDetailSchema,
  caseEventSchema,
  caseSchema,
  type UpdateCaseRequest,
} from '../../shared/contracts/api.js';
import { createId } from '../../shared/contracts/ids.js';
import type { Database, Row, SqlStatement } from '../db/database.js';
import {
  requireNumber,
  requireString,
  toIso,
  toJsonObject,
  toStringOrNull,
} from '../db/mappers.js';
import { conflict, notFound } from '../http/errors.js';
import { actionStatement } from '../repositories/actions.js';
import { TS } from '../repositories/records.js';
import type { Actor } from './bans.js';
import { CAPTURE_COLUMNS, mapCapture } from './captures.js';
import { DETECTION_COLUMNS, mapDetection } from './detections.js';
import { type Page, toPage, whereClause } from './page.js';

export interface CaseFilters {
  status?: string;
  playerId?: string;
  assignedTo?: string;
  limit: number;
  before?: string;
}

export interface CaseService {
  list(filters: CaseFilters): Promise<Page<CaseRecord>>;
  get(id: string): Promise<CaseDetail | null>;
  create(input: CreateCaseRequest, actor: Actor): Promise<CaseDetail>;
  update(id: string, input: UpdateCaseRequest, actor: Actor): Promise<CaseDetail>;
  addNote(id: string, note: string, actor: Actor): Promise<CaseDetail>;
  linkDetection(id: string, detectionId: string, actor: Actor): Promise<CaseDetail>;
  linkCapture(id: string, captureId: string, actor: Actor): Promise<CaseDetail>;
}

const CASE_COLUMNS = `id, player_id, status, priority, title, assigned_to,
  (SELECT COUNT(*) FROM sac_case_detections cd WHERE cd.case_id = c.id) AS detection_count,
  ${TS('created_at')}, ${TS('updated_at')}`;

const TOUCH = 'UPDATE sac_cases SET updated_at = CURRENT_TIMESTAMP(3) WHERE id = ?';

function mapCase(row: Row): CaseRecord {
  return caseSchema.parse({
    id: requireString(row, 'id'),
    playerId: requireString(row, 'player_id'),
    status: requireString(row, 'status'),
    priority: requireNumber(row, 'priority'),
    title: requireString(row, 'title'),
    assignedTo: toStringOrNull(row['assigned_to']),
    detectionCount: requireNumber(row, 'detection_count'),
    createdAt: toIso(row['created_at']),
    updatedAt: toIso(row['updated_at']),
  });
}

export function createCaseService(db: Database): CaseService {
  const load = async (id: string): Promise<CaseDetail | null> => {
    const row = await db.single(`SELECT ${CASE_COLUMNS} FROM sac_cases c WHERE id = ?`, [id]);
    if (!row) return null;
    const [detections, events, captures] = await Promise.all([
      db.query(
        `SELECT ${DETECTION_COLUMNS} FROM sac_detections d
         WHERE id IN (SELECT detection_id FROM sac_case_detections WHERE case_id = ?)
         ORDER BY id DESC LIMIT 200`,
        [id],
      ),
      db.query(
        `SELECT id, action_id, event_type, actor, body_json, ${TS('created_at')}
         FROM sac_case_events WHERE case_id = ? ORDER BY id ASC LIMIT 500`,
        [id],
      ),
      db.query(
        `SELECT ${CAPTURE_COLUMNS} FROM sac_captures WHERE case_id = ? ORDER BY id DESC LIMIT 50`,
        [id],
      ),
    ]);
    return caseDetailSchema.parse({
      ...mapCase(row),
      detections: detections.map(mapDetection),
      events: events.map((event) =>
        caseEventSchema.parse({
          id: requireNumber(event, 'id'),
          actionId: toStringOrNull(event['action_id']),
          type: requireString(event, 'event_type'),
          actor: requireString(event, 'actor'),
          body: toJsonObject(event['body_json']),
          createdAt: toIso(event['created_at']),
        }),
      ),
      captures: captures.map(mapCapture),
    });
  };

  const requireCase = async (id: string): Promise<Row> => {
    const row = await db.single(
      'SELECT id, player_id, status, priority, assigned_to FROM sac_cases WHERE id = ?',
      [id],
    );
    if (!row) throw notFound('The case does not exist.');
    return row;
  };

  const reload = async (id: string): Promise<CaseDetail> => {
    const updated = await load(id);
    if (!updated) throw new Error('case was not readable after commit');
    return updated;
  };

  const commit = async (statements: SqlStatement[], caseId: string): Promise<CaseDetail> => {
    if (!(await db.transaction(statements))) throw new Error('failed to persist case change');
    return reload(caseId);
  };

  const event = (
    caseId: string,
    actionId: string,
    type: string,
    actor: Actor,
    body: Record<string, unknown>,
  ): SqlStatement => ({
    query: `INSERT INTO sac_case_events (case_id, action_id, event_type, actor, body_json)
            VALUES (?, ?, ?, ?, ?)`,
    values: [caseId, actionId, type, actor.keyId, JSON.stringify(body)],
  });

  const ledger = (
    actor: Actor,
    actionType: string,
    caseId: string,
    reason: string,
    metadata: Record<string, unknown>,
  ) =>
    actionStatement({
      ...(actor.correlationId ? { correlationId: actor.correlationId } : {}),
      actorType: actor.type ?? 'web_api',
      actorId: actor.keyId,
      actionType,
      targetType: 'case',
      targetId: caseId,
      reason,
      metadata: { caseId, ...metadata },
      origin: actor.origin ?? 'http_api',
    });

  return {
    async list(filters) {
      const parts: { sql: string; values: unknown[] }[] = [];
      if (filters.before) parts.push({ sql: 'id < ?', values: [filters.before] });
      if (filters.status) parts.push({ sql: 'status = ?', values: [filters.status] });
      if (filters.playerId) parts.push({ sql: 'player_id = ?', values: [filters.playerId] });
      if (filters.assignedTo) parts.push({ sql: 'assigned_to = ?', values: [filters.assignedTo] });
      const { where, values } = whereClause(parts);
      const rows = await db.query(
        `SELECT ${CASE_COLUMNS} FROM sac_cases c ${where} ORDER BY id DESC LIMIT ?`,
        [...values, filters.limit + 1],
      );
      return toPage(rows.map(mapCase), filters.limit);
    },

    get: load,

    async create(input, actor) {
      if (!(await db.single('SELECT id FROM sac_players WHERE id = ?', [input.playerId]))) {
        throw notFound('The player does not exist.');
      }
      const caseId = createId('SAC-CASE');
      const action = ledger(actor, 'case.created', caseId, input.reason, {
        playerId: input.playerId,
        title: input.title,
      });
      return commit(
        [
          action,
          {
            query: 'INSERT INTO sac_cases (id, player_id, priority, title) VALUES (?, ?, ?, ?)',
            values: [caseId, input.playerId, input.priority, input.title],
          },
          event(caseId, action.id, 'case.created', actor, { title: input.title }),
        ],
        caseId,
      );
    },

    async update(id, input, actor) {
      const current = await requireCase(id);
      const previousAssignee = toStringOrNull(current['assigned_to']);
      const changes: Record<string, { from: unknown; to: unknown }> = {};
      const sets: string[] = [];
      const values: unknown[] = [];
      if (input.status !== undefined && input.status !== current['status']) {
        changes['status'] = { from: current['status'], to: input.status };
        sets.push('status = ?');
        values.push(input.status);
      }
      if (input.priority !== undefined && input.priority !== Number(current['priority'])) {
        changes['priority'] = { from: Number(current['priority']), to: input.priority };
        sets.push('priority = ?');
        values.push(input.priority);
      }
      if (input.assignedTo !== undefined && input.assignedTo !== previousAssignee) {
        changes['assignedTo'] = { from: previousAssignee, to: input.assignedTo };
        sets.push('assigned_to = ?');
        values.push(input.assignedTo);
      }
      if (sets.length === 0) throw conflict('The case already has those values.');

      const action = ledger(actor, 'case.updated', id, input.reason, { changes });
      return commit(
        [
          action,
          {
            query: `UPDATE sac_cases SET ${sets.join(', ')} WHERE id = ?`,
            values: [...values, id],
          },
          event(id, action.id, 'case.updated', actor, { changes }),
        ],
        id,
      );
    },

    async addNote(id, note, actor) {
      await requireCase(id);
      const action = ledger(actor, 'case.note_added', id, 'Case note', { length: note.length });
      return commit(
        [
          action,
          event(id, action.id, 'case.note', actor, { note }),
          { query: TOUCH, values: [id] },
        ],
        id,
      );
    },

    async linkDetection(id, detectionId, actor) {
      const current = await requireCase(id);
      const detection = await db.single('SELECT player_id FROM sac_detections WHERE id = ?', [
        detectionId,
      ]);
      if (!detection) throw notFound('The detection does not exist.');
      if (detection['player_id'] !== current['player_id']) {
        throw conflict('The detection belongs to a different player than the case.');
      }
      const linked = await db.single(
        'SELECT detection_id FROM sac_case_detections WHERE case_id = ? AND detection_id = ?',
        [id, detectionId],
      );
      if (linked) return reload(id);

      const action = ledger(actor, 'case.detection_linked', id, 'Detection linked to case', {
        detectionId,
      });
      return commit(
        [
          action,
          {
            query: 'INSERT IGNORE INTO sac_case_detections (case_id, detection_id) VALUES (?, ?)',
            values: [id, detectionId],
          },
          event(id, action.id, 'detection.linked', actor, { detectionId }),
          { query: TOUCH, values: [id] },
        ],
        id,
      );
    },

    async linkCapture(id, captureId, actor) {
      const current = await requireCase(id);
      const capture = await db.single('SELECT player_id, case_id FROM sac_captures WHERE id = ?', [
        captureId,
      ]);
      if (!capture) throw notFound('The capture does not exist.');
      if (capture['player_id'] !== current['player_id']) {
        throw conflict('The capture belongs to a different player than the case.');
      }
      if (capture['case_id'] === id) return reload(id);

      const action = ledger(actor, 'case.capture_linked', id, 'Capture linked to case', {
        captureId,
      });
      return commit(
        [
          action,
          { query: 'UPDATE sac_captures SET case_id = ? WHERE id = ?', values: [id, captureId] },
          event(id, action.id, 'capture.linked', actor, { captureId }),
          { query: TOUCH, values: [id] },
        ],
        id,
      );
    },
  };
}
