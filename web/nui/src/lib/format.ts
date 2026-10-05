import { hasString, t } from './i18n';

/** "3m ago", "2h ago", "5d ago". */
export function ago(iso: string, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (seconds < 45) return t('time.just_now');
  if (seconds < 3600) return t('time.minutes_ago', Math.round(seconds / 60));
  if (seconds < 86_400) return t('time.hours_ago', Math.round(seconds / 3600));
  return t('time.days_ago', Math.round(seconds / 86_400));
}

export function dateTime(iso: string): string {
  const date = new Date(iso);
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

/** The translated name of a rule, or a readable form of its key when no translation exists. */
export function ruleTitle(key: string): string {
  const translated = `rules.${key.replace(/\./g, '_')}`;
  if (hasString(translated)) return t(translated);
  const name = key.split('.').slice(1).join(' ').replace(/_/g, ' ') || key;
  return name.charAt(0).toUpperCase() + name.slice(1);
}

export function category(key: string): string {
  const first = key.split('.')[0] ?? key;
  const translated = `categories.${first}`;
  return hasString(translated) ? t(translated) : first.charAt(0).toUpperCase() + first.slice(1);
}

/** The translated name of an action type such as `ban.created`. */
export function actionLabel(type: string): string {
  const translated = `actions.${type.replace(/\./g, '_')}`;
  return hasString(translated) ? t(translated) : type.replace(/[._]/g, ' ');
}

/** What a rule does when it fires: log, warn, cancel the event, kick, ban... */
export function modeLabel(mode: string): string {
  return hasString(`modes.${mode}`) ? t(`modes.${mode}`) : mode;
}

export type Tone = 'accent' | 'success' | 'info' | 'danger' | 'muted';

export function actionTone(type: string): Tone {
  if (type.startsWith('ban.created') || type.includes('banned') || type.includes('kicked'))
    return 'danger';
  if (type.startsWith('case.') || type.startsWith('exception.')) return 'info';
  if (type.startsWith('capture.')) return 'info';
  if (type.startsWith('detection.')) return 'accent';
  return 'muted';
}

export function coords(value: { x: number; y: number; z: number }): string {
  return `${value.x.toFixed(0)}, ${value.y.toFixed(0)}, ${value.z.toFixed(0)}`;
}

/** Codes whose message is the same for everyone, so the translated text replaces the server's English one. */
const LOCALIZED_CODES = new Set([
  'timeout',
  'forbidden',
  'rate_limited',
  'internal_error',
  'unavailable',
]);

export function errorText(error: unknown): string {
  if (!(error instanceof Error)) return t('errors.generic');
  const code = (error as { code?: unknown }).code;
  if (typeof code === 'string' && LOCALIZED_CODES.has(code)) return t(`errors.${code}`);
  return error.message;
}
