import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';

const project = JSON.parse(await readFile('package.json', 'utf8'));
const packages = new Map();

async function locate(name, parent) {
  const require = createRequire(join(parent, 'package.json'));
  try {
    return dirname(require.resolve(`${name}/package.json`));
  } catch {
    let directory = dirname(require.resolve(name));
    while (directory !== dirname(directory)) {
      try {
        const pkg = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
        if (pkg.name === name) return directory;
      } catch {}
      directory = dirname(directory);
    }
    throw new Error(`Cannot find package metadata for ${name}`);
  }
}

async function collect(name, parent) {
  const directory = await locate(name, parent);
  if (packages.has(directory)) return;
  const pkg = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
  packages.set(directory, pkg);
  for (const dependency of Object.keys(pkg.dependencies ?? {})) {
    await collect(dependency, directory);
  }
}

for (const name of [...Object.keys(project.dependencies), '@citizenfx/three']) {
  await collect(name, resolve('.'));
}

const sections = [
  'SimpleAC third-party notices',
  'Dependency license texts for the distributed runtime and its dependency trees.',
  'The packaged tesseract.js getCore.js accepts boolean true as LSTM-only mode.',
];
for (const [directory, pkg] of [...packages].sort((a, b) =>
  `${a[1].name}@${a[1].version}`.localeCompare(`${b[1].name}@${b[1].version}`, 'en'),
)) {
  const repository =
    typeof pkg.repository === 'string' ? pkg.repository : (pkg.repository?.url ?? '');
  sections.push(
    `\n${'='.repeat(72)}\n${pkg.name}@${pkg.version}\nLicense: ${pkg.license}\n${repository}`,
  );
  const files = (await readdir(directory))
    .filter((file) => /^(?:licen[cs]e|copying|notice)(?:\.|$)/i.test(file))
    .sort();
  if (files.length === 0) {
    const supplement = join('third-party', `${pkg.name.replaceAll('/', '__')}.txt`);
    sections.push(await readFile(supplement, 'utf8'));
  }
  for (const file of files) {
    sections.push(`\n${file}\n${await readFile(join(directory, file), 'utf8')}`);
  }
}
await mkdir('dist', { recursive: true });
await writeFile('dist/THIRD_PARTY_NOTICES.txt', `${sections.join('\n')}\n`);
console.log(`licenses: recorded ${packages.size} runtime dependencies`);
