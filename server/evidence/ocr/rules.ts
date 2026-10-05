import { z } from 'zod';

const severity = z.enum(['low', 'medium', 'high']);
const id = z.string().regex(/^[a-z0-9][a-z0-9_.-]{0,63}$/);
const terms = z.array(z.string().trim().min(2).max(64)).min(1).max(500);

const ruleSchema = z.discriminatedUnion('kind', [
  z.object({ id, kind: z.literal('term'), severity, terms }),
  z.object({
    id,
    kind: z.literal('fuzzy'),
    severity,
    terms,
    /** Maximum edit distance, further capped at a quarter of the term's length. */
    maxDistance: z.number().int().min(1).max(3).default(1),
  }),
  z.object({
    id,
    kind: z.literal('regex'),
    severity,
    pattern: z.string().min(1).max(512),
    flags: z
      .string()
      .regex(/^[imsu]*$/)
      .default('i'),
  }),
  z.object({
    id,
    kind: z.literal('phrase_all'),
    severity,
    phrases: z.array(z.string().trim().min(2).max(64)).min(2).max(10),
  }),
]);

export const ocrRuleFileSchema = z.object({
  version: z.string().min(1).max(40),
  /** Words below this Tesseract confidence (0-100) are ignored. */
  minimumWordConfidence: z.number().min(0).max(100).default(40),
  rules: z.array(ruleSchema).max(200),
});

export type OcrRule = z.infer<typeof ruleSchema>;
export type OcrRuleFile = z.infer<typeof ocrRuleFileSchema>;
export type OcrSeverity = z.infer<typeof severity>;

export interface OcrMatch {
  rule: string;
  kind: OcrRule['kind'];
  severity: OcrSeverity;
  /** The configured term/phrase/pattern that matched. */
  term: string;
}

const MAX_TEXT = 50_000;

/** Lowercases and reduces everything that is not a letter or digit to single spaces. */
export function normalizeText(text: string): string {
  return text
    .slice(0, MAX_TEXT)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export function editDistance(a: string, b: string, limit: number): number {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let row = 1; row <= a.length; row += 1) {
    const current = [row];
    let best = row;
    for (let column = 1; column <= b.length; column += 1) {
      const cost = a[row - 1] === b[column - 1] ? 0 : 1;
      const value = Math.min(
        (previous[column] ?? 0) + 1,
        (current[column - 1] ?? 0) + 1,
        (previous[column - 1] ?? 0) + cost,
      );
      current.push(value);
      if (value < best) best = value;
    }
    if (best > limit) return limit + 1;
    previous = current;
  }
  return previous[b.length] ?? limit + 1;
}

const hasPhrase = (padded: string, phrase: string): boolean =>
  padded.includes(` ${normalizeText(phrase)} `);

function fuzzyHit(words: string[], term: string, maxDistance: number): boolean {
  const target = normalizeText(term);
  if (target === '') return false;
  const size = target.split(' ').length;
  const limit = Math.min(maxDistance, Math.floor(target.length / 4));
  if (limit < 1) return false;
  for (let start = 0; start + size <= words.length; start += 1) {
    const candidate = words.slice(start, start + size).join(' ');
    if (editDistance(candidate, target, limit) <= limit) return true;
  }
  return false;
}

/** Applies the configured rules to recognised text. Exact, fuzzy, regex and phrase-combination rules. */
export function matchText(text: string, file: OcrRuleFile): OcrMatch[] {
  const normalized = normalizeText(text);
  if (normalized === '') return [];
  const padded = ` ${normalized} `;
  const words = normalized.split(' ');
  const raw = text.slice(0, MAX_TEXT);
  const matches: OcrMatch[] = [];

  for (const rule of file.rules) {
    const add = (term: string): void => {
      matches.push({ rule: rule.id, kind: rule.kind, severity: rule.severity, term });
    };

    if (rule.kind === 'term') {
      for (const term of rule.terms) if (hasPhrase(padded, term)) add(term);
    } else if (rule.kind === 'fuzzy') {
      for (const term of rule.terms) {
        if (hasPhrase(padded, term) || fuzzyHit(words, term, rule.maxDistance)) add(term);
      }
    } else if (rule.kind === 'regex') {
      try {
        if (new RegExp(rule.pattern, rule.flags).test(raw)) add(rule.pattern);
      } catch {
        // An invalid pattern is reported when the file is loaded; skip it here.
      }
    } else if (rule.phrases.every((phrase) => hasPhrase(padded, phrase))) {
      add(rule.phrases.join(' + '));
    }
  }
  return matches;
}

export function parseRuleFile(value: unknown): OcrRuleFile {
  const file = ocrRuleFileSchema.parse(value);
  for (const rule of file.rules) {
    if (rule.kind === 'regex') new RegExp(rule.pattern, rule.flags);
  }
  return file;
}

const RANK: Record<OcrSeverity, number> = { low: 1, medium: 2, high: 3 };

export function highestSeverity(matches: readonly OcrMatch[]): OcrSeverity | null {
  let best: OcrSeverity | null = null;
  for (const match of matches) {
    if (best === null || RANK[match.severity] > RANK[best]) best = match.severity;
  }
  return best;
}
