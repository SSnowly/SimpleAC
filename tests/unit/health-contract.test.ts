import { describe, expect, it } from 'vitest';
import { healthResponseSchema } from '../../shared/contracts/health.js';

describe('health response contract', () => {
  it('accepts a valid response', () => {
    const response = healthResponseSchema.parse({
      status: 'ready',
      resource: 'simpleac',
      version: '0.1.0',
      migrationVersion: 1,
      uptimeSeconds: 10,
      dependencies: { oxLib: 'started', oxmysql: 'started' },
      failure: null,
    });
    expect(response.status).toBe('ready');
  });

  it('rejects negative migration versions', () => {
    expect(() =>
      healthResponseSchema.parse({
        status: 'ready',
        resource: 'simpleac',
        version: '0.1.0',
        migrationVersion: -1,
        uptimeSeconds: 10,
        dependencies: { oxLib: 'started', oxmysql: 'started' },
        failure: null,
      }),
    ).toThrow();
  });
});
