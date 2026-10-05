import {
  type Profile,
  type ProfileDetail,
  profileDetailSchema,
  profileSchema,
  profileVersionSchema,
} from '../../shared/contracts/api.js';
import type { Database, Row } from '../db/database.js';
import {
  requireNumber,
  requireString,
  toIso,
  toJsonObject,
  toStringOrNull,
} from '../db/mappers.js';
import { TS } from '../repositories/records.js';

export interface ProfileService {
  list(): Promise<Profile[]>;
  /** `versionId` selects a historical version's config; otherwise the active version is returned. */
  get(id: string, versionId?: string): Promise<ProfileDetail | null>;
}

const PROFILE_COLUMNS = `p.id, p.name, p.description, p.active_version_id,
  UNIX_TIMESTAMP(p.created_at) AS created_at,
  (SELECT v.version FROM sac_profile_versions v WHERE v.id = p.active_version_id) AS active_version,
  (SELECT COUNT(*) FROM sac_profile_versions v WHERE v.profile_id = p.id) AS version_count`;

const mapProfile = (row: Row): Profile =>
  profileSchema.parse({
    id: requireString(row, 'id'),
    name: requireString(row, 'name'),
    description: toStringOrNull(row['description']),
    activeVersionId: toStringOrNull(row['active_version_id']),
    activeVersion: row['active_version'] === null ? null : requireNumber(row, 'active_version'),
    versionCount: requireNumber(row, 'version_count'),
    createdAt: toIso(row['created_at']),
  });

export function createProfileService(db: Database): ProfileService {
  return {
    async list() {
      const rows = await db.query(
        `SELECT ${PROFILE_COLUMNS} FROM sac_profiles p ORDER BY p.created_at, p.id LIMIT 100`,
      );
      return rows.map(mapProfile);
    },

    async get(id, versionId) {
      const row = await db.single(`SELECT ${PROFILE_COLUMNS} FROM sac_profiles p WHERE p.id = ?`, [
        id,
      ]);
      if (!row) return null;
      const profile = mapProfile(row);
      const versions = await db.query(
        `SELECT id, version, created_by, ${TS('created_at')}
         FROM sac_profile_versions WHERE profile_id = ? ORDER BY version DESC LIMIT 100`,
        [id],
      );
      const wanted = versionId ?? profile.activeVersionId;
      const configRow = wanted
        ? await db.single(
            'SELECT config_json FROM sac_profile_versions WHERE id = ? AND profile_id = ?',
            [wanted, id],
          )
        : null;
      return profileDetailSchema.parse({
        ...profile,
        versions: versions.map((version) =>
          profileVersionSchema.parse({
            id: requireString(version, 'id'),
            version: requireNumber(version, 'version'),
            createdBy: requireString(version, 'created_by'),
            createdAt: toIso(version['created_at']),
          }),
        ),
        config: configRow ? toJsonObject(configRow['config_json']) : null,
      });
    },
  };
}
