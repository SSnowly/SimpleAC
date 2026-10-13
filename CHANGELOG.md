# Changelog

## 1.0.0

First stable release for FiveM Legacy.

- Automatic install of `init.lua` into every resource manifest, with a one-time restart requirement.
- MariaDB support, including 16.1.
- Permit system that catches unauthorized vehicle and explosion spawns, with a trusted resource whitelist.
- Server-side movement speed check.
- Player cleanup: deletes spawned entities and revives victims, automatically before a kick or ban.
- Weapon baseline generated from `weapons.meta`, with automatic scanning of custom weapons in other resources and server overrides.
- Cancelled damage now restores the victim's health on the attacker's client.
- Unauthorized vehicles and explosions, server speed hacks and NUI devtools are permanent bans by default.

## 0.1.0-beta.1

First beta release for FiveM Legacy.

- Server event protections and configurable client detections.
- Player identities, fingerprint matching, bans, and an action ledger.
- Cases, staff notes, exceptions, and integration allowances.
- Screenshot capture, local/Fivemanage/S3 storage, and English OCR.
- In-game staff panel, permissions, and live video watch through the built-in TURN relay.
- Optional Discord sign-in for the browser panel and a scoped HTTP API.
- Packaged runtime files, installation and update instructions, checksums, and dependency notices.

Profile settings are edited in configuration files. Live watch carries video. Voice monitoring is deferred.
