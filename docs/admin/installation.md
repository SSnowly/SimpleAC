# Installation and updates

## Install the beta

1. Download the `SimpleAC-v0.1.0-beta.1.zip` asset from [GitHub Releases](https://github.com/SSnowly/SimpleAC/releases). Use the release asset; GitHub's source archives contain uncompiled source.
2. Extract `SimpleAC/` into your server's resources directory. Keep that folder name, or use your chosen name in commands, worker permissions, and HTTP paths.
3. Install `ox_lib` and `oxmysql`, configure the database connection, and enable OneSync.
4. Add the settings and start order from the [README](../../README.md#installation) to `server.cfg`. SimpleAC selects the bundled Node.js 22 runtime through its manifest.
5. Review `configs/server/profile.lua` and the [configuration reference](configuration.md). For live watch, set the server's public IP and open its UDP ports.
6. Start the server. SimpleAC applies pending database migrations automatically. Run `simpleac:diagnostics` in the server console, then open the staff panel with F10 or `/simpleac`.

The ZIP includes documentation and third-party license notices. `SimpleAC-v0.1.0-beta.1.zip.sha256` contains the ZIP's SHA-256 checksum.

## Update

1. Stop SimpleAC and back up the database, your `configs/` directory, and locally stored screenshot evidence (`evidence/` by default).
2. Read the new release notes for configuration or migration changes.
3. Replace the resource files with the new release. Merge your configuration changes into the supplied defaults and restore local evidence. Keep the existing database; it contains player records and the identifier hashing salt.
4. Start SimpleAC and check the console and `simpleac:diagnostics`. Browser sessions and live-watch sessions end during a resource restart.

Do not copy an old `configs/shared/main.lua` over the new one without merging it: that file also contains the release version.

## Roll back

Stop SimpleAC, restore the previous resource files and matching database backup, then start it again. Migrations run forward; installing an older release does not undo schema changes.

## Report a problem

Open a [GitHub issue](https://github.com/SSnowly/SimpleAC/issues) with the SimpleAC version, FXServer artifact, steps to reproduce, expected result, and relevant console messages. For a false positive, include the detection rule or ID and the legitimate gameplay action that triggered it. Remove secrets and player identifiers from logs before posting.
