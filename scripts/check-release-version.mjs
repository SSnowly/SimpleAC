import { readFile } from 'node:fs/promises';

const tag = process.argv[2];
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
if (tag !== `v${version}`) throw new Error(`Tag ${tag} does not match package version ${version}`);
for (const file of ['fxmanifest.lua', 'configs/shared/main.lua']) {
  const source = await readFile(file, 'utf8');
  const match = source.match(/\bversion\s*(?:=\s*)?['"]([^'"]+)['"]/);
  if (match?.[1] !== version) throw new Error(`${file} does not match package version ${version}`);
}
console.log(`release: ${tag} matches package, manifest, and runtime versions`);
