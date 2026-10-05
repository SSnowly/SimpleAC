import type {
  ApiAction,
  ApiScope,
  Ban,
  IdentityLink,
  PlayerDetail,
  PlayerSummary,
} from '../../shared/contracts/api.js';
import { idPrefixes, simpleAcIdSchema } from '../../shared/contracts/ids.js';
import type { Database } from '../db/database.js';
import {
  requireString,
  toIso,
  toIsoOrNull,
  toJsonObject,
  toJsonValue,
  toStringOrNull,
} from '../db/mappers.js';
import {
  ACTION_COLUMNS,
  BAN_COLUMNS,
  escapeLike,
  findPlayerRow,
  mapAction,
  mapBan,
  mapIdentifier,
  mapIdentityLink,
  mapPlayer,
  mapSession,
  PLAYER_COLUMNS,
  TS,
} from '../repositories/records.js';

export interface Page<T> {
  items: T[];
  nextBefore: string | null;
}

export interface LookupResult {
  type: string;
  id: string;
  record: unknown;
  requiredScope: ApiScope;
}

function page<T extends { id: string }>(items: T[], limit: number): Page<T> {
  const hasMore = items.length > limit;
  const visible = hasMore ? items.slice(0, limit) : items;
  return { items: visible, nextBefore: hasMore ? (visible.at(-1)?.id ?? null) : null };
}

export interface Directory {
  listPlayers(input: {
    query?: string;
    limit: number;
    before?: string;
  }): Promise<Page<PlayerSummary>>;
  getPlayer(id: string, includeIdentifiers: boolean): Promise<PlayerDetail | null>;
  /** Scored links to other identities (shared device token, fingerprint, IP), strongest first. */
  listIdentityLinks(playerId: string): Promise<IdentityLink[]>;
  listActions(input: {
    targetId?: string;
    actionType?: string;
    /** Matches any action type starting with one of these, for example `ban.`. */
    typePrefixes?: string[];
    limit: number;
    before?: string;
  }): Promise<Page<ApiAction>>;
  getAction(id: string): Promise<ApiAction | null>;
  listBans(input: {
    playerId?: string;
    activeOnly: boolean;
    limit: number;
    before?: string;
  }): Promise<Page<Ban>>;
  getBan(id: string): Promise<Ban | null>;
  lookup(query: string): Promise<LookupResult | null>;
}

const lookupTables: Record<string, { table: string; scope: ApiScope; columns: string }> = {
  'SAC-PLY': { table: 'sac_players', scope: 'players:read', columns: PLAYER_COLUMNS },
  'SAC-SES': {
    table: 'sac_player_sessions',
    scope: 'players:read',
    columns: `id, player_id, ${TS('connected_at')}, ${TS('disconnected_at')}, disconnect_reason`,
  },
  'SAC-ACT': { table: 'sac_actions', scope: 'actions:read', columns: ACTION_COLUMNS },
  'SAC-CAP': {
    table: 'sac_captures',
    scope: 'captures:read',
    columns: `id, player_id, detection_id, case_id, status, trigger_type, media_type, byte_size, sha256,
      storage_backend, ${TS('created_at')}, ${TS('uploaded_at')}`,
  },
  'SAC-BAN': { table: 'sac_bans', scope: 'bans:read', columns: BAN_COLUMNS },
  'SAC-DET': {
    table: 'sac_detections',
    scope: 'detections:read',
    columns: `id, player_id, session_id, rule_key, rule_version, category, severity, confidence,
      score, outcome, status, measured_json, ${TS('occurred_at')}`,
  },
  'SAC-CASE': {
    table: 'sac_cases',
    scope: 'cases:read',
    columns: `id, player_id, status, priority, title, ${TS('created_at')}`,
  },
  'SAC-EXC': {
    table: 'sac_exceptions',
    scope: 'exceptions:read',
    columns: `id, scope_type, scope_value, effect, reason, created_by, ${TS('expires_at')}, ${TS('created_at')}`,
  },
  'SAC-KEY': {
    table: 'sac_api_keys',
    scope: 'keys:read',
    columns: `id, name, key_prefix, scopes_json, ${TS('expires_at')}, ${TS('last_used_at')}, ${TS('revoked_at')}, ${TS('created_at')}`,
  },
};

