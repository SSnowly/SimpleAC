import { z } from 'zod';
import type {
  ApiAction,
  Ban,
  Capture,
  CaptureDetail,
  CaseDetail,
  CaseRecord,
  Detection,
  DetectionDetailRecord,
  ExceptionRecord,
  IdentityLink,
  OcrRules,
  Overview,
  PlayerDetail,
  PlayerSummary,
  Profile,
  ProfileDetail,
} from './api.js';
import { simpleAcIdSchema } from './id-schema.js';

/** What a staff member may do in the in-game panel. Every operation names the one it needs. */
export const panelPermissions = [
  'players.view',
  'detections.review',
  'cases.manage',
  'evidence.capture',
  'live.watch',
  'players.moderate',
  'exceptions.manage',
  'access.manage',
] as const;

export type PanelPermission = (typeof panelPermissions)[number];

export const panelPermissionLabels: Record<PanelPermission, string> = {
  'players.view': 'View players and records',
  'detections.review': 'Review detections',
  'cases.manage': 'Manage cases',
  'evidence.capture': 'Capture and manage evidence',
  'live.watch': 'Live watch (video)',
  'players.moderate': 'Moderate players',
  'exceptions.manage': 'Manage exceptions and bypass',
  'access.manage': 'Manage panel access',
};

export const panelPermissionSchema = z.enum(panelPermissions);

const reason = z.string().trim().min(3).max(512);
const page = {
  limit: z.number().int().min(1).max(100).optional(),
  before: simpleAcIdSchema.optional(),
};
const text = (max: number) => z.string().trim().min(1).max(max);

