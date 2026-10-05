import { describe, expect, it } from 'vitest';
import type { Database } from '../../server/db/database.js';
import { createRateLimiter } from '../../server/http/middleware/rate-limit.js';
import { createPanelAccess, type StaffIdentity } from '../../server/panel/access.js';
import {
  createPanelHandlers,
  type PanelContext,
  type PanelDeps,
  type PanelHandlers,
} from '../../server/panel/handlers.js';
import type { PanelMembers } from '../../server/panel/members.js';
import { createPanelRouter, type PanelTransport } from '../../server/panel/router.js';
import type { PanelPermission, PanelReply, PanelSession } from '../../shared/contracts/panel.js';
import { panelOps, panelPermissions } from '../../shared/contracts/panel.js';

const PLAYER = 'SAC-PLY-01JABCDEFGHJKMNPQRSTVWXYZ0';
const STAFF_PLAYER = 'SAC-PLY-01JABCDEFGHJKMNPQRSTVWXYZ9';
/** The same player as a branded ID, for calling handlers directly. */
const PLAYER_ID = PLAYER as never;

function members(granted: Record<string, PanelPermission[]> = {}): PanelMembers {
  return {
    list: () => Promise.resolve([]),
    permissionsFor: (identifiers) =>
      Promise.resolve(new Set(identifiers.flatMap((identifier) => granted[identifier] ?? []))),
    grant: () => Promise.reject(new Error('unused')),
    revoke: () => Promise.resolve(true),
  };
}

describe('panel access', () => {
  const platform = (aces: string[]) => ({
    aceAllowed: (_source: number, object: string) => aces.includes(object),
    principalAllowed: (_identifier: string, object: string) => aces.includes(object),
    playerByIdentifier: () => Promise.resolve(STAFF_PLAYER),
    identifiers: () => ['license:abc', 'discord:1'],
    name: () => 'Staff',
    playerOf: () => Promise.resolve(STAFF_PLAYER),
  });

  it('grants everything to the admin ACE', async () => {
    const staff = await createPanelAccess(members(), platform(['simpleac.admin'])).resolve(1);
    expect([...staff.permissions].sort()).toEqual([...panelPermissions].sort());
  });

  it('combines per-permission ACEs with database grants over every identifier', async () => {
    const access = createPanelAccess(
      members({ 'discord:1': ['cases.manage'] }),
      platform(['simpleac.players.view']),
    );
    const staff = await access.resolve(1);
    expect([...staff.permissions].sort()).toEqual(['cases.manage', 'players.view']);
    expect(staff.playerId).toBe(STAFF_PLAYER);
  });

  it('gives nothing to someone with no ACE and no grant', async () => {
    const staff = await createPanelAccess(members(), platform([])).resolve(1);
    expect(staff.permissions.size).toBe(0);
  });

  it('resolves browser grants only from the verified Discord identifier', async () => {
    const access = createPanelAccess(
      members({ 'license:abc': ['access.manage'], 'discord:1': ['cases.manage'] }),
      platform([]),
    );
    const staff = await access.resolveWeb({
      identifier: 'discord:1',
      name: 'Staff',
      sessionId: 'session',
    });
    expect([...staff.permissions].sort()).toEqual(['cases.manage', 'players.view']);
    expect(staff).toMatchObject({
      source: 0,
      viewer: 'web:session',
      via: 'web',
      playerId: STAFF_PLAYER,
    });
  });
});

describe('panel operation table', () => {
  it('names a valid permission for every operation', () => {
    for (const definition of Object.values(panelOps)) {
      expect(panelPermissions).toContain(definition.permission);
    }
  });

  it('only offers read operations to view-only staff', () => {
    const viewOnly = Object.entries(panelOps)
      .filter(([, definition]) => definition.permission === 'players.view')
      .map(([name]) => name);
    expect(viewOnly.length).toBeGreaterThan(10);
    for (const name of viewOnly) expect(name).toMatch(/\.(list|get|links|image)$|^lookup$/);
  });

  it('rejects malformed input', () => {
    expect(
      panelOps['cases.create'].input.safeParse({ playerId: 'nope', title: 'x', reason: 'abc' })
        .success,
    ).toBe(false);
    expect(
      panelOps['access.grant'].input.safeParse({
        identifier: 'not an identifier',
        name: 'A',
        permissions: ['cases.manage'],
      }).success,
    ).toBe(false);
    expect(
      panelOps['access.grant'].input.safeParse({
        identifier: 'license:abc',
        name: 'A',
        permissions: ['root'],
      }).success,
    ).toBe(false);
    expect(
      panelOps['moderation.ban'].input.safeParse({
        playerId: PLAYER,
        reason: 'cheating',
        durationHours: 0,
      }).success,
    ).toBe(false);
  });
});

