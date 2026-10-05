import type { PanelSession } from '../../../../shared/contracts/panel';
import { t } from './i18n';

const configured = import.meta.env['VITE_PANEL_API_BASE'] as string | undefined;
export const webBase =
  configured?.replace(/\/$/, '') ?? window.location.pathname.replace(/\/$/, '');
let csrf = '';

export async function webRequest<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${webBase}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'same-origin',
    headers:
      body === undefined ? {} : { 'content-type': 'application/json', 'x-simpleac-csrf': csrf },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.headers.get('content-type')?.includes('application/json'))
    throw new Error(t('browser.unavailable'));
  const result = (await response.json()) as T & { error?: { code: string; message: string } };
  if (!response.ok) {
    if (
      response.status === 401 ||
      (response.status === 403 && (path === '/session' || path.startsWith('/events')))
    ) {
      window.dispatchEvent(
        new CustomEvent('simpleac:web:access', { detail: result.error?.code ?? 'unauthenticated' }),
      );
    }
    throw new Error(result.error?.message ?? `Request failed (${response.status})`);
  }
  return result;
}

export async function loadWebSession(): Promise<PanelSession> {
  const result = await webRequest<{ session: PanelSession; csrf: string }>('/session');
  csrf = result.csrf;
  return result.session;
}

export async function logoutWeb(): Promise<void> {
  await webRequest('/auth/logout', {});
  csrf = '';
  window.location.assign(`${webBase}/`);
}

export function listenWebEvents(): () => void {
  let stopped = false;
  let cursor = 0;
  let timer: number | undefined;
  const poll = async () => {
    try {
      const result = await webRequest<{ cursor: number; events: { event: unknown }[] }>(
        `/events?after=${cursor}`,
      );
      if (stopped) return;
      cursor = result.cursor;
      for (const item of result.events) {
        window.dispatchEvent(
          new MessageEvent('message', {
            data: { action: 'simpleac:panel:watch', event: item.event },
          }),
        );
      }
    } catch {
      /* The next poll retries transient failures. */
    }
    if (!stopped)
      timer = window.setTimeout(() => {
        void poll();
      }, 1000);
  };
  void poll();
  return () => {
    stopped = true;
    window.clearTimeout(timer);
  };
}
