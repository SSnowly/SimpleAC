# The staff panel

Staff use the panel to review detections, manage cases, inspect evidence, moderate players, and watch live video. It runs inside the game or in a [browser with Discord sign-in](browser-panel.md). Staff changes and monitoring sessions are recorded in the audit history.

## Opening it

Press **F10** or type `/simpleac`. The key can be changed in the FiveM key bindings under "Open the SimpleAC panel". Escape steps back one page, then closes the panel.

Opening the panel is recorded (`panel.opened`). Someone with no permission sees "you do not have access to the panel" and nothing opens.

## Giving staff access

Grant access through ACE permissions or the Panel access page. Both grants apply.

**ACE permissions in `server.cfg`:**

```cfg
# Full access to everything
add_ace group.admin simpleac.admin allow
add_principal identifier.license:YOUR_LICENSE group.admin

# Or one permission at a time
add_ace group.moderator simpleac.players.view allow
add_ace group.moderator simpleac.cases.manage allow
add_principal identifier.license:THEIR_LICENSE group.moderator
```

**Panel access page:** staff with "Manage panel access" can add a `license:` identifier for in-game access or a `discord:` identifier for browser access, then select permissions. Changes apply on the next request.

People with the `simpleac.admin` ACE always have everything and do not appear on that page.

### What each permission allows

| Permission | ACE name | Allows |
| --- | --- | --- |
| View players and records | `simpleac.players.view` | Open the panel; read players, detections, cases, evidence, the ledger, exceptions, profiles and configuration. Every other permission includes this one. |
| Review detections | `simpleac.detections.review` | Confirm or dismiss a detection |
| Manage cases | `simpleac.cases.manage` | Open and change cases, add notes, link detections and screenshots |
| Capture and manage evidence | `simpleac.evidence.capture` | Request screenshots, re-read their text, delete an image |
| Live watch (video) | `simpleac.live.watch` | Watch a player's screen live |
| Moderate players | `simpleac.players.moderate` | Warn, kick, ban, revoke bans; see raw identifiers and linked accounts |
| Manage exceptions and bypass | `simpleac.exceptions.manage` | Create and revoke exceptions; use the personal bypass |
| Manage panel access | `simpleac.access.manage` | Add and remove panel members |

The server checks permissions on every request. The panel hides unavailable controls.

## Screens

- **Overview**: players online, the last day of detections and cases, what needs review, recent activity.
- **Players**: who is online, a search by name, and a box that jumps straight to any `SAC-…` ID or `license:` identifier. Opening a player shows their summary, a Live tab, detections, cases, evidence, identifiers and actions.
- **Detections / Cases / Evidence**: the review workflow. A detection is a signal to investigate, not proof; confirm or dismiss it with a reason. A case groups signals, screenshots and notes. Evidence shows the screenshot with the text the server read from it.
- **Actions / Audit**: Actions is what was done to players; Audit is everything, including staff work.
- **Exceptions**: scoped allowances for legitimate behaviour, for a player, a detection rule or a resource. They apply immediately. The sidebar **Bypass** switch is an exception for your own player, kept until you turn it off.
- **Profiles / Configuration**: what the server is running. These are read-only: protection settings live in `configs/server/*.lua`.

Moderation and review actions record the staff member and their reason.

## Live watch

The Live tab shows the player's game view as video.

The player's game sends a WebRTC stream to the panel. The server authorizes the session and exchanges connection details. With the built-in TURN relay running, video passes through the server and the peers' IP addresses stay hidden from each other.

It stops when you leave the tab, close the panel, the player leaves, or after 30 minutes. Every live view is recorded in the audit history.

### Setting up the relay on a real server

Configure the relay before using live watch:

1. Allow worker threads for the resource (the same setting OCR needs):
   ```cfg
   add_unsafe_worker_permission "SimpleAC"
   ```
2. Tell SimpleAC the address people reach your server on:
   ```cfg
   set simpleac:watch_public_ip "203.0.113.10"
   ```
3. Open these **UDP** ports in the firewall: `3478` and `49152`–`49351`. Both can be changed (see [configuration](./configuration.md)).

If the relay cannot start, live watch falls back to a public STUN server. It still works, but then the video travels directly and the staff member's address and the player's become visible to each other's network, and the panel says so. To use your own TURN server instead, set `simpleac:watch_ice_servers` and, if you want, `simpleac:watch_relay 0`.

### If the live view will not connect

- The player's game must be running the same version of the resource as the server. Rejoin after an update.
- Check the server console for `watch_relay_failed`. The usual causes are missing worker permission and a port already in use.
- On a real server, check `simpleac:watch_public_ip` and the UDP ports. A relay that only works locally is the commonest mistake.

## Languages

All text comes from `locales/en.json` through ox_lib. See [localization](../developer/localization.md).
