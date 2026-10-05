# Fingerprinting and ban evasion

SimpleAC scores shared device and identifier signals between player identities. Each stored link records its contributing signals. Configured thresholds decide whether a match to a banned identity is recorded, reviewed, restricted, or blocked.

## What is collected

`nui/fingerprint.js` runs in the SimpleAC NUI frame about 8 seconds after joining (`fingerprint.delayMs`) and collects:

- user agent, platform, locale, timezone
- screen width and height, colour depth, pixel ratio
- CPU concurrency and device memory
- WebGL vendor, renderer and a rendering signature
- a canvas signature and an optional audio-processing signature
- a random storage id kept in NUI `localStorage`

The server validates the payload (unknown keys dropped, strings trimmed, lowercased and length limited, numbers clamped, at least four attributes required), then hashes every attribute and the composite with `identifier_salt`, a per-server secret. Only hashes are stored, in `sac_fingerprints` (composite, per algorithm version) and `sac_fingerprint_observations` (per-attribute hashes, session and player). Raw attribute values are never persisted.

The composite fingerprint excludes the storage id and the audio signature, so neither splits an otherwise identical device in two. Change `algorithmVersion` in `configs/server/evasion.lua` when the attribute set or hashing changes; fingerprints of different versions never match.

## Persistent device token

The server issues a random 256-bit token the first time it sees a device that presents no known token. The client keeps it in resource KVP (`simpleac:device`) and in NUI storage, and presents both on later joins. The server stores only its salted hash in `sac_device_tokens` and records which players presented it in `sac_device_token_players`. A token shared by two identities is the strongest single device signal. Clearing NUI storage alone does not remove it because the KVP copy survives, and the NUI copy restores the KVP one.

## Scoring

Each candidate identity (another player that shares a token, hashed IP, or any lookup attribute) is scored against the current one. Weights are in `configs/server/evasion.lua`:

| Signal | Default weight | Notes |
| --- | --- | --- |
| `deviceToken` | 60 | server-issued token seen on both identities |
| `storageId` | 30 | NUI storage id, lost when the cache is cleared |
| `fingerprintExact` | 35 | every device attribute matches; supporting evidence |
| `attributes(...)` | up to 40 | partial match: canvas 12, WebGL signature 12, audio 10, WebGL renderer 4, screen 4, user agent 3, timezone 2, locale 1, hardware 3 |
| `ip` | 8 | same hashed IP; weak (shared networks, CGNAT) |

The total is capped at 100. Links with a score of at least `minimumLinkScore` (20) are stored in `sac_identity_links` as one row per pair, with the full signal list in `reasons_json`.

`GET /v1/players/:id/links` (scope `identifiers:read`) returns each link with its score, every signal and weight, and whether the other identity is currently banned, so a panel can explain every match.

## Outcomes

Outcomes only apply when the matched identity has an **active ban**; any other match is just recorded as a link. The best banned match decides:

| Outcome | Default threshold | Effect |
| --- | --- | --- |
| `review` | 45 | raises `identity.ban_evasion` (logged, printed to the console, linked to cases like any detection) |
| `restrict` | 80 | review, plus the `simpleacRestricted` state bag and a ledger action |
| `block` | off | review, plus a ledger action and dropping the player |

Block is disabled by default. The connection check already refuses the banned identity's own identifiers; block additionally removes a new identity as soon as its fingerprint arrives. Fingerprints are only available after the player joins, so no outcome can stop the connection itself. In [debug mode](./debug-mode.md) restrict and block are printed instead of applied.

Examples with the defaults: token alone (60) reaches review; token plus a matching fingerprint (95, capped at 100) reaches restrict; an IP match plus a matching fingerprint (43) stays a recorded link.

## Limits

- Everything comes from the client, so a determined evader can spoof attributes or drop the callback. The device token and storage id raise the effort; they do not make evasion impossible.
- Clearing both the FiveM KVP store and NUI storage resets the token, leaving only attribute and IP matching.
- Subnet history is not tracked; IPs are matched exactly through the existing salted endpoint hash.
- Fingerprint submissions are limited to `maximumSubmissions` (2) per session.
