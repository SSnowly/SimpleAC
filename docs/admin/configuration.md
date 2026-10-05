# Configuration

Settings come from two places: **convars** in `server.cfg`, and **Lua files** under `configs/`. Convars are for things that differ per server (storage, ports, secrets). The Lua files hold detection behaviour and are read when the resource starts.

Use `set` for a convar the server alone reads, and `setr` only for one the game client must also see. Never put a secret in a `setr`.

## Convars

### General

| Convar | Default | Meaning |
| --- | --- | --- |
| `simpleac:debug` | `0` | `1` is a dry run: nobody is kicked, banned or blocked and nothing is cancelled; everything SimpleAC would have done is printed. Use `setr`. |
| `simpleac:logging` | `1` | Structured log output |
| `ox:locale` | `en` | Language, shared with the other ox resources. Use `setr`. See [localization](../developer/localization.md). |

### Screenshot evidence

| Convar | Default | Meaning |
| --- | --- | --- |
| `simpleac:capture_storage` | `local` | `local`, `fivemanage` or `s3` |
| `simpleac:capture_local_dir` | `evidence` | Where local files go, relative to the resource or absolute |
| `simpleac:capture_max_bytes` | `4194304` | Largest accepted upload |
| `simpleac:capture_retention_days` | `30` | Images older than this are deleted; `0` keeps them |
| `simpleac:capture_token_seconds` | `60` | How long an upload token lives |
| `simpleac:capture_upload_url` | empty | Set to the resource's public `https://` URL to let the game upload directly; otherwise images travel through the game connection |
| `simpleac:capture_keep_clean_sweeps` | `0` | `1` keeps the screenshot of a scheduled sweep even when no cheat text was found |
| `simpleac:fivemanage_key` | empty | API key for Fivemanage storage. Secret: use `set`. |

S3-compatible storage has its own set of convars, listed in [evidence capture](../developer/evidence-capture.md#storage).

### Text recognition (OCR)

| Convar | Default | Meaning |
| --- | --- | --- |
| `simpleac:ocr_enabled` | `1` | Read text on screenshots. Needs `add_unsafe_worker_permission "SimpleAC"`. |
| `simpleac:ocr_workers` | `1` | Parallel readers (1–4) |
| `simpleac:ocr_queue` | `20` | Screenshots allowed to wait |
| `simpleac:ocr_timeout_ms` | `30000` | Give up on one screenshot after this long |
| `simpleac:ocr_max_width` | `1280` | Screenshots are read from a grayscale copy this wide; `0` reads them as uploaded. Raise it if small text is missed. |

### Live watch

| Convar | Default | Meaning |
| --- | --- | --- |
| `simpleac:watch_relay` | `1` | Run the built-in TURN relay. Needs worker permission. |
| `simpleac:watch_public_ip` | `127.0.0.1` | The address players and staff reach this server on. **Set this on a real server.** |
| `simpleac:watch_relay_port` | `3478` | UDP port clients connect to |
| `simpleac:watch_relay_ports` | `49152-49351` | UDP range used to carry video |
| `simpleac:watch_ice_servers` | built-in STUN | JSON array of your own ICE servers, for example `[{"urls":"turn:turn.example:3478","username":"u","credential":"c"}]` |
| `simpleac:watch_relay_only` | `0` | `1` forces all video through a TURN relay when you use your own servers |

## Lua files

| File | What it controls |
| --- | --- |
| `configs/server/profile.lua` | Which detections are on and what each one does (log, warn, cancel, kick, ban), thresholds and the case threshold |
| `configs/server/captures.lua` | Screenshot limits, automatic captures on detections, the player **sweep**, live-watch frame limits |
| `configs/server/ocr-rules.json` | The blacklisted text OCR looks for |
| `configs/server/protections.lua`, `combat.lua`, `vehicles.lua` | Limits for the network, combat and vehicle protections |
| `configs/server/grace.lua`, `heartbeat.lua`, `evasion.lua` | Join grace windows, the heartbeat, ban-evasion weights |
| `configs/client/detections.lua` | Thresholds the game client checks |

### The sweep

With `sweep.enabled`, the server captures players on a rotation and reads the text. The default target interval is 30 seconds per player, bounded by a 1.5-second gap between captures and the pending-upload limit. Screenshots with no OCR matches are deleted; matching images are kept.

## Ports and firewall summary

| Port | Protocol | Used for |
| --- | --- | --- |
| Your FXServer port (30120 by default) | TCP and UDP | The game, and the resource's HTTP API |
| `simpleac:watch_relay_port` (3478) | UDP | Live-watch relay |
| `simpleac:watch_relay_ports` (49152–49351) | UDP | Live-watch video |

Use an HTTPS reverse proxy for browser and API traffic; see the [HTTP API](../developer/http-api.md).