function shapeLookupRecord(prefix: string, row: Record<string, unknown>): unknown {
  switch (prefix) {
    case 'SAC-PLY':
      return mapPlayer(row);
    case 'SAC-SES':
      return {
        ...mapSession(row),
        playerId: requireString(row, 'player_id'),
      };
    case 'SAC-ACT':
      return mapAction(row);
    case 'SAC-CAP':
      return {
        id: requireString(row, 'id'),
        playerId: requireString(row, 'player_id'),
        detectionId: toStringOrNull(row['detection_id']),
        caseId: toStringOrNull(row['case_id']),
        status: requireString(row, 'status'),
        trigger: requireString(row, 'trigger_type'),
        mediaType: toStringOrNull(row['media_type']),
        byteSize: row['byte_size'] === null ? null : Number(row['byte_size']),
        sha256: toStringOrNull(row['sha256']),
        storageBackend: toStringOrNull(row['storage_backend']),
        createdAt: toIso(row['created_at']),
        uploadedAt: toIsoOrNull(row['uploaded_at']),
      };
    case 'SAC-BAN':
      return mapBan(row);
    case 'SAC-DET':
      return {
        id: requireString(row, 'id'),
        playerId: requireString(row, 'player_id'),
        sessionId: row['session_id'] ?? null,
        ruleKey: requireString(row, 'rule_key'),
        ruleVersion: Number(row['rule_version']),
        category: requireString(row, 'category'),
        severity: Number(row['severity']),
        confidence: Number(row['confidence']),
        score: Number(row['score']),
        outcome: requireString(row, 'outcome'),
        status: requireString(row, 'status'),
        measured: toJsonObject(row['measured_json']),
        occurredAt: toIso(row['occurred_at']),
      };
    case 'SAC-CASE':
      return {
        id: requireString(row, 'id'),
        playerId: requireString(row, 'player_id'),
        status: requireString(row, 'status'),
        priority: Number(row['priority']),
        title: requireString(row, 'title'),
        createdAt: toIso(row['created_at']),
      };
    case 'SAC-EXC':
      return {
        id: requireString(row, 'id'),
        scopeType: requireString(row, 'scope_type'),
        scopeValue: requireString(row, 'scope_value'),
        effect: requireString(row, 'effect'),
        reason: requireString(row, 'reason'),
        createdBy: requireString(row, 'created_by'),
        expiresAt: toIsoOrNull(row['expires_at']),
        createdAt: toIso(row['created_at']),
      };
    default:
      return {
        id: requireString(row, 'id'),
        name: requireString(row, 'name'),
        prefix: requireString(row, 'key_prefix'),
        scopes: toJsonValue(row['scopes_json']),
        expiresAt: toIsoOrNull(row['expires_at']),
        lastUsedAt: toIsoOrNull(row['last_used_at']),
        revokedAt: toIsoOrNull(row['revoked_at']),
        createdAt: toIso(row['created_at']),
      };
  }
}

