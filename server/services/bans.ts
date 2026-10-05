import type { Ban, CreateBanRequest } from '../../shared/contracts/api.js';
import { createId } from '../../shared/contracts/ids.js';
import type { Database } from '../db/database.js';
import { requireString } from '../db/mappers.js';
import { conflict, notFound } from '../http/errors.js';
import { actionStatement } from '../repositories/actions.js';
import { BAN_COLUMNS, mapBan } from '../repositories/records.js';

export interface GameBridge {
  /** Drops any connected session for the player. Resolves true when a session was dropped. */
  dropBannedPlayer(playerId: string, banId: string): Promise<boolean>;
}

export interface Actor {
  /** API key ID or, for the in-game panel, the staff member's player ID. */
  keyId: string;
  correlationId: string | undefined;
  /** Defaults to `web_api`. */
  type?: 'web_api' | 'ingame_panel' | 'staff';
  /** Defaults to `http_api`. */
  origin?: string;
}

export interface BanService {
  create(input: CreateBanRequest, actor: Actor): Promise<Ban>;
  revoke(banId: string, reason: string, actor: Actor): Promise<Ban>;
}

const ACTIVE_BAN = `revoked_by_action_id IS NULL
  AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP(3))`;

export function createBanService(db: Database, game: GameBridge): BanService {
  return {
    async create(input, actor) {
      const player = await db.single('SELECT id FROM sac_players WHERE id = ?', [input.playerId]);
      if (!player) throw notFound('The player does not exist.');
      const existing = await db.single(
        `SELECT id FROM sac_bans WHERE player_id = ? AND ${ACTIVE_BAN} LIMIT 1`,
        [input.playerId],
      );
      if (existing) throw conflict('The player already has an active ban.');

      const banId = createId('SAC-BAN');
      const action = actionStatement({
        ...(actor.correlationId ? { correlationId: actor.correlationId } : {}),
        actorType: actor.type ?? 'web_api',
        actorId: actor.keyId,
        actionType: 'ban.created',
        targetType: 'player',
        targetId: input.playerId,
        reason: input.reason,
        metadata: { banId, durationHours: input.durationHours },
        origin: actor.origin ?? 'http_api',
      });
      const committed = await db.transaction([
        action,
        {
          query: `INSERT INTO sac_bans (id, player_id, action_id, reason, expires_at)
            VALUES (?, ?, ?, ?, ${input.durationHours === null ? 'NULL' : 'DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL ? HOUR)'})`,
          values:
            input.durationHours === null
              ? [banId, input.playerId, action.id, input.reason]
              : [banId, input.playerId, action.id, input.reason, input.durationHours],
        },
      ]);
      if (!committed) throw new Error('failed to persist ban');

      await game.dropBannedPlayer(input.playerId, banId).catch(() => false);
      const row = await db.single(`SELECT ${BAN_COLUMNS} FROM sac_bans WHERE id = ?`, [banId]);
      if (!row) throw new Error('ban was not readable after commit');
      return mapBan(row);
    },

    async revoke(banId, reason, actor) {
      const row = await db.single(`SELECT ${BAN_COLUMNS} FROM sac_bans WHERE id = ?`, [banId]);
      if (!row) throw notFound('The ban does not exist.');
      const ban = mapBan(row);
      if (ban.revokedByActionId !== null) throw conflict('The ban is already revoked.');
      if (!ban.active) throw conflict('The ban has already expired.');

      const action = actionStatement({
        ...(actor.correlationId ? { correlationId: actor.correlationId } : {}),
        actorType: actor.type ?? 'web_api',
        actorId: actor.keyId,
        actionType: 'ban.revoked',
        targetType: 'player',
        targetId: ban.playerId,
        reason,
        metadata: { banId },
        origin: actor.origin ?? 'http_api',
        reversesActionId: ban.actionId,
      });
      const committed = await db.transaction([
        action,
        {
          query: `UPDATE sac_bans SET revoked_by_action_id = ?
                  WHERE id = ? AND revoked_by_action_id IS NULL`,
          values: [action.id, banId],
        },
      ]);
      if (!committed) throw new Error('failed to persist ban revocation');

      const updated = await db.single(`SELECT ${BAN_COLUMNS} FROM sac_bans WHERE id = ?`, [banId]);
      if (!updated) throw new Error('ban was not readable after commit');
      requireString(updated, 'id');
      return mapBan(updated);
    },
  };
}
