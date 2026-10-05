# Localization

All text that players and staff read lives in `locales/en.json`. SimpleAC uses [ox_lib's locale module](https://overextended.dev/ox_lib/Modules/Locale/Shared), so the language follows the `ox:locale` convar like every other ox resource:

```cfg
setr ox:locale "hu"
```

## Adding a language

Copy `locales/en.json` to `locales/<code>.json` and translate the values. Keep the keys, and keep `%s` / `%d` placeholders in the same order. A language only needs the keys it changes: English fills in anything that is missing. No rebuild is needed.

## Where the text is used

| Area | How it is read |
| --- | --- |
| Kick, ban and connection-block messages, notifications, key binding name | `locale('key', ...)` in the Lua scripts |
| The staff panel | The client sends `lib.getLocales()` (the chosen language over English) when the panel opens, and the panel looks keys up with `t('key', ...)` |
| Detection and action names in the panel | `rules.*` and `actions.*`: a rule `movement.noclip` is `rules.movement_noclip`, an action `ban.created` is `actions.ban_created` |

Server names are never translated: the panel shows `sv_projectName` (then `sv_hostname`), and `server.fallback_name` when neither is set.

## What is not translated on purpose

- **Audit records** (reasons, case notes, profile names) are data that staff wrote or the system recorded, so they stay as stored.
- **API errors** from the HTTP API are English for developers. In the panel, errors that mean the same thing for everyone (`forbidden`, `rate_limited`, `timeout`, `unavailable`, `internal_error`) are replaced by `errors.*`; more specific messages are shown as the server wrote them.
- **Console and log output** is for operators and stays English.

## Keeping it consistent

`bun run test` checks that every key used by the panel or the Lua scripts exists in `en.json`, that every detection rule and ledger action has a name, and that no key is left unused.
