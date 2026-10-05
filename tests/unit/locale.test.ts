import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

type Tree = { [key: string]: string | Tree };

function flatten(
  tree: Tree,
  prefix = '',
  into: Record<string, string> = {},
): Record<string, string> {
  for (const [key, value] of Object.entries(tree)) {
    const full = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') into[full] = value;
    else flatten(value, full, into);
  }
  return into;
}

function files(directory: string, extensions: string[]): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return name === 'node_modules' ? [] : files(path, extensions);
    return extensions.some((extension) => name.endsWith(extension)) ? [path] : [];
  });
}

const english = flatten(JSON.parse(readFileSync('locales/en.json', 'utf8')) as Tree);

// The panel (TypeScript) and the game scripts (Lua) both read this one file.
const panelSources = [...files('web/nui/src', ['.ts', '.tsx'])].filter(
  (path) => !path.includes('dev-backend'),
);
const luaSources = ['client', 'server-lua', 'bridge', 'shared'].flatMap((directory) =>
  files(directory, ['.lua']),
);

const usedInPanel = new Set<string>();
for (const path of panelSources) {
  const source = readFileSync(path, 'utf8');
  for (const match of source.matchAll(/\bt\(\s*'([a-z0-9_.]+)'/g)) usedInPanel.add(match[1] ?? '');
  // Tour steps and filter lists name their keys as plain strings.
  for (const match of source.matchAll(/'((?:tour|nav|nav_desc)\.[a-z0-9_.]+)'/g))
    usedInPanel.add(match[1] ?? '');
}
const usedInLua = new Set<string>();
for (const path of luaSources) {
  for (const match of readFileSync(path, 'utf8').matchAll(/\blocale\(\s*'([a-z0-9_.]+)'/g)) {
    usedInLua.add(match[1] ?? '');
  }
}

/** Keys built at run time (`t(`rules.${key}`)`), so a literal search cannot see them being used. */
const DYNAMIC = [
  'rules.',
  'actions.',
  'categories.',
  'permissions.',
  'modes.',
  'theme.',
  'triggers.',
  'color.',
  'records.capture_',
  'records.case_',
  'records.status_',
  'detections.measured_',
  'detections.filter_',
  'cases.field_',
  'cases.status_',
  'cases.filter_',
  'player.duration_',
  'player.action_',
  'exceptions.length_',
  'exceptions.type_',
  'exceptions.scope_',
  'exceptions.effect_',
  'exceptions.hint_',
  'live.ended_',
  'player.tab_',
  'tour.',
  'nav.',
  'nav_desc.',
  'errors.',
];

describe('locale file', () => {
  it('holds only text', () => {
    for (const [key, value] of Object.entries(english)) {
      expect(typeof value, key).toBe('string');
      expect(value.length, key).toBeGreaterThan(0);
    }
  });

  it('has every key the panel asks for', () => {
    const missing = [...usedInPanel].filter((key) => key && !(key in english));
    expect(missing).toEqual([]);
  });

  it('has every key the game scripts ask for', () => {
    const missing = [...usedInLua].filter((key) => !(key in english));
    expect(missing).toEqual([]);
  });

  it('has no key that nothing uses', () => {
    const unused = Object.keys(english).filter(
      (key) =>
        !usedInPanel.has(key) &&
        !usedInLua.has(key) &&
        !DYNAMIC.some((prefix) => key.startsWith(prefix)),
    );
    expect(unused).toEqual([]);
  });

  it('names every detection rule and every ledger action the panel can show', () => {
    const profile = readFileSync('configs/server/profile.lua', 'utf8');
    const rules = [...profile.matchAll(/\['([a-z]+\.[a-z_]+)'\]/g)].map((match) => match[1] ?? '');
    expect(rules.length).toBeGreaterThan(30);
    const missing = rules.filter((rule) => !(`rules.${rule.replace(/\./g, '_')}` in english));
    expect(missing).toEqual([]);

    const actionTypes = new Set<string>();
    for (const path of [...files('server', ['.ts']), ...files('server-lua', ['.lua'])]) {
      for (const match of readFileSync(path, 'utf8').matchAll(
        /(?:actionType|action_type)\s*[=:]\s*'([a-z_]+\.[a-z_.]+)'/g,
      )) {
        actionTypes.add(match[1] ?? '');
      }
    }
    const unnamed = [...actionTypes].filter(
      (type) => !(`actions.${type.replace(/\./g, '_')}` in english),
    );
    expect(unnamed).toEqual([]);
  });

  it('keeps %s placeholders aligned with how the code formats them', () => {
    const placeholders = (text: string): number => (text.match(/%[sd]/g) ?? []).length;
    // These are formatted by the game with positional arguments, so a wrong count would print garbage.
    const expected: Record<string, number> = {
      'kick.detection': 2,
      'kick.banned': 1,
      'kick.evasion': 1,
      'kick.heartbeat': 1,
      'kick.staff': 1,
      'connection.blocked': 1,
      'panel.warned': 1,
      'time.minutes_ago': 1,
      'time.hours_minutes': 2,
      'overview.evidence_detail': 2,
    };
    for (const [key, count] of Object.entries(expected)) {
      expect(placeholders(english[key] ?? ''), key).toBe(count);
    }
  });
});
