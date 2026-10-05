import { createHash } from 'node:crypto';
import {
  type Capture,
  type CaptureDetail,
  type CreateCaptureRequest,
  captureDetailSchema,
  captureSchema,
  type OcrRules,
  ocrResultSchema,
  ocrRulesSchema,
} from '../../shared/contracts/api.js';
import type { Database } from '../db/database.js';
import { requireString, toIso, toIsoOrNull, toJsonValue, toStringOrNull } from '../db/mappers.js';
import { sniffImage } from '../evidence/images.js';
import type { OcrRuleFile } from '../evidence/ocr/rules.js';
import type { OcrMatchEvent, OcrService } from '../evidence/ocr/service.js';
import type { EvidenceStorage, OpenedObject } from '../evidence/storage.js';
import { ApiError, conflict, notFound } from '../http/errors.js';
import { actionStatement } from '../repositories/actions.js';
import type { Actor } from './bans.js';
import type { Page } from './directory.js';

export interface CaptureGame {
  /** Asks the Lua side to request screenshots from a connected player. */
  requestCapture(
    playerId: string,
    options: CreateCaptureRequest & { requestedBy: string },
  ): Promise<{ ok: true; ids: string[] } | { ok: false; reason: string }>;
  /** Tells the Lua side an upload finished so it can free its concurrency slot. */
  captureStored(captureId: string): void;
  /** Tells the Lua side that OCR found something worth linking to a case. */
  ocrMatch(event: OcrMatchEvent): void;
}

export interface CaptureActor {
  keyId: string;
  correlationId: string | undefined;
}

export interface CaptureService {
  /**
   * Upload that arrived through the game client (a latent server event) instead of HTTP. The capture ID must match
   * the one the token was issued for.
   */
  receiveInline(input: {
    captureId: string;
    token: string;
    mediaType: string;
    base64: string;
  }): Promise<{ id: string }>;
  receiveUpload(input: {
    token: string;
    bytes: Buffer;
    contentType: string | undefined;
    expectedCaptureId?: string;
  }): Promise<{ id: string }>;
  list(input: {
    playerId?: string;
    caseId?: string;
    status?: string;
    trigger?: string;
    /** Only captures whose OCR found at least one rule match. */
    ocrMatched?: boolean;
    limit: number;
    before?: string;
  }): Promise<Page<Capture>>;
  get(id: string): Promise<CaptureDetail | null>;
  openImage(id: string): Promise<OpenedObject | null>;
  /** The active OCR rule file, as staff see it. */
  ocrRules(): OcrRules;
  /** Reads the stored image again with the current OCR rules. */
  rescan(id: string, actor: Actor): Promise<{ captureId: string; status: string }>;
  /**
   * Drops the image of a scheduled sweep capture whose OCR found nothing, so routine sweeps do not fill the
   * storage. Captures from any other trigger are never touched.
   */
  discardCleanSweep(captureId: string): Promise<boolean>;
  /** Deletes the stored image. The record, its OCR text and the ledger entry stay. */
  remove(id: string, reason: string, actor: Actor): Promise<void>;
  request(
    playerId: string,
    input: CreateCaptureRequest,
    actor: CaptureActor,
  ): Promise<{ ids: string[] }>;
  /** Expires stale requests and deletes evidence past its retention. Returns the rows it touched. */
  prune(): Promise<number>;
}

export interface CaptureServiceDeps {
  db: Database;
  storage: EvidenceStorage;
  ocr: OcrService;
  rules: OcrRuleFile;
  game: CaptureGame;
  retentionDays: number;
}

const TS = (column: string): string => `UNIX_TIMESTAMP(${column}) AS ${column}`;

export const CAPTURE_COLUMNS = `id, player_id, detection_id, case_id, status, trigger_type, requested_by,
  media_type, byte_size, sha256, width, height, storage_backend, error,
  ${TS('created_at')}, ${TS('uploaded_at')}`;

const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

function nullableNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

export function mapCapture(row: Record<string, unknown>): Capture {
  return captureSchema.parse({
    id: requireString(row, 'id'),
    playerId: requireString(row, 'player_id'),
    detectionId: toStringOrNull(row['detection_id']),
    caseId: toStringOrNull(row['case_id']),
    status: requireString(row, 'status'),
    trigger: requireString(row, 'trigger_type'),
    requestedBy: requireString(row, 'requested_by'),
    mediaType: toStringOrNull(row['media_type']),
    byteSize: nullableNumber(row['byte_size']),
    sha256: toStringOrNull(row['sha256']),
    width: nullableNumber(row['width']),
    height: nullableNumber(row['height']),
    storageBackend: toStringOrNull(row['storage_backend']),
    error: toStringOrNull(row['error']),
    createdAt: toIso(row['created_at']),
    uploadedAt: toIsoOrNull(row['uploaded_at']),
  });
}

