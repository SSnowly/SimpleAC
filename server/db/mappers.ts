import type { Row } from './database.js';

export function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'number' || (typeof value === 'string' && /^\d+(\.\d+)?$/.test(value))) {
    const numeric = Number(value);
    // oxmysql returns epoch milliseconds; UNIX_TIMESTAMP() returns epoch seconds.
    return new Date(numeric > 1e11 ? numeric : Math.round(numeric * 1000)).toISOString();
  }
  if (typeof value === 'string') {
    const parsed = new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  throw new TypeError('unrecognized timestamp value from database');
}

export function toIsoOrNull(value: unknown): string | null {
  return value === null || value === undefined ? null : toIso(value);
}

export function toStringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

export function toJsonObject(value: unknown): Record<string, unknown> {
  let parsed: unknown = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      return {};
    }
  }
  return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
}

export function toJsonValue(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export function requireString(row: Row, column: string): string {
  const value = row[column];
  if (typeof value !== 'string') throw new TypeError(`column ${column} is not a string`);
  return value;
}

export function requireNumber(row: Row, column: string): number {
  const value = Number(row[column]);
  if (!Number.isFinite(value)) throw new TypeError(`column ${column} is not numeric`);
  return value;
}
