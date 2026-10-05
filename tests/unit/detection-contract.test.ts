import { describe, expect, it } from 'vitest';
import {
  detectionDecisionSchema,
  detectionSignalSchema,
} from '../../shared/contracts/detections.js';

describe('detection contracts', () => {
  it('accepts a normalized server signal', () => {
    const signal = detectionSignalSchema.parse({
      rule: 'network.entity_rate',
      source: 12,
      measured: { count: 41, limit: 40 },
      resourceName: 'vehicle_shop',
    });
    expect(signal.rule).toBe('network.entity_rate');
  });

  it('rejects invalid player sources and rule keys', () => {
    expect(() =>
      detectionSignalSchema.parse({ rule: '../bad', source: 0, measured: {} }),
    ).toThrow();
  });

  it('validates a prevention decision', () => {
    const decision = detectionDecisionSchema.parse({
      accepted: true,
      reason: 'detected',
      detectionId: 'SAC-DET-01HF7YAT000000000000000000',
      severity: 90,
      confidence: 0.95,
      score: 85.5,
      cumulativeRisk: 85.5,
      cancel: true,
      outcome: 'cancel',
    });
    expect(decision.cancel).toBe(true);
  });
});
