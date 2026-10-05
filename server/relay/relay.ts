import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import type { PanelIceServer } from '../../shared/contracts/panel.js';
import type { RelayCommand, RelayWorkerConfig } from './relay-worker.js';

export interface RelayConfig extends RelayWorkerConfig {
  enabled: boolean;
  /** Bundled worker script. */
  workerFile: string;
}

/**
 * Self-hosted relay settings from convars:
 * - `simpleac:watch_relay`: `1` (default) runs a TURN relay inside this resource for live watch, `0` turns it off.
 * - `simpleac:watch_relay_port`: UDP port clients connect to (default 3478).
 * - `simpleac:watch_relay_ports`: UDP range used to relay video, `min-max` (default 49152-49351).
 * - `simpleac:watch_public_ip`: the address players and staff can reach this server on. Defaults to 127.0.0.1,
 *   which only works when everyone is on the same machine, so set it on a real server.
 */
export function loadRelayConfig(
  read: (name: string, fallback: string) => string,
  resourcePath: string,
): RelayConfig {
  const range = /^(\d{1,5})-(\d{1,5})$/.exec(read('simpleac:watch_relay_ports', '49152-49351'));
  const min = range ? Number(range[1]) : 49152;
  const max = range ? Number(range[2]) : 49351;
  const port = Number.parseInt(read('simpleac:watch_relay_port', '3478'), 10);
  const valid = (value: number): boolean =>
    Number.isInteger(value) && value >= 1024 && value <= 65535;
  return {
    enabled: read('simpleac:watch_relay', '1') === '1',
    port: valid(port) ? port : 3478,
    minPort: valid(min) && valid(max) && min < max ? min : 49152,
    maxPort: valid(min) && valid(max) && min < max ? max : 49351,
    publicIp: read('simpleac:watch_public_ip', '127.0.0.1').trim() || '127.0.0.1',
    workerFile: join(resourcePath, 'dist', 'server', 'relay-worker.js'),
  };
}

/** The part of a worker the relay uses, so tests can stand in for a real thread. */
export interface RelayThread {
  postMessage(command: RelayCommand): void;
  on(event: 'message', listener: (message: { type: string; message?: string }) => void): void;
  on(event: 'error', listener: (error: Error) => void): void;
  terminate(): Promise<unknown>;
}

export interface Relay {
  /** True once the relay thread reported that it is listening. */
  ready(): boolean;
  /**
   * Time-limited credentials for one live view. Both ends use them; they stop working when the view ends.
   * Returns null while the relay is not available.
   */
  issue(sessionId: string): PanelIceServer[] | null;
  revoke(sessionId: string): void;
  close(): Promise<void>;
}

export interface RelayDeps {
  config: RelayConfig;
  log: (level: 'info' | 'warn' | 'error', event: string, fields: Record<string, unknown>) => void;
  spawn?: (config: RelayConfig) => RelayThread;
}

const defaultSpawn = (config: RelayConfig): RelayThread =>
  new Worker(config.workerFile, {
    workerData: {
      port: config.port,
      minPort: config.minPort,
      maxPort: config.maxPort,
      publicIp: config.publicIp,
    } satisfies RelayWorkerConfig,
  });

/** Starts the relay thread. When it cannot start (workers not allowed, port taken) live watch falls back to STUN. */
export function createRelay(deps: RelayDeps): Relay {
  const { config, log } = deps;
  const users = new Map<string, string>();
  let thread: RelayThread | null = null;
  let ready = false;

  if (config.enabled) {
    try {
      if (!deps.spawn && !existsSync(config.workerFile))
        throw new Error('the relay worker is not built');
      thread = (deps.spawn ?? defaultSpawn)(config);
      thread.on('message', (message) => {
        if (message.type === 'ready') {
          ready = true;
          log('info', 'watch_relay_ready', { port: config.port, publicIp: config.publicIp });
        } else if (message.type === 'error') {
          ready = false;
          log('error', 'watch_relay_failed', { error: message.message ?? 'unknown error' });
        }
      });
      thread.on('error', (error) => {
        ready = false;
        const restricted = /restricted|permission|not allowed/i.test(error.message);
        log('error', 'watch_relay_failed', {
          error: error.message,
          ...(restricted
            ? {
                hint: 'Add: add_unsafe_worker_permission "SimpleAC" to server.cfg, then restart the server.',
              }
            : {}),
        });
      });
    } catch (error) {
      log('error', 'watch_relay_failed', {
        error: error instanceof Error ? error.message : 'unknown error',
      });
    }
  }

  return {
    ready: () => ready,

    issue(sessionId) {
      if (!thread || !ready) return null;
      // The username carries its own expiry so a leaked credential is useless after the maximum view length.
      const username = `${String(Math.floor(Date.now() / 1000) + 3600)}:${sessionId}`;
      const password = randomBytes(18).toString('base64url');
      users.set(sessionId, username);
      thread.postMessage({ type: 'add', username, password });
      return [
        {
          urls: [`turn:${config.publicIp}:${String(config.port)}?transport=udp`],
          username,
          credential: password,
        },
      ];
    },

    revoke(sessionId) {
      const username = users.get(sessionId);
      if (!username || !thread) return;
      users.delete(sessionId);
      thread.postMessage({ type: 'remove', username });
    },

    async close() {
      if (!thread) return;
      thread.postMessage({ type: 'stop' });
      await thread.terminate().catch(() => undefined);
      thread = null;
      ready = false;
    },
  };
}
