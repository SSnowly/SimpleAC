local Config = require 'configs.shared.main'
require 'client.scheduler'
require 'client.detection.sensors'
require 'client.integrity.heartbeat'
require 'client.detection.nui_devtools'
require 'client.identity.fingerprint'
require 'client.evidence.capture'
require 'client.panel'
require 'client.watch'

CreateThread(function()
    if Config.debug then
        print(('^6[SimpleAC:client]^7 initialized v%s'):format(Config.version))
    end
end)
