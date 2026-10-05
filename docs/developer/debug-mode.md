# Debug mode and console announcements

## Debug mode

Set the `simpleac:debug` convar to `1` for a dry run:

```cfg
setr simpleac:debug 1
```

While it is on, SimpleAC detects and records as usual but takes no action:

- banned players can connect (`debug_action_skipped`, action `connection_block`)
- warn, restrict, kick and both ban types are downgraded to `log`; the console line shows `wouldHave` with the outcome that was skipped
- protected-event and weapon cancels are skipped, and rule cancels are turned off
- the heartbeat temporary ban and API-issued ban kicks are skipped

Every detection is printed to the server console while the flag is on. Protected events that fail validation still run their handler, so handlers may see unvalidated data. Never enable debug mode on a live server. The logic lives in `server-lua/enforcement/dry_run.lua`.

## Console announcements

Any rule can print its accepted detections to the server console. Set `announce` on its entry in `configs/server/profile.lua`:

```lua
['movement.teleport'] = { enabled = true, mode = 'log', announce = true, ... },
```

A rule can also default to announcing in code (`announce = true` in its registration). A profile entry overrides the rule default in either direction. The line looks like:

```
[SimpleAC] {"level":"warn","event":"detection","fields":{"rule":"integrity.nui_devtools_progress","player":"...","source":12,"outcome":"log","checks":5,"method":"debugger","detectionId":"SAC-DET-..."}}
```

## Profile modes

Besides `log` and `cancel`, a rule's profile mode may be `temporary_ban` or `permanent_ban`. These skip the score thresholds and ban on the first accepted report, so reserve them for rules that already require strong confirmation.
