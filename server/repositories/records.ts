import type { z } from 'zod';
import {
  type ApiAction,
  actionSchema,
  type Ban,
  banSchema,
  type IdentityLink,
  identityLinkSchema,
  type PlayerSummary,
  playerIdentifierSchema,
  playerSummarySchema,
  sessionSummarySchema,
} from '../../shared/contracts/api.js';
import type { Database, Row } from '../db/database.js';
import {
  requireNumber,
  requireString,
  toIso,
  toIsoOrNull,
  toJsonObject,
  toJsonValue,
  toStringOrNull,
} from '../db/mappers.js';

const TS = (column: string): string => `UNIX_TIMESTAMP(${column}) AS ${column}`;

export const PLAYER_COLUMNS = `id, display_name, risk_score, ${TS('first_seen_at')}, ${TS('last_seen_at')}`;
export const BAN_COLUMNS = `id, player_id, action_id, reason, revoked_by_action_id,
  (revoked_by_action_id IS NULL AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP(3))) AS active,
  ${TS('expires_at')}, ${TS('created_at')}`;
export const ACTION_COLUMNS = `id, correlation_id, actor_type, actor_id, action_type, target_type,
  target_id, reason, metadata_json, origin, reverses_action_id, ${TS('created_at')}`;

export function mapPlayer(row: Row): PlayerSummary {
  return playerSummarySchema.parse({
    id: requireString(row, 'id'),
    displayName: toStringOrNull(row['display_name']),
    riskScore: requireNumber(row, 'risk_score'),
    firstSeenAt: toIso(row['first_seen_at']),
    lastSeenAt: toIso(row['last_seen_at']),
  });
}

export function mapBan(row: Row): Ban {
  return banSchema.parse({
    id: requireString(row, 'id'),
    playerId: requireString(row, 'player_id'),
    actionId: requireString(row, 'action_id'),
    reason: requireString(row, 'reason'),
    expiresAt: toIsoOrNull(row['expires_at']),
    revokedByActionId: toStringOrNull(row['revoked_by_action_id']),
    active: Number(row['active']) === 1,
    createdAt: toIso(row['created_at']),
  });
}

export function mapAction(row: Row): ApiAction {
  return actionSchema.parse({
    id: requireString(row, 'id'),
    correlationId: requireString(row, 'correlation_id'),
    actorType: requireString(row, 'actor_type'),
    actorId: toStringOrNull(row['actor_id']),
    actionType: requireString(row, 'action_type'),
    targetType: toStringOrNull(row['target_type']),
    targetId: toStringOrNull(row['target_id']),
    reason: toStringOrNull(row['reason']),
    metadata: toJsonObject(row['metadata_json']),
    origin: requireString(row, 'origin'),
    reversesActionId: toStringOrNull(row['reverses_action_id']),
    createdAt: toIso(row['created_at']),
  });
}

export function mapIdentifier(row: Row): z.infer<typeof playerIdentifierSchema> {
  return playerIdentifierSchema.parse({
    type: requireString(row, 'identifier_type'),
    key: requireString(row, 'identifier_key'),
    firstSeenAt: toIso(row['first_seen_at']),
    lastSeenAt: toIso(row['last_seen_at']),
  });
}

export function mapIdentityLink(row: Row): IdentityLink {
  return identityLinkSchema.parse({
    id: String(row['id']),
    playerId: requireString(row, 'other_player_id'),
    score: requireNumber(row, 'score'),
    signals: toJsonValue(row['reasons_json']),
    otherBanned: Number(row['other_banned']) === 1,
    createdAt: toIso(row['created_at']),
  });
}

export function mapSession(row: Row): z.infer<typeof sessionSummarySchema> {
  return sessionSummarySchema.parse({
    id: requireString(row, 'id'),
    connectedAt: toIso(row['connected_at']),
    disconnectedAt: toIsoOrNull(row['disconnected_at']),
    disconnectReason: toStringOrNull(row['disconnect_reason']),
  });
}

/** Escapes LIKE wildcards so user input is matched literally. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

export async function findPlayerRow(db: Database, id: string): Promise<Row | null> {
  return db.single(`SELECT ${PLAYER_COLUMNS} FROM sac_players WHERE id = ?`, [id]);
}

export { TS };
