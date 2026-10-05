import { z } from 'zod';
import { type ApiScope, apiScopeSchema } from '../../shared/contracts/api.js';
import { createId } from '../../shared/contracts/ids.js';
import type { Database } from '../db/database.js';
import { requireString, toIsoOrNull, toJsonObject, toJsonValue } from '../db/mappers.js';
import { actionStatement } from '../repositories/actions.js';
import {
  generateApiKey,
  hashApiSecret,
  parseApiToken,
  tokenDigest,
  verifyApiSecret,
} from '../security/api-key-crypto.js';

const CACHE_TTL_MS = 30_000;
const LAST_USED_INTERVAL_MS = 60_000;

export interface VerifiedKey {
  id: string;
  name: string;
  scopes: readonly ApiScope[];
  allowedIps: readonly string[];
}

export interface ApiKeyListing {
  id: string;
  name: string;
  prefix: string;
  scopes: readonly string[];
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

const scopesSchema = z.array(apiScopeSchema);
const restrictionsSchema = z.object({ allowedIps: z.array(z.string().max(64)).max(32).optional() });

export interface ApiKeyService {
  create(input: {
    name: string;
    scopes: readonly ApiScope[];
    expiresInDays?: number;
    allowedIps?: readonly string[];
  }): Promise<{ id: string; token: string }>;
  revoke(id: string): Promise<boolean>;
  list(): Promise<ApiKeyListing[]>;
  authenticate(token: string): Promise<VerifiedKey | null>;
}

export function createApiKeyService(
  db: Database,
  now: () => number = Date.now,
  hashSecret: (secret: string) => Promise<string> = (secret) => hashApiSecret(secret),
): ApiKeyService {
  const cache = new Map<string, { key: VerifiedKey; expires: number }>();
  const lastTouched = new Map<string, number>();

  return {
    async create(input) {
      const id = createId('SAC-KEY');
      const { prefix, token } = generateApiKey();
      const parsed = parseApiToken(token);
      if (!parsed) throw new Error('generated API key failed self-validation');
      const secretHash = await hashSecret(parsed.secret);
      const action = actionStatement({
        actorType: 'console',
        actorId: 'console',
        actionType: 'api_key.created',
        targetType: 'api_key',
        targetId: id,
        reason: `API key "${input.name}" created`,
        metadata: { keyId: id, scopes: input.scopes, expiresInDays: input.expiresInDays ?? null },
        origin: 'console',
      });
      const restrictions = input.allowedIps?.length ? { allowedIps: input.allowedIps } : {};
      const committed = await db.transaction([
        {
          query: `INSERT INTO sac_api_keys (
            id, name, key_prefix, secret_hash, scopes_json, restrictions_json, expires_at
          ) VALUES (?, ?, ?, ?, ?, ?, ${input.expiresInDays ? 'DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL ? DAY)' : '?'})`,
          values: [
            id,
            input.name,
            prefix,
            secretHash,
            JSON.stringify(input.scopes),
            JSON.stringify(restrictions),
            input.expiresInDays ?? null,
          ],
        },
        action,
      ]);
      if (!committed) throw new Error('failed to persist API key');
      return { id, token };
    },

    async revoke(id) {
      const action = actionStatement({
        actorType: 'console',
        actorId: 'console',
        actionType: 'api_key.revoked',
        targetType: 'api_key',
        targetId: id,
        reason: 'API key revoked',
        metadata: { keyId: id },
        origin: 'console',
      });
      const row = await db.single(
        'SELECT id FROM sac_api_keys WHERE id = ? AND revoked_at IS NULL',
        [id],
      );
      if (!row) return false;
      const committed = await db.transaction([
        {
          query:
            'UPDATE sac_api_keys SET revoked_at = CURRENT_TIMESTAMP(3) WHERE id = ? AND revoked_at IS NULL',
          values: [id],
        },
        action,
      ]);
      cache.clear();
      return committed;
    },

    async list() {
      const rows = await db.query(
        `SELECT id, name, key_prefix, scopes_json, expires_at, last_used_at, revoked_at
         FROM sac_api_keys ORDER BY id DESC LIMIT 200`,
      );
      return rows.map((row) => ({
        id: requireString(row, 'id'),
        name: requireString(row, 'name'),
        prefix: requireString(row, 'key_prefix'),
        scopes: z.array(z.string()).catch([]).parse(toJsonValue(row['scopes_json'])),
        expiresAt: toIsoOrNull(row['expires_at']),
        lastUsedAt: toIsoOrNull(row['last_used_at']),
        revokedAt: toIsoOrNull(row['revoked_at']),
      }));
    },

    async authenticate(token) {
      const parsed = parseApiToken(token);
      if (!parsed) return null;

      const digest = tokenDigest(token);
      const cached = cache.get(digest);
      if (cached && cached.expires > now()) return cached.key;
      cache.delete(digest);

      const row = await db.single(
        `SELECT id, name, secret_hash, scopes_json, restrictions_json
         FROM sac_api_keys
         WHERE key_prefix = ?
           AND revoked_at IS NULL
           AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP(3))`,
        [parsed.prefix],
      );
      // Verify against a dummy hash on a miss would equalize timing, but prefixes are
      // random 48-bit identifiers, so a miss reveals nothing about any secret.
      if (!row) return null;
      if (!(await verifyApiSecret(parsed.secret, requireString(row, 'secret_hash')))) return null;

      const scopes = scopesSchema.safeParse(toJsonValue(row['scopes_json']));
      if (!scopes.success) return null;
      const restrictions = restrictionsSchema.safeParse(toJsonObject(row['restrictions_json']));
      const key: VerifiedKey = {
        id: requireString(row, 'id'),
        name: requireString(row, 'name'),
        scopes: scopes.data,
        allowedIps: restrictions.success ? (restrictions.data.allowedIps ?? []) : [],
      };
      cache.set(digest, { key, expires: now() + CACHE_TTL_MS });

      const touched = lastTouched.get(key.id) ?? 0;
      if (now() - touched > LAST_USED_INTERVAL_MS) {
        lastTouched.set(key.id, now());
        void db
          .execute('UPDATE sac_api_keys SET last_used_at = CURRENT_TIMESTAMP(3) WHERE id = ?', [
            key.id,
          ])
          .catch(() => undefined);
      }
      return key;
    },
  };
}
