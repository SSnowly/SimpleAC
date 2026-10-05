import { createHash } from 'node:crypto';
import type { Database } from '../db/database.js';
import { requireNumber, toJsonValue } from '../db/mappers.js';

const STALE_IN_PROGRESS_SECONDS = 60;
const RETENTION_HOURS = 24;

export interface StoredResponse {
  status: number;
  body: unknown;
}

export type IdempotencyBegin =
  | { kind: 'proceed' }
  | { kind: 'replay'; response: StoredResponse }
  | { kind: 'reused' }
  | { kind: 'in_progress' };

export interface IdempotencyStore {
  begin(keyId: string, idempotencyKey: string, fingerprint: string): Promise<IdempotencyBegin>;
  complete(keyId: string, idempotencyKey: string, response: StoredResponse): Promise<void>;
  abandon(keyId: string, idempotencyKey: string): Promise<void>;
  prune(): Promise<void>;
}

export function requestFingerprint(method: string, path: string, rawBody: string): string {
  return createHash('sha256').update(`${method}\n${path}\n${rawBody}`).digest('hex');
}

export function createIdempotencyStore(db: Database): IdempotencyStore {
  return {
    async begin(keyId, idempotencyKey, fingerprint) {
      await db.execute(
        `DELETE FROM sac_api_idempotency
         WHERE api_key_id = ? AND idempotency_key = ? AND status = 0
           AND created_at < DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL ? SECOND)`,
        [keyId, idempotencyKey, STALE_IN_PROGRESS_SECONDS],
      );
      const inserted = await db.execute(
        `INSERT IGNORE INTO sac_api_idempotency (api_key_id, idempotency_key, fingerprint, status)
         VALUES (?, ?, ?, 0)`,
        [keyId, idempotencyKey, fingerprint],
      );
      if (inserted > 0) return { kind: 'proceed' };

      const row = await db.single(
        `SELECT fingerprint, status, response_json
         FROM sac_api_idempotency WHERE api_key_id = ? AND idempotency_key = ?`,
        [keyId, idempotencyKey],
      );
      if (!row) return { kind: 'in_progress' };
      if (row['fingerprint'] !== fingerprint) return { kind: 'reused' };
      const status = requireNumber(row, 'status');
      if (status === 0) return { kind: 'in_progress' };
      return {
        kind: 'replay',
        response: { status, body: toJsonValue(row['response_json']) },
      };
    },

    async complete(keyId, idempotencyKey, response) {
      await db.execute(
        `UPDATE sac_api_idempotency SET status = ?, response_json = ?
         WHERE api_key_id = ? AND idempotency_key = ?`,
        [response.status, JSON.stringify(response.body), keyId, idempotencyKey],
      );
    },

    async abandon(keyId, idempotencyKey) {
      await db.execute(
        'DELETE FROM sac_api_idempotency WHERE api_key_id = ? AND idempotency_key = ? AND status = 0',
        [keyId, idempotencyKey],
      );
    },

    async prune() {
      await db.execute(
        'DELETE FROM sac_api_idempotency WHERE created_at < DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL ? HOUR)',
        [RETENTION_HOURS],
      );
    },
  };
}