export function createDirectory(db: Database): Directory {
  return {
    async listPlayers({ query, limit, before }) {
      const conditions: string[] = [];
      const values: unknown[] = [];
      if (before) {
        conditions.push('id < ?');
        values.push(before);
      }
      if (query) {
        conditions.push(`(display_name LIKE ? ESCAPE '\\\\' OR id = ?
          OR id IN (SELECT player_id FROM sac_player_identifiers WHERE identifier_key = ?))`);
        values.push(`%${escapeLike(query)}%`, query, query);
      }
      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      const rows = await db.query(
        `SELECT ${PLAYER_COLUMNS} FROM sac_players ${where} ORDER BY id DESC LIMIT ?`,
        [...values, limit + 1],
      );
      return page(rows.map(mapPlayer), limit);
    },

    async getPlayer(id, includeIdentifiers) {
      const row = await findPlayerRow(db, id);
      if (!row) return null;
      const [sessions, bans, identifiers] = await Promise.all([
        db.query(
          `SELECT id, ${TS('connected_at')}, ${TS('disconnected_at')}, disconnect_reason
           FROM sac_player_sessions WHERE player_id = ? ORDER BY id DESC LIMIT 10`,
          [id],
        ),
        db.query(
          `SELECT ${BAN_COLUMNS} FROM sac_bans WHERE player_id = ? ORDER BY id DESC LIMIT 25`,
          [id],
        ),
        includeIdentifiers
          ? db.query(
              `SELECT identifier_type, identifier_key, ${TS('first_seen_at')}, ${TS('last_seen_at')}
               FROM sac_player_identifiers WHERE player_id = ? ORDER BY identifier_type LIMIT 100`,
              [id],
            )
          : Promise.resolve([]),
      ]);
      return {
        ...mapPlayer(row),
        ...(includeIdentifiers ? { identifiers: identifiers.map(mapIdentifier) } : {}),
        recentSessions: sessions.map(mapSession),
        bans: bans.map(mapBan),
      };
    },

    async listIdentityLinks(playerId) {
      const rows = await db.query(
        `SELECT x.id, x.other_player_id, x.score, x.reasons_json, x.created_at,
                EXISTS(SELECT 1 FROM sac_bans b
                       WHERE b.player_id = x.other_player_id AND b.revoked_by_action_id IS NULL
                         AND (b.expires_at IS NULL OR b.expires_at > CURRENT_TIMESTAMP(3))) AS other_banned
         FROM (SELECT id,
                      IF(source_player_id = ?, target_player_id, source_player_id) AS other_player_id,
                      score, reasons_json, ${TS('created_at')}
               FROM sac_identity_links
               WHERE source_player_id = ? OR target_player_id = ?) x
         ORDER BY x.score DESC, x.id DESC LIMIT 100`,
        [playerId, playerId, playerId],
      );
      return rows.map(mapIdentityLink);
    },

    async listActions({ targetId, actionType, typePrefixes, limit, before }) {
      const conditions: string[] = [];
      const values: unknown[] = [];
      if (before) {
        conditions.push('id < ?');
        values.push(before);
      }
      if (targetId) {
        conditions.push('target_id = ?');
        values.push(targetId);
      }
      if (actionType) {
        conditions.push('action_type = ?');
        values.push(actionType);
      }
      if (typePrefixes && typePrefixes.length > 0) {
        conditions.push(`(${typePrefixes.map(() => 'action_type LIKE ?').join(' OR ')})`);
        values.push(...typePrefixes.map((prefix) => `${escapeLike(prefix)}%`));
      }
      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      const rows = await db.query(
        `SELECT ${ACTION_COLUMNS} FROM sac_actions ${where} ORDER BY id DESC LIMIT ?`,
        [...values, limit + 1],
      );
      return page(rows.map(mapAction), limit);
    },

    async getAction(id) {
      const row = await db.single(`SELECT ${ACTION_COLUMNS} FROM sac_actions WHERE id = ?`, [id]);
      return row ? mapAction(row) : null;
    },

    async listBans({ playerId, activeOnly, limit, before }) {
      const conditions: string[] = [];
      const values: unknown[] = [];
      if (before) {
        conditions.push('id < ?');
        values.push(before);
      }
      if (playerId) {
        conditions.push('player_id = ?');
        values.push(playerId);
      }
      if (activeOnly) {
        conditions.push(
          'revoked_by_action_id IS NULL AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP(3))',
        );
      }
      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      const rows = await db.query(
        `SELECT ${BAN_COLUMNS} FROM sac_bans ${where} ORDER BY id DESC LIMIT ?`,
        [...values, limit + 1],
      );
      return page(rows.map(mapBan), limit);
    },

    async getBan(id) {
      const row = await db.single(`SELECT ${BAN_COLUMNS} FROM sac_bans WHERE id = ?`, [id]);
      return row ? mapBan(row) : null;
    },

    async lookup(query) {
      const parsedId = simpleAcIdSchema.safeParse(query);
      if (parsedId.success) {
        const prefix = idPrefixes.find((candidate) => query.startsWith(`${candidate}-`));
        const definition = prefix ? lookupTables[prefix] : undefined;
        if (!prefix || !definition) return null;
        // Table and column names come from the hardcoded allowlist above.
        const row = await db.single(
          `SELECT ${definition.columns} FROM ${definition.table} WHERE id = ?`,
          [query],
        );
        if (!row) return null;
        return {
          type: prefix,
          id: query,
          record: shapeLookupRecord(prefix, row),
          requiredScope: definition.scope,
        };
      }

      const row = await db.single(
        `SELECT p.id FROM sac_player_identifiers i JOIN sac_players p ON p.id = i.player_id
         WHERE i.identifier_key = ? ORDER BY i.last_seen_at DESC LIMIT 1`,
        [query],
      );
      if (!row) return null;
      const player = await findPlayerRow(db, requireString(row, 'id'));
      return player
        ? {
            type: 'SAC-PLY',
            id: requireString(row, 'id'),
            record: mapPlayer(player),
            requiredScope: 'identifiers:read',
          }
        : null;
    },
  };
}
