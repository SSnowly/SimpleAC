import type {
  PanelConfigView,
  PanelServerInfo,
  PanelSession,
} from '../../shared/contracts/panel.js';
import type { Database } from '../db/database.js';
import { onGameThread } from '../game/bridge.js';
import { createRateLimiter } from '../http/middleware/rate-limit.js';
import type { WebPanelDeps } from '../http/routes/panel.js';
import { createRelay, loadRelayConfig } from '../relay/relay.js';
import { actionStatement } from '../repositories/actions.js';
import type { BanService } from '../services/bans.js';
import type { CaptureService } from '../services/captures.js';
import type { CaseService } from '../services/cases.js';
import type { DetectionService } from '../services/detections.js';
import type { Directory } from '../services/directory.js';
import type { ExceptionService } from '../services/exceptions.js';
import type { OverviewService } from '../services/overview.js';
import type { ProfileService } from '../services/profiles.js';
import type { StaffIdentity } from './access.js';
import { createPanelAccess } from './access.js';
import {
  actorOf,
  createPanelHandlers,
  findBypass,
  newCorrelationId,
  type PanelGame,
  staffActor,
} from './handlers.js';
import { createPanelMembers } from './members.js';
import { createPanelRouter, LATENT_BYTES_PER_SECOND, type PanelTransport } from './router.js';
import {
  createWatchSessions,
  loadWatchConfig,
  type WatchConfig,
  type WatchTransport,
} from './watch.js';
import { createWebSessions } from './web-auth.js';

export interface PanelWiring {
  db: Database;
  directory: Directory;
  bans: BanService;
  detections: DetectionService;
  cases: CaseService;
  exceptions: ExceptionService;
  profiles: ProfileService;
  overview: OverviewService;
  captures: CaptureService | undefined;
  evidenceConfig(): PanelConfigView['evidence'];
  game: PanelGame & {
    playerOf(source: number): Promise<string | null>;
    sourceOf(playerId: string): Promise<number | null>;
  };
  log(level: 'info' | 'warn' | 'error', event: string, fields: Record<string, unknown>): void;
}

const startedAt = Date.now();

/** Colour codes such as `^2` are meant for the server console, not for display. */
const plain = (value: string): string => value.replace(/\^\d/g, '').trim();

export function readServerInfo(): PanelServerInfo {
  const slots = Number.parseInt(GetConvar('sv_maxclients', '48'), 10);
  return {
    name: plain(GetConvar('sv_projectName', GetConvar('sv_hostname', ''))).slice(0, 80),
    online: GetNumPlayerIndices(),
    slots: Number.isFinite(slots) ? slots : 48,
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    version: GetResourceMetadata(GetCurrentResourceName(), 'version', 0) ?? '0.0.0',
    profile: null,
  };
}

/**
 * Connects the panel to the game: staff open it with the `simpleac:panel:open` event and then send numbered
 * `simpleac:panel:req` requests. The server authorizes every request on its own.
 */
