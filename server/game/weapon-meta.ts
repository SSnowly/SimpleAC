import { type Dirent, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Numeric `<Field value="..."/>` entries of a CWeaponInfo that matter for damage and ballistics checks. */
const NUMERIC_FIELDS = [
  'Damage',
  'Speed',
  'WeaponRange',
  'TimeBetweenShots',
  'BulletsInBatch',
  'HitLimbsDamageModifier',
  'NetworkHitLimbsDamageModifier',
  'LightlyArmouredDamageModifier',
  'VehicleDamageModifier',
  'NetworkPlayerDamageModifier',
  'NetworkPedDamageModifier',
  'HeadShotDamageModifierPlayer',
  'HeadShotDamageModifierAI',
  'ClipSize',
] as const;

const TEXT_FIELDS = ['Model', 'DamageType', 'FireType', 'AmmoInfo'] as const;

export type WeaponFieldName = (typeof NUMERIC_FIELDS)[number];

export type WeaponMetaEntry = Partial<Record<WeaponFieldName, number>> & {
  /** Resource the definition came from. */
  source: string;
  damageType?: string;
  fireType?: string;
  model?: string;
  ammoInfo?: string;
};

const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_DEPTH = 10;
const SKIPPED_DIRECTORIES = new Set(['node_modules', '.git', 'dist', 'web', 'nui', 'html', 'ui']);

/** Slices every `<Item type="CWeaponInfo">...</Item>` block, honouring nested `<Item>` elements. */
function weaponBlocks(xml: string): string[] {
  const blocks: string[] = [];
  const open = '<Item type="CWeaponInfo">';
  const token = /<Item\b[^>]*?(\/?)>|<\/Item>/g;
  for (let start = xml.indexOf(open); start !== -1; start = xml.indexOf(open, start)) {
    let depth = 0;
    let end = xml.length;
    token.lastIndex = start;
    for (let match = token.exec(xml); match; match = token.exec(xml)) {
      if (match[0] === '</Item>') depth -= 1;
      else if (match[1] !== '/') depth += 1;
      if (depth === 0) {
        end = token.lastIndex;
        break;
      }
    }
    blocks.push(xml.slice(start, end));
    start = end;
  }
  return blocks;
}

/** Drops nested `<Item>` children (attachment points, component lists) so their fields never leak into the weapon. */
function ownFields(block: string): string {
  const inner = block.slice(block.indexOf('>') + 1, block.lastIndexOf('</Item>'));
  let result = '';
  let depth = 0;
  let cursor = 0;
  const token = /<Item\b[^>]*?(\/?)>|<\/Item>/g;
  for (let match = token.exec(inner); match; match = token.exec(inner)) {
    if (match[0] === '</Item>') {
      depth -= 1;
      if (depth === 0) cursor = token.lastIndex;
    } else if (match[1] !== '/') {
      if (depth === 0) result += inner.slice(cursor, match.index);
      depth += 1;
    }
  }
  return result + (depth === 0 ? inner.slice(cursor) : '');
}

/** Parses the weapons of one weapons.meta document. Keys are the upper-case weapon names. */
export function parseWeaponMeta(xml: string, source: string): Map<string, WeaponMetaEntry> {
  const weapons = new Map<string, WeaponMetaEntry>();
  const clean = xml.replace(/<!--[\s\S]*?-->/g, '');
  for (const block of weaponBlocks(clean)) {
    const body = ownFields(block);
    const name = /<Name>\s*([^<\s]+)\s*<\/Name>/.exec(body)?.[1];
    if (!name) continue;
    const entry: WeaponMetaEntry = { source };
    for (const field of NUMERIC_FIELDS) {
      const raw = new RegExp(String.raw`<${field}\s+value="([^"]*)"`).exec(body)?.[1];
      const value = raw === undefined ? Number.NaN : Number.parseFloat(raw);
      if (Number.isFinite(value)) entry[field] = value;
    }
    for (const field of TEXT_FIELDS) {
      const text = new RegExp(String.raw`<${field}>\s*([^<\s]+)\s*</${field}>`).exec(body)?.[1];
      if (!text) continue;
      if (field === 'Model') entry.model = text;
      else if (field === 'DamageType') entry.damageType = text;
      else if (field === 'FireType') entry.fireType = text;
      else entry.ammoInfo = text;
    }
    weapons.set(name.toUpperCase(), entry);
  }
  return weapons;
}

function* walk(directory: string, depth: number): Generator<string> {
  if (depth > MAX_DEPTH) return;
  let entries: Dirent[];
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) yield* walk(path, depth + 1);
    } else if (/\.(meta|xml)$/i.test(entry.name)) {
      yield path;
    }
  }
}

/**
 * Scans resource folders (stream/, data/, anywhere) for weapon meta files and returns every weapon they define.
 * Resources are processed in the order given; later ones win, matching the game's data file load order.
 */
export function scanWeaponMeta(
  resources: readonly { name: string; path: string }[],
): Record<string, WeaponMetaEntry> {
  const weapons = new Map<string, WeaponMetaEntry>();
  for (const resource of resources) {
    for (const file of walk(resource.path, 0)) {
      try {
        if (statSync(file).size > MAX_FILE_BYTES) continue;
        const xml = readFileSync(file, 'utf8');
        if (!xml.includes('CWeaponInfo')) continue;
        for (const [name, entry] of parseWeaponMeta(xml, resource.name)) weapons.set(name, entry);
      } catch {
        // Unreadable or malformed files are skipped; the scan must never break startup.
      }
    }
  }
  return Object.fromEntries(weapons);
}
