import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { createId } from '../../../shared/contracts/ids.js';
import type { Database } from '../../db/database.js';
import type { OcrConfig } from '../config.js';
import { highestSeverity, matchText, type OcrMatch, type OcrRuleFile } from './rules.js';

export interface OcrWord {
  text: string;
  confidence: number;
  box: { x0: number; y0: number; x1: number; y1: number };
}

export interface OcrRecognition {
  text: string;
  /** Overall confidence, 0-100. */
  confidence: number;
  words: OcrWord[];
}

/** One recognition worker. The Tesseract-backed implementation is swappable in tests. */
export interface OcrEngine {
  recognize(bytes: Buffer): Promise<OcrRecognition>;
  close(): Promise<void>;
}

export interface OcrJob {
  captureId: string;
  playerId: string;
  bytes: Buffer;
  mediaType: string;
}

export interface OcrMatchEvent {
  captureId: string;
  playerId: string;
  resultId: string;
  severity: string;
  terms: string;
  matchCount: number;
}

export interface OcrService {
  enqueue(job: OcrJob): 'queued' | 'skipped_format' | 'queue_full' | 'disabled';
  pending(): number;
  close(): Promise<void>;
}

export interface OcrDeps {
  db: Database;
  config: OcrConfig;
  rules: OcrRuleFile;
  createEngine: () => OcrEngine;
  onMatch: (event: OcrMatchEvent) => void;
  /** Called after every stored result, with or without matches. */
  onResult?: (event: { captureId: string; matchCount: number }) => void;
  log?: (event: string, fields: Record<string, unknown>) => void;
  /** Resource name shown in the worker-permission hint. */
  resourceName?: string;
}

// Tesseract's bundled image readers cover JPEG and PNG; WebP captures are stored but not recognised.
const SUPPORTED = new Set(['image/jpeg', 'image/png']);
const MAX_RAW_TEXT = 20_000;
const MAX_WORDS = 300;

interface TesseractWorker {
  recognize(
    image: Buffer,
    options: Record<string, unknown>,
    output: Record<string, boolean>,
  ): Promise<{
    data: {
      text: string;
      confidence: number;
      blocks?:
        | {
            paragraphs: {
              lines: {
                words: {
                  text: string;
                  confidence: number;
                  bbox: { x0: number; y0: number; x1: number; y1: number };
                }[];
              }[];
            }[];
          }[]
        | null;
    };
  }>;
  setParameters(parameters: Record<string, string>): Promise<unknown>;
  terminate(): Promise<unknown>;
}

interface TesseractModule {
  createWorker(
    language: string,
    oem: number,
    options: Record<string, unknown>,
  ): Promise<TesseractWorker>;
}

/** Loads the vendored tesseract.js (dist/ocr) and falls back to the project's own node_modules in development. */
export interface TesseractEngineOptions {
  /** Screenshots wider than this are converted to a grayscale copy of this width before recognition. 0 disables. */
  maxWidth?: number;
  /** Bundled `prepare-worker.js`. Without it (or if a worker cannot start) screenshots are read as uploaded. */
  prepareWorkerFile?: string;
}

/** Runs image preparation on its own thread so decoding never stalls FXServer's main thread. */
function createPreparer(file: string | undefined, maxWidth: number) {
  let worker: Worker | undefined;
  let nextId = 0;
  const waiting = new Map<number, (result: { bytes: Buffer; scale: number } | null) => void>();

  const stop = (): void => {
    const current = worker;
    worker = undefined;
    for (const resolve of waiting.values()) resolve(null);
    waiting.clear();
    void current?.terminate();
  };

  const start = (): Worker | undefined => {
    if (!file || maxWidth <= 0 || !existsSync(file)) return undefined;
    try {
      const created = new Worker(file);
      created.on('message', (message: { id: number; bytes: Uint8Array; scale: number }) => {
        waiting.get(message.id)?.({ bytes: Buffer.from(message.bytes), scale: message.scale });
        waiting.delete(message.id);
      });
      created.on('error', stop);
      created.on('exit', () => {
        if (worker === created) stop();
      });
      return created;
    } catch {
      return undefined;
    }
  };

  return {
    async prepare(bytes: Buffer): Promise<{ bytes: Buffer; scale: number }> {
      const unchanged = { bytes, scale: 1 };
      worker ??= start();
      const active = worker;
      if (!active) return unchanged;
      const id = nextId++;
      const result = await new Promise<{ bytes: Buffer; scale: number } | null>((resolve) => {
        waiting.set(id, resolve);
        active.postMessage({ id, bytes: new Uint8Array(bytes), maxWidth });
      });
      return result ?? unchanged;
    },
    close: stop,
  };
}

