import { createId } from '../../shared/contracts/ids.js';
import type {
  PanelConfigView,
  PanelInput,
  PanelOnline,
  PanelOp,
  PanelOpOutput,
  PanelPermission,
  PanelPlayerRow,
  PanelServerInfo,
} from '../../shared/contracts/panel.js';
import type { Database } from '../db/database.js';
import { ApiError, forbidden, notFound } from '../http/errors.js';
import { actionStatement } from '../repositories/actions.js';
import { mapPlayer, PLAYER_COLUMNS } from '../repositories/records.js';
import type { Actor, BanService } from '../services/bans.js';
import type { CaptureService } from '../services/captures.js';
import type { CaseService } from '../services/cases.js';
import type { DetectionService } from '../services/detections.js';
import type { Directory } from '../services/directory.js';
import type { ExceptionService } from '../services/exceptions.js';
import type { OverviewService } from '../services/overview.js';
import type { ProfileService } from '../services/profiles.js';
import type { StaffIdentity } from './access.js';
import type { PanelMembers } from './members.js';
import type { WatchSessions } from './watch.js';

export interface OnlinePlayer extends PanelOnline {
  playerId: string;
  name: string;
}

/** What the panel needs from the running game. Implemented over the Lua exports; faked in tests. */
export interface PanelGame {
  online(): Promise<OnlinePlayer[]>;
  warn(playerId: string, reason: string): Promise<boolean>;
  kick(playerId: string, reason: string): Promise<boolean>;
}

export interface PanelDeps {
  db: Database;
  directory: Directory;
  bans: BanService;
  detections: DetectionService;
  cases: CaseService;
  exceptions: ExceptionService;
  profiles: ProfileService;
  overview: OverviewService;
  members: PanelMembers;
  watch: WatchSessions;
  game: PanelGame;
  /** Absent when evidence storage is not configured. */
  captures: CaptureService | undefined;
  serverInfo(): PanelServerInfo;
  evidenceConfig(): PanelConfigView['evidence'];
}

export interface PanelContext {
  staff: StaffIdentity;
  actor: Actor;
  correlationId: string;
}

export type PanelHandlers = {
  [K in PanelOp]: (context: PanelContext, input: PanelInput<K>) => Promise<PanelOpOutput[K]>;
};

const MODERATION_ACTIONS = ['ban.', 'enforcement.', 'moderation.'];
const BYPASS_REASON = 'Staff bypass';

export const actorOf = (context: PanelContext): Actor => context.actor;

/** Who a ledger entry names: the staff member's player when known, else their identifier. */
export function staffActor(staff: StaffIdentity, correlationId: string): Actor {
  return {
    keyId: staff.playerId ?? staff.identifiers[0] ?? `source:${String(staff.source)}`,
    correlationId,
    type: staff.via === 'game' ? 'ingame_panel' : 'staff',
    origin: staff.via === 'game' ? 'ingame_panel' : 'web_panel',
  };
}

/** The ID of the staff member's active self-bypass exception, if they turned it on. */
export async function findBypass(
  exceptions: ExceptionService,
  staff: StaffIdentity,
): Promise<string | null> {
  if (!staff.playerId) return null;
  const result = await exceptions.list({
    scopeType: 'player',
    scopeValue: staff.playerId,
    activeOnly: true,
    limit: 20,
  });
  return result.items.find((item) => item.reason === BYPASS_REASON)?.id ?? null;
}

const can = (staff: StaffIdentity, permission: PanelPermission): boolean =>
  staff.permissions.has(permission);

