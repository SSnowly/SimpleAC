import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setHttpCallback } from '@citizenfx/http-wrapper';
import type { PanelConfigView } from '../shared/contracts/panel.js';
import { registerCommands } from './commands.js';
import { createOxmysqlDatabase } from './db/database.js';
import { loadEvidenceConfig } from './evidence/config.js';
import { parseRuleFile } from './evidence/ocr/rules.js';
import { createOcrService, createTesseractEngine } from './evidence/ocr/service.js';
import { createStorage } from './evidence/storage.js';
import {
  createCaptureBridge,
  createExceptionBridge,
  createGameBridge,
  createPanelGame,
} from './game/bridge.js';
import { createHttpApp, type HttpAppDeps } from './http/app.js';
import { loadWebConfig } from './panel/web-auth.js';
import { registerPanel } from './panel/wire.js';
import { createApiKeyService } from './services/api-keys.js';
import { createBanService } from './services/bans.js';
import { type CaptureService, createCaptureService } from './services/captures.js';
import { createCaseService } from './services/cases.js';
import { createDetectionService } from './services/detections.js';
import { createDirectory } from './services/directory.js';
import { createExceptionService } from './services/exceptions.js';
import { getHealth } from './services/health.js';
import { createIdempotencyStore } from './services/idempotency.js';
import { createOverviewService } from './services/overview.js';
import { createProfileService } from './services/profiles.js';

const db = createOxmysqlDatabase(exports.oxmysql);
const keys = createApiKeyService(db);
const idempotency = createIdempotencyStore(db);

const log = (
  level: 'info' | 'warn' | 'error',
  event: string,
  fields: Record<string, unknown> = {},
): void => {
  console.log(JSON.stringify({ level, event, resource: GetCurrentResourceName(), ...fields }));
};

interface EvidenceRuntime {
  service: CaptureService;
  maxUploadBytes: number;
  summary: PanelConfigView['evidence'];
}

function createEvidence(): EvidenceRuntime | undefined {
  try {
    const resourcePath = GetResourcePath(GetCurrentResourceName());
    const config = loadEvidenceConfig(GetConvar, resourcePath);
    const rules = parseRuleFile(JSON.parse(readFileSync(config.ocr.rulesFile, 'utf8')));
    const game = createCaptureBridge();
    // The capture service needs the OCR service and the OCR service reports back to it, so bind it afterwards.
    let captureService: { discardCleanSweep(id: string): Promise<boolean> } | undefined;
    const ocr = createOcrService({
      db,
      config: config.ocr,
      rules,
      createEngine: () =>
        createTesseractEngine(config.ocr.modulesDirectory, join(tmpdir(), 'simpleac-ocr'), {
          maxWidth: config.ocr.maxWidth,
          prepareWorkerFile: config.ocr.prepareWorkerFile,
        }),
      resourceName: GetCurrentResourceName(),
      onMatch: (event) => {
        game.ocrMatch(event);
      },
      onResult: ({ captureId, matchCount }) => {
        if (matchCount > 0 || config.keepCleanSweeps) return;
        void captureService?.discardCleanSweep(captureId).catch(() => undefined);
      },
      log: (event, fields) => {
        log('info', event, fields);
      },
    });
    const service = createCaptureService({
      db,
      storage: createStorage(config.storage),
      ocr,
      rules,
      game,
      retentionDays: config.retentionDays,
    });
    captureService = service;
    log('info', 'evidence_ready', {
      storage: config.storage.backend,
      maxBytes: config.maxBytes,
      ocr: config.ocr.enabled,
      retentionDays: config.retentionDays,
      keepCleanSweeps: config.keepCleanSweeps,
    });
    return {
      service,
      maxUploadBytes: config.maxBytes,
      summary: {
        storage: config.storage.backend,
        retentionDays: config.retentionDays,
        ocrEnabled: config.ocr.enabled,
        ocrMaxWidth: config.ocr.maxWidth,
        ocr: service.ocrRules(),
      },
    };
  } catch (error) {
    log('error', 'evidence_disabled', {
      error: error instanceof Error ? error.message : 'unknown error',
    });
    return undefined;
  }
}

const evidence = createEvidence();
const captures = evidence
  ? { service: evidence.service, maxUploadBytes: evidence.maxUploadBytes }
  : undefined;
const services = {
  directory: createDirectory(db),
  bans: createBanService(db, createGameBridge()),
  detections: createDetectionService(db),
  cases: createCaseService(db),
  exceptions: createExceptionService(db, createExceptionBridge()),
  profiles: createProfileService(db),
  overview: createOverviewService(db),
};
registerCommands(keys);
const panel = registerPanel({
  db,
  ...services,
  captures: evidence?.service,
  evidenceConfig: () =>
    evidence?.summary ?? {
      storage: 'unavailable',
      retentionDays: 0,
      ocrEnabled: false,
      ocrMaxWidth: 0,
      ocr: null,
    },
  game: createPanelGame(),
  log,
});
let browserPanel: HttpAppDeps['panel'];
try {
  const config = loadWebConfig(GetConvar);
  if (config) {
    browserPanel = {
      ...panel,
      config,
      assetsDirectory: join(GetResourcePath(GetCurrentResourceName()), 'dist/web/nui'),
    };
    log('info', 'browser_panel_ready', { url: config.url });
  }
} catch (error) {
  log('error', 'browser_panel_disabled', {
    error: error instanceof Error ? error.message : 'Invalid browser panel configuration',
  });
}
const app = createHttpApp({
  getHealth,
  keys,
  ...services,
  idempotency,
  ...(captures ? { captures } : {}),
  ...(browserPanel ? { panel: browserPanel } : {}),
});
const callback = app.callback();
setHttpCallback((request, response) => {
  void callback(request, response);
});

// Screenshots that reach the server through the game client (the latent-event transport) arrive here from Lua.
on('simpleac:internal:captureUpload', (captureId, token, mediaType, base64) => {
  if (
    !captures ||
    typeof captureId !== 'string' ||
    typeof token !== 'string' ||
    typeof mediaType !== 'string' ||
    typeof base64 !== 'string'
  ) {
    return;
  }
  captures.service
    .receiveInline({ captureId, token, mediaType, base64 })
    .catch((error: unknown) => {
      log('error', 'capture_upload_failed', {
        captureId,
        error: error instanceof Error ? error.message : 'unknown error',
      });
      emit('simpleac:internal:captureFailed', captureId);
    });
});

// Tables are created by the Lua migration runner; wait for it before touching them.
on('simpleac:internal:ready', () => {
  const prune = (): void => {
    idempotency.prune().catch(() => undefined);
    captures?.service.prune().catch(() => undefined);
  };
  prune();
  setInterval(prune, 5 * 60 * 1000).unref();
});

console.log(
  JSON.stringify({
    level: 'info',
    event: 'http_control_plane_started',
    resource: GetCurrentResourceName(),
  }),
);