function harness(permissions: PanelPermission[], handlers: Partial<PanelHandlers> = {}) {
  const replies: PanelReply[] = [];
  const events: string[] = [];
  const audited: PanelContext[] = [];
  const staff: StaffIdentity = {
    source: 7,
    name: 'Staff',
    identifiers: ['license:abc'],
    playerId: STAFF_PLAYER,
    viewer: 'game:7',
    via: 'game' as const,
    permissions: new Set(permissions),
  };
  const transport: PanelTransport = {
    reply: (_source, reply) => replies.push(reply),
    granted: (_source, session: PanelSession) => events.push(`granted:${session.staff.name}`),
    denied: () => events.push('denied'),
  };
  const router = createPanelRouter({
    access: { resolve: () => Promise.resolve(staff), resolveWeb: () => Promise.resolve(staff) },
    handlers: handlers as PanelHandlers,
    limiter: createRateLimiter(5, 0.0001),
    transport,
    session: (identity) =>
      Promise.resolve({
        staff: {
          name: identity.name,
          playerId: identity.playerId,
          source: identity.source,
          permissions: [...identity.permissions],
          bypass: false,
        },
        server: { name: 's', online: 1, slots: 2, uptimeSeconds: 3, version: '1', profile: null },
      }),
    audit: (context) => {
      audited.push(context);
      return Promise.resolve();
    },
    log: () => undefined,
  });
  return { router, replies, events, audited };
}

describe('panel router', () => {
  it('opens for staff and records the access', async () => {
    const { router, events, audited } = harness(['players.view']);
    await router.open(7);
    expect(events).toEqual(['granted:Staff']);
    expect(audited).toHaveLength(1);
  });

  it('treats an empty array from the game as an empty input', async () => {
    const { router, replies } = harness(['players.view'], {
      'profiles.list': () => Promise.resolve({ items: [] }),
    });
    await router.request(7, 1, 'profiles.list', []);
    expect(replies[0]).toMatchObject({ ok: true });
  });

  it('refuses to open for someone with no permission', async () => {
    const { router, events, audited } = harness([]);
    await router.open(7);
    expect(events).toEqual(['denied']);
    expect(audited).toHaveLength(0);
  });

  it('runs an operation the staff member may use', async () => {
    const { router, replies } = harness(['players.view'], {
      'profiles.list': () => Promise.resolve({ items: [] }),
    });
    await router.request(7, 1, 'profiles.list', {});
    expect(replies).toEqual([{ id: 1, ok: true, data: { items: [] } }]);
  });

  it('enforces the permission of every operation on the server', async () => {
    let called = false;
    const { router, replies } = harness(['players.view'], {
      'moderation.kick': () => {
        called = true;
        return Promise.resolve({ ok: true, dropped: true });
      },
    });
    await router.request(7, 2, 'moderation.kick', { playerId: PLAYER, reason: 'afk in the road' });
    expect(called).toBe(false);
    expect(replies[0]).toMatchObject({ id: 2, ok: false, code: 'forbidden' });
  });

  it('validates input before any handler runs', async () => {
    let called = false;
    const { router, replies } = harness(['cases.manage'], {
      'cases.note': () => {
        called = true;
        return Promise.reject(new Error('unused'));
      },
    });
    await router.request(7, 3, 'cases.note', { id: 'bad', note: '' });
    expect(called).toBe(false);
    expect(replies[0]).toMatchObject({ id: 3, ok: false, code: 'validation_failed' });
  });

  it('rejects unknown operations, bad IDs and oversized payloads', async () => {
    const { router, replies } = harness(['players.view']);
    await router.request(7, 4, 'system.shutdown', {});
    expect(replies[0]).toMatchObject({ ok: false, code: 'bad_request' });
    await router.request(7, 'abc', 'profiles.list', {});
    await router.request(7, -1, 'profiles.list', {});
    expect(replies).toHaveLength(1);
    await router.request(7, 5, 'lookup', { q: 'x'.repeat(40_000) });
    expect(replies[1]).toMatchObject({ id: 5, ok: false, code: 'payload_too_large' });
  });

  it('never leaks internal error details', async () => {
    const { router, replies } = harness(['players.view'], {
      'profiles.list': () => Promise.reject(new Error('SELECT secret FROM somewhere')),
    });
    await router.request(7, 6, 'profiles.list', {});
    expect(replies[0]).toEqual({
      id: 6,
      ok: false,
      code: 'internal_error',
      message: 'The request could not be completed.',
    });
  });

  it('rate limits a client that floods requests', async () => {
    const { router, replies } = harness(['players.view'], {
      'profiles.list': () => Promise.resolve({ items: [] }),
    });
    for (let id = 1; id <= 9; id += 1) await router.request(7, id, 'profiles.list', {});
    expect(
      replies.filter((reply) => !reply.ok && reply.code === 'rate_limited').length,
    ).toBeGreaterThan(0);
  });
});

