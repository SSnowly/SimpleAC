# Browser staff panel

The browser panel uses the same screens and operations as the in-game panel. Staff sign in with Discord; the resource resolves their permissions from `discord:<user ID>` and serves the panel through its HTTP handler.

## Configure sign-in

Create an application in the [Discord Developer Portal](https://discord.com/developers/applications). On its OAuth2 page, add the exact redirect URI `https://ac.example.com/simpleac/panel/auth/callback` and copy the client ID and client secret.

Add these private server convars to `server.cfg` (use `set`, so the secret is not replicated):

```cfg
set simpleac:web_url "https://ac.example.com/simpleac/panel"
set simpleac:discord_client_id "YOUR_APPLICATION_ID"
set simpleac:discord_client_secret "YOUR_APPLICATION_SECRET"

add_ace group.admin simpleac.admin allow
add_principal identifier.discord:YOUR_DISCORD_USER_ID group.admin
```

The public URL must use HTTPS, end in `/panel`, and have no query or fragment. Replace `simpleac` with your actual resource name in the public URL and proxy configuration. The callback is always the public URL plus `/auth/callback`.

Alternatively, an existing administrator can add a `discord:<user ID>` on the Panel access page and select individual permissions. Discord grants are independent from grants to a FiveM `license:` identifier. A successful Discord login does not grant access by itself. Staff need no active game connection; personal bypass is available when their Discord identifier is linked to a tracked player.

## Serve it through HTTPS

Use the included [Caddyfile](../../deploy/browser-panel/Caddyfile) as the starting point for a local reverse proxy. Change its hostname, resource name and FXServer port. Caddy provides HTTPS; the proxy forwards only the browser panel routes to FXServer. Keep the resource path when forwarding requests: FXServer removes the resource prefix before handing the request to Koa.

The existing `build:web` step produces the shared UI under `dist/web/nui`, which the resource serves at `/panel/`. Deploy that directory together with the server bundle. Source changes require a new build before they appear on a live server. Restart the resource after changing its convars, then open the public URL.

An empty `simpleac:web_url` disables browser routes. Invalid configuration disables the browser panel and logs `browser_panel_disabled`; the in-game panel and scoped API continue running.

## Sessions and live watch

Cookies are HTTP-only, Secure, SameSite=Lax and scoped to this panel. Sessions live in server memory, expire after eight hours or thirty minutes without requests, and disappear on a resource restart. Login uses a single-use state tied to the initiating browser, with a five-minute expiry. Discord access tokens are used only for identity verification and are not retained or returned to the UI. Mutating requests require both the public origin and a session CSRF token.

Every request checks the current ACE and database permissions. Revoking all panel access invalidates the session; removing live-watch permission stops its video. Sign-in, sign-out and operations appear in the existing action ledger with `web_panel` origin.

Live watch uses the existing WebRTC relay. Its signaling is delivered through short authenticated polls, which work with the CitizenFX HTTP wrapper. Closing the tab or losing connectivity ends the viewer after about thirty seconds, plus the server's ten-second cleanup interval. Background browsers may throttle polling and end a view. Two tabs sharing one cookie share one viewer and can replace each other's live view.

## Troubleshooting

- **Sign-in denied:** grant permissions to the verified `discord:` identifier; a license-only grant cannot authenticate the browser.
- **Sign-in failed:** check the Discord application's exact callback URI, client ID, client secret and FXServer's outbound access to Discord.
- **Blank or missing page:** confirm the current UI build is deployed under `dist/web/nui` and that the proxy preserves `/RESOURCE/panel/`.
- **Session expired:** sign in again; resource restarts clear all sessions.
- **Live watch does not connect:** check the relay configuration and its UDP firewall ports as described in the [staff panel guide](panel.md).
