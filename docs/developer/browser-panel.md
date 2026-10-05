# Browser panel transport

`server/panel/web-auth.ts` holds Discord authorization-code login, validated identity responses, a bounded in-memory session store, single-use browser-bound login state, expiry and per-session watch event queues. The flow follows [Discord's OAuth2 documentation](https://discord.com/developers/docs/topics/oauth2) and requests only `identify`.

`server/http/routes/panel.ts` serves the shared Vite assets and exposes the following routes relative to the resource's HTTP root:

| Route | Purpose |
| --- | --- |
| `GET /panel/auth/login` | Start Discord authorization and set the browser binding cookie |
| `GET /panel/auth/callback` | Consume state, verify Discord identity, check staff access, issue session |
| `GET /panel/session` | Resolve current staff permissions and obtain panel session plus CSRF token |
| `POST /panel/rpc` | Run `{ op, payload }` through the shared operation validator |
| `GET /panel/events?after=0` | Read viewer signals after a sequence cursor |
| `POST /panel/auth/logout` | Audit logout, invalidate the session, stop its live view |

RPC returns `{ data }` or the existing HTTP error envelope. It uses `executeOperation`, as does the game event router: permission checking, Zod input validation, payload limits and actor construction are shared. Browser actors use `staff` and `web_panel`. Sessions are authenticated before reading request bodies. Mutation origin and CSRF checks run before handlers. API-key routes retain their existing authentication and idempotency middleware.

Login attempts are rate-limited by address and authenticated requests by Discord identifier. The public URL comes from configuration; requests and proxy headers cannot select a callback URL or cookie scope. `app.proxy` remains disabled. The panel router explicitly emits Secure cookies for its configured HTTPS public URL even when the local TLS proxy talks to FXServer over HTTP. It does not infer security or staff identity from forwarded headers.

Only `index.html` and selected public asset types under `assets/` and `branding/` are served. API routes keep the restrictive API CSP; page assets receive a CSP allowing the shared UI's scripts, styles, fonts and local evidence data. Static paths reject traversal and do not expose source files or config.

`registerPanel` returns the access resolver, handlers, session builder and browser event store. Watch sessions use a viewer key (`game:<source>` or `web:<hashed session ID>`). Offers and end signals go to either the game transport or the corresponding web queue. Queues retain up to 32 events; advancing the cursor acknowledges earlier messages. The server stops a disconnected browser viewer, an expired session, a logged-out viewer or a viewer whose watch permission was removed. A final lifecycle check stops a watch that finishes starting after its browser session has been removed.

`web/nui/src/lib/env.ts` selects game, browser or fixture mode. A production page outside FiveM uses browser transport. Vite's `/` keeps the fixture preview; `/panel/` selects the browser login screen. `VITE_PANEL_API_BASE` can provide a same-origin panel endpoint for development through an HTTPS proxy. Never put the Discord client secret in Vite variables.

Tests in `tests/unit/web-panel.test.ts` cover state binding/replay/expiry, identity exchange, session expiry and logout, event isolation, static routes, cookies, origin/CSRF rejection, payload validation, denied login and permission revocation.
