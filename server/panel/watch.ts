import { z } from 'zod';
import { createId } from '../../shared/contracts/ids.js';
import type { PanelIceServer, PanelWatchStart } from '../../shared/contracts/panel.js';
import type { Database } from '../db/database.js';
import { ApiError, conflict, forbidden, notFound } from '../http/errors.js';
import type { Relay } from '../relay/relay.js';
import { actionStatement } from '../repositories/actions.js';
import type { Actor } from '../services/bans.js';
import type { StaffIdentity } from './access.js';

/**
 * Every live view is sent at the player's own resolution up to 1080p, 30 frames a second. A modern machine can
 * encode that, and a lower setting only makes the picture worse for the person watching.
 */
export const STREAM = { width: 1920, fps: 30, bitrateKbps: 6000 };

export interface WatchConfig {
  iceServers: PanelIceServer[];
  relayOnly: boolean;
}

const iceServerSchema = z.object({
  urls: z
    .union([z.string(), z.array(z.string()).min(1)])
    .transform((urls) => (Array.isArray(urls) ? urls : [urls])),
  username: z.string().max(256).optional(),
  credential: z.string().max(512).optional(),
});

const DEFAULT_ICE: PanelIceServer[] = [{ urls: ['stun:stun.l.google.com:19302'] }];

/**
 * Live-watch settings from convars:
 * - `simpleac:watch_ice_servers`: JSON array of ICE servers (STUN/TURN). Defaults to a public STUN server.
 * - `simpleac:watch_relay_only`: `1` forces all video through a TURN relay.
 */
export function loadWatchConfig(read: (name: string, fallback: string) => string): WatchConfig {
  let iceServers = DEFAULT_ICE;
  const raw = read('simpleac:watch_ice_servers', '');
  if (raw.trim() !== '') {
    const parsed = z.array(iceServerSchema).max(8).safeParse(JSON.parse(raw));
    if (!parsed.success)
      throw new Error('simpleac:watch_ice_servers must be a JSON array of ICE servers');
    iceServers = parsed.data.map((server) => ({
      urls: server.urls,
      ...(server.username ? { username: server.username } : {}),
      ...(server.credential ? { credential: server.credential } : {}),
    }));
  }
  return {
    iceServers,
    relayOnly: read('simpleac:watch_relay_only', '0') === '1',
  };
}

/** One end of a live view: a player in the game, or a browser panel session. */
export type Party = { kind: 'game'; source: number } | { kind: 'web'; sessionId: string };

/** Messages the server sends to the two ends. Implemented over net events and the browser event stream; faked in tests. */
export interface WatchTransport {
  /** Tells the watched player's game to start streaming and send an offer. */
  begin(
    target: number,
    params: {
      id: string;
      iceServers: PanelIceServer[];
      relayOnly: boolean;
      fps: number;
      width: number;
      bitrateKbps: number;
    },
  ): void;
  /** The staff member's answer, for the watched player's game. */
  answer(target: number, id: string, sdp: string): void;
  /** The watched player's offer, for the staff member's panel (in the game or in the browser). */
  offer(viewer: Party, id: string, sdp: string): void;
  /** A session ended; tells the side that did not end it. */
  ended(party: Party, id: string, role: 'staff' | 'target', reason: string): void;
}

export interface WatchSessions {
  start(staff: StaffIdentity, playerId: string, actor: Actor): Promise<PanelWatchStart>;
  answer(staff: StaffIdentity, id: string, sdp: string): void;
  stop(staff: StaffIdentity, id: string, actor: Actor): Promise<void>;
  /** The offer arrives from the watched player's game. */
  fromTarget(source: number, id: unknown, kind: unknown, sdp: unknown): void;
  /** A player left the server: their sessions end, as watcher or as watched. */
  playerLeft(source: number): Promise<void>;
  /** A browser panel session went away (signed out, closed the tab): its live view ends. */
  viewerLeft(viewer: string): Promise<void>;
  /** Ends sessions that never connected or ran too long. */
  prune(): Promise<number>;
}