export function createPanelHandlers(deps: PanelDeps): PanelHandlers {
  const {
    db,
    directory,
    bans,
    detections,
    cases,
    exceptions,
    profiles,
    overview,
    members,
    game,
    watch,
  } = deps;

  const requireCaptures = (): CaptureService => {
    if (!deps.captures)
      throw new ApiError(503, 'unavailable', 'Evidence capture is not configured.');
    return deps.captures;
  };

  const ledger = async (
    context: PanelContext,
    actionType: string,
    targetType: string,
    targetId: string,
    reason: string,
    metadata: Record<string, unknown>,
  ): Promise<void> => {
    const actor = actorOf(context);
    const committed = await db.transaction([
      actionStatement({
        correlationId: context.correlationId,
        actorType: actor.type ?? 'ingame_panel',
        actorId: actor.keyId,
        actionType,
        targetType,
        targetId,
        reason,
        metadata,
        origin: actor.origin ?? 'ingame_panel',
      }),
    ]);
    if (!committed) throw new Error('failed to record the action');
  };

  const onlineByPlayer = async (): Promise<Map<string, OnlinePlayer>> =>
    new Map((await game.online()).map((player) => [player.playerId, player]));

  const toOnline = (player: OnlinePlayer | undefined): PanelOnline | null =>
    player
      ? {
          source: player.source,
          ping: player.ping,
          health: player.health,
          armor: player.armor,
          coords: player.coords,
          inVehicle: player.inVehicle,
          bucket: player.bucket,
        }
      : null;

  const pageOptions = (input: { limit?: number | undefined; before?: string | undefined }) => ({
    limit: input.limit ?? 25,
    ...(input.before ? { before: input.before } : {}),
  });

  const identifiersVisible = (staff: StaffIdentity): boolean =>
    can(staff, 'players.moderate') || can(staff, 'access.manage');

  return {
    async 'overview.get'() {
      const [stats, trends, attention, activity, profileList] = await Promise.all([
        overview.get(),
        overview.trends(7),
        detections.list({ status: 'open', limit: 8 }),
        directory.listActions({ limit: 8 }),
        profiles.list(),
      ]);
      const server = deps.serverInfo();
      return {
        stats,
        trends,
        attention: attention.items,
        activity: activity.items,
        server: { ...server, profile: profileList[0]?.name ?? server.profile },
      };
    },

    async 'players.list'(_context, input) {
      const online = await onlineByPlayer();
      const options = pageOptions(input);
      if (!input.q && !input.all && !input.before) {
        if (online.size === 0) return { items: [], nextBefore: null };
        const ids = [...online.keys()];
        const rows = await db.query(
          `SELECT ${PLAYER_COLUMNS} FROM sac_players WHERE id IN (${ids.map(() => '?').join(', ')})`,
          ids,
        );
        const items: PanelPlayerRow[] = rows
          .map(mapPlayer)
          .sort((a, b) => b.riskScore - a.riskScore)
          .map((player) => ({ ...player, online: toOnline(online.get(player.id)) }));
        return { items, nextBefore: null };
      }
      const result = await directory.listPlayers({
        ...(input.q ? { query: input.q } : {}),
        ...options,
      });
      return {
        items: result.items.map((player) => ({
          ...player,
          online: toOnline(online.get(player.id)),
        })),
        nextBefore: result.nextBefore,
      };
    },

    async 'players.get'(context, input) {
      const visible = identifiersVisible(context.staff);
      const player = await directory.getPlayer(input.id, visible);
      if (!player) throw notFound('The player does not exist.');
      const online = (await onlineByPlayer()).get(input.id);
      return { player, online: toOnline(online), identifiersVisible: visible };
    },

    async 'players.links'(context, input) {
      if (!identifiersVisible(context.staff)) throw forbidden();
      return { items: await directory.listIdentityLinks(input.id) };
    },

    'detections.list': (_context, input) =>
      detections.list({
        ...pageOptions(input),
        ...(input.playerId ? { playerId: input.playerId } : {}),
        ...(input.caseId ? { caseId: input.caseId } : {}),
        ...(input.status ? { status: input.status } : {}),
      }),

    async 'detections.get'(_context, input) {
      const detection = await detections.get(input.id);
      if (!detection) throw notFound('The detection does not exist.');
      return detection;
    },

    'detections.review': (context, input) =>
      detections.review(input.id, { status: input.status, reason: input.reason }, actorOf(context)),

    'cases.list': (_context, input) =>
      cases.list({
        ...pageOptions(input),
        ...(input.playerId ? { playerId: input.playerId } : {}),
        ...(input.status ? { status: input.status } : {}),
      }),

    async 'cases.get'(_context, input) {
      const record = await cases.get(input.id);
      if (!record) throw notFound('The case does not exist.');
      return record;
    },

    'cases.create': (context, input) =>
      cases.create(
        {
          playerId: input.playerId,
          title: input.title,
          priority: input.priority ?? 0,
          reason: input.reason,
        },
        actorOf(context),
      ),

    'cases.update': (context, input) =>
      cases.update(
        input.id,
        {
          ...(input.status ? { status: input.status } : {}),
          ...(input.priority !== undefined ? { priority: input.priority } : {}),
          ...(input.assignedTo !== undefined ? { assignedTo: input.assignedTo } : {}),
          reason: input.reason,
        },
        actorOf(context),
      ),

    'cases.note': (context, input) => cases.addNote(input.id, input.note, actorOf(context)),
    'cases.linkDetection': (context, input) =>
      cases.linkDetection(input.id, input.detectionId, actorOf(context)),
    'cases.linkCapture': (context, input) =>
      cases.linkCapture(input.id, input.captureId, actorOf(context)),

    'evidence.list': (_context, input) =>
      requireCaptures().list({
        ...pageOptions(input),
        ...(input.playerId ? { playerId: input.playerId } : {}),
        ...(input.caseId ? { caseId: input.caseId } : {}),
        ...(input.matchedOnly ? { ocrMatched: true } : {}),
      }),

    async 'evidence.get'(_context, input) {
      const capture = await requireCaptures().get(input.id);
      if (!capture) throw notFound('The capture does not exist.');
      return capture;
    },

    async 'evidence.image'(_context, input) {
      const image = await requireCaptures().openImage(input.id);
      if (!image) throw notFound('The capture has no stored image.');
      return image.kind === 'bytes'
        ? { mediaType: image.mediaType, base64: image.bytes.toString('base64'), url: null }
        : { mediaType: 'image/jpeg', base64: null, url: image.url };
    },

    async 'evidence.request'(context, input) {
      return requireCaptures().request(input.playerId, { reason: input.reason }, actorOf(context));
    },

    'evidence.rescan': (context, input) => requireCaptures().rescan(input.id, actorOf(context)),

    async 'evidence.delete'(context, input) {
      await requireCaptures().remove(input.id, input.reason, actorOf(context));
      return { ok: true };
    },

    'watch.start': (context, input) => watch.start(context.staff, input.playerId, actorOf(context)),

    async 'watch.answer'(context, input) {
      watch.answer(context.staff, input.id, input.sdp);
      return { ok: true };
    },

    async 'watch.stop'(context, input) {
      await watch.stop(context.staff, input.id, actorOf(context));
      return { ok: true };
    },

    'actions.list': (_context, input) =>
      directory.listActions({
        ...pageOptions(input),
        ...(input.targetId ? { targetId: input.targetId } : {}),
        ...(input.group === 'moderation' ? { typePrefixes: MODERATION_ACTIONS } : {}),
      }),

    'bans.list': (_context, input) =>
      directory.listBans({
        ...pageOptions(input),
        activeOnly: input.activeOnly ?? false,
        ...(input.playerId ? { playerId: input.playerId } : {}),
      }),

    async 'moderation.warn'(context, input) {
      if (!(await directory.getPlayer(input.playerId, false)))
        throw notFound('The player does not exist.');
      await ledger(context, 'moderation.warned', 'player', input.playerId, input.reason, {});
      return { ok: true, delivered: await game.warn(input.playerId, input.reason) };
    },

    async 'moderation.kick'(context, input) {
      if (!(await directory.getPlayer(input.playerId, false)))
        throw notFound('The player does not exist.');
      await ledger(context, 'moderation.kicked', 'player', input.playerId, input.reason, {});
      return { ok: true, dropped: await game.kick(input.playerId, input.reason) };
    },

    'moderation.ban': (context, input) =>
      bans.create(
        { playerId: input.playerId, reason: input.reason, durationHours: input.durationHours },
        actorOf(context),
      ),

    'moderation.unban': (context, input) =>
      bans.revoke(input.banId, input.reason, actorOf(context)),

    'exceptions.list': (_context, input) =>
      exceptions.list({ ...pageOptions(input), activeOnly: input.activeOnly ?? false }),

    'exceptions.create': (context, input) => exceptions.create(input, actorOf(context)),

    'exceptions.revoke': (context, input) =>
      exceptions.revoke(input.id, input.reason, actorOf(context)),

    async 'bypass.set'(context, input) {
      const self = context.staff.playerId;
      if (!self) throw new ApiError(409, 'conflict', 'Your player is not tracked by SimpleAC yet.');
      const active = await findBypass(exceptions, context.staff);
      if (input.enabled && !active) {
        await exceptions.create(
          {
            scopeType: 'player',
            scopeValue: self,
            effect: 'allow',
            reason: BYPASS_REASON,
            durationHours: null,
          },
          actorOf(context),
        );
      } else if (!input.enabled && active) {
        await exceptions.revoke(active, 'Staff turned bypass off', actorOf(context));
      }
      return { bypass: input.enabled };
    },

    async 'profiles.list'() {
      return { items: await profiles.list() };
    },

    async 'profiles.get'(_context, input) {
      const profile = await profiles.get(input.id, input.version);
      if (!profile) throw notFound('The profile does not exist.');
      return profile;
    },

    async 'config.get'() {
      const [first] = await profiles.list();
      const detail = first ? await profiles.get(first.id) : null;
      const rules = detail?.config?.['rules'];
      const entries =
        typeof rules === 'object' && rules !== null
          ? Object.entries(rules as Record<string, unknown>)
          : [];
      return {
        profile: { name: first?.name ?? 'None', version: first?.activeVersion ?? null },
        rules: entries
          .map(([key, value]) => {
            const rule = (typeof value === 'object' && value !== null ? value : {}) as {
              enabled?: unknown;
              mode?: unknown;
            };
            return {
              key,
              category: key.split('.')[0] ?? 'other',
              mode: typeof rule.mode === 'string' ? rule.mode : 'log',
              enabled: rule.enabled === true,
            };
          })
          .sort((a, b) => a.key.localeCompare(b.key)),
        evidence: deps.evidenceConfig(),
      };
    },

    async lookup(context, input) {
      if (input.q.includes(':') && !identifiersVisible(context.staff)) throw forbidden();
      const result = await directory.lookup(input.q);
      if (!result) throw notFound('No record matches that identifier.');
      return { type: result.type, id: result.id, record: result.record };
    },

    async 'access.list'() {
      return { items: await members.list() };
    },

    async 'access.grant'(context, input) {
      const member = await members.grant({
        identifier: input.identifier,
        name: input.name,
        permissions: input.permissions,
        createdBy: actorOf(context).keyId,
      });
      await ledger(
        context,
        'panel.access_granted',
        'panel_member',
        input.identifier,
        'Panel access granted',
        {
          permissions: member.permissions,
          name: input.name,
        },
      );
      return member;
    },

    async 'access.revoke'(context, input) {
      if (context.staff.identifiers.includes(input.identifier)) {
        throw new ApiError(409, 'conflict', 'You cannot remove your own panel access.');
      }
      if (!(await members.revoke(input.identifier))) throw notFound('That member does not exist.');
      await ledger(
        context,
        'panel.access_revoked',
        'panel_member',
        input.identifier,
        'Panel access revoked',
        {},
      );
      return { ok: true };
    },
  };
}

export const newCorrelationId = (): string => createId('SAC-ACT');
