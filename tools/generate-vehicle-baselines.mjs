import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';

const [root, out = 'shared/data/vehicle-baselines.json'] = process.argv.slice(2);
if (!root) {
  console.error('usage: node tools/generate-vehicle-baselines.mjs <extract-root> [out.json]');
  process.exit(1);
}

// Later tiers override earlier ones, matching the game's load order.
const TIERS = ['base', 'B', 'update', 'D', 'E'];

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

const sources = [];
for (const tier of TIERS) {
  const tierDir = join(root, tier);
  try {
    statSync(tierDir);
  } catch {
    continue;
  }
  const entries =
    tier === 'base' || tier === 'update'
      ? [tierDir]
      : readdirSync(tierDir).map((pack) => join(tierDir, pack));
  for (const entry of entries) {
    const pack =
      tier === 'base' || tier === 'update' ? tier : relative(tierDir, entry).split(sep)[0];
    for (const file of walk(entry)) {
      const name = file.split(sep).pop();
      if (name === 'handling.meta' || name === 'vehicles.meta')
        sources.push({ tier, pack, name, file });
    }
  }
}

const num = (text) => (/^-?\d+$/.test(text) ? Number.parseInt(text, 10) : Number.parseFloat(text));

const parseFields = (xml) => {
  const fields = {};
  const tag =
    /<(\w+)\s+(value|x)="([^"]*)"(?:\s+y="([^"]*)"\s+z="([^"]*)")?(?:\s+w="[^"]*")?\s*\/>|<(\w+)>([^<]*)<\/\6>/g;
  for (let match = tag.exec(xml); match; match = tag.exec(xml)) {
    if (match[1]) {
      fields[match[1]] =
        match[2] === 'x'
          ? [num(match[3]), num(match[4]), num(match[5])]
          : /^-?[\d.]+$/.test(match[3])
            ? num(match[3])
            : match[3];
    } else if (match[6] !== 'handlingName') {
      fields[match[6]] = match[7].trim();
    }
  }
  return fields;
};

const blocks = (xml, open) => {
  const result = [];
  let index = 0;
  for (index = xml.indexOf(open, index); index !== -1; index = xml.indexOf(open, index)) {
    let depth = 0;
    let cursor = index;
    const token = /<Item\b[^>]*?(\/?)>|<\/Item>/g;
    token.lastIndex = index;
    for (let match = token.exec(xml); match; match = token.exec(xml)) {
      if (match[0] === '</Item>') depth -= 1;
      else if (match[1] !== '/') depth += 1;
      if (depth === 0) {
        cursor = token.lastIndex;
        break;
      }
    }
    result.push(xml.slice(index, cursor));
    index = cursor;
  }
  return result;
};

const handlings = {};
const vehicles = {};

for (const source of sources.sort((a, b) => TIERS.indexOf(a.tier) - TIERS.indexOf(b.tier))) {
  const xml = readFileSync(source.file, 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  if (source.name === 'handling.meta') {
    for (const block of blocks(xml, '<Item type="CHandlingData">')) {
      const name = /<handlingName>([^<]+)<\/handlingName>/.exec(block)?.[1];
      if (!name) continue;
      const sub = /<SubHandlingData>([\s\S]*)<\/SubHandlingData>/.exec(block)?.[1] ?? '';
      const body = block.replace(/<SubHandlingData>[\s\S]*<\/SubHandlingData>/, '');
      const subHandling = {};
      for (const item of blocks(sub, '<Item type="C')) {
        const type = /<Item type="(\w+)"/.exec(item)[1];
        subHandling[type] = parseFields(item.slice(item.indexOf('>') + 1));
      }
      handlings[name.toUpperCase()] = {
        ...parseFields(body),
        ...(Object.keys(subHandling).length ? { sub: subHandling } : {}),
        source: source.pack,
      };
    }
  } else {
    for (const block of blocks(xml, '<Item>')) {
      const model = /<modelName>([^<]+)<\/modelName>/.exec(block)?.[1];
      const handlingId = /<handlingId>([^<]+)<\/handlingId>/.exec(block)?.[1];
      if (!model || !handlingId) continue;
      const field = (key) => new RegExp(`<${key}>([^<]*)</${key}>`).exec(block)?.[1]?.trim();
      const value = (key) => new RegExp(`<${key}\\s+value="([^"]*)"`).exec(block)?.[1];
      const lower = model.toLowerCase();
      const hash = joaat(lower);
      vehicles[lower] = {
        hash,
        signedHash: hash | 0,
        handlingId: handlingId.toUpperCase(),
        gameName: field('gameName') ?? null,
        make: field('vehicleMakeName') ?? null,
        type: field('type') ?? null,
        class: field('vehicleClass') ?? null,
        wheelType: field('wheelType') ?? null,
        flags: (field('flags') ?? '').split(/\s+/).filter(Boolean),
        defaultBodyHealth: value('defaultBodyHealth') ? num(value('defaultBodyHealth')) : null,
        source: source.pack,
      };
    }
  }
}

const missing = Object.entries(vehicles)
  .filter(([, v]) => !handlings[v.handlingId])
  .map(([model]) => model);

const sortKeys = (object) =>
  Object.fromEntries(Object.entries(object).sort(([a], [b]) => a.localeCompare(b)));
const document = {
  version: 1,
  generator: 'tools/generate-vehicle-baselines.mjs',
  note: 'Generated from GTA V meta files. Do not edit; put addon vehicles/handlings in vehicle-baselines.custom.json.',
  handlings: sortKeys(handlings),
  vehicles: sortKeys(vehicles),
};

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(document)}\n`);
console.log(
  `sources=${sources.length} handlings=${Object.keys(handlings).length} vehicles=${Object.keys(vehicles).length} missingHandling=${missing.length}`,
);
if (missing.length) console.log(`missing: ${missing.join(', ')}`);
