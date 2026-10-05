import type {
  PanelInput,
  PanelOp,
  PanelOutput,
  PanelReply,
} from '../../../../shared/contracts/panel';
import { devBackend } from './dev-backend';
import { isBrowser, isDev } from './env';
import { webRequest } from './web-panel';

export class RpcError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'RpcError';
    this.code = code;
  }
}

const TIMEOUT_MS = 20_000;

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: RpcError) => void;
  timer: number;
}

const pending = new Map<number, Pending>();
let nextId = 1;
let listening = false;

function listen(): void {
  if (listening) return;
  listening = true;
  window.addEventListener(
    'message',
    (event: MessageEvent<{ action?: string; reply?: PanelReply } | null>) => {
      if (event.data?.action !== 'simpleac:panel:res' || !event.data.reply) return;
      const reply = event.data.reply;
      const entry = pending.get(reply.id);
      if (!entry) return;
      pending.delete(reply.id);
      window.clearTimeout(entry.timer);
      if (reply.ok) entry.resolve(reply.data);
      else entry.reject(new RpcError(reply.code, reply.message));
    },
  );
}

/**
 * Calls a panel operation. In the game the request goes up to the page that hosts the panel, on to the client and
 * to the server, which checks the staff member's permission for this exact operation. In a browser (`bun run
 * dev:web`) a local fixture answers instead.
 */
export function rpc<K extends PanelOp>(op: K, input?: PanelInput<K>): Promise<PanelOutput<K>> {
  if (isDev) return devBackend(op, input);
  if (isBrowser)
    return webRequest<{ data: PanelOutput<K> }>('/rpc', { op, payload: input ?? {} }).then(
      (reply) => reply.data,
    );
  listen();
  const id = nextId++;
  return new Promise<PanelOutput<K>>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      pending.delete(id);
      reject(new RpcError('timeout', 'The server did not answer in time.'));
    }, TIMEOUT_MS);
    pending.set(id, { resolve: (value) => resolve(value as PanelOutput<K>), reject, timer });
    window.parent.postMessage({ type: 'simpleac:rpc', id, op, payload: input ?? {} }, '*');
  });
}

/** Tells the page that hosts the panel that it finished closing, so the game can take focus back. */
export function notifyClosed(): void {
  if (isDev || isBrowser) return;
  window.parent.postMessage({ type: 'simpleac:closed' }, '*');
}