/** Input of every panel operation, and the permission it needs. `null` means any member of the panel. */
export const panelOps = {
  'overview.get': { permission: 'players.view', input: z.object({}) },
  'players.list': {
    permission: 'players.view',
    input: z.object({ q: text(128).optional(), all: z.boolean().optional(), ...page }),
  },
  'players.get': { permission: 'players.view', input: z.object({ id: simpleAcIdSchema }) },
  'players.links': { permission: 'players.view', input: z.object({ id: simpleAcIdSchema }) },
  'detections.list': {
    permission: 'players.view',
    input: z.object({
      playerId: simpleAcIdSchema.optional(),
      caseId: simpleAcIdSchema.optional(),
      status: z.enum(['open', 'confirmed', 'dismissed']).optional(),
      ...page,
    }),
  },
  'detections.get': { permission: 'players.view', input: z.object({ id: simpleAcIdSchema }) },
  'detections.review': {
    permission: 'detections.review',
    input: z.object({
      id: simpleAcIdSchema,
      status: z.enum(['open', 'confirmed', 'dismissed']),
      reason,
    }),
  },
  'cases.list': {
    permission: 'players.view',
    input: z.object({
      playerId: simpleAcIdSchema.optional(),
      status: z.enum(['open', 'investigating', 'closed']).optional(),
      ...page,
    }),
  },
  'cases.get': { permission: 'players.view', input: z.object({ id: simpleAcIdSchema }) },
  'cases.create': {
    permission: 'cases.manage',
    input: z.object({
      playerId: simpleAcIdSchema,
      title: text(255).min(3),
      priority: z.number().int().min(0).max(100).optional(),
      reason,
    }),
  },
  'cases.update': {
    permission: 'cases.manage',
    input: z.object({
      id: simpleAcIdSchema,
      status: z.enum(['open', 'investigating', 'closed']).optional(),
      priority: z.number().int().min(0).max(100).optional(),
      assignedTo: text(128).nullable().optional(),
      reason,
    }),
  },
  'cases.note': {
    permission: 'cases.manage',
    input: z.object({ id: simpleAcIdSchema, note: text(4000) }),
  },
  'cases.linkDetection': {
    permission: 'cases.manage',
    input: z.object({ id: simpleAcIdSchema, detectionId: simpleAcIdSchema }),
  },
  'cases.linkCapture': {
    permission: 'cases.manage',
    input: z.object({ id: simpleAcIdSchema, captureId: simpleAcIdSchema }),
  },
  'evidence.list': {
    permission: 'players.view',
    input: z.object({
      playerId: simpleAcIdSchema.optional(),
      caseId: simpleAcIdSchema.optional(),
      matchedOnly: z.boolean().optional(),
      ...page,
    }),
  },
  'evidence.get': { permission: 'players.view', input: z.object({ id: simpleAcIdSchema }) },
  'evidence.image': { permission: 'players.view', input: z.object({ id: simpleAcIdSchema }) },
  'evidence.request': {
    permission: 'evidence.capture',
    input: z.object({ playerId: simpleAcIdSchema, reason }),
  },
  'evidence.rescan': { permission: 'evidence.capture', input: z.object({ id: simpleAcIdSchema }) },
  'evidence.delete': {
    permission: 'evidence.capture',
    input: z.object({ id: simpleAcIdSchema, reason }),
  },
  'watch.start': { permission: 'live.watch', input: z.object({ playerId: simpleAcIdSchema }) },
  'watch.answer': {
    permission: 'live.watch',
    input: z.object({ id: simpleAcIdSchema, sdp: z.string().min(20).max(24_000) }),
  },
  'watch.stop': { permission: 'live.watch', input: z.object({ id: simpleAcIdSchema }) },
  'actions.list': {
    permission: 'players.view',
    input: z.object({
      group: z.enum(['moderation', 'all']).optional(),
      targetId: text(128).optional(),
      ...page,
    }),
  },
  'bans.list': {
    permission: 'players.view',
    input: z.object({
      playerId: simpleAcIdSchema.optional(),
      activeOnly: z.boolean().optional(),
      ...page,
    }),
  },
  'moderation.warn': {
    permission: 'players.moderate',
    input: z.object({ playerId: simpleAcIdSchema, reason }),
  },
  'moderation.kick': {
    permission: 'players.moderate',
    input: z.object({ playerId: simpleAcIdSchema, reason }),
  },
  'moderation.ban': {
    permission: 'players.moderate',
    input: z.object({
      playerId: simpleAcIdSchema,
      reason,
      durationHours: z.number().int().min(1).max(87_600).nullable(),
    }),
  },
  'moderation.unban': {
    permission: 'players.moderate',
    input: z.object({ banId: simpleAcIdSchema, reason }),
  },
  'exceptions.list': {
    permission: 'players.view',
    input: z.object({ activeOnly: z.boolean().optional(), ...page }),
  },
  'exceptions.create': {
    permission: 'exceptions.manage',
    input: z.object({
      scopeType: z.enum(['player', 'detection', 'resource']),
      scopeValue: text(255),
      effect: z.enum(['allow', 'ignore']),
      reason,
      durationHours: z.number().int().min(1).max(87_600).nullable(),
    }),
  },
  'exceptions.revoke': {
    permission: 'exceptions.manage',
    input: z.object({ id: simpleAcIdSchema, reason }),
  },
  'bypass.set': { permission: 'exceptions.manage', input: z.object({ enabled: z.boolean() }) },
  'profiles.list': { permission: 'players.view', input: z.object({}) },
  'profiles.get': {
    permission: 'players.view',
    input: z.object({ id: simpleAcIdSchema, version: simpleAcIdSchema.optional() }),
  },
  'config.get': { permission: 'players.view', input: z.object({}) },
  lookup: { permission: 'players.view', input: z.object({ q: z.string().trim().min(3).max(255) }) },
  'access.list': { permission: 'access.manage', input: z.object({}) },
  'access.grant': {
    permission: 'access.manage',
    input: z.object({
      identifier: z
        .string()
        .trim()
        .regex(/^[a-z0-9_]{2,16}:[A-Za-z0-9._-]{1,200}$/),
      name: text(128),
      permissions: z.array(panelPermissionSchema).min(1).max(panelPermissions.length),
    }),
  },
  'access.revoke': {
    permission: 'access.manage',
    input: z.object({
      identifier: z
        .string()
        .trim()
        .regex(/^[a-z0-9_]{2,16}:[A-Za-z0-9._-]{1,200}$/),
    }),
  },
} as const satisfies Record<string, { permission: PanelPermission; input: z.ZodType }>;

export type PanelOp = keyof typeof panelOps;
export type PanelInput<K extends PanelOp> = z.infer<(typeof panelOps)[K]['input']>;

export interface PanelServerInfo {
  name: string;
  online: number;
  slots: number;
  uptimeSeconds: number;
  version: string;
  profile: string | null;
}

