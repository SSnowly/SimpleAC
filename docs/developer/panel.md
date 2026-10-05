# The staff panel: how it works

The panel is a React page (`web/nui/`) shown inside the game or in a browser. Everything it shows or changes goes through the shared server operation validator. The game transport below uses client events; the [browser transport](browser-panel.md) uses Discord sessions and authenticated HTTP.

```
panel (React, in an iframe)
   │  postMessage                         web/nui/src/lib/rpc.ts
   ▼
NUI page (nui/index.html + panel.js)      forwards to the game client
   │  NUI callback `panelRequest`
   ▼
client/panel.lua                          sanity-checks, forwards
   │  net event `simpleac:panel:req`
   ▼
server/panel/router.ts                    rate limit → permission → validate → handler
   │
   ▼
server/panel/handlers.ts                  calls the same services the HTTP API uses
   │
   ▼  net event `simpleac:panel:res`  (latent when large)
back the same way
```

## Authorization

Every operation is listed once in `shared/contracts/panel.ts`, with the permission it needs and a Zod schema for its input. The router refuses an operation before running anything if:

1. the operation name is not in the table,
2. the request is not an integer ID plus a JSON body under 32 KiB,
3. the player is over the rate limit (30 burst, 15 per second),
4. the player's permissions, recomputed for this request, do not include the operation's permission,
5. the input fails its schema.

Permissions come from `server/panel/access.ts`: the `simpleac.admin` ACE grants everything, `simpleac.<permission>` ACEs grant one each, and `sac_panel_members` rows grant by identifier. Browser sessions resolve only their verified Discord identifier through principal ACEs and member grants. Any permission implies `players.view`. Nothing is cached between requests.

Errors are mapped to a code and a safe message. Anything unexpected is logged on the server and the client only sees `internal_error`.

## Adding an operation

1. Add it to `panelOps` in `shared/contracts/panel.ts` with its `permission` and `input` schema, and its result type to `PanelOpOutput`.
2. Implement it in `createPanelHandlers` (`server/panel/handlers.ts`). TypeScript will not compile until every operation has a handler of the right type.
3. Call it from the UI with `rpc('your.op', input)` and add fixture handling in `web/nui/src/lib/dev-backend.ts` for the development preview.
4. Add the text to `locales/en.json`. The locale test fails if the UI uses a key that is missing.

Handlers reuse the services behind the HTTP API (`server/services/*`), so a rule enforced there is enforced for the panel too. Those services take an `Actor`; the game passes `type: 'ingame_panel'`, and the browser passes `type: 'staff'` with `web_panel` origin, so the ledger records who acted and from where.

## Opening and the session

`simpleac:panel:open` resolves the staff member, writes a `panel.opened` ledger entry and replies with `simpleac:panel:granted` (their permissions, bypass state, server info). The client then takes NUI focus and sends the language strings (`lib.getLocales()`) with the session. Closing releases focus through the `panelClosed` callback.

## Live watch

Code: `server/panel/watch.ts` (sessions), `server/relay/*` (relay), `nui/watch.js` (sending side), `web/nui/src/screens/LiveWatch.tsx` (viewing side).

```
staff panel ──watch.start──▶ server ──begin──▶ watched player's game
                                                    │ draws the game view into a canvas,
                                                    │ captureStream → RTCPeerConnection
staff panel ◀──────────── offer (relayed by server) ┘
staff panel ──watch.answer──▶ server ──answer──▶ watched player's game
        ◀════════ video over WebRTC through the relay ════════
```

- The server holds the state machine: one session per staff member, the watched player must send the offer, only the owning staff member may answer or stop, the offer must arrive within 20 s, the answer within 30 s, and no session lasts over 30 minutes. A player leaving ends their sessions.
- The relay is a pure-JS TURN server (`node-turn`) in a worker thread. Each session gets credentials whose username carries an expiry; they are removed when it ends. Both sides use `iceTransportPolicy: 'relay'`, so neither address is exposed.
- Quality: the stream is the player's resolution up to 1080p at 30 fps. Both ends add `x-google-start-bitrate` to the SDP (`web/nui/src/lib/sdp.ts`, `nui/watch.js`) because the game's embedded browser otherwise starts at a few hundred kilobits and drops the picture to 480×270 while it ramps up.

## Testing

- `bun run test`: the router and permission rules (`tests/unit/panel.test.ts`), the live-watch sessions (`watch.test.ts`), the locale file (`locale.test.ts`).
- `simpleac_panel_call <server id> <operation> [json]` (server console only) runs an operation exactly as that player would, with the same permission checks, and prints the reply. `simpleac_panel_call 1 open` shows whether the panel would open for them.
- `bun run dev:web` runs the panel in a browser against fixtures, with no game.

## Limits to know about

- Protection settings and profiles are read-only in the panel. Edit `configs/server/profile.lua`; the database stores profile versions for the audit trail.
- A screenshot shows the game's own rendering. Text drawn by other NUI pages (a chat box, a NUI menu) is not in it.
