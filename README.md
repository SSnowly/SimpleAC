# SimpleAC

SimpleAC is a FiveM anti-cheat resource with server protections, client detections, screenshot evidence, OCR, and a staff panel. Staff can review detections, manage cases and bans, and watch a player's screen live.

The current release is **0.1.0-beta.1**, for FiveM Legacy. Report bugs and false positives through [GitHub issues](https://github.com/SSnowly/SimpleAC/issues).

## Installation

Download `SimpleAC-v0.1.0-beta.1.zip` from [Releases](https://github.com/SSnowly/SimpleAC/releases) and extract the `SimpleAC` folder into your server's resources directory. The release ZIP includes the compiled UI, server code, and OCR files.

Requirements:

- FXServer with OneSync and the bundled Node.js 22 runtime
- `ox_lib`
- `oxmysql` with a configured connection string

Add this to `server.cfg`, replacing the license and public IP:

```cfg
add_ace group.admin simpleac.admin allow
add_principal identifier.license:YOUR_LICENSE group.admin

add_unsafe_worker_permission "SimpleAC"
set simpleac:watch_public_ip "YOUR_SERVER_PUBLIC_IP"
setr simpleac:debug 0
setr simpleac:logging 1

ensure ox_lib
ensure oxmysql
ensure SimpleAC
```

For live watch, open UDP port `3478` and the UDP range `49152`–`49351`. Database migrations run when the resource starts. Staff open the panel with **F10** or `/simpleac`.

See [installation and updates](docs/admin/installation.md), [configuration](docs/admin/configuration.md), and [staff access](docs/admin/panel.md).

## Configuration

Detection rules and thresholds are in `configs/server/profile.lua`. Client thresholds are in `configs/client/detections.lua`. Review these settings for your server's gameplay and use exceptions or integration allowances for legitimate teleports, invulnerability, and similar actions.

Screenshots use local storage by default. OCR reads their text with the bundled English model. Storage options and capture settings are in [evidence capture](docs/developer/evidence-capture.md).

`simpleac:debug 1` records detections while skipping enforcement and connection bans. Use it on a test server; protected events can run without validation in this mode. Details: [debug mode](docs/developer/debug-mode.md).

The optional [browser panel](docs/admin/browser-panel.md) uses Discord sign-in and an HTTPS reverse proxy. The [HTTP API](docs/developer/http-api.md) uses scoped API keys. Run `simpleac:diagnostics` in the server console for resource and dependency status.

## Development

Build tools require Bun and Node.js 22 or newer:

```sh
bun install --frozen-lockfile
bun run check
bun run test
bun run test:lua
bun run ci
bun run build
```

`bun run test:lua` requires Lua 5.4. `bun run dev:web` opens the panel with fixture data. Deploy the complete resource with its `dist/` directory after building.

Developer references: [panel](docs/developer/panel.md), [detection engine and exports](docs/developer/detection-engine.md), [fingerprinting](docs/developer/fingerprinting.md), [localization](docs/developer/localization.md), and [build and release](docs/developer/build-and-release.md).
