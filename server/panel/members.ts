import {
  type PanelMember,
  type PanelPermission,
  panelPermissionSchema,
  panelPermissions,
} from '../../shared/contracts/panel.js';
import type { Database } from '../db/database.js';
import { requireString, toIso, toJsonValue } from '../db/mappers.js';
import { TS } from '../repositories/records.js';

export interface PanelMembers {
  list(): Promise<PanelMember[]>;
  /** Permissions granted to any of these identifiers, combined. */
  permissionsFor(identifiers: readonly string[]): Promise<Set<PanelPermission>>;
  grant(input: {
    identifier: string;
    name: string;
    permissions: readonly PanelPermission[];
    createdBy: string;
  }): Promise<PanelMember>;
  revoke(identifier: string): Promise<boolean>;
}

function parsePermissions(value: unknown): PanelPermission[] {
  const raw = toJsonValue(value);
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    const parsed = panelPermissionSchema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
}

const COLUMNS = `identifier, display_name, permissions_json, created_by, ${TS('created_at')}`;

export function createPanelMembers(db: Database): PanelMembers {
  const find = async (identifier: string): Promise<PanelMember | null> => {
    const row = await db.single(`SELECT ${COLUMNS} FROM sac_panel_members WHERE identifier = ?`, [
      identifier,
    ]);
    return row ? mapMember(row) : null;
  };

  return {
    async list() {
      const rows = await db.query(
        `SELECT ${COLUMNS} FROM sac_panel_members ORDER BY created_at, identifier LIMIT 200`,
      );
      return rows.map(mapMember);
    },

    async permissionsFor(identifiers) {
      const granted = new Set<PanelPermission>();
      if (identifiers.length === 0) return granted;
      const rows = await db.query(
        `SELECT permissions_json FROM sac_panel_members
         WHERE identifier IN (${identifiers.map(() => '?').join(', ')})`,
        [...identifiers],
      );
      for (const row of rows) {
        for (const permission of parsePermissions(row['permissions_json'])) granted.add(permission);
      }
      return granted;
    },

    async grant({ identifier, name, permissions, createdBy }) {
      // Stored in the canonical order so equal grants compare equal.
      const ordered = panelPermissions.filter((permission) => permissions.includes(permission));
      await db.execute(
        `INSERT INTO sac_panel_members (identifier, display_name, permissions_json, created_by)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE display_name = VALUES(display_name),
           permissions_json = VALUES(permissions_json)`,
        [identifier, name, JSON.stringify(ordered), createdBy],
      );
      const member = await find(identifier);
      if (!member) throw new Error('panel member was not readable after the write');
      return member;
    },

    async revoke(identifier) {
      return (
        (await db.execute('DELETE FROM sac_panel_members WHERE identifier = ?', [identifier])) > 0
      );
    },
  };
}

function mapMember(row: Record<string, unknown>): PanelMember {
  return {
    identifier: requireString(row, 'identifier'),
    name: requireString(row, 'display_name'),
    permissions: parsePermissions(row['permissions_json']),
    createdBy: requireString(row, 'created_by'),
    createdAt: toIso(row['created_at']),
  };
}
