export const theme = {
  accent: '#28cdff',
  background: '#101012',
  panel: '#171719',
  surface: '#202023',
  border: '#303033',
  text: '#f1efeb',
  muted: '#89888d',
  danger: '#ef5858',
  success: '#71c8a0',
  info: '#72a9ed',
  purple: '#ac8ae5',
  yellow: '#e6be63',
};
export type Theme = typeof theme;

const KEY = 'simpleac-theme';

/** The viewer's own colours, kept in this browser only. Storage can be unavailable in NUI, so it is optional. */
export function loadTheme(): Theme {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return theme;
    const parsed = JSON.parse(raw) as Partial<Theme>;
    const next = { ...theme };
    for (const key of Object.keys(theme) as (keyof Theme)[]) {
      const value = parsed[key];
      if (typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value)) next[key] = value;
    }
    return next;
  } catch {
    return theme;
  }
}

export function saveTheme(value: Theme): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(value));
  } catch {
    /* Keep the colours for this session only. */
  }
}
