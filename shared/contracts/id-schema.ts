import { z } from 'zod';

export const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const ULID_LENGTH = 26;

export const idPrefixes = [
  'SAC-ACT',
  'SAC-DET',
  'SAC-CASE',
  'SAC-BAN',
  'SAC-EXC',
  'SAC-ALW',
  'SAC-PLY',
  'SAC-SES',
  'SAC-FP',
  'SAC-CAP',
  'SAC-OCR',
  'SAC-WATCH',
  'SAC-STR',
  'SAC-VOICE',
  'SAC-PRF',
  'SAC-KEY',
] as const;

export type IdPrefix = (typeof idPrefixes)[number];
export type SimpleAcId<P extends IdPrefix = IdPrefix> = `${P}-${string}` & {
  readonly __brand: 'SimpleAcId';
};

const idPattern = new RegExp(`^(${idPrefixes.join('|')})-[${CROCKFORD}]{${String(ULID_LENGTH)}}$`);

export const simpleAcIdSchema = z
  .string()
  .regex(idPattern)
  .transform((value) => value as SimpleAcId);

export function parseId(value: unknown): SimpleAcId {
  return simpleAcIdSchema.parse(value);
}
