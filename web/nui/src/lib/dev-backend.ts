import type {
  PanelInput,
  PanelOp,
  PanelOutput,
  PanelSession,
} from '../../../../shared/contracts/panel';
import { panelPermissions } from '../../../../shared/contracts/panel';

// Browser-only stand-in for the game server, so the panel can be developed with `bun run dev:web`. It is never
// used inside the game: `rpc()` only reaches this when there is no `window.invokeNative`.

const now = Date.now();
const iso = (minutesAgo: number): string => new Date(now - minutesAgo * 60_000).toISOString();

const PLAYER = 'SAC-PLY-01M3YMQ4K91FDY5DF3ACEGPJM3';
const DET = 'SAC-DET-01M45SDQY18XZG0KQ18GYYPJFY';
const CASE = 'SAC-CASE-01M45VXAKBT5GKNKTQJBQGPRK7';
const CAP = 'SAC-CAP-01M45W3H7FXVCTQP2BKRTQ5RX5';

const player = {
  id: PLAYER,
  displayName: 'Alex Morgan',
  riskScore: 86,
  firstSeenAt: iso(60 * 24 * 12),
  lastSeenAt: iso(1),
};
const online = {
  source: 12,
  ping: 48,
  health: 200,
  armor: 50,
  coords: { x: 215.4, y: -810.2, z: 30.7 },
  inVehicle: true,
  bucket: 0,
};
const detection = {
  id: DET,
  playerId: PLAYER,
  sessionId: null,
  caseId: CASE,
  ruleKey: 'evidence.ocr_match',
  ruleVersion: 1,
  category: 'evidence',
  severity: 55,
  confidence: 0.6,
  score: 53,
  outcome: 'log',
  status: 'open',
  occurredAt: iso(4),
  createdAt: iso(4),
};
const capture = {
  id: CAP,
  playerId: PLAYER,
  detectionId: DET,
  caseId: CASE,
  status: 'uploaded',
  trigger: 'sweep',
  requestedBy: 'system',
  mediaType: 'image/svg+xml',
  byteSize: 1800,
  sha256: 'a'.repeat(64),
  width: 1920,
  height: 1080,
  storageBackend: 'local',
  error: null,
  createdAt: iso(4),
  uploadedAt: iso(4),
};
const caseRecord = {
  id: CASE,
  playerId: PLAYER,
  status: 'investigating',
  priority: 60,
  title: 'Cheat menu text on screen',
  assignedTo: 'snowy',
  detectionCount: 1,
  createdAt: iso(120),
  updatedAt: iso(3),
};
const action = {
  id: 'SAC-ACT-01M45VXAKCEGK18H5G9530QNAD',
  correlationId: 'dev',
  actorType: 'ingame_panel',
  actorId: PLAYER,
  actionType: 'case.created',
  targetType: 'case',
  targetId: CASE,
  reason: 'Reported by a player',
  metadata: {},
  origin: 'ingame_panel',
  reversesActionId: null,
  createdAt: iso(120),
};
const exception = {
  id: 'SAC-EXC-01M45VXNSE75TF0TWRNZ08GQGA',
  scopeType: 'detection',
  scopeValue: 'state.ragdoll_disabled',
  effect: 'ignore',
  reason: 'Hospital respawn animation',
  createdBy: PLAYER,
  expiresAt: null,
  revokedByActionId: null,
  active: true,
  createdAt: iso(600),
};
const ban = {
  id: 'SAC-BAN-01M448QV9AGJZVHVFS2PBYXTBT',
  playerId: PLAYER,
  actionId: action.id,
  reason: 'Movement manipulation',
  expiresAt: iso(-60 * 24),
  revokedByActionId: null,
  active: true,
  createdAt: iso(60),
};
const profile = {
  id: 'SAC-PRF-01M3YDTZZ28F55KX9RJ1VBGNCW',
  name: 'Balanced roleplay',
  description: 'Default conservative roleplay profile',
  activeVersionId: 'SAC-PRF-01M3YDTZZ3F3DQEFC4HQFN29BT',
  activeVersion: 1,
  versionCount: 1,
  createdAt: iso(60 * 24 * 3),
};
const server = {
  name: 'LOS SANTOS ROLEPLAY',
  online: 128,
  slots: 200,
  uptimeSeconds: 45_240,
  version: '0.1.0',
  profile: profile.name,
};
const page = <T>(items: T[]) => ({ items, nextBefore: null });
const trend = (values: number[]) =>
  values.map((value, index) => ({
    day: new Date(now - (values.length - 1 - index) * 86_400_000).toISOString().slice(0, 10),
    value,
  }));

export const devSession: PanelSession = {
  staff: {
    name: 'Andrew Wilson',
    playerId: 'SAC-PLY-01M3YMQ4K91FDY5DF3ACEGPJM9',
    source: 1,
    permissions: [...panelPermissions],
    bypass: false,
  },
  server,
};

const delay = <T>(value: T): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(value), 120));

