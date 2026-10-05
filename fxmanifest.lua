fx_version 'cerulean'
game 'gta5'

author 'SimpleAC contributors'
description 'Self-hostable FiveM anti-cheat and operations platform'
version '0.1.0-beta.1'

lua54 'yes'
-- Node 22 (bundled with the server) for the control plane: workers for OCR, global fetch and current language features.
node_version '22'

dependencies {
    '/onesync',
    'ox_lib',
    'oxmysql',
}

shared_scripts {
    '@ox_lib/init.lua',
    'shared/lua/debug.lua',
}

server_scripts {
    '@oxmysql/lib/MySQL.lua',
    'server-lua/_index.lua',
    'dist/server/bootstrap.js',
}

ui_page 'dist/nui/index.html'

client_scripts {
    'client/_index.lua',
}

files {
    'configs/shared/*.lua',
    'configs/client/*.lua',
    'shared/lua/*.lua',
    'bridge/*.lua',
    'client/**/*.lua',
    'locales/*.json',
    'dist/nui/*',
    'dist/web/nui/**',
}

ox_libs {
    'locale',
}

provide 'simpleac'