describe('panel handlers', () => {
  const staff = (
    permissions: PanelPermission[],
    playerId: string | null = STAFF_PLAYER,
  ): PanelContext => ({
    staff: {
      source: 7,
      name: 'Staff',
      identifiers: ['license:abc'],
      playerId,
      viewer: 'game:7',
      via: 'game' as const,
      permissions: new Set(permissions),
    },
    actor: {
      keyId: playerId ?? 'license:abc',
      correlationId: undefined,
      type: 'ingame_panel' as const,
      origin: 'ingame_panel',
    },
    correlationId: 'SAC-ACT-01JABCDEFGHJKMNPQRSTVWXYZ1',
  });

  const statements: { query: string; values: readonly unknown[] }[] = [];
  const db = {
    query: () => Promise.resolve([]),
    single: () => Promise.resolve(null),
    scalar: () => Promise.resolve(null),
    execute: () => Promise.resolve(1),
    transaction: (batch) => {
      statements.push(...batch);
      return Promise.resolve(true);
    },
  } satisfies Database;

  const created: unknown[] = [];
  const revoked: string[] = [];
  const warned: string[] = [];
  const handlers = createPanelHandlers({
    db,
    directory: {
      getPlayer: (id: string, withIdentifiers: boolean) =>
        Promise.resolve({
          id,
          identifiersRequested: withIdentifiers,
          recentSessions: [],
          bans: [],
        } as never),
      lookup: () =>
        Promise.resolve({ type: 'SAC-PLY', id: PLAYER, record: {}, requiredScope: 'players:read' }),
      listIdentityLinks: () => Promise.resolve([]),
    } as never,
    bans: {} as never,
    detections: {} as never,
    cases: {} as never,
    exceptions: {
      list: (filters: { scopeValue?: string }) =>
        Promise.resolve({
          items:
            filters.scopeValue === STAFF_PLAYER && revoked.length === 0 && created.length > 0
              ? [{ id: 'SAC-EXC-01JABCDEFGHJKMNPQRSTVWXYZ2', reason: 'Staff bypass' }]
              : [],
          nextBefore: null,
        }),
      create: (input: unknown) => {
        created.push(input);
        return Promise.resolve({} as never);
      },
      revoke: (id: string) => {
        revoked.push(id);
        return Promise.resolve({} as never);
      },
    } as never,
    profiles: {} as never,
    overview: {} as never,
    watch: {} as never,
    members: {
      list: () => Promise.resolve([]),
      permissionsFor: () => Promise.resolve(new Set()),
      grant: () => Promise.reject(new Error('unused')),
      revoke: () => Promise.resolve(true),
    },
    game: {
      online: () => Promise.resolve([]),
      warn: (playerId) => {
        warned.push(playerId);
        return Promise.resolve(true);
      },
      kick: () => Promise.resolve(true),
    },
    captures: undefined,
    serverInfo: () => ({
      name: 's',
      online: 0,
      slots: 1,
      uptimeSeconds: 0,
      version: '1',
      profile: null,
    }),
    evidenceConfig: () => ({
      storage: 'local',
      retentionDays: 1,
      ocrEnabled: true,
      ocrMaxWidth: 1280,
      ocr: null,
    }),
  } satisfies PanelDeps);

  it('hides raw identifiers from staff who cannot moderate or manage access', async () => {
    const viewer = await handlers['players.get'](staff(['players.view']), { id: PLAYER_ID });
    expect(viewer.identifiersVisible).toBe(false);
    const moderator = await handlers['players.get'](staff(['players.view', 'players.moderate']), {
      id: PLAYER_ID,
    });
    expect(moderator.identifiersVisible).toBe(true);
    await expect(
      handlers['players.links'](staff(['players.view']), { id: PLAYER_ID }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('keeps identifier lookups for staff who may see identifiers', async () => {
    await expect(
      handlers.lookup(staff(['players.view']), { q: 'license:abcdef' }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(handlers.lookup(staff(['players.view']), { q: PLAYER })).resolves.toMatchObject({
      id: PLAYER_ID,
    });
  });

  it('records a warning in the ledger before showing it to the player', async () => {
    statements.length = 0;
    const result = await handlers['moderation.warn'](staff(['players.moderate']), {
      playerId: PLAYER_ID,
      reason: 'stop blocking the road',
    });
    expect(result).toEqual({ ok: true, delivered: true });
    expect(warned).toEqual([PLAYER]);
    expect(statements[0]?.values).toContain('moderation.warned');
    expect(statements[0]?.values).toContain('ingame_panel');
  });

  it('turns the personal bypass on and off through exceptions', async () => {
    await handlers['bypass.set'](staff(['exceptions.manage']), { enabled: true });
    expect(created[0]).toMatchObject({
      scopeType: 'player',
      scopeValue: STAFF_PLAYER,
      effect: 'allow',
      durationHours: null,
    });
    await handlers['bypass.set'](staff(['exceptions.manage']), { enabled: false });
    expect(revoked).toEqual(['SAC-EXC-01JABCDEFGHJKMNPQRSTVWXYZ2']);
    await expect(
      handlers['bypass.set'](staff(['exceptions.manage'], null), { enabled: true }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('stops staff removing their own access', async () => {
    await expect(
      handlers['access.revoke'](staff(['access.manage']), { identifier: 'license:abc' }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      handlers['access.revoke'](staff(['access.manage']), { identifier: 'license:other' }),
    ).resolves.toEqual({ ok: true });
  });
});
