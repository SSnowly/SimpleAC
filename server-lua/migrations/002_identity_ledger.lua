local Random = require 'server-lua.random'

return {
    version = 2,
    name = 'identity_and_ledger',
    statements = {
        [[ALTER TABLE sac_server_installation
            ADD COLUMN IF NOT EXISTS identifier_salt VARBINARY(32) NULL AFTER secret_hash]],
        function()
            local salt = Random.hex(32)
            if not salt then error('secure random source unavailable') end
            return [[UPDATE sac_server_installation
                SET identifier_salt = UNHEX(?)
                WHERE identifier_salt IS NULL]], { salt }
        end,
        [[ALTER TABLE sac_server_installation
            MODIFY COLUMN identifier_salt VARBINARY(32) NOT NULL]],
        [[ALTER TABLE sac_player_identifiers
            DROP INDEX idx_sac_identifiers_lookup]],
        [[ALTER TABLE sac_player_identifiers
            CHANGE COLUMN identifier_hash identifier_key VARCHAR(255) NOT NULL]],
        [[ALTER TABLE sac_player_identifiers
            ADD INDEX idx_sac_identifiers_lookup (identifier_type, identifier_key, last_seen_at)]],
        [[ALTER TABLE sac_player_sessions
            ADD COLUMN IF NOT EXISTS correlation_id VARCHAR(40) NULL AFTER id]],
        [[ALTER TABLE sac_player_sessions
            ADD INDEX IF NOT EXISTS idx_sac_sessions_source_active (server_source, disconnected_at)]],
    },
}