export function createTesseractEngine(
  modulesDirectory: string,
  cacheDirectory: string,
  options: TesseractEngineOptions = {},
): OcrEngine {
  let workerPromise: Promise<TesseractWorker> | undefined;
  const preparer = createPreparer(options.prepareWorkerFile, options.maxWidth ?? 0);

  const start = async (): Promise<TesseractWorker> => {
    const candidates = [
      join(modulesDirectory, 'package.json'),
      join(modulesDirectory, '..', '..', 'package.json'),
    ];
    let loaded: { module: TesseractModule; languagePath: string } | undefined;
    for (const candidate of candidates) {
      try {
        const require = createRequire(candidate);
        const module = require('tesseract.js') as TesseractModule;
        const languagePath = join(
          dirname(require.resolve('@tesseract.js-data/eng/package.json')),
          '4.0.0_best_int',
        );
        loaded = { module, languagePath };
        break;
      } catch {
        // try the next location
      }
    }
    if (!loaded)
      throw new Error('tesseract.js is not installed (run the build to vendor dist/ocr)');
    const worker = await loaded.module.createWorker('eng', 1, {
      langPath: loaded.languagePath,
      cachePath: cacheDirectory,
      // The language data is read straight from the resource; nothing is written outside it.
      cacheMethod: 'none',
      gzip: true,
      logger: () => undefined,
    });
    // Screens are scattered UI text, not a page: sparse-text mode skips page layout analysis, which is most of the
    // time spent on a busy 3D scene.
    await worker.setParameters({ tessedit_pageseg_mode: '11' });
    return worker;
  };

  return {
    async recognize(bytes) {
      workerPromise ??= start();
      const [worker, prepared] = await Promise.all([workerPromise, preparer.prepare(bytes)]);
      const { scale } = prepared;
      const { data } = await worker.recognize(prepared.bytes, {}, { text: true, blocks: true });
      const words: OcrWord[] = [];
      for (const block of data.blocks ?? []) {
        for (const paragraph of block.paragraphs) {
          for (const line of paragraph.lines) {
            for (const word of line.words) {
              const { x0, y0, x1, y1 } = word.bbox;
              words.push({
                text: word.text,
                confidence: word.confidence,
                // Boxes are reported in the coordinates of the screenshot that was uploaded.
                box: {
                  x0: Math.round(x0 * scale),
                  y0: Math.round(y0 * scale),
                  x1: Math.round(x1 * scale),
                  y1: Math.round(y1 * scale),
                },
              });
            }
          }
        }
      }
      return { text: data.text, confidence: data.confidence, words };
    },
    async close() {
      preparer.close();
      if (!workerPromise) return;
      const pending = workerPromise;
      workerPromise = undefined;
      await pending.then((worker) => worker.terminate()).catch(() => undefined);
    },
  };
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('OCR timed out')), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error('OCR failed'));
      },
    );
  });
}

export function createOcrService(deps: OcrDeps): OcrService {
  const { db, config, rules } = deps;
  const log = deps.log ?? (() => undefined);
  const resourceName = deps.resourceName ?? 'SimpleAC';
  const queue: OcrJob[] = [];
  let blocked = false;
  const engines: { engine: OcrEngine; busy: boolean }[] = [];

  const process = async (engine: OcrEngine, job: OcrJob): Promise<void> => {
    const started = Date.now();
    const result = await withTimeout(engine.recognize(job.bytes), config.timeoutMs);
    const threshold = rules.minimumWordConfidence;
    const confident = result.words.filter((word) => word.confidence >= threshold);
    const text = confident.length > 0 ? confident.map((word) => word.text).join(' ') : result.text;
    const matches: OcrMatch[] = matchText(text, rules);
    const resultId = createId('SAC-OCR');

    await db.execute(
      `INSERT INTO sac_ocr_results (id, capture_id, rule_version, raw_text, matches_json, confidence, duration_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        resultId,
        job.captureId,
        rules.version,
        result.text.slice(0, MAX_RAW_TEXT),
        JSON.stringify({ matches, words: result.words.slice(0, MAX_WORDS) }),
        Math.max(0, Math.min(9.9999, result.confidence / 100)),
        Date.now() - started,
      ],
    );
    log('ocr_completed', {
      captureId: job.captureId,
      matches: matches.length,
      durationMs: Date.now() - started,
    });

    deps.onResult?.({ captureId: job.captureId, matchCount: matches.length });

    if (matches.length > 0) {
      deps.onMatch({
        captureId: job.captureId,
        playerId: job.playerId,
        resultId,
        severity: highestSeverity(matches) ?? 'low',
        terms: [...new Set(matches.map((match) => match.term))]
          .slice(0, 5)
          .join(', ')
          .slice(0, 200),
        matchCount: matches.length,
      });
    }
  };

  const pump = (): void => {
    for (const slot of engines) {
      if (slot.busy) continue;
      const job = queue.shift();
      if (!job) return;
      slot.busy = true;
      process(slot.engine, job)
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : 'unknown error';
          if (/restricted|permission|not allowed/i.test(message) && !blocked) {
            // FXServer blocks worker threads unless the resource is allowed in server.cfg.
            blocked = true;
            queue.length = 0;
            log('ocr_unavailable', {
              error: message,
              hint: `Add: add_unsafe_worker_permission "${resourceName}" to server.cfg, then restart the server. Screenshots are still stored.`,
            });
          } else {
            log('ocr_failed', { captureId: job.captureId, error: message });
          }
          // A timed-out or crashed worker is replaced rather than reused.
          void slot.engine.close();
        })
        .finally(() => {
          slot.busy = false;
          pump();
        });
    }
  };

  return {
    enqueue(job) {
      if (!config.enabled || blocked) return 'disabled';
      if (!SUPPORTED.has(job.mediaType)) {
        log('ocr_skipped', {
          captureId: job.captureId,
          reason: 'unsupported_format',
          mediaType: job.mediaType,
        });
        return 'skipped_format';
      }
      if (queue.length >= config.queueLimit) {
        log('ocr_skipped', { captureId: job.captureId, reason: 'queue_full' });
        return 'queue_full';
      }
      while (engines.length < config.workers)
        engines.push({ engine: deps.createEngine(), busy: false });
      queue.push(job);
      pump();
      return 'queued';
    },
    pending: () => queue.length + engines.filter((slot) => slot.busy).length,
    async close() {
      queue.length = 0;
      await Promise.all(engines.map((slot) => slot.engine.close()));
    },
  };
}
