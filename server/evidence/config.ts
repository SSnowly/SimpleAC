import { isAbsolute, join, normalize } from 'node:path';

export type StorageBackend = 'local' | 'fivemanage' | 's3';

export type StorageConfig =
  | { backend: 'local'; directory: string }
  | { backend: 'fivemanage'; apiKey: string }
  | {
      backend: 's3';
      /** Full endpoint for S3-compatible services (R2, MinIO, Backblaze). Omit for AWS. */
      endpoint: string | null;
      region: string;
      bucket: string;
      accessKey: string;
      secretKey: string;
      sessionToken: string | null;
      prefix: string;
      pathStyle: boolean;
      /** When set, stored objects are served from this base URL instead of presigned links. */
      publicBaseUrl: string | null;
      presignSeconds: number;
    };

export interface OcrConfig {
  enabled: boolean;
  workers: number;
  queueLimit: number;
  timeoutMs: number;
  /** Screenshots wider than this are read from a grayscale copy scaled to this width; 0 reads them as uploaded. */
  maxWidth: number;
  /** Bundled worker that prepares that copy. */
  prepareWorkerFile: string;
  /** Directory holding the vendored tesseract.js and language data. */
  modulesDirectory: string;
  rulesFile: string;
}

export interface EvidenceConfig {
  storage: StorageConfig;
  maxBytes: number;
  retentionDays: number;
  /** Keep the screenshot of a scheduled sweep even when OCR found nothing. */
  keepCleanSweeps: boolean;
  uploadTokenSeconds: number;
  ocr: OcrConfig;
}

export type ConvarReader = (name: string, fallback: string) => string;

function integer(
  read: ConvarReader,
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const value = Number.parseInt(read(name, String(fallback)), 10);
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${String(min)} and ${String(max)}`);
  }
  return value;
}

/** 0 turns the downscale off; otherwise a width between 320 and 3840. */
function ocrMaxWidth(read: ConvarReader): number {
  const width = integer(read, 'simpleac:ocr_max_width', 1280, 0, 3840);
  if (width !== 0 && width < 320)
    throw new Error('simpleac:ocr_max_width must be 0 or at least 320');
  return width;
}

function required(read: ConvarReader, name: string): string {
  const value = read(name, '').trim();
  if (value === '') throw new Error(`${name} is required for this storage backend`);
  return value;
}

function localDirectory(read: ConvarReader, resourcePath: string): string {
  const configured = read('simpleac:capture_local_dir', 'evidence').trim() || 'evidence';
  return isAbsolute(configured) ? normalize(configured) : join(resourcePath, configured);
}

/** Reads capture storage and OCR settings from convars. Secrets live in server-only (`set`) convars. */
export function loadEvidenceConfig(read: ConvarReader, resourcePath: string): EvidenceConfig {
  const backend = read('simpleac:capture_storage', 'local').trim().toLowerCase();
  let storage: StorageConfig;

  if (backend === 'local') {
    storage = { backend, directory: localDirectory(read, resourcePath) };
  } else if (backend === 'fivemanage') {
    storage = { backend, apiKey: required(read, 'simpleac:fivemanage_key') };
  } else if (backend === 's3') {
    const endpoint = read('simpleac:s3_endpoint', '').trim().replace(/\/+$/, '');
    if (endpoint !== '' && !/^https?:\/\//.test(endpoint)) {
      throw new Error('simpleac:s3_endpoint must start with http:// or https://');
    }
    const publicBase = read('simpleac:s3_public_base_url', '').trim().replace(/\/+$/, '');
    const prefix = read('simpleac:s3_prefix', 'simpleac/').trim().replace(/^\/+/, '');
    storage = {
      backend,
      endpoint: endpoint === '' ? null : endpoint,
      region: read('simpleac:s3_region', 'us-east-1').trim(),
      bucket: required(read, 'simpleac:s3_bucket'),
      accessKey: required(read, 'simpleac:s3_access_key'),
      secretKey: required(read, 'simpleac:s3_secret_key'),
      sessionToken: read('simpleac:s3_session_token', '').trim() || null,
      prefix: prefix === '' || prefix.endsWith('/') ? prefix : `${prefix}/`,
      pathStyle: read('simpleac:s3_path_style', endpoint === '' ? '0' : '1') === '1',
      publicBaseUrl: publicBase === '' ? null : publicBase,
      presignSeconds: integer(read, 'simpleac:s3_presign_seconds', 300, 30, 3600),
    };
  } else {
    throw new Error('simpleac:capture_storage must be local, fivemanage or s3');
  }

  return {
    storage,
    maxBytes: integer(
      read,
      'simpleac:capture_max_bytes',
      4 * 1024 * 1024,
      64 * 1024,
      32 * 1024 * 1024,
    ),
    retentionDays: integer(read, 'simpleac:capture_retention_days', 30, 0, 3650),
    keepCleanSweeps: read('simpleac:capture_keep_clean_sweeps', '0') === '1',
    uploadTokenSeconds: integer(read, 'simpleac:capture_token_seconds', 60, 10, 600),
    ocr: {
      enabled: read('simpleac:ocr_enabled', '1') === '1',
      workers: integer(read, 'simpleac:ocr_workers', 1, 1, 4),
      queueLimit: integer(read, 'simpleac:ocr_queue', 20, 1, 500),
      timeoutMs: integer(read, 'simpleac:ocr_timeout_ms', 30_000, 1000, 300_000),
      maxWidth: ocrMaxWidth(read),
      prepareWorkerFile: join(resourcePath, 'dist', 'server', 'ocr-prepare.js'),
      modulesDirectory: join(resourcePath, 'dist', 'ocr'),
      rulesFile: join(resourcePath, 'configs', 'server', 'ocr-rules.json'),
    },
  };
}
