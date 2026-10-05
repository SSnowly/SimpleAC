import {
  type CreateExceptionRequest,
  type ExceptionRecord,
  exceptionSchema,
} from '../../shared/contracts/api.js';
import { createId } from '../../shared/contracts/ids.js';
import type { Database, Row } from '../db/database.js';
import { requireString, toIso, toIsoOrNull, toStringOrNull } from '../db/mappers.js';
import { ApiError, conflict, notFound } from '../http/errors.js';
import { actionStatement } from '../repositories/actions.js';
import { TS } from '../repositories/records.js';
import type { Actor } from './bans.js';
import { type Page, toPage, whereClause } from './page.js';

export interface ExceptionGame {
  /** Tells the Lua detection engine to reload its in-memory exception cache. */
  reloadExceptions(): void;
}

export interface ExceptionFilters {
  scopeType?: string;
  scopeValue?: string;
  activeOnly: boolean;
  limit: number;
  before?: string;
}

export interface ExceptionService {
  list(filters: ExceptionFilters): Promise<Page<ExceptionRecord>>;
  get(id: string): Promise<ExceptionRecord | null>;
  create(input: CreateExceptionRequest, actor: Actor): Promise<ExceptionRecord>;
  revoke(id: string, reason: string, actor: Actor): Promise<ExceptionRecord>;
}

const ACTIVE = `revoked_by_action_id IS NULL AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP(3))`;

const EXCEPTION_COLUMNS = `id, scope_type, scope_value, effect, reason, created_by, revoked_by_action_id,
  (${ACTIVE}) AS active, ${TS('expires_at')}, ${TS('created_at')}`;

const PLAYER_ID = /^SAC-PLY-[0-9A-HJKMNP-TV-Z]{26}$/;
const DETECTION_KEY = /^[a-z][a-z0-9_.]{1,127}$/;
const RESOURCE_NAME = /^[A-Za-z0-9_.-]{1,128}$/;

const mapException = (row: Row): ExceptionRecord =>
  exceptionSchema.parse({
    id: requireString(row, 'id'),
    scopeType: requireString(row, 'scope_type'),
    scopeValue: requireString(row, 'scope_value'),
    effect: requireString(row, 'effect'),
    reason: requireString(row, 'reason'),
    createdBy: requireString(row, 'created_by'),
    expiresAt: toIsoOrNull(row['expires_at']),
    revokedByActionId: toStringOrNull(row['revoked_by_action_id']),
    active: Number(row['active']) === 1,
    createdAt: toIso(row['created_at']),
  });

function invalidScope(message: string): ApiError {
  return new ApiError(400, 'validation_failed', message);
}

export function createExceptionService(db: Database, game: ExceptionGame): ExceptionService {
  const find = async (id: string): Promise<ExceptionRecord | null> => {
    const row = await db.single(`SELECT ${EXCEPTION_COLUMNS} FROM sac_exceptions WHERE id = ?`, [
      id,
    ]);
    return row ? mapException(row) : null;
  };

  return {
    async list(filters) {
      const parts: { sql: string; values: unknown[] }[] = [];
      if (filters.before) parts.push({ sql: 'id < ?', values: [filters.before] });
      if (filters.scopeType) parts.push({ sql: 'scope_type = ?', values: [filters.scopeType] });
      if (filters.scopeValue) parts.push({ sql: 'scope_value = ?', values: [filters.scopeValue] });
      if (filters.activeOnly) parts.push({ sql: ACTIVE, values: [] });
      const { where, values } = whereClause(parts);
      const rows = await db.query(
        `SELECT ${EXCEPTION_COLUMNS} FROM sac_exceptions ${where} ORDER BY id DESC LIMIT ?`,
        [...values, filters.limit + 1],
      );
      return toPage(rows.map(mapException), filters.limit);
    },

    get: find,

    async create(input, actor) {
      const value = input.scopeValue;
      if (input.scopeType === 'player') {
        if (!PLAYER_ID.test(value)) throw invalidScope('A player exception needs a SAC-PLY id.');
        if (!(await db.single('SELECT id FROM sac_players WHERE id = ?', [value]))) {
          throw notFound('The player does not exist.');
        }
      } else if (input.scopeType === 'detection') {
        if (!DETECTION_KEY.test(value))
          throw invalidScope('A detection exception needs a rule key.');
      } else if (!RESOURCE_NAME.test(value)) {
        throw invalidScope('A resource exception needs a resource name.');
      }

      const duplicate = await db.single(
        `SELECT id FROM sac_exceptions
         WHERE scope_type = ? AND scope_value = ? AND effect = ? AND ${ACTIVE} LIMIT 1`,
        [input.scopeType, value, input.effect],
      );
      if (duplicate) throw conflict('An active exception with the same scope and effect exists.');

      const id = createId('SAC-EXC');
      const action = actionStatement({
        ...(actor.correlationId ? { correlationId: actor.correlationId } : {}),
        actorType: actor.type ?? 'web_api',
        actorId: actor.keyId,
        actionType: 'exception.created',
        targetType: 'exception',
        targetId: id,
        reason: input.reason,
        metadata: {
          exceptionId: id,
          scopeType: input.scopeType,
          scopeValue: value,
          effect: input.effect,
          durationHours: input.durationHours,
        },
        origin: actor.origin ?? 'http_api',
      });
      const expires =
        input.durationHours === null ? 'NULL' : 'DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL ? HOUR)';
      const committed = await db.transaction([
        action,
        {
          query: `INSERT INTO sac_exceptions (id, scope_type, scope_value, effect, reason, created_by, expires_at)
                  VALUES (?, ?, ?, ?, ?, ?, ${expires})`,
          values: [
            id,
            input.scopeType,
            value,
            input.effect,
            input.reason,
            actor.keyId,
            ...(input.durationHours === null ? [] : [input.durationHours]),
          ],
        },
      ]);
      if (!committed) throw new Error('failed to persist exception');
      game.reloadExceptions();
      const created = await find(id);
      if (!created) throw new Error('exception was not readable after commit');
      return created;
    },

    async revoke(id, reason, actor) {
      const current = await find(id);
      if (!current) throw notFound('The exception does not exist.');
      if (current.revokedByActionId !== null) throw conflict('The exception is already revoked.');
      if (!current.active) throw conflict('The exception has already expired.');

      const created = await db.single(
        `SELECT id FROM sac_actions WHERE action_type = 'exception.created' AND target_id = ? LIMIT 1`,
        [id],
      );
      const action = actionStatement({
        ...(actor.correlationId ? { correlationId: actor.correlationId } : {}),
        actorType: actor.type ?? 'web_api',
        actorId: actor.keyId,
        actionType: 'exception.revoked',
        targetType: 'exception',
        targetId: id,
        reason,
        metadata: { exceptionId: id },
        origin: actor.origin ?? 'http_api',
        ...(created ? { reversesActionId: requireString(created, 'id') } : {}),
      });
      const committed = await db.transaction([
        action,
        {
          query: `UPDATE sac_exceptions SET revoked_by_action_id = ?
                  WHERE id = ? AND revoked_by_action_id IS NULL`,
          values: [action.id, id],
        },
      ]);
      if (!committed) throw new Error('failed to persist exception revocation');
      game.reloadExceptions();
      const updated = await find(id);
      if (!updated) throw new Error('exception was not readable after commit');
      return updated;
    },
  };
}
