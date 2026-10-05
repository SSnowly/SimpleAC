import { describe, expect, it } from 'vitest';
import { parseCaptureResult } from '../../server/game/bridge.js';

describe('Lua capture result', () => {
  it('accepts IDs as an array or as an index-keyed object', () => {
    expect(parseCaptureResult({ ok: true, ids: ['SAC-CAP-1', 'SAC-CAP-2'] })).toEqual({
      ok: true,
      ids: ['SAC-CAP-1', 'SAC-CAP-2'],
    });
    expect(parseCaptureResult({ ok: true, ids: { '1': 'SAC-CAP-1' } })).toEqual({
      ok: true,
      ids: ['SAC-CAP-1'],
    });
  });

  it('accepts an empty series (delayed captures have no ID yet)', () => {
    expect(parseCaptureResult({ ok: true, ids: {} })).toEqual({ ok: true, ids: [] });
    expect(parseCaptureResult({ ok: true })).toEqual({ ok: true, ids: [] });
  });

  it('turns failures into a reason', () => {
    expect(parseCaptureResult({ ok: false, reason: 'cooldown' })).toEqual({
      ok: false,
      reason: 'cooldown',
    });
    expect(parseCaptureResult(undefined)).toEqual({ ok: false, reason: 'unavailable' });
    expect(parseCaptureResult({ ok: false })).toEqual({ ok: false, reason: 'unavailable' });
  });
});
