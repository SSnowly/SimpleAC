# HTTP API

API routes are served through `SetHttpHandler` (Koa), under `http://<server>:<port>/<resource>/v1`. `GET /health` and `GET /v1/health` are public. Other API routes require a scoped API key. The [browser panel](browser-panel.md) has separate session authentication.

## API keys

Keys are created only from the **server console** (never from in-game chat):

```
simpleac:apikey create <name> <scope[,scope...]> [expiryDays] [allowedIp[,ip...]]
simpleac:apikey list
simpleac:apikey revoke <SAC-KEY-id>
```

The raw key (`sac_<12 hex>.<43 chars>`) is printed once. Only a scrypt hash and the non-secret prefix are stored. Creation and revocation write `api_key.created` / `api_key.revoked` actions. Send the key as `Authorization: Bearer <key>`.

Verified keys are cached in memory for 30 seconds; revoking from the console clears the cache immediately.

## Scopes

| Scope              | Grants                                               |
| ------------------ | ---------------------------------------------------- |
| `admin`            | Everything                                           |
| `players:read`     | Player list/detail, sessions                         |
| `identifiers:read` | Raw identifiers in player detail; identifier lookups |
| `actions:read`     | Action ledger                                        |
| `detections:read`  | Detections, evidence and the overview                |
| `detections:write` | Confirm or dismiss a detection (implies read)        |
| `cases:read`       | Cases, their notes and linked evidence               |
| `cases:write`      | Create, update and annotate cases (implies read)     |
| `exceptions:read`  | Persistent exceptions                                |
| `exceptions:write` | Create and revoke exceptions (implies read)          |
| `profiles:read`    | Detection profiles and their versions                |
| `bans:read`        | Ban list/detail                                      |
| `bans:write`       | Create and revoke bans (implies `bans:read`)         |
| `captures:read`    | Screenshot evidence, OCR results and images          |
| `captures:write`   | Request a screenshot (implies `captures:read`)       |
| `keys:read`        | API key metadata via lookup                          |

## Endpoints

| Method | Path                  | Scope                                     |
| ------ | --------------------- | ----------------------------------------- |
| GET    | `/v1/players`         | `players:read` (`q`, `limit`, `before`)   |
| GET    | `/v1/players/:id`     | `players:read`                            |
| GET    | `/v1/players/:id/links` | `identifiers:read`                      |
| GET    | `/v1/captures`        | `captures:read` (`playerId`, `caseId`, `status`, `trigger`, `ocr=matched`) |
| GET    | `/v1/captures/:id`    | `captures:read`                           |
| GET    | `/v1/captures/:id/image` | `captures:read`                        |
| POST   | `/v1/players/:id/captures` | `captures:write`                     |
| POST   | `/v1/captures/:id/rescan` | `captures:write` (re-reads the stored image with the current OCR rules) |
| POST   | `/v1/captures/:id/delete` | `captures:write` (`reason`; removes the image, keeps the record and OCR text) |
| GET    | `/v1/ocr/rules`       | `captures:read`                           |
| GET    | `/v1/overview`        | `detections:read`                         |
| GET    | `/v1/detections`      | `detections:read` (`playerId`, `caseId`, `ruleKey`, `category`, `status`) |
| GET    | `/v1/detections/:id`  | `detections:read` (measurements, evidence, captures) |
| POST   | `/v1/detections/:id/review` | `detections:write` (`status`: `open`, `confirmed`, `dismissed`; `reason`) |
| GET    | `/v1/cases`           | `cases:read` (`playerId`, `status`, `assignedTo`) |
| GET    | `/v1/cases/:id`       | `cases:read` (detections, timeline, captures) |
| POST   | `/v1/cases`           | `cases:write` (`playerId`, `title`, `priority`, `reason`) |
| POST   | `/v1/cases/:id/update` | `cases:write` (`status`, `priority`, `assignedTo`, `reason`) |
| POST   | `/v1/cases/:id/notes` | `cases:write` (`note`)                    |
| POST   | `/v1/cases/:id/detections` | `cases:write` (`detectionId`)        |
| POST   | `/v1/cases/:id/captures` | `cases:write` (`captureId`)            |
| GET    | `/v1/exceptions`      | `exceptions:read` (`active`, `scopeType`, `scopeValue`) |
| GET    | `/v1/exceptions/:id`  | `exceptions:read`                         |
| POST   | `/v1/exceptions`      | `exceptions:write` (`scopeType`, `scopeValue`, `effect`, `reason`, `durationHours`) |
| POST   | `/v1/exceptions/:id/revoke` | `exceptions:write` (`reason`)       |
| GET    | `/v1/profiles`        | `profiles:read`                           |
| GET    | `/v1/profiles/:id`    | `profiles:read` (`version` selects an older config) |
| GET    | `/v1/actions`         | `actions:read` (`targetId`, `actionType`) |
| GET    | `/v1/actions/:id`     | `actions:read`                            |
| GET    | `/v1/bans`            | `bans:read` (`playerId`, `active`)        |
| GET    | `/v1/bans/:id`        | `bans:read`                               |
| POST   | `/v1/bans`            | `bans:write`                              |
| POST   | `/v1/bans/:id/revoke` | `bans:write`                              |
| GET    | `/v1/lookup?q=`       | scope of the record type found            |

