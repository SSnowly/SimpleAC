# Screenshot evidence and OCR

SimpleAC captures a player's game view, stores the image, reads its text with OCR, and links the results to detections, cases, and actions.

## Requirements

- Node.js 22, selected by `fxmanifest.lua`.
- Worker permission for OCR. Add this to `server.cfg` using your resource's folder name:

  ```cfg
  add_unsafe_worker_permission "SimpleAC"
  ```

  Without it screenshots still work; OCR is skipped and the console prints `ocr_unavailable` with this hint once.

## How a capture works

1. A trigger asks for a capture (see below). The Lua server checks the per-player cooldown and the global pending limit, inserts a `sac_captures` row (`SAC-CAP-*`) with the hash of a random single-use upload token that expires after `simpleac:capture_token_seconds` (60), and writes a `capture.requested` ledger action.
2. The client receives the token and renders the game view in `nui/capture.js` using the CitizenFX build of three.js. The renderer is created for the capture and released afterward.
3. The image is encoded in the NUI (JPEG by default, 1920 px wide at most) and delivered one of two ways:
   - **Direct HTTPS upload** to `POST /v1/captures/upload/<token>`, when the operator exposes the resource over HTTPS and sets `simpleac:capture_upload_url`.
   - **Latent event** otherwise. An HTTPS NUI page cannot call a plain-HTTP game server (Chromium blocks it as mixed content), so the image goes NUI → client Lua → `TriggerLatentServerEvent`, which is split into chunks at `latentBytesPerSecond` instead of flooding the connection. Only the player the capture was requested from can deliver it, once.
4. The server claims the token (it can only be spent once), checks the bytes are really a JPEG, PNG or WebP of a sane size (the declared content type must match), hashes the image with SHA-256, stores it, and in one transaction marks the capture `uploaded`, writes a `capture.stored` action and, for detection-triggered captures, adds a `capture` row to `sac_detection_evidence`.
5. OCR is queued for JPEG and PNG captures.

A capture ends as `uploaded`, `failed` (invalid image, storage error, client error) or `expired` (never uploaded, or past retention). Rows are kept; only the stored image goes away.

## Triggers

| Trigger | How |
| --- | --- |
| manual (console) | `simpleac_capture <server id> [reason]` |
| manual (API) | `POST /v1/players/:id/captures` with `captures:write`; optional `delayMs` (up to 60 s), `burst` (2-5 shots, 0.5-10 s apart) and `encoding` |
| automatic | a detection from a rule listed in `configs/server/captures.lua` `automatic.rules`, linked to that detection, with its own per-player cooldown |
| sweep | `sweep.enabled` in `configs/server/captures.lua`: every connected player on a rotation, most overdue first. A capture starts about every `intervalMs / players`, bounded by `minimumGapMs` and `sweep.maximumPending`. On by default |
| random | `random.enabled` in `configs/server/captures.lua`: one random connected player every `intervalMs` plus jitter. Off by default |

A sweep screenshot whose OCR finds nothing is discarded as soon as OCR finishes (status `expired`, error `sweep_clean`), so routine sweeps do not fill the storage; screenshots with matches are kept like any other. Set `simpleac:capture_keep_clean_sweeps 1` to keep them all.

Delayed and burst requests return no IDs for shots that start later; they appear in `GET /v1/captures`. All limits (`perPlayerCooldownMs`, `maximumPending`, `maximumBurst`, `maximumDelayMs`, `quality`, `maxWidth`, `encoding`) are in `configs/server/captures.lua`. Debug mode does not block captures; they are not enforcement.

## Storage

Choose a backend with `simpleac:capture_storage`. Secrets belong in server-only `set` convars, never `setr`.

