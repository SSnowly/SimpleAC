import { cp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';
import JavaScriptObfuscator from 'javascript-obfuscator';

const out = 'dist/nui';
await mkdir(out, { recursive: true });
await cp('nui/index.html', `${out}/index.html`);

const options = {
  compact: true,
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 0.75,
  deadCodeInjection: true,
  deadCodeInjectionThreshold: 0.3,
  identifierNamesGenerator: 'hexadecimal',
  renameGlobals: false,
  stringArray: true,
  stringArrayEncoding: ['rc4'],
  stringArrayThreshold: 1,
  splitStrings: true,
  splitStringsChunkLength: 4,
  transformObjectKeys: true,
  target: 'browser',
};

// Scripts that import libraries are bundled and minified; the rest are obfuscated as they are.
const bundled = new Set(['capture.js', 'watch.js']);

const scripts = (await readdir('nui')).filter((name) => name.endsWith('.js'));
for (const name of scripts) {
  if (bundled.has(name)) {
    await build({
      entryPoints: [`nui/${name}`],
      outfile: `${out}/${name}`,
      bundle: true,
      minify: true,
      format: 'iife',
      target: 'chrome103',
      legalComments: 'none',
    });
    console.log(`nui: bundled ${name}`);
    continue;
  }
  const source = await readFile(`nui/${name}`, 'utf8');
  const code = JavaScriptObfuscator.obfuscate(source, options).getObfuscatedCode();
  await writeFile(`${out}/${name}`, code);
  console.log(`nui: obfuscated ${name} (${source.length} -> ${code.length} bytes)`);
}
