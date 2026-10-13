import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';

const [root, out = 'shared/data/weapon-baselines.json'] = process.argv.slice(2);
if (!root) {
  console.error('usage: node tools/generate-weapon-baselines.mjs <extract-root> [out.json]');
  process.exit(1);
}

// Later tiers override earlier ones, matching the game's load order (same layout as the vehicle generator).
const TIERS = ['base', 'B', 'update', 'D', 'E'];
const NUMERIC = [
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
];

const joaat = (text) => {
  let hash = 0;
  for (const byte of Buffer.from(text.toLowerCase(), 'utf8')) {
    hash = (hash + byte) >>> 0;
    hash = (hash + (hash << 10)) >>> 0;
    hash = (hash ^ (hash >>> 6)) >>> 0;
  }
  hash = (hash + (hash << 3)) >>> 0;
  hash = (hash ^ (hash >>> 11)) >>> 0;
  hash = (hash + (hash << 15)) >>> 0;
  return hash;
};

const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });

const items = (xml) => {
  const result = [];
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
    result.push(xml.slice(start, end));
    start = end;
  }
  return result;
};

// Nested <Item> children (attachment points, component lists) must not leak their fields into the weapon.
const ownFields = (block) => {
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
};

const files = [];
for (const tier of TIERS) {
  const tierDir = join(root, tier);
  try {
    statSync(tierDir);
  } catch {
    continue;
  }
  const flat = tier === 'base' || tier === 'update';
  const entries = flat ? [tierDir] : readdirSync(tierDir).map((pack) => join(tierDir, pack));
  for (const entry of entries) {
    const pack = flat ? tier : relative(tierDir, entry).split(sep)[0];
    for (const file of walk(entry)) {
      if (/^weapons\w*\.meta$/i.test(file.split(sep).pop() ?? '')) {
        files.push({ tier, pack, file });
      }
    }
  }
}

const weapons = {};
for (const source of files.sort((a, b) => TIERS.indexOf(a.tier) - TIERS.indexOf(b.tier))) {
  const xml = readFileSync(source.file, 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  for (const block of items(xml)) {
    const body = ownFields(block);
    const name = /<Name>\s*([^<\s]+)\s*<\/Name>/.exec(body)?.[1];
    if (!name) continue;
    const lower = name.toLowerCase();
    const entry = { hash: joaat(lower), source: source.pack };
    for (const field of NUMERIC) {
      const raw = new RegExp(String.raw`<${field}\s+value="([^"]*)"`).exec(body)?.[1];
      const value = raw === undefined ? Number.NaN : Number.parseFloat(raw);
      if (Number.isFinite(value)) entry[field] = value;
    }
    for (const [field, key] of [
      ['Model', 'model'],
      ['DamageType', 'damageType'],
      ['FireType', 'fireType'],
      ['AmmoInfo', 'ammoInfo'],
    ]) {
      const text = new RegExp(String.raw`<${field}>\s*([^<\s]+)\s*</${field}>`).exec(body)?.[1];
      if (text) entry[key] = text;
    }
    weapons[lower] = entry;
  }
}

const document = {
  version: 1,
  generator: 'tools/generate-weapon-baselines.mjs',
  note: 'Generated from GTA V weapons.meta files. Do not edit; put server overrides in weapon-baselines.custom.json.',
  weapons: Object.fromEntries(Object.entries(weapons).sort(([a], [b]) => a.localeCompare(b))),
};

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(document)}\n`);
console.log(`sources=${files.length} weapons=${Object.keys(weapons).length}`);