| Backend | Convars | Notes |
| --- | --- | --- |
| `local` (default) | `simpleac:capture_local_dir` (`evidence`, relative to the resource, or an absolute path) | Files are stored as `YYYY/MM/<capture id>.<ext>` and are never served by FXServer. FXServer's sandbox only allows writes inside resource folders. Served to staff through `GET /v1/captures/:id/image`. |
| `fivemanage` | `simpleac:fivemanage_key` | Uploads to the Fivemanage v3 file API. The returned URL is stored and the image route redirects to it. Fivemanage has no delete API here, so its own retention settings apply. |
| `s3` | `simpleac:s3_bucket`, `simpleac:s3_access_key`, `simpleac:s3_secret_key`; optional `simpleac:s3_region` (`us-east-1`), `simpleac:s3_endpoint` (R2, MinIO, Backblaze and other S3-compatible services), `simpleac:s3_prefix` (`simpleac/`), `simpleac:s3_path_style`, `simpleac:s3_session_token`, `simpleac:s3_public_base_url`, `simpleac:s3_presign_seconds` (300) | Requests are signed with AWS Signature V4. Without a public base URL the image route redirects to a short-lived presigned link, so the bucket can stay private. |

Example for Cloudflare R2:

```cfg
set simpleac:capture_storage "s3"
set simpleac:s3_endpoint "https://<account>.r2.cloudflarestorage.com"
set simpleac:s3_region "auto"
set simpleac:s3_bucket "evidence"
set simpleac:s3_access_key "..."
set simpleac:s3_secret_key "..."
```

If storage is misconfigured the control plane logs `evidence_disabled` with the reason and the capture API and upload route are not registered; the rest of SimpleAC keeps working.

Other settings: `simpleac:capture_max_bytes` (4 MiB), `simpleac:capture_retention_days` (30, `0` keeps everything). Retention deletes the stored image (local and S3) and marks the row `expired`; ledger actions, hashes and OCR results stay.

## OCR

`tesseract.js` reads text locally with the bundled English model in `dist/ocr`. OCR uses a bounded worker queue; workers that time out or crash are replaced. Configure it with `simpleac:ocr_workers`, `simpleac:ocr_queue`, `simpleac:ocr_timeout_ms`, and `simpleac:ocr_enabled`.

Recognition uses sparse-text mode. A separate worker downsizes screenshots wider than `simpleac:ocr_max_width` (1280 by default) and converts the copy to grayscale. Set the width to `0` to use the uploaded image. Increase it if small text is missed. The stored screenshot stays unchanged; word boxes use its original coordinates.

JPEG and PNG captures are recognised; WebP captures are stored without OCR.

Results go to `sac_ocr_results`: raw text, confidence, duration, the rule file version, and `matches_json` with the matches and up to 300 words with confidence and bounding boxes.

### Rules

`configs/server/ocr-rules.json` is validated when the resource starts. Each rule has an `id`, a `severity` (`low`, `medium`, `high`) and a `kind`:

- `term`: case-insensitive match of any listed term on word boundaries
- `fuzzy`: like `term`, tolerating OCR errors (edit distance up to `maxDistance`, capped at a quarter of the term's length)
- `regex`: a regular expression run on the raw text
- `phrase_all`: every listed phrase must appear

Words below `minimumWordConfidence` are ignored. Add your own terms, such as your server's cheat-menu names, to the shipped rules. A match raises `evidence.ocr_match`, a detection in `log` mode that is printed to the console and joins the correlation window and cases like any other. OCR never bans on its own.

## API

| Method | Path | Scope |
| --- | --- | --- |
| GET | `/v1/captures` (`playerId`, `caseId`, `limit`, `before`) | `captures:read` |
| GET | `/v1/captures/:id` (metadata and OCR results) | `captures:read` |
| GET | `/v1/captures/:id/image` (bytes, or a redirect for external storage) | `captures:read` |
| POST | `/v1/players/:id/captures` | `captures:write` |

`/v1/lookup` also resolves `SAC-CAP-*` identifiers.

## Limits

- Everything starts on the client, so a cheater can block the screenshot or return a clean frame. Treat captures as evidence to review, not proof.
- Thumbnails are not generated; the panel scales the full image.
- OCR preprocessing is limited to resizing and grayscale conversion.
