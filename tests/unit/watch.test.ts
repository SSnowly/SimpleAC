import { describe, expect, it } from 'vitest';
import type { Database } from '../../server/db/database.js';
import type { StaffIdentity } from '../../server/panel/access.js';
import {
  createWatchSessions,
  loadWatchConfig,
  WATCH_ANSWER_TIMEOUT_MS,
  WATCH_MAX_MS,
  WATCH_OFFER_TIMEOUT_MS,
  type WatchTransport,
} from '../../server/panel/watch.js';

const PLAYER = 'SAC-PLY-01JABCDEFGHJKMNPQRSTVWXYZ0' as never;
const SDP = `v=0\r\n${'a=candidate:1 1 udp 2122260223 192.168.1.2 50000 typ host\r\n'.repeat(3)}`;

const staff = (source: number): StaffIdentity => ({
  source,
  name: `Staff ${String(source)}`,
  identifiers: [`license:${String(source)}`],
  viewer: `game:${String(source)}`,
  via: 'game' as const,
  playerId: `SAC-PLY-0000000000000000000000000${String(source)}`,
  permissions: new Set(['live.watch', 'players.view']),
});
const actor = (source: number) => ({
  keyId: `staff-${String(source)}`,
  correlationId: undefined,
  type: 'ingame_panel' as const,
  origin: 'ingame_panel',
});

function setup(options: { online?: number | null; clock?: { now: number } } = {}) {
  const clock = options.clock ?? { now: 1_000_000 };
  const log: string[] = [];
  const statements: string[] = [];
  const db: Database = {
    query: () => Promise.resolve([]),
    single: () => Promise.resolve({ id: PLAYER }),
    scalar: () => Promise.resolve(null),
    execute: () => Promise.resolve(0),
    transaction: (batch) => {
      for (const statement of batch)
        statements.push(`${statement.query} ${JSON.stringify(statement.values)}`);
      return Promise.resolve(true);
    },
  };
  const transport: WatchTransport = {
    begin: (target, params) => log.push(`begin:${String(target)}:${params.id}`),
    answer: (target, id) => log.push(`answer:${String(target)}:${id}`),
    offer: (viewer, id) =>
      log.push(`offer:${viewer.kind === 'game' ? String(viewer.source) : viewer.sessionId}:${id}`),
    ended: (party, id, role, reason) =>
      log.push(
        `ended:${party.kind === 'game' ? String(party.source) : party.sessionId}:${role}:${reason}:${id}`,
      ),
  };
  const sessions = createWatchSessions({
    db,
    config: loadWatchConfig(() => ''),
    transport,
    sourceOf: () => Promise.resolve(options.online === undefined ? 50 : options.online),
    now: () => clock.now,
  });
  return { sessions, log, statements, clock };
}

describe('watch configuration', () => {
  it('defaults to a public STUN server', () => {
    const config = loadWatchConfig(() => '');
    expect(config.iceServers[0]?.urls[0]).toMatch(/^stun:/);
    expect(config).toMatchObject({ relayOnly: false });
  });

  it('reads TURN servers and the relay-only switch', () => {
    const values: Record<string, string> = {
      'simpleac:watch_ice_servers': JSON.stringify([
        { urls: 'turn:turn.example:3478', username: 'u', credential: 'c' },
      ]),
      'simpleac:watch_relay_only': '1',
    };
    const config = loadWatchConfig((name, fallback) => values[name] ?? fallback);
    expect(config.iceServers).toEqual([
      { urls: ['turn:turn.example:3478'], username: 'u', credential: 'c' },
    ]);
    expect(config).toMatchObject({ relayOnly: true });
  });

  it('rejects malformed ICE settings', () => {
    expect(() =>
      loadWatchConfig((name, fallback) =>
        name === 'simpleac:watch_ice_servers' ? '{"urls":1}' : fallback,
      ),
    ).toThrow();
  });
});

