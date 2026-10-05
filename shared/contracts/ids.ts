import { webcrypto } from 'node:crypto';
import { CROCKFORD, type IdPrefix, type SimpleAcId } from './id-schema.js';

export {
  type IdPrefix,
  idPrefixes,
  parseId,
  type SimpleAcId,
  simpleAcIdSchema,
} from './id-schema.js';

let lastTimestamp = -1;
let lastRandom: Uint8Array = new Uint8Array(16);

function alphabetAt(index: number): string {
  const character = CROCKFORD[index];
  if (character === undefined) throw new Error('invalid Crockford Base32 index');
  return character;
}

function encodeTime(timestamp: number): string {
  let remaining = timestamp;
  let encoded = '';
  for (let index = 0; index < 10; index += 1) {
    encoded = alphabetAt(remaining % 32) + encoded;
    remaining = Math.floor(remaining / 32);
  }
  return encoded;
}

function randomBytes(): Uint8Array {
  const bytes = new Uint8Array(16);
  webcrypto.getRandomValues(bytes);
  return bytes;
}

function incrementRandom(bytes: Uint8Array): Uint8Array {
  const next = bytes.slice();
  for (let index = next.length - 1; index >= 0; index -= 1) {
    const value = next[index];
    if (value === undefined) throw new Error('invalid ULID entropy state');
    next[index] = (value + 1) & 31;
    if (next[index] !== 0) return next;
  }
  throw new Error('monotonic ULID entropy exhausted for the current millisecond');
}

function encodeRandom(bytes: Uint8Array): string {
  let encoded = '';
  for (const value of bytes) {
    encoded += alphabetAt(value & 31);
  }
  return encoded;
}

export function createId<P extends IdPrefix>(prefix: P, now = Date.now()): SimpleAcId<P> {
  if (!Number.isSafeInteger(now) || now < 0 || now > 281_474_976_710_655) {
    throw new RangeError('ULID timestamp must be an unsigned 48-bit integer');
  }
  if (now < lastTimestamp) now = lastTimestamp;
  lastRandom = now === lastTimestamp ? incrementRandom(lastRandom) : randomBytes();
  lastTimestamp = now;
  return `${prefix}-${encodeTime(now)}${encodeRandom(lastRandom)}` as SimpleAcId<P>;
}
