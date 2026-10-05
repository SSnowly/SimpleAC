import { describe, expect, it } from 'vitest';
import { createRateLimiter } from '../../server/http/middleware/rate-limit.js';
import {
  generateApiKey,
  hashApiSecret,
  parseApiToken,
  verifyApiSecret,
} from '../../server/security/api-key-crypto.js';
import { hasScope } from '../../server/security/scopes.js';

describe('api key crypto', () => {
  it('generates tokens that parse back to their prefix', () => {
    const { prefix, token } = generateApiKey();
    const parsed = parseApiToken(token);
    expect(parsed?.prefix).toBe(prefix);
    expect(parsed?.secret).toHaveLength(43);
  });

  it('rejects malformed tokens', () => {
    expect(parseApiToken('')).toBeNull();
    expect(parseApiToken(`sac_zzzzzzzzzzzz.${'a'.repeat(43)}`)).toBeNull();
    expect(parseApiToken('sac_0123456789ab.short')).toBeNull();
    expect(parseApiToken(`Bearer sac_0123456789ab.${'a'.repeat(43)}`)).toBeNull();
  });

  it('verifies only the matching secret and never stores it in the hash', async () => {
    const hash = await hashApiSecret('correct-secret', 1024);
    expect(hash).not.toContain('correct-secret');
    expect(await verifyApiSecret('correct-secret', hash)).toBe(true);
    expect(await verifyApiSecret('wrong-secret', hash)).toBe(false);
  });

  it('refuses malformed or unreasonable stored hashes', async () => {
    expect(await verifyApiSecret('x', 'plaintext')).toBe(false);
    expect(await verifyApiSecret('x', 'scrypt$1$AA==$AA==')).toBe(false);
  });
});

describe('scopes', () => {
  it('lets admin do everything', () => {
    expect(hasScope(['admin'], 'bans:write')).toBe(true);
  });

  it('lets write imply read for the same resource only', () => {
    expect(hasScope(['bans:write'], 'bans:read')).toBe(true);
    expect(hasScope(['bans:write'], 'players:read')).toBe(false);
    expect(hasScope(['bans:read'], 'bans:write')).toBe(false);
  });
});

describe('rate limiter', () => {
  it('allows a burst then reports a retry delay, then refills', () => {
    let now = 0;
    const limiter = createRateLimiter(2, 1, () => now);
    expect(limiter.take('a')).toBe(0);
    expect(limiter.take('a')).toBe(0);
    expect(limiter.take('a')).toBeGreaterThan(0);
    expect(limiter.take('b')).toBe(0);
    now += 1500;
    expect(limiter.take('a')).toBe(0);
  });
});
