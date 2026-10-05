# Build and release

Builds use Bun, Node.js 22 or newer, and the committed lockfile. Biome checks formatting and lint rules.

| Command | Purpose |
| --- | --- |
| `bun install` | install dependencies |
| `bun run ci` | Biome lint, format and import checks (what CI runs) |
| `bun run format:write` | apply Biome fixes and formatting |
| `bun run check` | TypeScript type check |
| `bun run test` | Vitest suite |
| `bun run test:lua` | Lua suite on a plain Lua 5.4 interpreter |
| `bun run dev:web` | Vite dev server for the in-game panel at http://localhost:5173 |
| `bun run build:web` | build the in-game panel only |
| `bun run build` | build NUI and the panel, type-check, bundle the server |
| `bun run build:licenses` | generate runtime dependency notices |

## Build outputs

`bun run build` compiles NUI and the panel, copies the OCR runtime, generates dependency notices, type-checks, and bundles the server with esbuild.

- `dist/nui/`: `index.html` plus the scripts it loads. `devtools.js`, `fingerprint.js` and `panel.js` are obfuscated with `javascript-obfuscator` (control-flow flattening, dead code, RC4 string array); `capture.js` and `watch.js` use libraries, so they are bundled and minified instead. The readable source stays in `nui/`. `fxmanifest.lua` points `ui_page` and `files` at `dist/nui/`.
- `dist/server/bootstrap.js`: the server bundle. `ocr-prepare.js` (screenshot downscaling) and `relay-worker.js` (the live-watch relay) are separate bundles because each runs in its own worker thread.
- `dist/ocr/`: Tesseract and its language data, copied by `scripts/vendor-ocr.mjs` (which also patches a core-selection bug in tesseract.js 7).

- `dist/web/nui/`: the in-game staff panel (Vite, React, TypeScript), built from `web/nui/` with relative asset paths and a `chrome103` target to match FiveM's NUI. `dist/nui/index.html` hosts it in an iframe and relays its requests to the game; the English strings from `locales/en.json` are bundled as the fallback language.

`bun run dev:web` serves fixture data at `/` and previews browser login at `/panel/`. `web/nui/src/lib/env.ts` selects the transport. Production browser pages use authenticated HTTP.

Always deploy `dist/` after a build; the resource does not run from `nui/`.

## GitHub workflows

- `.github/workflows/ci.yml` checks publishable files, formatting, types, tests, and the build on pushes to `main` and pull requests.
- `.github/workflows/release.yml` builds on `v*` tags or manual runs. It packages the runtime, tracked documentation, deployment examples, and dependency notices into `SimpleAC/`, removes source maps, and generates a ZIP and SHA-256 checksum.
- A tag containing a prerelease suffix, such as `v0.1.0-beta.1`, creates a GitHub prerelease. Release notes come from `docs/releases/<tag>.md` when present, otherwise from GitHub's generated notes.

## Publish a beta

1. Set the same version in `package.json`, `fxmanifest.lua`, and `configs/shared/main.lua`.
2. Update `CHANGELOG.md` and add `docs/releases/v<version>.md`.
3. Run `bun run ci`, `bun run check`, `bun run test`, `bun run test:lua`, and `bun run build`.
4. Commit and push the release changes. Tag that commit and push the tag:

   ```sh
   git tag -a v0.1.0-beta.1 -m "SimpleAC 0.1.0-beta.1"
   git push origin v0.1.0-beta.1
   ```

5. Check the Release workflow and confirm the GitHub release is marked **Pre-release** with both assets attached.

Enable the local publication guard with `git config core.hooksPath .githooks`. CI and release jobs also check the published history. Internal notes belong in ignored local paths and are excluded from release packaging.
