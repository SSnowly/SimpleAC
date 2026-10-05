import { z } from 'zod';
import type { OnlinePlayer, PanelGame } from '../panel/handlers.js';
import type { GameBridge } from '../services/bans.js';
import type { CaptureGame } from '../services/captures.js';
import type { ExceptionGame } from '../services/exceptions.js';

/** Runs a CitizenFX native/export call on the game thread, per the engineering rules. */
export function onGameThread<T>(operation: () => T): Promise<T> {
  return new Promise((resolve, reject) => {
    setImmediate(() => {
      try {
        resolve(operation());
      } catch (error: unknown) {
        reject(error instanceof Error ? error : new Error('CitizenFX native call failed'));
      }
    });
  });
}

export function createGameBridge(): GameBridge {
  return {
    dropBannedPlayer(playerId, banId) {
      return onGameThread(() => {
        const own = exports[GetCurrentResourceName()] as
          | { InternalEnforceBan?: (playerId: string, banId: string) => unknown }
          | undefined;
        return own?.InternalEnforceBan?.(playerId, banId) === true;
      });
    },
  };
}

/**
 * Reads the table a Lua export returns. A Lua sequence can reach JavaScript as an array or as an object keyed by
 * index, and an empty one as either, so both are accepted.
 */
export function parseCaptureResult(
  value: unknown,
): { ok: true; ids: string[] } | { ok: false; reason: string } {
  const result = value as { ok?: unknown; ids?: unknown; reason?: unknown } | null | undefined;
  if (result?.ok === true) {
    const raw: unknown[] = Array.isArray(result.ids)
      ? result.ids
      : typeof result.ids === 'object' && result.ids !== null
        ? Object.values(result.ids)
        : [];
    return { ok: true, ids: raw.filter((id): id is string => typeof id === 'string') };
  }
  return { ok: false, reason: typeof result?.reason === 'string' ? result.reason : 'unavailable' };
}

interface CaptureExports {
  InternalRequestCapture?: (
    playerId: string,
    options: unknown,
    callback: (result: unknown) => void,
  ) => unknown;
}

const BRIDGE_TIMEOUT_MS = 10_000;

export function createCaptureBridge(): CaptureGame {
  return {
    requestCapture(playerId, options) {
      // The Lua export waits on the database, and a yielding Lua export cannot return a value to JavaScript, so
      // it answers through a callback instead.
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          resolve({ ok: false, reason: 'unavailable' });
        }, BRIDGE_TIMEOUT_MS);
        onGameThread(() => {
          const own = exports[GetCurrentResourceName()] as CaptureExports | undefined;
          if (!own?.InternalRequestCapture) throw new Error('capture export is not available');
          own.InternalRequestCapture(playerId, options, (result) => {
            clearTimeout(timer);
            resolve(parseCaptureResult(result));
          });
        }).catch(() => {
          clearTimeout(timer);
          resolve({ ok: false, reason: 'unavailable' });
        });
      });
    },
    captureStored(captureId) {
      emit('simpleac:internal:captureStored', captureId);
    },
    ocrMatch(event) {
      emit('simpleac:internal:ocrMatch', event);
    },
  };
}

export function createExceptionBridge(): ExceptionGame {
  return {
    reloadExceptions() {
      emit('simpleac:internal:reloadExceptions');
    },
  };
}

const onlinePlayerSchema = z.object({
  source: z.number(),
  playerId: z.string(),
  name: z.string(),
  ping: z.number(),
  health: z.number(),
  armor: z.number(),
  coords: z.object({ x: z.number(), y: z.number(), z: z.number() }),
  inVehicle: z.boolean(),
  bucket: z.number(),
});

interface PanelExports {
  InternalPanelSource?: (playerId: string) => unknown;
  InternalPanelOnline?: () => unknown;
  InternalPanelPlayer?: (source: number) => unknown;
  InternalPanelWarn?: (playerId: string, reason: string) => unknown;
  InternalPanelKick?: (playerId: string, reason: string) => unknown;
}

const panelExports = (): PanelExports => {
  const own = exports[GetCurrentResourceName()] as PanelExports | undefined;
  if (!own) throw new Error('panel exports are not available');
  return own;
};

/** A Lua sequence can arrive as an array or as an object keyed by index. */
const asList = (value: unknown): unknown[] =>
  Array.isArray(value)
    ? value
    : typeof value === 'object' && value !== null
      ? Object.values(value)
      : [];

export function createPanelGame(): PanelGame & {
  playerOf(source: number): Promise<string | null>;
  sourceOf(playerId: string): Promise<number | null>;
} {
  return {
    online: () =>
      onGameThread(() =>
        asList(panelExports().InternalPanelOnline?.()).flatMap((item): OnlinePlayer[] => {
          const parsed = onlinePlayerSchema.safeParse(item);
          return parsed.success ? [parsed.data] : [];
        }),
      ),
    playerOf: (source) =>
      onGameThread(() => {
        const value = panelExports().InternalPanelPlayer?.(source);
        return typeof value === 'string' ? value : null;
      }),
    sourceOf: (playerId) =>
      onGameThread(() => {
        const value = panelExports().InternalPanelSource?.(playerId);
        return typeof value === 'number' ? value : null;
      }),
    warn: (playerId, reason) =>
      onGameThread(() => panelExports().InternalPanelWarn?.(playerId, reason) === true),
    kick: (playerId, reason) =>
      onGameThread(() => panelExports().InternalPanelKick?.(playerId, reason) === true),
  };
}