export interface PanelOnline {
  source: number;
  ping: number;
  health: number;
  armor: number;
  coords: { x: number; y: number; z: number };
  inVehicle: boolean;
  bucket: number;
}

export interface PanelPlayerRow extends PlayerSummary {
  online: PanelOnline | null;
}

export interface PanelStaff {
  name: string;
  playerId: string | null;
  source: number;
  permissions: PanelPermission[];
  bypass: boolean;
}

export interface PanelSession {
  staff: PanelStaff;
  server: PanelServerInfo;
}

export interface PanelTrendPoint {
  day: string;
  value: number;
}

export interface PanelOverview {
  stats: Overview;
  trends: { detections: PanelTrendPoint[]; cases: PanelTrendPoint[] };
  attention: Detection[];
  activity: ApiAction[];
  server: PanelServerInfo;
}

export interface PanelPlayerDetail {
  player: PlayerDetail;
  online: PanelOnline | null;
  /** Raw identifiers are only sent to staff who moderate or manage access. */
  identifiersVisible: boolean;
}

export interface PanelPage<T> {
  items: T[];
  nextBefore: string | null;
}

export interface PanelMember {
  identifier: string;
  name: string;
  permissions: PanelPermission[];
  createdBy: string;
  createdAt: string;
}

export interface PanelConfigView {
  profile: { name: string; version: number | null };
  rules: { key: string; category: string; mode: string; enabled: boolean }[];
  evidence: {
    storage: string;
    retentionDays: number;
    ocrEnabled: boolean;
    ocrMaxWidth: number;
    ocr: OcrRules | null;
  };
}

/** An evidence image: inline for local storage, or a link when an external service holds it. */
export interface PanelIceServer {
  urls: string[];
  username?: string;
  credential?: string;
}

export interface PanelWatchStart {
  id: string;
  iceServers: PanelIceServer[];
  /** When true the video only travels through a relay, so neither side learns the other's address. */
  relayOnly: boolean;
  fps: number;
}

export interface PanelImage {
  mediaType: string;
  base64: string | null;
  url: string | null;
}

export interface PanelOpOutput {
  'overview.get': PanelOverview;
  'players.list': PanelPage<PanelPlayerRow>;
  'players.get': PanelPlayerDetail;
  'players.links': { items: IdentityLink[] };
  'detections.list': PanelPage<Detection>;
  'detections.get': DetectionDetailRecord;
  'detections.review': DetectionDetailRecord;
  'cases.list': PanelPage<CaseRecord>;
  'cases.get': CaseDetail;
  'cases.create': CaseDetail;
  'cases.update': CaseDetail;
  'cases.note': CaseDetail;
  'cases.linkDetection': CaseDetail;
  'cases.linkCapture': CaseDetail;
  'evidence.list': PanelPage<Capture>;
  'evidence.get': CaptureDetail;
  'evidence.image': PanelImage;
  'evidence.request': { ids: string[] };
  'evidence.rescan': { captureId: string; status: string };
  'evidence.delete': { ok: true };
  'watch.start': PanelWatchStart;
  'watch.answer': { ok: true };
  'watch.stop': { ok: true };
  'actions.list': PanelPage<ApiAction>;
  'bans.list': PanelPage<Ban>;
  'moderation.warn': { ok: true; delivered: boolean };
  'moderation.kick': { ok: true; dropped: boolean };
  'moderation.ban': Ban;
  'moderation.unban': Ban;
  'exceptions.list': PanelPage<ExceptionRecord>;
  'exceptions.create': ExceptionRecord;
  'exceptions.revoke': ExceptionRecord;
  'bypass.set': { bypass: boolean };
  'profiles.list': { items: Profile[] };
  'profiles.get': ProfileDetail;
  'config.get': PanelConfigView;
  lookup: { type: string; id: string; record: unknown };
  'access.list': { items: PanelMember[] };
  'access.grant': PanelMember;
  'access.revoke': { ok: true };
}

export type PanelOutput<K extends PanelOp> = PanelOpOutput[K];

/** Wire format of a panel reply, sent from the server to the client and on to the NUI. */
export type PanelReply =
  | { id: number; ok: true; data: unknown }
  | { id: number; ok: false; code: string; message: string };