`/v1/lookup` accepts any `SAC-*` identifier or a platform identifier (for example `license:...`, which requires `identifiers:read`).

Lists are paginated newest-first: pass `nextBefore` from the previous page as `before`. `limit` is 1-100 (default 25).

## Mutations

- Bodies must be `application/json`, at most 64 KiB.
- Send an `Idempotency-Key` header (8-128 chars) to make retries safe. A repeated request with the same key and payload replays the stored response with `Idempotent-Replayed: true`; the same key with a different payload returns `422 idempotency_key_reuse`. Keys are retained for 24 hours.
- Every mutation writes an immutable `sac_actions` row with `actor_type = web_api`, the key ID as actor, and the request ID as correlation ID. Reverting a ban creates a new `ban.revoked` action referencing the original.
- `POST /v1/bans` drops the player if currently connected.
- Detections are never edited: `review` only changes the triage status (`open`, `confirmed`, `dismissed`) and writes a `detection.reviewed` action, which also appears on any linked case's timeline.
- Case changes (`case.created`, `case.updated`, `case.note_added`, `case.detection_linked`, `case.capture_linked`) each write an action and a timeline event. A case can only link detections and captures of its own player. Setting a case to the values it already has returns `409`.
- Exceptions take effect immediately: the API rebuilds the detection engine's in-memory cache after every create or revoke. `scopeType` is `player` (a `SAC-PLY` id), `detection` (a rule key such as `state.godmode`) or `resource` (a resource name); `effect` is `allow` or `ignore`. An active exception with the same scope, value and effect returns `409`. Revoking records the reversal of the `exception.created` action.
- `POST /v1/captures/:id/delete` removes only the stored image. The capture row, OCR text and ledger entries stay, and the capture shows as `expired` with the error `deleted_by_staff`.
- `POST /v1/captures/:id/rescan` re-reads the image with the current OCR rules and can raise a new `evidence.ocr_match` detection (subject to that rule's cooldown). It returns `202`; the result appears on the capture.
- Profiles are read-only. The detection engine runs the bundled profile from `configs/server/profile.lua` and records each version in the database for the audit trail; changing thresholds means editing that file.

## Errors

```json
{ "error": { "code": "validation_failed", "message": "...", "requestId": "...", "details": [] } }
```

Codes: `bad_request`, `validation_failed`, `unauthenticated`, `forbidden`, `not_found`, `conflict`, `idempotency_key_reuse`, `idempotency_in_progress`, `payload_too_large`, `unsupported_media_type`, `rate_limited`, `internal_error`. Callers may supply `X-Request-Id` (letters, digits, `.`, `_`, `-`, max 40); otherwise one is generated.

## Limits

- 60-request burst, 2 requests/second sustained, per key.
- Failed authentication is throttled per remote address (10 burst, 10/minute).
- Keys may be restricted to specific source IPs.

Route browser and API traffic through an HTTPS reverse proxy. FXServer's game port must remain reachable by players.
