import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Database } from '../../server/db/database.js';
import type { OcrConfig } from '../../server/evidence/config.js';
import {
  editDistance,
  highestSeverity,
  matchText,
  normalizeText,
  parseRuleFile,
} from '../../server/evidence/ocr/rules.js';
import {
  createOcrService,
  createTesseractEngine,
  type OcrEngine,
  type OcrMatchEvent,
} from '../../server/evidence/ocr/service.js';

const rules = parseRuleFile(JSON.parse(readFileSync('configs/server/ocr-rules.json', 'utf8')));

describe('OCR rules', () => {
  it('ships a valid rule file', () => {
    expect(rules.rules.length).toBeGreaterThan(0);
    expect(rules.version).toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it('normalises recognised text', () => {
    expect(normalizeText('  Eulen—Executor v2.1!!\n')).toBe('eulen executor v2 1');
  });

  it('matches exact terms case-insensitively on word boundaries', () => {
    const hits = matchText('Menu: GODMODE enabled', rules);
    expect(hits.map((hit) => hit.term)).toContain('godmode');
    expect(matchText('the aimbotanist guild', rules)).toEqual([]);
  });

  it('matches fuzzy terms despite OCR errors, but not unrelated words', () => {
    expect(matchText('Eu1en loader', rules).some((hit) => hit.rule === 'executors')).toBe(true);
    expect(matchText('Eulen', rules).some((hit) => hit.rule === 'executors')).toBe(true);
    expect(matchText('hotel lobby', rules)).toEqual([]);
  });

  it('matches regex rules and phrase combinations', () => {
    expect(matchText('Click to inject the lua script now', rules).map((hit) => hit.rule)).toContain(
      'executor-ui',
    );
    const combo = matchText('godmode    noclip', rules).filter(
      (hit) => hit.rule === 'menu-combinations',
    );
    expect(combo).toHaveLength(1);
    expect(
      matchText('only godmode here', rules).some((hit) => hit.rule === 'menu-combinations'),
    ).toBe(false);
  });

  it('reports the highest severity and rejects invalid rule files', () => {
    expect(highestSeverity([])).toBeNull();
    expect(
      highestSeverity([
        { rule: 'a', kind: 'term', severity: 'low', term: 'x' },
        { rule: 'b', kind: 'term', severity: 'high', term: 'y' },
      ]),
    ).toBe('high');
    expect(() => parseRuleFile({ version: '1', rules: [{ id: 'x', kind: 'nope' }] })).toThrow();
    expect(() =>
      parseRuleFile({
        version: '1',
        rules: [{ id: 'x', kind: 'regex', severity: 'low', pattern: '(' }],
      }),
    ).toThrow();
  });

  it('computes bounded edit distance', () => {
    expect(editDistance('eulen', 'eu1en', 2)).toBe(1);
    expect(editDistance('abcdef', 'uvwxyz', 2)).toBeGreaterThan(2);
  });
});

function fakeDatabase(inserts: unknown[][]): Database {
  return {
    query: () => Promise.resolve([]),
    single: () => Promise.resolve(null),
    scalar: () => Promise.resolve(null),
    execute: (_query, values) => {
      inserts.push([...(values ?? [])]);
      return Promise.resolve(1);
    },
    transaction: () => Promise.resolve(true),
  };
}

const ocrConfig: OcrConfig = {
  enabled: true,
  workers: 1,
  queueLimit: 2,
  timeoutMs: 1000,
  maxWidth: 0,
  prepareWorkerFile: '',
  modulesDirectory: '',
  rulesFile: '',
};

function waitFor(condition: () => boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (condition()) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() - started > 5000) {
        clearInterval(timer);
        reject(new Error('timed out waiting'));
      }
    }, 5);
  });
}

