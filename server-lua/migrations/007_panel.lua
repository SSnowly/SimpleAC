return {
    version = 7,
    name = 'panel',
    statements = {
        -- Staff who may open the in-game panel, and what each of them may do. Keyed by a platform identifier so a
        -- grant works before the person has ever joined this server.
        [[CREATE TABLE IF NOT EXISTS sac_panel_members (
            identifier VARCHAR(255) NOT NULL PRIMARY KEY,
            display_name VARCHAR(128) NOT NULL,
            permissions_json JSON NOT NULL,
            created_by VARCHAR(128) NOT NULL,
            created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
            updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci]],
    },
}
