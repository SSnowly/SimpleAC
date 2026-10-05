import { describe, expect, it } from 'vitest';
import { createId, parseId } from '../../shared/contracts/ids.js';

describe('SimpleAC IDs', () => {
  it('creates a valid domain-prefixed ULID', () => {
    const id = createId('SAC-DET', 1_700_000_000_000);
    expect(id).toMatch(/^SAC-DET-[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(parseId(id)).toBe(id);
  });

  it('is monotonic within one millisecond', () => {
    const first = createId('SAC-ACT', 1_700_000_000_001);
    const second = createId('SAC-ACT', 1_700_000_000_001);
    expect(second > first).toBe(true);
  });

  it('rejects an unknown domain', () => {
    expect(() => parseId('SAC-NOPE-01HF7YAT000000000000000000')).toThrow();
  });

  it('supports dedicated session IDs', () => {
    expect(createId('SAC-SES')).toMatch(/^SAC-SES-[0-9A-HJKMNP-TV-Z]{26}$/);
  });
});
