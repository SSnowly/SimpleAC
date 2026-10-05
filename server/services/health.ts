import type { HealthResponse } from '../../shared/contracts/health.js';

const startedAt = Date.now();
let status: HealthResponse['status'] = 'booting';
let migrationVersion: number | null = null;
let failure: string | null = null;

on('simpleac:internal:ready', (version: unknown) => {
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 0) {
    status = 'degraded';
    failure = 'invalid_migration_version';
    return;
  }
  migrationVersion = version;
  status = 'ready';
  failure = null;
});

on('simpleac:internal:startupFailed', (reason: unknown) => {
  status = 'degraded';
  failure = typeof reason === 'string' ? reason : 'unknown_startup_failure';
});

function onGameThread<T>(operation: () => T): Promise<T> {
  return new Promise((resolve, reject) => {
    setImmediate(() => {
      try {
        resolve(operation());
      } catch (error: unknown) {
        reject(error instanceof Error ? error : new Error('CitizenFX native call failed'));
      }
    });
  });
}

export async function getHealth(): Promise<HealthResponse> {
  const [resource, version, oxLib, oxmysql] = await onGameThread(() => {
    const currentResource = GetCurrentResourceName();
    return [
      currentResource,
      GetResourceMetadata(currentResource, 'version', 0) ?? 'unknown',
      GetResourceState('ox_lib'),
      GetResourceState('oxmysql'),
    ] as const;
  });
  const dependenciesReady = oxLib === 'started' && oxmysql === 'started';
  return {
    status: dependenciesReady ? status : 'degraded',
    resource,
    version,
    migrationVersion,
    uptimeSeconds: (Date.now() - startedAt) / 1000,
    dependencies: { oxLib, oxmysql },
    failure: dependenciesReady ? failure : 'dependency_unavailable',
  };
}