export interface WatchDeps {
  db: Database;
  config: WatchConfig;
  transport: WatchTransport;
  sourceOf(playerId: string): Promise<number | null>;
  /** The self-hosted relay. When it is up, live views go through it and stay private. */
  relay?: Relay;
  now?: () => number;
}

interface Session {
  id: string;
  /** `game:<id>` or `web:<session>`: who is watching. */
  viewerKey: string;
  viewer: Party;
  staffKey: string;
  targetSource: number;
  playerId: string;
  startedAt: number;
  offered: boolean;
  offeredAt: number;
  answered: boolean;
}

/** The watched player must send an offer within this long, or the session is dropped. */
export const WATCH_OFFER_TIMEOUT_MS = 20_000;
/** Once the offer is out, the panel must answer within this long. */
export const WATCH_ANSWER_TIMEOUT_MS = 30_000;
/** No live view runs longer than this, so a forgotten panel cannot watch a player forever. */
export const WATCH_MAX_MS = 30 * 60_000;
const MAX_SDP = 24_000;

export function createWatchSessions(deps: WatchDeps): WatchSessions {
  const { db, config, transport } = deps;
  const now = deps.now ?? Date.now;
  const sessions = new Map<string, Session>();

  const ledger = (
    actor: Actor,
    type: string,
    session: Session,
    reason: string,
    metadata: Record<string, unknown> = {},
  ) =>
    actionStatement({
      ...(actor.correlationId ? { correlationId: actor.correlationId } : {}),
      actorType: actor.type ?? 'web_api',
      actorId: actor.keyId,
      actionType: type,
      targetType: 'player',
      targetId: session.playerId,
      reason,
      metadata: { sessionId: session.id, ...metadata },
      origin: actor.origin ?? 'http_api',
    });

  const finish = async (
    session: Session,
    status: 'ended' | 'expired',
    reason: string,
    notify: 'staff' | 'target' | 'both',
    actor: Actor,
  ): Promise<void> => {
    sessions.delete(session.id);
    deps.relay?.revoke(session.id);
    if (notify !== 'target') transport.ended(session.viewer, session.id, 'staff', reason);
    if (notify !== 'staff') {
      transport.ended({ kind: 'game', source: session.targetSource }, session.id, 'target', reason);
    }
    await db.transaction([
      {
        query: `UPDATE sac_watch_sessions SET status = ?, ended_at = CURRENT_TIMESTAMP(3)
                WHERE id = ? AND status = 'active'`,
        values: [status, session.id],
      },
      ledger(actor, 'watch.stopped', session, 'Live watch ended', {
        reason,
        seconds: Math.round((now() - session.startedAt) / 1000),
      }),
    ]);
  };

  const ownedBy = (staff: StaffIdentity, id: string): Session => {
    const session = sessions.get(id);
    if (!session) throw notFound('That live view is not running.');
    if (session.viewerKey !== staff.viewer)
      throw forbidden('That live view belongs to someone else.');
    return session;
  };

  const systemActor = (session: Session): Actor => ({
    keyId: session.staffKey,
    correlationId: undefined,
    type: session.viewer.kind === 'game' ? 'ingame_panel' : 'staff',
    origin: session.viewer.kind === 'game' ? 'ingame_panel' : 'web_panel',
  });

  return {
    async start(staff, playerId, actor) {
      if (!(await db.single('SELECT id FROM sac_players WHERE id = ?', [playerId]))) {
        throw notFound('The player does not exist.');
      }
      const target = await deps.sourceOf(playerId);
      if (target === null) throw conflict('The player is not online.');
      for (const existing of [...sessions.values()]) {
        if (existing.viewerKey === staff.viewer)
          await finish(existing, 'ended', 'replaced', 'target', actor);
      }

      const session: Session = {
        id: createId('SAC-WATCH'),
        viewerKey: staff.viewer,
        viewer:
          staff.via === 'game'
            ? { kind: 'game', source: staff.source }
            : { kind: 'web', sessionId: staff.viewer.slice('web:'.length) },
        staffKey: actor.keyId,
        targetSource: target,
        playerId,
        startedAt: now(),
        offered: false,
        offeredAt: 0,
        answered: false,
      };
      // Through the self-hosted relay when it is up: nobody learns anyone's address and no outside server is needed.
      const relayServers = deps.relay?.issue(session.id) ?? null;
      const iceServers = relayServers ?? config.iceServers;
      const relayOnly = relayServers !== null || config.relayOnly;
      const committed = await db.transaction([
        {
          query: `INSERT INTO sac_watch_sessions (id, player_id, started_by, status, metadata_json)
                  VALUES (?, ?, ?, 'active', ?)`,
          values: [
            session.id,
            playerId,
            actor.keyId,
            JSON.stringify({
              mode: 'webrtc',
              fps: STREAM.fps,
              width: STREAM.width,
              relayOnly,
              relay: relayServers !== null,
            }),
          ],
        },
        ledger(actor, 'watch.started', session, 'Live watch started', { relayOnly }),
      ]);
      if (!committed) {
        deps.relay?.revoke(session.id);
        throw new Error('failed to record the live view');
      }
      sessions.set(session.id, session);
      transport.begin(target, {
        id: session.id,
        iceServers,
        relayOnly,
        fps: STREAM.fps,
        width: STREAM.width,
        bitrateKbps: STREAM.bitrateKbps,
      });
      return {
        id: session.id,
        iceServers,
        relayOnly,
        fps: STREAM.fps,
      };
    },

    answer(staff, id, sdp) {
      const session = ownedBy(staff, id);
      if (!session.offered) throw conflict('The player has not sent an offer yet.');
      if (session.answered) throw conflict('That live view was already answered.');
      if (sdp.length > MAX_SDP)
        throw new ApiError(413, 'payload_too_large', 'The answer is too large.');
      session.answered = true;
      transport.answer(session.targetSource, id, sdp);
    },

    async stop(staff, id, actor) {
      const session = ownedBy(staff, id);
      await finish(session, 'ended', 'stopped', 'target', actor);
    },

    fromTarget(source, id, kind, sdp) {
      if (
        typeof id !== 'string' ||
        kind !== 'offer' ||
        typeof sdp !== 'string' ||
        sdp.length < 20 ||
        sdp.length > MAX_SDP
      )
        return;
      const session = sessions.get(id);
      // Only the player being watched may send the offer, and only once.
      if (!session || session.targetSource !== source || session.offered) return;
      session.offered = true;
      session.offeredAt = now();
      transport.offer(session.viewer, id, sdp);
    },

    async playerLeft(source) {
      for (const session of [...sessions.values()]) {
        if (session.targetSource === source)
          await finish(session, 'ended', 'player_left', 'staff', systemActor(session));
        else if (session.viewerKey === `game:${String(source)}`)
          await finish(session, 'ended', 'staff_left', 'target', systemActor(session));
      }
    },

    async viewerLeft(viewer) {
      for (const session of [...sessions.values()]) {
        if (session.viewerKey === viewer) {
          await finish(session, 'ended', 'staff_left', 'target', systemActor(session));
        }
      }
    },

    async prune() {
      let ended = 0;
      const current = now();
      for (const session of [...sessions.values()]) {
        const noOffer = !session.offered && current - session.startedAt > WATCH_OFFER_TIMEOUT_MS;
        const noAnswer =
          session.offered &&
          !session.answered &&
          current - session.offeredAt > WATCH_ANSWER_TIMEOUT_MS;
        const stalled = noOffer || noAnswer;
        if (stalled || current - session.startedAt > WATCH_MAX_MS) {
          await finish(
            session,
            'expired',
            noOffer ? 'no_offer' : noAnswer ? 'no_answer' : 'time_limit',
            'both',
            systemActor(session),
          );
          ended += 1;
        }
      }
      // Sessions lost to a restart must not stay active forever.
      return (
        ended +
        (await db.execute(
          `UPDATE sac_watch_sessions SET status = 'expired', ended_at = CURRENT_TIMESTAMP(3)
         WHERE status = 'active' AND started_at < (CURRENT_TIMESTAMP(3) - INTERVAL 40 MINUTE)`,
        ))
      );
    },
  };
}
