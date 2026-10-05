// Copies tesseract.js, its runtime dependencies and the English language data into dist/ocr/node_modules.
// FXServer resolves modules from the resource folder at runtime, so the OCR engine is shipped as files next to
// the bundled server code rather than being bundled into it (its worker and WebAssembly cores are loaded by path).
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, sep } from 'node:path';

const out = 'dist/ocr';
const modules = join(out, 'node_modules');

// Only the LSTM cores are needed for the default OCR engine mode; this drops about half of tesseract.js-core.
const filters = {
  'tesseract.js': (path) => !path.includes(`${sep}dist${sep}`) && !path.endsWith(`${sep}dist`),
  'tesseract.js-core': (path) => {
    const name = path.split(sep).at(-1);
    return !/^tesseract-core/.test(name) || name.includes('lstm');
  },
  '@tesseract.js-data/eng': (path) =>
    !path.includes('4.0.0_best_int') ? !path.includes(`${sep}4.0.0`) : true,
};

async function packageJson(name) {
  return JSON.parse(await readFile(join('node_modules', name, 'package.json'), 'utf8'));
}

const seen = new Set();
async function collect(name) {
  if (seen.has(name)) return;
  seen.add(name);
  const { dependencies = {} } = await packageJson(name);
  for (const dependency of Object.keys(dependencies)) await collect(dependency);
}

await rm(out, { recursive: true, force: true });
await mkdir(modules, { recursive: true });
await collect('tesseract.js');
await collect('@tesseract.js-data/eng');

for (const name of seen) {
  await cp(join('node_modules', name), join(modules, name), {
    recursive: true,
    filter: filters[name] ?? (() => true),
  });
}
// tesseract.js 7 passes a boolean `lstmOnly` to getCore, which compares it to numeric OEM values and so always picks
// the legacy core that was filtered out above. Treat `true` as LSTM-only.
const getCore = join(modules, 'tesseract.js', 'src', 'worker-script', 'node', 'getCore.js');
const original = await readFile(getCore, 'utf8');
const patched = original.replaceAll(
  '[OEM.DEFAULT, OEM.LSTM_ONLY].includes(oem)',
  '(oem === true || [OEM.DEFAULT, OEM.LSTM_ONLY].includes(oem))',
);
if (patched === original) throw new Error('ocr: getCore.js did not match the expected source');
await writeFile(getCore, patched);
await writeFile(join(out, 'package.json'), JSON.stringify({ name: 'simpleac-ocr', private: true }));
console.log(`ocr: vendored ${seen.size} packages into ${out}`);
