return {
    version = 3,
    name = 'detection_engine',
    statements = {
        [[ALTER TABLE sac_detections
            ADD COLUMN IF NOT EXISTS score DECIMAL(10,3) NOT NULL DEFAULT 0 AFTER confidence]],
        [[ALTER TABLE sac_detections
            ADD COLUMN IF NOT EXISTS outcome VARCHAR(32) NOT NULL DEFAULT 'log' AFTER score]],
        [[ALTER TABLE sac_detections
            ADD COLUMN IF NOT EXISTS rule_version INT UNSIGNED NOT NULL DEFAULT 1 AFTER rule_key]],
        [[CREATE TABLE IF NOT EXISTS sac_case_detections (
            case_id VARCHAR(40) NOT NULL,
            detection_id VARCHAR(40) NOT NULL,
            created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
            PRIMARY KEY (case_id, detection_id),
            CONSTRAINT fk_sac_case_detections_case FOREIGN KEY (case_id) REFERENCES sac_cases(id),
            CONSTRAINT fk_sac_case_detections_detection FOREIGN KEY (detection_id) REFERENCES sac_detections(id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci]],
        [[CREATE TABLE IF NOT EXISTS sac_runtime_allowance_audit (
            id VARCHAR(40) PRIMARY KEY,
            player_id VARCHAR(40) NOT NULL,
            behavior VARCHAR(128) NOT NULL,
            resource_name VARCHAR(128) NOT NULL,
            reason VARCHAR(512) NOT NULL,
            expires_at TIMESTAMP(3) NOT NULL,
            revoked_at TIMESTAMP(3) NULL,
            created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
            INDEX idx_sac_allowance_player_behavior (player_id, behavior, expires_at),
            CONSTRAINT fk_sac_allowance_player FOREIGN KEY (player_id) REFERENCES sac_players(id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci]],
    },
}
