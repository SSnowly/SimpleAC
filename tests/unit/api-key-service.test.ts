import { describe, expect, it } from 'vitest';
import type { Database, Row, SqlStatement } from '../../server/db/database.js';
import { hashApiSecret } from '../../server/security/api-key-crypto.js';
import { createApiKeyService } from '../../server/services/api-keys.js';

const fastHash = (secret: string): Promise<string> => hashApiSecret(secret, 1024);

function createFakeDb() {
  let keyRow: Row | null = null;
  const statements: SqlStatement[] = [];
  const db: Database = {
    query: () => Promise.resolve([]),
    scalar: () => Promise.resolve(null),
    execute: () => Promise.resolve(1),
    single(query) {
      if (query.includes('FROM sac_api_keys') && query.includes('key_prefix')) {
        return Promise.resolve(keyRow?.['revoked_at'] ? null : keyRow);
      }
      if (query.includes('SELECT id FROM sac_api_keys')) {
        return Promise.resolve(keyRow?.['revoked_at'] ? null : keyRow);
      }
      return Promise.resolve(null);
    },
    transaction(batch) {
      statements.push(...batch);
      const insert = batch.find((statement) =>
        statement.query.includes('INSERT INTO sac_api_keys'),
      );
      if (insert) {
        const [id, name, prefix, secretHash, scopes, restrictions] = insert.values;
        keyRow = {
          id,
          name,
          key_prefix: prefix,
          secret_hash: secretHash,
          scopes_json: scopes,
          restrictions_json: restrictions,
          revoked_at: null,
        };
      }
      const revoke = batch.find((statement) => statement.query.includes('SET revoked_at'));
      if (revoke && keyRow) keyRow = { ...keyRow, revoked_at: 1 };
      return Promise.resolve(true);
    },
  };
  return { db, statements };
}

describe('api key service', () => {
  it('authenticates a created key, stores no raw secret, and audits the creation', async () => {
    const { db, statements } = createFakeDb();
    const service = createApiKeyService(db, Date.now, fastHash);
    const created = await service.create({ name: 'ci', scopes: ['players:read'] });

    const serialized = JSON.stringify(statements);
    expect(serialized).not.toContain(created.token.split('.')[1]);
    expect(
      statements.some((statement) => statement.query.includes('INSERT INTO sac_actions')),
    ).toBe(true);
    expect(created.id).toMatch(/^SAC-KEY-/);

    const verified = await service.authenticate(created.token);
    expect(verified?.id).toBe(created.id);
    expect(verified?.scopes).toEqual(['players:read']);

    const tampered = created.token.slice(0, -1) + (created.token.endsWith('A') ? 'B' : 'A');
    expect(await service.authenticate(tampered)).toBeNull();
  });

  it('stops authenticating a key once it is revoked', async () => {
    const { db } = createFakeDb();
    const service = createApiKeyService(db, Date.now, fastHash);
    const created = await service.create({ name: 'temp', scopes: ['admin'] });
    expect(await service.revoke(created.id)).toBe(true);
    expect(await service.authenticate(created.token)).toBeNull();
  });

  it('rejects malformed tokens without touching the database', async () => {
    const { db } = createFakeDb();
    const service = createApiKeyService(db);
    expect(await service.authenticate('nope')).toBeNull();
  });
});