describe('watch sessions', () => {
  it('isolates browser viewers even though their game sources are both zero', async () => {
    const { sessions, log } = setup();
    const first: StaffIdentity = { ...staff(0), viewer: 'web:first', via: 'web' };
    const second: StaffIdentity = { ...staff(0), viewer: 'web:second', via: 'web' };
    const a = await sessions.start(first, PLAYER, actor(0));
    const b = await sessions.start(second, PLAYER, actor(0));
    sessions.fromTarget(50, a.id, 'offer', SDP);
    expect(log).toContain(`offer:first:${a.id}`);
    expect(() => sessions.answer(second, a.id, SDP)).toThrow('belongs to someone else');
    await expect(sessions.stop(second, a.id, actor(0))).rejects.toMatchObject({ status: 403 });
    await sessions.playerLeft(0);
    sessions.answer(first, a.id, SDP);
    await sessions.viewerLeft('web:first');
    expect(log).toContain(`ended:50:target:staff_left:${a.id}`);
    sessions.fromTarget(50, b.id, 'offer', SDP);
    sessions.answer(second, b.id, SDP);
    await sessions.stop(second, b.id, actor(0));
  });
  it('starts a session, asks the watched game to stream, and relays offer and answer', async () => {
    const { sessions, log, statements } = setup();
    const started = await sessions.start(staff(1), PLAYER, actor(1));
    expect(log).toEqual([`begin:50:${started.id}`]);
    expect(statements.some((statement) => statement.includes('watch.started'))).toBe(true);

    sessions.fromTarget(50, started.id, 'offer', SDP);
    expect(log).toContain(`offer:1:${started.id}`);
    sessions.answer(staff(1), started.id, SDP);
    expect(log).toContain(`answer:50:${started.id}`);
  });

  it('refuses to watch a player who is not online', async () => {
    const { sessions } = setup({ online: null });
    await expect(sessions.start(staff(1), PLAYER, actor(1))).rejects.toMatchObject({
      status: 409,
    });
  });

  it('accepts an offer only from the watched player, and only once', async () => {
    const { sessions, log } = setup();
    const { id } = await sessions.start(staff(1), PLAYER, actor(1));
    sessions.fromTarget(99, id, 'offer', SDP);
    sessions.fromTarget(50, id, 'answer', SDP);
    sessions.fromTarget(50, id, 'offer', 'short');
    sessions.fromTarget(50, 42, 'offer', SDP);
    expect(log.filter((entry) => entry.startsWith('offer'))).toEqual([]);
    sessions.fromTarget(50, id, 'offer', SDP);
    sessions.fromTarget(50, id, 'offer', SDP);
    expect(log.filter((entry) => entry.startsWith('offer'))).toHaveLength(1);
  });

  it('keeps one watcher from answering or stopping another watcher', async () => {
    const { sessions } = setup();
    const { id } = await sessions.start(staff(1), PLAYER, actor(1));
    sessions.fromTarget(50, id, 'offer', SDP);
    expect(() => sessions.answer(staff(2), id, SDP)).toThrow(/someone else/);
    await expect(sessions.stop(staff(2), id, actor(2))).rejects.toMatchObject({ status: 403 });
    expect(() => sessions.answer(staff(1), id, 'x'.repeat(30_000))).toThrow();
  });

  it('needs the offer before an answer, and only one answer', async () => {
    const { sessions } = setup();
    const { id } = await sessions.start(staff(1), PLAYER, actor(1));
    expect(() => sessions.answer(staff(1), id, SDP)).toThrow(/offer/);
    sessions.fromTarget(50, id, 'offer', SDP);
    sessions.answer(staff(1), id, SDP);
    expect(() => sessions.answer(staff(1), id, SDP)).toThrow(/already/);
  });

  it('ends the previous session when the same staff member starts another', async () => {
    const { sessions, log } = setup();
    const first = await sessions.start(staff(1), PLAYER, actor(1));
    await sessions.start(staff(1), PLAYER, actor(1));
    expect(log).toContain(`ended:50:target:replaced:${first.id}`);
  });

  it('records the end and tells the watched game when staff stop', async () => {
    const { sessions, log, statements } = setup();
    const { id } = await sessions.start(staff(1), PLAYER, actor(1));
    await sessions.stop(staff(1), id, actor(1));
    expect(log).toContain(`ended:50:target:stopped:${id}`);
    expect(statements.some((statement) => statement.includes('watch.stopped'))).toBe(true);
    await expect(sessions.stop(staff(1), id, actor(1))).rejects.toMatchObject({ status: 404 });
  });

  it('tells staff when the watched player leaves, and the player when staff leave', async () => {
    const { sessions, log } = setup();
    const first = await sessions.start(staff(1), PLAYER, actor(1));
    await sessions.playerLeft(50);
    expect(log).toContain(`ended:1:staff:player_left:${first.id}`);
    const second = await sessions.start(staff(2), PLAYER, actor(2));
    await sessions.playerLeft(2);
    expect(log).toContain(`ended:50:target:staff_left:${second.id}`);
  });

  it('drops sessions that never get an offer, and ones that run too long', async () => {
    const clock = { now: 1_000_000 };
    const { sessions, log } = setup({ clock });
    const stalled = await sessions.start(staff(1), PLAYER, actor(1));
    clock.now += WATCH_OFFER_TIMEOUT_MS + 1;
    await sessions.prune();
    expect(log).toContain(`ended:1:staff:no_offer:${stalled.id}`);

    const unanswered = await sessions.start(staff(1), PLAYER, actor(1));
    sessions.fromTarget(50, unanswered.id, 'offer', SDP);
    clock.now += WATCH_ANSWER_TIMEOUT_MS + 1;
    await sessions.prune();
    expect(log).toContain(`ended:1:staff:no_answer:${unanswered.id}`);

    const long = await sessions.start(staff(1), PLAYER, actor(1));
    sessions.fromTarget(50, long.id, 'offer', SDP);
    sessions.answer(staff(1), long.id, SDP);
    clock.now += WATCH_MAX_MS + 1;
    await sessions.prune();
    expect(log).toContain(`ended:1:staff:time_limit:${long.id}`);
  });
});