function answer(op: PanelOp): unknown {
  switch (op) {
    case 'overview.get':
      return {
        stats: {
          generatedAt: iso(0),
          players: { total: 214, seenLast24h: 128 },
          detections: {
            last24h: 36,
            open: 8,
            topRules: [{ ruleKey: 'movement.teleport', count: 11 }],
          },
          cases: { open: 8, investigating: 3 },
          bans: { active: 5 },
          captures: { total: 94, last24h: 41, ocrMatchesLast24h: 3 },
        },
        trends: {
          detections: trend([18, 27, 21, 42, 29, 23, 36]),
          cases: trend([3, 6, 4, 9, 5, 7, 8]),
        },
        attention: [detection],
        activity: [action],
        server,
      };
    case 'players.list':
      return page([{ ...player, online }]);
    case 'players.get':
      return {
        player: {
          ...player,
          identifiers: [
            {
              type: 'license',
              key: 'license:8c1f2e4a90b7d36e5a1c4f7b2d9e0a63b1c5d842',
              firstSeenAt: iso(1000),
              lastSeenAt: iso(1),
            },
          ],
          recentSessions: [
            {
              id: 'SAC-SES-01M45S13RXM9WRR12EY9XHDQ7S',
              connectedAt: iso(90),
              disconnectedAt: null,
              disconnectReason: null,
            },
          ],
          bans: [ban],
        },
        online,
        identifiersVisible: true,
      };
    case 'players.links':
      return { items: [] };
    case 'detections.list':
      return page([detection]);
    case 'detections.get':
    case 'detections.review':
      return {
        ...detection,
        measured: { captureId: CAP, terms: 'eulen, godmode', matchCount: 14 },
        evidence: [],
        captures: [capture],
      };
    case 'cases.list':
      return page([caseRecord]);
    case 'cases.get':
    case 'cases.create':
    case 'cases.update':
    case 'cases.note':
    case 'cases.linkDetection':
    case 'cases.linkCapture':
      return {
        ...caseRecord,
        detections: [detection],
        events: [
          {
            id: 1,
            actionId: action.id,
            type: 'case.created',
            actor: PLAYER,
            body: { title: caseRecord.title },
            createdAt: iso(120),
          },
        ],
        captures: [capture],
      };
    case 'evidence.list':
      return page([capture]);
    case 'evidence.get':
      return {
        ...capture,
        ocr: [
          {
            id: 'SAC-OCR-1',
            ruleVersion: '2026-10-04.1',
            text: 'EULEN EXECUTOR v7.2\nSelf Options > Godmode [ON]',
            matches: [{ rule: 'executors', kind: 'fuzzy', severity: 'high', term: 'eulen' }],
            confidence: 0.75,
            durationMs: 1090,
            createdAt: iso(4),
          },
        ],
      };
    case 'evidence.image': {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540"><rect width="100%" height="100%" fill="#1b2430"/><text x="40" y="90" font-size="40" fill="#fff" font-family="sans-serif">EULEN EXECUTOR v7.2</text><text x="40" y="150" font-size="28" fill="#ddd" font-family="sans-serif">Self Options &gt; Godmode [ON]</text></svg>`;
      return { mediaType: 'image/svg+xml', base64: btoa(svg), url: null };
    }
    case 'evidence.request':
      return { ids: [CAP] };
    case 'evidence.rescan':
      return { captureId: CAP, status: 'queued' };
    case 'evidence.delete':
      return { ok: true };
    case 'actions.list':
      return page([action]);
    case 'bans.list':
      return page([ban]);
    case 'moderation.warn':
      return { ok: true, delivered: true };
    case 'moderation.kick':
      return { ok: true, dropped: true };
    case 'moderation.ban':
    case 'moderation.unban':
      return ban;
    case 'exceptions.list':
      return page([exception]);
    case 'exceptions.create':
    case 'exceptions.revoke':
      return exception;
    case 'bypass.set':
      return { bypass: true };
    case 'profiles.list':
      return { items: [profile] };
    case 'profiles.get':
      return {
        ...profile,
        versions: [
          {
            id: profile.activeVersionId,
            version: 1,
            createdBy: 'system',
            createdAt: iso(60 * 24 * 3),
          },
        ],
        config: { name: profile.name },
      };
    case 'config.get':
      return {
        profile: { name: profile.name, version: 1 },
        rules: [
          { key: 'movement.noclip', category: 'movement', mode: 'log', enabled: true },
          { key: 'network.explosion_abnormal', category: 'network', mode: 'cancel', enabled: true },
        ],
        evidence: {
          storage: 'local',
          retentionDays: 30,
          ocrEnabled: true,
          ocrMaxWidth: 1280,
          ocr: null,
        },
      };
    case 'lookup':
      return { type: 'SAC-PLY', id: PLAYER, record: player };
    case 'access.list':
      return {
        items: [
          {
            identifier: 'license:2d6f8a1c4e7b093a5c8d1f4e7a0b3c6d9e2f5a81',
            name: 'Jenny Lewis',
            permissions: ['players.view', 'cases.manage'],
            createdBy: PLAYER,
            createdAt: iso(5000),
          },
        ],
      };
    case 'access.grant':
      return {
        identifier: 'license:new',
        name: 'New staff',
        permissions: ['players.view'],
        createdBy: PLAYER,
        createdAt: iso(0),
      };
    case 'access.revoke':
      return { ok: true };
    case 'watch.start':
    case 'watch.answer':
    case 'watch.stop':
      throw new Error('Live view needs the game; it is not available in the browser preview.');
  }
}

export function devBackend<K extends PanelOp>(
  op: K,
  _input?: PanelInput<K>,
): Promise<PanelOutput<K>> {
  return delay(answer(op) as PanelOutput<K>);
}