export function registerPanel(
  wiring: PanelWiring,
): Pick<WebPanelDeps, 'access' | 'handlers' | 'sessions' | 'session' | 'audit'> {
  const { db, game } = wiring;
  const members = createPanelMembers(db);
  const access = createPanelAccess(members, {
    aceAllowed: (source, object) => IsPlayerAceAllowed(String(source), object),
    // `add_principal identifier.discord:123 group.admin` works for browser staff who are not connected.
    principalAllowed: (identifier, object) =>
      IsPrincipalAceAllowed(`identifier.${identifier}`, object),
    playerByIdentifier: async (identifier) => {
      const row = await db.single(
        `SELECT player_id FROM sac_player_identifiers WHERE identifier_key = ? ORDER BY last_seen_at DESC LIMIT 1`,
        [identifier],
      );
      return typeof row?.['player_id'] === 'string' ? row['player_id'] : null;
    },
    identifiers: (source) => {
      const player = String(source);
      const found: string[] = [];
      for (let index = 0; index < GetNumPlayerIdentifiers(player); index += 1) {
        const identifier = GetPlayerIdentifier(player, index);
        if (identifier) found.push(identifier);
      }
      return found;
    },
    name: (source) => GetPlayerName(String(source)) ?? `Player ${String(source)}`,
    playerOf: (source) => game.playerOf(source),
  });
  let watchConfig: WatchConfig;
  try {
    watchConfig = loadWatchConfig(GetConvar);
  } catch (error) {
    wiring.log('error', 'watch_config_invalid', {
      error: error instanceof Error ? error.message : 'unknown error',
    });
    watchConfig = loadWatchConfig(() => '');
  }
  const watchTransport: WatchTransport = {
    begin: (target, params) => {
      void onGameThread(() => emitNet('simpleac:watch:begin', target, params));
    },
    answer: (target, id, sdp) => {
      void onGameThread(() => emitNet('simpleac:watch:signal', target, id, 'answer', sdp));
    },
    offer: (viewer, id, sdp) => {
      if (viewer.kind === 'game') {
        void onGameThread(() => emitNet('simpleac:watch:signal', viewer.source, id, 'offer', sdp));
      } else {
        webSessions.push(viewer.sessionId, { type: 'offer', id, sdp });
      }
    },
    ended: (party, id, role, reason) => {
      if (party.kind === 'game') {
        void onGameThread(() => emitNet('simpleac:watch:end', party.source, id, role, reason));
      } else {
        webSessions.push(party.sessionId, { type: 'ended', id, reason });
      }
    },
  };
  const relay = createRelay({
    config: loadRelayConfig(GetConvar, GetResourcePath(GetCurrentResourceName())),
    log: wiring.log,
  });
  on('onResourceStop', (resourceName) => {
    if (resourceName === GetCurrentResourceName()) void relay.close();
  });
  const watch = createWatchSessions({
    db,
    relay,
    config: watchConfig,
    transport: watchTransport,
    sourceOf: game.sourceOf,
  });
  const webSessions = createWebSessions({ onLeave: (viewer) => watch.viewerLeft(viewer) });
  const handlers = createPanelHandlers({
    watch,
    db,
    directory: wiring.directory,
    bans: wiring.bans,
    detections: wiring.detections,
    cases: wiring.cases,
    exceptions: wiring.exceptions,
    profiles: wiring.profiles,
    overview: wiring.overview,
    members,
    game,
    captures: wiring.captures,
    serverInfo: readServerInfo,
    evidenceConfig: wiring.evidenceConfig,
  });

  const gameTransport: PanelTransport = {
    reply: (source, reply, latent) => {
      void onGameThread(() => {
        if (latent) {
          TriggerLatentClientEvent('simpleac:panel:res', source, LATENT_BYTES_PER_SECOND, reply);
        } else {
          emitNet('simpleac:panel:res', source, reply);
        }
      });
    },
    granted: (source, session: PanelSession) => {
      void onGameThread(() => {
        emitNet('simpleac:panel:granted', source, session);
      });
    },
    denied: (source) => {
      void onGameThread(() => {
        emitNet('simpleac:panel:denied', source);
      });
    },
  };

  const session = async (staff: StaffIdentity): Promise<PanelSession> => {
    const [profileList, bypass] = await Promise.all([
      wiring.profiles.list(),
      findBypass(wiring.exceptions, staff),
    ]);
    return {
      staff: {
        name: staff.name,
        playerId: staff.playerId,
        source: staff.source,
        permissions: [...staff.permissions],
        bypass: bypass !== null,
      },
      server: { ...readServerInfo(), profile: profileList[0]?.name ?? null },
    };
  };
  const buildRouter = (transport: PanelTransport) =>
    createPanelRouter({
      access,
      handlers,
      limiter: createRateLimiter(30, 15),
      log: wiring.log,
      transport,
      session,
      async audit(context) {
        const actor = actorOf(context);
        await db.transaction([
          actionStatement({
            correlationId: context.correlationId,
            actorType: 'ingame_panel',
            actorId: actor.keyId,
            actionType: 'panel.opened',
            targetType: 'panel',
            targetId: actor.keyId,
            reason: 'Panel opened',
            metadata: { name: context.staff.name },
            origin: 'ingame_panel',
          }),
        ]);
      },
    });

  const router = buildRouter(gameTransport);

  // The watched player's game sends its offer here; the panel's answer goes through the `watch.answer` operation.
  onNet('simpleac:watch:signal', (id: unknown, kind: unknown, sdp: unknown) => {
    watch.fromTarget(source, id, kind, sdp);
  });
  on('playerDropped', () => {
    void watch.playerLeft(source).catch(() => undefined);
  });
  setInterval(() => {
    webSessions.prune();
    watch.prune().catch(() => undefined);
  }, 10_000).unref();

  onNet('simpleac:panel:open', () => {
    void router.open(source);
  });
  onNet('simpleac:panel:req', (id: unknown, op: unknown, payload: unknown) => {
    void router.request(source, id, op, payload);
  });

  // Console-only: runs a panel operation as a connected player, with the same permission checks and validation as
  // a click in the panel, and prints the answer. Handy for checking a staff member's access without opening the UI.
  RegisterCommand(
    'simpleac_panel_call',
    (commandSource, args) => {
      if (commandSource !== 0) return;
      const target = Number.parseInt(args[0] ?? '', 10);
      const op = args[1];
      if (!Number.isInteger(target) || !op) {
        console.log('[SimpleAC] usage: simpleac_panel_call <server id> <operation> [json input]');
        return;
      }
      let payload: unknown = {};
      try {
        payload = args.length > 2 ? JSON.parse(args.slice(2).join(' ')) : {};
      } catch {
        console.log('[SimpleAC] the input is not valid JSON');
        return;
      }
      const printer = buildRouter({
        reply: (_source, reply) => {
          const text = JSON.stringify(reply);
          console.log(
            `[SimpleAC] panel ${op} -> ${text.length > 1800 ? `${text.slice(0, 1800)}...` : text}`,
          );
        },
        granted: (_source, session) => {
          console.log(
            `[SimpleAC] panel opens for ${session.staff.name}: ${session.staff.permissions.join(', ')}`,
          );
        },
        denied: () => {
          console.log('[SimpleAC] panel would be refused for that player');
        },
      });
      if (op === 'open') void printer.open(target);
      else void printer.request(target, 1, op, payload);
    },
    true,
  );
  return {
    access,
    handlers,
    sessions: webSessions,
    session,
    async audit(staff, action) {
      const actor = staffActor(staff, newCorrelationId());
      const committed = await db.transaction([
        actionStatement({
          ...(actor.correlationId ? { correlationId: actor.correlationId } : {}),
          actorType: 'staff',
          actorId: actor.keyId,
          actionType: action,
          targetType: 'panel',
          targetId: actor.keyId,
          reason:
            action === 'panel.opened' ? 'Browser panel signed in' : 'Browser panel signed out',
          metadata: { name: staff.name },
          origin: 'web_panel',
        }),
      ]);
      if (!committed) throw new Error('Panel audit could not be committed');
    },
  };
}
