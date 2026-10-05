return {
    version = 6,
    name = 'captures',
    statements = {
        -- A capture row is created when it is requested and completed when the image is uploaded, so everything
        -- that only exists after upload becomes nullable.
        [[ALTER TABLE sac_captures
            MODIFY COLUMN storage_key VARCHAR(512) NULL,
            MODIFY COLUMN media_type VARCHAR(64) NULL,
            MODIFY COLUMN byte_size INT UNSIGNED NULL,
            MODIFY COLUMN sha256 CHAR(64) NULL]],
        [[ALTER TABLE sac_captures
            ADD COLUMN IF NOT EXISTS status VARCHAR(16) NOT NULL DEFAULT 'requested',
            ADD COLUMN IF NOT EXISTS storage_backend VARCHAR(16) NULL,
            ADD COLUMN IF NOT EXISTS external_url VARCHAR(1024) NULL,
            ADD COLUMN IF NOT EXISTS trigger_type VARCHAR(16) NOT NULL DEFAULT 'manual',
            ADD COLUMN IF NOT EXISTS requested_by VARCHAR(128) NOT NULL DEFAULT 'system',
            ADD COLUMN IF NOT EXISTS watch_id VARCHAR(40) NULL,
            ADD COLUMN IF NOT EXISTS action_id VARCHAR(40) NULL,
            ADD COLUMN IF NOT EXISTS width SMALLINT UNSIGNED NULL,
            ADD COLUMN IF NOT EXISTS height SMALLINT UNSIGNED NULL,
            ADD COLUMN IF NOT EXISTS token_hash CHAR(64) NULL,
            ADD COLUMN IF NOT EXISTS token_expires_at TIMESTAMP(3) NULL,
            ADD COLUMN IF NOT EXISTS uploaded_at TIMESTAMP(3) NULL,
            ADD COLUMN IF NOT EXISTS error VARCHAR(255) NULL]],
        [[ALTER TABLE sac_captures
            ADD UNIQUE INDEX IF NOT EXISTS uq_sac_captures_token (token_hash),
            ADD INDEX IF NOT EXISTS idx_sac_captures_status (status, created_at),
            ADD INDEX IF NOT EXISTS idx_sac_captures_case (case_id)]],
    },
}