describe('OCR service', () => {
  it('stores the result and raises a match event', async () => {
    const inserts: unknown[][] = [];
    const events: OcrMatchEvent[] = [];
    const engine: OcrEngine = {
      recognize: () =>
        Promise.resolve({
          text: 'Eulen Executor godmode',
          confidence: 91,
          words: [
            { text: 'Eulen', confidence: 95, box: { x0: 0, y0: 0, x1: 10, y1: 10 } },
            { text: 'godmode', confidence: 90, box: { x0: 12, y0: 0, x1: 40, y1: 10 } },
          ],
        }),
      close: () => Promise.resolve(),
    };
    const service = createOcrService({
      db: fakeDatabase(inserts),
      config: ocrConfig,
      rules,
      createEngine: () => engine,
      onMatch: (event) => events.push(event),
    });

    expect(
      service.enqueue({
        captureId: 'SAC-CAP-1',
        playerId: 'SAC-PLY-1',
        bytes: Buffer.from('x'),
        mediaType: 'image/jpeg',
      }),
    ).toBe('queued');
    await waitFor(() => events.length === 1);

    expect(inserts).toHaveLength(1);
    expect(inserts[0]?.[1]).toBe('SAC-CAP-1');
    expect(inserts[0]?.[5]).toBeCloseTo(0.91);
    const stored = JSON.parse(String(inserts[0]?.[4])) as { matches: unknown[]; words: unknown[] };
    expect(stored.matches.length).toBeGreaterThan(0);
    expect(stored.words).toHaveLength(2);
    expect(events[0]).toMatchObject({
      captureId: 'SAC-CAP-1',
      playerId: 'SAC-PLY-1',
      severity: 'high',
    });
    await service.close();
  });

  it('records clean text without raising an event', async () => {
    const inserts: unknown[][] = [];
    const events: OcrMatchEvent[] = [];
    const service = createOcrService({
      db: fakeDatabase(inserts),
      config: ocrConfig,
      rules,
      createEngine: () => ({
        recognize: () =>
          Promise.resolve({ text: 'Welcome to Los Santos', confidence: 88, words: [] }),
        close: () => Promise.resolve(),
      }),
      onMatch: (event) => events.push(event),
    });
    service.enqueue({
      captureId: 'SAC-CAP-2',
      playerId: 'p',
      bytes: Buffer.from('x'),
      mediaType: 'image/png',
    });
    await waitFor(() => inserts.length === 1);
    expect(events).toEqual([]);
    await service.close();
  });

  it('reports every result, with its match count, to the result callback', async () => {
    const inserts: unknown[][] = [];
    const results: { captureId: string; matchCount: number }[] = [];
    const texts = ['Welcome to Los Santos', 'eulen executor'];
    const service = createOcrService({
      db: fakeDatabase(inserts),
      config: ocrConfig,
      rules,
      createEngine: () => ({
        recognize: () => Promise.resolve({ text: texts.shift() ?? '', confidence: 90, words: [] }),
        close: () => Promise.resolve(),
      }),
      onMatch: () => undefined,
      onResult: (event) => results.push(event),
    });
    for (const captureId of ['SAC-CAP-CLEAN', 'SAC-CAP-HIT']) {
      service.enqueue({
        captureId,
        playerId: 'p',
        bytes: Buffer.from('x'),
        mediaType: 'image/png',
      });
    }
    await waitFor(() => results.length === 2);
    expect(results).toEqual([
      { captureId: 'SAC-CAP-CLEAN', matchCount: 0 },
      { captureId: 'SAC-CAP-HIT', matchCount: expect.any(Number) as number },
    ]);
    expect(results[1]?.matchCount).toBeGreaterThan(0);
    await service.close();
  });

  it('skips WebP, a full queue and a disabled service', () => {
    const service = createOcrService({
      db: fakeDatabase([]),
      config: ocrConfig,
      rules,
      createEngine: () => ({
        recognize: () => new Promise(() => undefined),
        close: () => Promise.resolve(),
      }),
      onMatch: () => undefined,
    });
    const job = { captureId: 'SAC-CAP-3', playerId: 'p', bytes: Buffer.from('x') };
    expect(service.enqueue({ ...job, mediaType: 'image/webp' })).toBe('skipped_format');
    expect(service.enqueue({ ...job, mediaType: 'image/jpeg' })).toBe('queued');
    expect(service.enqueue({ ...job, mediaType: 'image/jpeg' })).toBe('queued');
    expect(service.enqueue({ ...job, mediaType: 'image/jpeg' })).toBe('queued');
    expect(service.enqueue({ ...job, mediaType: 'image/jpeg' })).toBe('queue_full');

    const disabled = createOcrService({
      db: fakeDatabase([]),
      config: { ...ocrConfig, enabled: false },
      rules,
      createEngine: () => {
        throw new Error('not used');
      },
      onMatch: () => undefined,
    });
    expect(disabled.enqueue({ ...job, mediaType: 'image/jpeg' })).toBe('disabled');
  });

  it('survives a failing engine and keeps processing', async () => {
    const inserts: unknown[][] = [];
    let calls = 0;
    const service = createOcrService({
      db: fakeDatabase(inserts),
      config: ocrConfig,
      rules,
      createEngine: () => ({
        recognize: () => {
          calls += 1;
          return calls === 1
            ? Promise.reject(new Error('boom'))
            : Promise.resolve({ text: 'fine', confidence: 80, words: [] });
        },
        close: () => Promise.resolve(),
      }),
      onMatch: () => undefined,
    });
    const job = { playerId: 'p', bytes: Buffer.from('x'), mediaType: 'image/jpeg' };
    service.enqueue({ ...job, captureId: 'SAC-CAP-A' });
    service.enqueue({ ...job, captureId: 'SAC-CAP-B' });
    await waitFor(() => inserts.length === 1);
    expect(inserts[0]?.[1]).toBe('SAC-CAP-B');
    await service.close();
  });
});

describe('Tesseract engine', () => {
  it('reads text from a screenshot-like image offline', async () => {
    const engine = createTesseractEngine(
      join(process.cwd(), 'dist', 'ocr'),
      join(process.cwd(), 'node_modules', '.cache'),
    );
    try {
      const result = await engine.recognize(readFileSync('tests/fixtures/ocr-sample.png'));
      expect(normalizeText(result.text)).toContain('eulen executor');
      expect(result.words.length).toBeGreaterThan(3);
      expect(matchText(result.text, rules).some((hit) => hit.rule === 'executors')).toBe(true);
    } finally {
      await engine.close();
    }
  }, 60_000);
});