function mapOcr(row: Record<string, unknown>) {
  const stored = toJsonValue(row['matches_json']);
  const matches =
    typeof stored === 'object' && stored !== null && 'matches' in stored
      ? (stored as { matches: unknown }).matches
      : [];
  return ocrResultSchema.parse({
    id: requireString(row, 'id'),
    ruleVersion: requireString(row, 'rule_version'),
    text: toStringOrNull(row['raw_text']) ?? '',
    matches,
    confidence: nullableNumber(row['confidence']),
    durationMs: Number(row['duration_ms']),
    createdAt: toIso(row['created_at']),
  });
}

export function createCaptureService(deps: CaptureServiceDeps): CaptureService {
  const { db, storage, ocr, game, rules } = deps;

  const fail = async (id: string, reason: string): Promise<void> => {
    await db.execute(
      `UPDATE sac_captures SET status = 'failed', error = ?, token_hash = NULL WHERE id = ?`,
      [reason, id],
    );
  };

  const service: CaptureService = {
    async receiveInline({ captureId, token, mediaType, base64 }) {
      if (!BASE64.test(base64))
        throw new ApiError(400, 'bad_request', 'The upload is not valid base64.');
      const bytes = Buffer.from(base64, 'base64');
      return service.receiveUpload({
        token,
        bytes,
        contentType: mediaType,
        expectedCaptureId: captureId,
      });
    },

    async receiveUpload({ token, bytes, contentType, expectedCaptureId }) {
      const row = await db.single(
        `SELECT id, player_id, detection_id, status,
                (token_expires_at IS NOT NULL AND token_expires_at > CURRENT_TIMESTAMP(3)) AS live
         FROM sac_captures WHERE token_hash = ?`,
        [hashToken(token)],
      );
      if (!row) throw notFound('The upload token is not valid.');
      const id = requireString(row, 'id');
      if (expectedCaptureId !== undefined && expectedCaptureId !== id) {
        throw notFound('The upload token is not valid.');
      }
      const playerId = requireString(row, 'player_id');
      if (row['status'] !== 'requested' || Number(row['live']) !== 1) {
        throw conflict('The upload token has expired or was already used.');
      }

      // Claim the token before doing any work so it can only ever be spent once.
      const claimed = await db.execute(
        `UPDATE sac_captures SET status = 'uploading'
         WHERE id = ? AND status = 'requested' AND token_expires_at > CURRENT_TIMESTAMP(3)`,
        [id],
      );
      if (claimed !== 1) throw conflict('The upload token has expired or was already used.');

      const declared = contentType?.split(';')[0]?.trim().toLowerCase();
      const image = sniffImage(bytes);
      if (!image || !declared || !ALLOWED_TYPES.has(declared) || declared !== image.mediaType) {
        await fail(id, 'invalid_image');
        throw new ApiError(
          415,
          'unsupported_media_type',
          'The upload must be a JPEG, PNG or WebP image matching its content type.',
        );
      }

      const createdAt = new Date();
      let stored: Awaited<ReturnType<EvidenceStorage['put']>>;
      try {
        stored = await storage.put({ captureId: id, playerId, bytes, image, createdAt });
      } catch (error) {
        await fail(id, 'storage_error');
        console.error(
          JSON.stringify({
            level: 'error',
            event: 'capture_storage_failed',
            captureId: id,
            backend: storage.backend,
            error: error instanceof Error ? error.message : 'unknown error',
          }),
        );
        throw new ApiError(503, 'unavailable', 'The evidence could not be stored.');
      }

      const sha256 = createHash('sha256').update(bytes).digest('hex');
      const action = actionStatement({
        actorType: 'system',
        actorId: 'simpleac',
        actionType: 'capture.stored',
        targetType: 'player',
        targetId: playerId,
        reason: 'Screenshot uploaded',
        metadata: {
          captureId: id,
          backend: storage.backend,
          bytes: bytes.length,
          sha256,
        },
        origin: 'capture',
      });
      const statements = [
        {
          query: `UPDATE sac_captures
                  SET status = 'uploaded', storage_backend = ?, storage_key = ?, external_url = ?,
                      media_type = ?, byte_size = ?, sha256 = ?, width = ?, height = ?,
                      action_id = ?, uploaded_at = CURRENT_TIMESTAMP(3), token_hash = NULL
                  WHERE id = ?`,
          values: [
            storage.backend,
            stored.key,
            stored.url,
            image.mediaType,
            bytes.length,
            sha256,
            image.width,
            image.height,
            action.id,
            id,
          ],
        },
        { query: action.query, values: action.values },
      ];
      const detectionId = toStringOrNull(row['detection_id']);
      if (detectionId) {
        statements.push({
          query: `INSERT INTO sac_detection_evidence (detection_id, evidence_type, reference_id, payload_json)
                  VALUES (?, 'capture', ?, ?)`,
          values: [
            detectionId,
            id,
            JSON.stringify({ sha256, bytes: bytes.length, backend: storage.backend }),
          ],
        });
      }
      if (!(await db.transaction(statements))) {
        await storage.remove(stored.key).catch(() => undefined);
        await fail(id, 'persist_error');
        throw new ApiError(503, 'unavailable', 'The evidence could not be recorded.');
      }

      game.captureStored(id);
      ocr.enqueue({ captureId: id, playerId, bytes, mediaType: image.mediaType });
      return { id };
    },

    async list({ playerId, caseId, status, trigger, ocrMatched, limit, before }) {
      const conditions: string[] = [];
      const values: unknown[] = [];
      if (before) {
        conditions.push('id < ?');
        values.push(before);
      }
      if (playerId) {
        conditions.push('player_id = ?');
        values.push(playerId);
      }
      if (caseId) {
        conditions.push('case_id = ?');
        values.push(caseId);
      }
      if (status) {
        conditions.push('status = ?');
        values.push(status);
      }
      if (trigger) {
        conditions.push('trigger_type = ?');
        values.push(trigger);
      }
      if (ocrMatched) {
        conditions.push(`EXISTS (SELECT 1 FROM sac_ocr_results o WHERE o.capture_id = sac_captures.id
          AND JSON_LENGTH(JSON_EXTRACT(o.matches_json, '$.matches')) > 0)`);
      }
      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      const rows = await db.query(
        `SELECT ${CAPTURE_COLUMNS} FROM sac_captures ${where} ORDER BY id DESC LIMIT ?`,
        [...values, limit + 1],
      );
      const hasMore = rows.length > limit;
      const items = rows.slice(0, limit).map(mapCapture);
      return { items, nextBefore: hasMore ? (items.at(-1)?.id ?? null) : null };
    },

    async get(id) {
      const row = await db.single(`SELECT ${CAPTURE_COLUMNS} FROM sac_captures WHERE id = ?`, [id]);
      if (!row) return null;
      const ocrRows = await db.query(
        `SELECT id, rule_version, raw_text, matches_json, confidence, duration_ms, ${TS('created_at')}
         FROM sac_ocr_results WHERE capture_id = ? ORDER BY created_at DESC LIMIT 10`,
        [id],
      );
      return captureDetailSchema.parse({ ...mapCapture(row), ocr: ocrRows.map(mapOcr) });
    },

    async openImage(id) {
      const row = await db.single(
        `SELECT status, storage_key, external_url, media_type FROM sac_captures WHERE id = ?`,
        [id],
      );
      const key = row ? toStringOrNull(row['storage_key']) : null;
      const mediaType = row ? toStringOrNull(row['media_type']) : null;
      if (!row || row['status'] !== 'uploaded' || !key || !mediaType) return null;
      return storage.open({ key, url: toStringOrNull(row['external_url']), mediaType });
    },

    ocrRules() {
      return ocrRulesSchema.parse({
        version: rules.version,
        minimumWordConfidence: rules.minimumWordConfidence,
        rules: rules.rules.map((rule) => {
          const terms =
            rule.kind === 'regex'
              ? [rule.pattern]
              : rule.kind === 'phrase_all'
                ? rule.phrases
                : rule.terms;
          return {
            id: rule.id,
            kind: rule.kind,
            severity: rule.severity,
            termCount: terms.length,
            terms,
          };
        }),
      });
    },

    async rescan(id, actor) {
      const row = await db.single(
        `SELECT player_id, status, media_type FROM sac_captures WHERE id = ?`,
        [id],
      );
      if (!row) throw notFound('The capture does not exist.');
      const opened = await this.openImage(id);
      if (!opened) throw conflict('The capture has no stored image.');
      if (opened.kind !== 'bytes')
        throw conflict('The image is held by an external service and cannot be re-read.');

      const outcome = ocr.enqueue({
        captureId: id,
        playerId: requireString(row, 'player_id'),
        bytes: opened.bytes,
        mediaType: opened.mediaType,
      });
      if (outcome === 'queue_full') {
        throw new ApiError(429, 'rate_limited', 'The OCR queue is full. Try again shortly.', {
          headers: { 'retry-after': '5' },
        });
      }
      if (outcome === 'disabled') throw new ApiError(503, 'unavailable', 'OCR is not available.');
      if (outcome === 'skipped_format') throw conflict('OCR cannot read this image format.');

      await db.transaction([
        actionStatement({
          ...(actor.correlationId ? { correlationId: actor.correlationId } : {}),
          actorType: actor.type ?? 'web_api',
          actorId: actor.keyId,
          actionType: 'capture.rescan_requested',
          targetType: 'capture',
          targetId: id,
          reason: 'OCR re-run with the current rules',
          metadata: { captureId: id, ruleVersion: rules.version },
          origin: actor.origin ?? 'http_api',
        }),
      ]);
      return { captureId: id, status: 'queued' };
    },

    async discardCleanSweep(captureId) {
      const row = await db.single(
        `SELECT storage_key FROM sac_captures WHERE id = ? AND trigger_type = 'sweep' AND status = 'uploaded'
           AND detection_id IS NULL AND case_id IS NULL`,
        [captureId],
      );
      const key = row ? toStringOrNull(row['storage_key']) : null;
      if (!key) return false;
      const changed = await db.execute(
        `UPDATE sac_captures SET status = 'expired', error = 'sweep_clean', token_hash = NULL
         WHERE id = ? AND status = 'uploaded'`,
        [captureId],
      );
      if (changed === 0) return false;
      await storage.remove(key).catch(() => undefined);
      return true;
    },

    async remove(id, reason, actor) {
      const row = await db.single(`SELECT status, storage_key FROM sac_captures WHERE id = ?`, [
        id,
      ]);
      if (!row) throw notFound('The capture does not exist.');
      const key = toStringOrNull(row['storage_key']);
      if (row['status'] !== 'uploaded' || !key) throw conflict('The capture has no stored image.');

      const committed = await db.transaction([
        actionStatement({
          ...(actor.correlationId ? { correlationId: actor.correlationId } : {}),
          actorType: actor.type ?? 'web_api',
          actorId: actor.keyId,
          actionType: 'capture.deleted',
          targetType: 'capture',
          targetId: id,
          reason,
          metadata: { captureId: id },
          origin: actor.origin ?? 'http_api',
        }),
        {
          query: `UPDATE sac_captures SET status = 'expired', error = 'deleted_by_staff', token_hash = NULL
                  WHERE id = ? AND status = 'uploaded'`,
          values: [id],
        },
      ]);
      if (!committed) throw new Error('failed to record the capture deletion');
      await storage.remove(key).catch(() => undefined);
    },

    async request(playerId, input, actor) {
      const result = await game.requestCapture(playerId, {
        ...input,
        requestedBy: actor.keyId,
      });
      if (!result.ok) {
        if (result.reason === 'player_offline') throw conflict('The player is not connected.');
        if (result.reason === 'cooldown' || result.reason === 'busy') {
          throw new ApiError(429, 'rate_limited', 'Captures are rate limited. Try again shortly.', {
            headers: { 'retry-after': '5' },
          });
        }
        throw new ApiError(503, 'unavailable', 'The capture could not be requested.');
      }
      return { ids: result.ids };
    },

    async prune() {
      let touched = 0;
      touched += await db.execute(
        `UPDATE sac_captures SET status = 'expired', error = 'upload_expired', token_hash = NULL
         WHERE status = 'requested' AND token_expires_at < CURRENT_TIMESTAMP(3)`,
      );
      touched += await db.execute(
        `UPDATE sac_captures SET status = 'failed', error = 'upload_stalled', token_hash = NULL
         WHERE status = 'uploading' AND created_at < (CURRENT_TIMESTAMP(3) - INTERVAL 10 MINUTE)`,
      );
      if (deps.retentionDays > 0) {
        const old = await db.query(
          `SELECT id, storage_key FROM sac_captures
           WHERE status = 'uploaded' AND uploaded_at < (CURRENT_TIMESTAMP(3) - INTERVAL ? DAY)
           ORDER BY uploaded_at LIMIT 100`,
          [deps.retentionDays],
        );
        for (const row of old) {
          const key = toStringOrNull(row['storage_key']);
          if (key) await storage.remove(key).catch(() => undefined);
          touched += await db.execute(
            `UPDATE sac_captures
             SET status = 'expired', storage_key = NULL, external_url = NULL, error = 'retention'
             WHERE id = ?`,
            [requireString(row, 'id')],
          );
        }
      }
      return touched;
    },
  };
  return service;
}
