return {
    version = 4,
    name = 'api_security',
    statements = {
        [[CREATE TABLE IF NOT EXISTS sac_api_idempotency (
            api_key_id VARCHAR(40) NOT NULL,
            idempotency_key VARCHAR(128) NOT NULL,
            fingerprint CHAR(64) NOT NULL,
            status SMALLINT UNSIGNED NOT NULL DEFAULT 0,
            response_json JSON NULL,
            created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
            PRIMARY KEY (api_key_id, idempotency_key),
            INDEX idx_sac_api_idempotency_created (created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci]],
        [[ALTER TABLE sac_bans
            ADD INDEX IF NOT EXISTS idx_sac_bans_active (revoked_by_action_id, expires_at)]],
    },
}
