import {
  type Detection,
  type DetectionDetailRecord,
  detectionDetailSchema,
  detectionSchema,
  type UpdateDetectionRequest,
} from '../../shared/contracts/api.js';
import type { Database, Row } from '../db/database.js';
import {
  requireNumber,
  requireString,
  toIso,
  toJsonObject,
  toJsonValue,
  toStringOrNull,
} from '../db/mappers.js';
import { conflict, notFound } from '../http/errors.js';
import { actionStatement } from '../repositories/actions.js';
import { TS } from '../repositories/records.js';
import type { Actor } from './bans.js';
import { CAPTURE_COLUMNS, mapCapture } from './captures.js';
import { type Page, toPage, whereClause } from './page.js';

export interface DetectionFilters {
  playerId?: string;
  ruleKey?: string;
  category?: string;
  status?: string;
  caseId?: string;
  limit: number;
  before?: string;
}

export interface DetectionService {
  list(filters: DetectionFilters): Promise<Page<Detection>>;
  get(id: string): Promise<DetectionDetailRecord | null>;
  review(id: string, input: UpdateDetectionRequest, actor: Actor): Promise<DetectionDetailRecord>;
}

export const DETECTION_COLUMNS = `id, player_id, session_id, rule_key, rule_version, category, severity,
  confidence, score, outcome, status, ${TS('occurred_at')}, ${TS('created_at')},
  (SELECT cd.case_id FROM sac_case_detections cd WHERE cd.detection_id = d.id
     ORDER BY cd.created_at DESC LIMIT 1) AS case_id`;

export function mapDetection(row: Row): Detection {
  return detectionSchema.parse({
    id: requireString(row, 'id'),
    playerId: requireString(row, 'player_id'),
    sessionId: toStringOrNull(row['session_id']),
    caseId: toStringOrNull(row['case_id']),
    ruleKey: requireString(row, 'rule_key'),
    ruleVersion: requireNumber(row, 'rule_version'),
    category: requireString(row, 'category'),
    severity: requireNumber(row, 'severity'),
    confidence: requireNumber(row, 'confidence'),
    score: requireNumber(row, 'score'),
    outcome: requireString(row, 'outcome'),
    status: requireString(row, 'status'),
    occurredAt: toIso(row['occurred_at']),
    createdAt: toIso(row['created_at']),
  });
}

export function createDetectionService(db: Database): DetectionService {
  const load = async (id: string): Promise<DetectionDetailRecord | null> => {
    const row = await db.single(
      `SELECT ${DETECTION_COLUMNS}, measured_json FROM sac_detections d WHERE id = ?`,
      [id],
    );
    if (!row) return null;
    const measured = toJsonObject(row['measured_json']);
    const evidenceRows = await db.query(
      `SELECT evidence_type, reference_id, payload_json, ${TS('created_at')}
       FROM sac_detection_evidence WHERE detection_id = ? ORDER BY id ASC LIMIT 100`,
      [id],
    );
    // An OCR match names its capture in the measurements; automatic captures name the detection instead.
    const measuredCapture = typeof measured['captureId'] === 'string' ? measured['captureId'] : '';
    const captureRows = await db.query(
      `SELECT ${CAPTURE_COLUMNS} FROM sac_captures WHERE detection_id = ? OR id = ?
       ORDER BY id DESC LIMIT 20`,
      [id, measuredCapture],
    );
    return detectionDetailSchema.parse({
      ...mapDetection(row),
      measured,
      evidence: evidenceRows.map((evidence) => ({
        type: requireString(evidence, 'evidence_type'),
        referenceId: toStringOrNull(evidence['reference_id']),
        payload: toJsonValue(evidence['payload_json']),
        createdAt: toIso(evidence['created_at']),
      })),
      captures: captureRows.map(mapCapture),
    });
  };

  return {
    async list(filters) {
      const parts: { sql: string; values: unknown[] }[] = [];
      if (filters.before) parts.push({ sql: 'id < ?', values: [filters.before] });
      if (filters.playerId) parts.push({ sql: 'player_id = ?', values: [filters.playerId] });
      if (filters.ruleKey) parts.push({ sql: 'rule_key = ?', values: [filters.ruleKey] });
      if (filters.category) parts.push({ sql: 'category = ?', values: [filters.category] });
      if (filters.status) parts.push({ sql: 'status = ?', values: [filters.status] });
      if (filters.caseId) {
        parts.push({
          sql: 'id IN (SELECT detection_id FROM sac_case_detections WHERE case_id = ?)',
          values: [filters.caseId],
        });
      }
      const { where, values } = whereClause(parts);
      const rows = await db.query(
        `SELECT ${DETECTION_COLUMNS} FROM sac_detections d ${where} ORDER BY id DESC LIMIT ?`,
        [...values, filters.limit + 1],
      );
      return toPage(rows.map(mapDetection), filters.limit);
    },

    get: load,

    async review(id, input, actor) {
      const row = await db.single('SELECT status FROM sac_detections WHERE id = ?', [id]);
      if (!row) throw notFound('The detection does not exist.');
      const previous = requireString(row, 'status');
      if (previous === input.status) throw conflict(`The detection is already ${previous}.`);

      const action = actionStatement({
        ...(actor.correlationId ? { correlationId: actor.correlationId } : {}),
        actorType: actor.type ?? 'web_api',
        actorId: actor.keyId,
        actionType: 'detection.reviewed',
        targetType: 'detection',
        targetId: id,
        reason: input.reason,
        metadata: { detectionId: id, from: previous, to: input.status },
        origin: actor.origin ?? 'http_api',
      });
      const committed = await db.transaction([
        action,
        {
          query: 'UPDATE sac_detections SET status = ? WHERE id = ?',
          values: [input.status, id],
        },
        {
          query: `INSERT INTO sac_case_events (case_id, action_id, event_type, actor, body_json)
                  SELECT case_id, ?, 'detection.reviewed', ?, ?
                  FROM sac_case_detections WHERE detection_id = ?`,
          values: [
            action.id,
            actor.keyId,
            JSON.stringify({ detectionId: id, from: previous, to: input.status }),
            id,
          ],
        },
      ]);
      if (!committed) throw new Error('failed to persist detection review');
      const updated = await load(id);
      if (!updated) throw new Error('detection was not readable after commit');
      return updated;
    },
  };
}
