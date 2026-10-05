import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { prepareForOcr } from '../../server/evidence/ocr/prepare.js';

function pngSize(bytes: Buffer): { width: number; height: number } {
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

describe('prepareForOcr', () => {
  const sample = readFileSync('tests/fixtures/ocr-sample.png');
  const original = pngSize(sample);

  it('returns the original when the width limit is off', () => {
    const result = prepareForOcr(sample, 0);
    expect(result.bytes).toBe(sample);
    expect(result.scale).toBe(1);
  });

  it('returns the original when it is already narrow enough', () => {
    const result = prepareForOcr(sample, original.width + 100);
    expect(result.bytes).toBe(sample);
  });

  it('scales a PNG down to the requested width and reports the factor', () => {
    const width = Math.floor(original.width / 2);
    const result = prepareForOcr(sample, width);
    const size = pngSize(result.bytes);
    expect(size.width).toBe(width);
    expect(size.height).toBe(Math.round((original.height * width) / original.width));
    expect(result.scale).toBeCloseTo(original.width / width, 5);
  });

  it('passes through data it cannot decode', () => {
    const junk = Buffer.from('not an image');
    expect(prepareForOcr(junk, 100).bytes).toBe(junk);
  });
});
