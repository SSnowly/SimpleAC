# NUI DevTools detection

SimpleAC checks its NUI frame for debugger pauses and missing liveness messages associated with an attached DevTools frontend. The thresholds and enforcement modes are configurable.

## How it works

- `nui/devtools.js` runs a timed `debugger` statement every `intervalMs`. The statement only pauses execution while a DevTools frontend is attached, so a probe slower than `debuggerThresholdMs` means DevTools is open.
- Each tick also posts `nuiAlive` to Lua. A page held on a breakpoint never finishes its probe, so `client/detection/nui_devtools.lua` watches the pings and reports `stalled` when they stop for the same number of checks.
- Closing DevTools resets the consecutive-check count, so a short or accidental open never escalates.
- FiveM's CEF debugging port (13172) is always open and its responses carry no CORS headers, so probing the port tells us nothing and is not used.

## Escalation

| Consecutive checks | Rule | Default profile mode |
| --- | --- | --- |
| every `progressEvery` (5), below `confirmChecks` | `integrity.nui_devtools_progress` | `log` |
| `confirmChecks` (10) | `integrity.nui_devtools` | `temporary_ban` |

At the default 2 second interval a player has about 20 seconds to close DevTools. Both rules are announced in the server console (see [debug mode](./debug-mode.md) for the `announce` option). The server validators read the same thresholds as the client from `configs/client/detections.lua`, so they cannot drift apart.

## Configuration

`configs/client/detections.lua`:

```lua
nuiDevtools = {
    enabled = true,
    intervalMs = 2000,
    debuggerThresholdMs = 100,
    progressEvery = 5,
    confirmChecks = 10,
},
```

Enforcement is set per rule in `configs/server/profile.lua`. Use `log` to only record, `temporary_ban` (`temporaryBanHours`) or `permanent_ban`.

## Limits

Client modifications can disable or falsify these probes. Review the signal alongside other evidence. `nui/devtools.js` is obfuscated during the [build](./build-and-release.md).
