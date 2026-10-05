# Detection engine

Detectors submit measured facts to the server registry. They do not directly ban players. The engine validates the registered rule, active profile, persistent exceptions, temporary allowances, cooldown, strikes, and recent cross-category evidence before selecting an outcome.

The synchronous result contains `cancel`. Cancellable CitizenFX handlers must call `CancelEvent()` immediately when it is true. Detection persistence, case creation, ledger writes, and enforcement run in a separate coroutine so database latency is not placed on the cancellation path.

The balanced profile cancels clearly abusive entity, explosion, and protected-event activity. A single noisy client heuristic must not independently produce a permanent ban.

## Integration exports

- `AllowAction(source, behavior, durationMs, reason)` creates a resource-scoped runtime allowance.
- `RevokeAllowance(id)` revokes an allowance created by the calling resource.
- `IsActionAllowed(source, behavior)` checks an allowance owned by the calling resource.
- `RegisterProtectedEvent(name, definition, handler)` registers a validated, rate-limited server event.
- `RegisterSafeZone(id, definition)` registers server-owned zone metadata.
- `RegisterEntityAllowance(source, durationMs, reason)` permits a bounded entity burst.
- `SetPlayerContext(source, key, value)` stores bounded server-owned gameplay context.
- `SubmitDetection(signal)` submits a signal attributed to the calling resource.
- `GetRiskState(source)` returns the current ephemeral risk summary.

All export inputs are validated. The calling resource is obtained through `GetInvokingResource`; a payload cannot claim a different origin.

## Client-sourced detections and legitimate flows

Rules registered with `clientSourced = true` are the only ones accepted on `simpleac:detection:clientReport`. They share thresholds with the client sensors through `configs/client/detections.lua`, so the validator and the sensor cannot drift. Server-side rules (network, authoritative combat, integrity) can never be submitted by a client.

`integrity.nui_devtools` and `integrity.nui_devtools_progress` detect an attached NUI DevTools frontend and escalate from logs to a temporary ban; see [nui-devtools.md](./nui-devtools.md). Rules can print to the server console and the whole engine can run as a dry run; see [debug-mode.md](./debug-mode.md).

Client-sourced rules are suppressed, with reason `grace`, `safe_zone`, `excepted` or `allowed`, in these cases:

- **Join grace** (`configs/server/grace.lua`): every new session starts with a window covering all client categories.
- **Lifecycle hints**: the client reports `respawn`, `cutscene`, `loading` and `interior` transitions on `simpleac:lifecycle:hint`. The server decides: unknown kinds are refused, each kind has a duration cap and a per-player cooldown, and `respawn` is only granted while the server sees a living ped. A forged hint therefore buys at most a short, rate-limited window for the listed categories.
- **Safe zones**: `RegisterSafeZone(id, { x, y, z, radius, exempt })` exempts players whose _server-side_ position is inside the zone from the categories in `exempt` (default `state` and `movement`).
- **Allowances and exceptions**: framework or admin teleports, god mode and similar should call `AllowAction(source, 'movement.teleport', durationMs, reason)` before acting.

## Damage-event protections

`server-lua/protections/network.lua` guards the three FiveM damage events, with limits in `configs/server/protections.lua`:

- `explosionEvent`: `network.explosion_abnormal` (denied type, invisible, damage scale over `maximumDamageScale`) and `network.explosion_rate`.
- `startProjectileEvent`: `network.projectile_abnormal` for a denied projectile or weapon hash, a projectile credited to an entity the sender does not own, or a start position more than `maximumSpawnDistance` from the sender's ped.
- `ptFxEvent`: `network.particle_abnormal` for a denied effect or asset hash, a scale over `maximumScale`, or an unattached effect more than `maximumDistance` from the sender.

Both new rules cancel the event in the balanced profile. The denylists are empty by default, and checks skip any field the event does not carry. Every event also stays under the per-event rate limit (`network.event_rate`).

## Client scheduler and profiling

`client/scheduler.lua` runs staggered, jittered tasks from one 100 ms loop. A task returning `'idle'` backs its interval off, doubling up to `maxBackoff`. Run `simpleac_profile` in the F8 console to print per-task average and maximum cost and an estimated per-frame total.

## Tests

`bun run test:lua` runs the Lua suite with a plain Lua 5.4 interpreter and CitizenFX stubs (`tests/lua/harness.lua`). It covers rule validation, profile coverage, engine decisions, grace windows and report handling.
