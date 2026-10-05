import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const SCRYPT_N = 16_384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 32;
const TOKEN_PATTERN = /^sac_([0-9a-f]{12})\.([A-Za-z0-9_-]{43})$/;

export interface GeneratedApiKey {
  prefix: string;
  token: string;
}

export function generateApiKey(): GeneratedApiKey {
  const prefix = randomBytes(6).toString('hex');
  const secret = randomBytes(32).toString('base64url');
  return { prefix, token: `sac_${prefix}.${secret}` };
}

export function parseApiToken(token: string): { prefix: string; secret: string } | null {
  const match = TOKEN_PATTERN.exec(token);
  if (!match?.[1] || !match[2]) return null;
  return { prefix: match[1], secret: match[2] };
}

function derive(secret: string, salt: Buffer, cost: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(secret, salt, KEY_LENGTH, { N: cost, r: SCRYPT_R, p: SCRYPT_P }, (error, derived) => {
      if (error) reject(error);
      else resolve(derived);
    });
  });
}

export async function hashApiSecret(secret: string, cost = SCRYPT_N): Promise<string> {
  const salt = randomBytes(16);
  const derived = await derive(secret, salt, cost);
  return `scrypt$${String(cost)}$${salt.toString('base64')}$${derived.toString('base64')}`;
}

export async function verifyApiSecret(secret: string, stored: string): Promise<boolean> {
  const [scheme, costText, saltText, hashText] = stored.split('$');
  if (scheme !== 'scrypt' || !costText || !saltText || !hashText) return false;
  const cost = Number(costText);
  if (!Number.isInteger(cost) || cost < 1024 || cost > 1_048_576) return false;
  const expected = Buffer.from(hashText, 'base64');
  const actual = await derive(secret, Buffer.from(saltText, 'base64'), cost);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/** Cache key that never stores the raw token. */
export function tokenDigest(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
