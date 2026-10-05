# Trust boundaries

SimpleAC treats every client, NUI message, external HTTP request, export argument, statebag value, and framework result as untrusted input.

The server owns mutable anti-cheat state and enforcement decisions. Lua integrates with CitizenFX events and server-native cancellation points. The TypeScript control plane owns HTTP orchestration, schemas, and services. oxmysql is the only persistence provider, and all query values use placeholders.

Only `client/_index.lua` and `server-lua/_index.lua` are registered Lua entry points. Feature modules are loaded explicitly with `require`. The TypeScript bootstrap is the sole owner of `SetHttpHandler`, through `@citizenfx/http-wrapper`.

The current health endpoint is public and read-only. It exposes only resource readiness, version, migration version, uptime, and dependency states. It never returns secrets, player data, database connection information, or stack traces.

## The staff panel and live watch

The panel's page runs in an iframe inside the NUI and is treated as untrusted: it can only send numbered requests, and the server checks the sender's permission for each operation, validates its input, rate-limits it and records changes in the ledger. Hiding a control in the panel is never authorization. See [how the panel works](../developer/panel.md).

The watched player's game submits one WebRTC offer; the owning staff session submits the answer. The server validates both, limits session duration, and removes relay credentials when the session ends. The relay forwards encrypted video packets. See [the panel transport](../developer/panel.md#live-watch).
