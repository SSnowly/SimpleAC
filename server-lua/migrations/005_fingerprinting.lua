return {
    version = 5,
    name = 'fingerprinting',
    statements = {
        [[CREATE TABLE IF NOT EXISTS sac_device_tokens (
            token_hash CHAR(64) PRIMARY KEY,
            created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci]],
        [[CREATE TABLE IF NOT EXISTS sac_device_token_players (
            token_hash CHAR(64) NOT NULL,
            player_id VARCHAR(40) NOT NULL,
            first_seen_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
            last_seen_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
            PRIMARY KEY (token_hash, player_id),
            INDEX idx_sac_device_token_players_player (player_id),
            CONSTRAINT fk_sac_device_token FOREIGN KEY (token_hash) REFERENCES sac_device_tokens(token_hash),
            CONSTRAINT fk_sac_device_token_player FOREIGN KEY (player_id) REFERENCES sac_players(id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci]],
        [[ALTER TABLE sac_identity_links
            ADD INDEX IF NOT EXISTS idx_sac_identity_links_target (target_player_id)]],
    },
}
