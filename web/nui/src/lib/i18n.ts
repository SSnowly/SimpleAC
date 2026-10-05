import english from '../../../../locales/en.json';

type Tree = { [key: string]: string | Tree };

/** Nested locale files are read as flat dotted keys, the same way ox_lib reads them. */
function flatten(
  tree: Tree,
  prefix = '',
  into: Record<string, string> = {},
): Record<string, string> {
  for (const [key, value] of Object.entries(tree)) {
    const full = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') into[full] = value;
    else flatten(value, full, into);
  }
  return into;
}

const bundled = flatten(english as Tree);
let active: Record<string, string> = bundled;

/**
 * The game sends the active language (ox_lib's `lib.getLocales()`, English underneath), so translations are a
 * drop-in JSON file with no rebuild. Anything missing falls back to the English bundled here, then to the key.
 */
export function setStrings(strings: Record<string, string> | undefined): void {
  active = strings ? { ...bundled, ...strings } : bundled;
}

/** ox_lib style formatting: `%s` and `%d` take the next argument, `%%` is a percent sign. */
function format(template: string, args: readonly (string | number)[]): string {
  let index = 0;
  return template.replace(/%([sd%])/g, (_match, kind: string) => {
    if (kind === '%') return '%';
    const value = args[index];
    index += 1;
    return value === undefined ? '' : String(value);
  });
}

export function t(key: string, ...args: (string | number)[]): string {
  const template = active[key] ?? bundled[key] ?? key;
  return args.length > 0 || template.includes('%') ? format(template, args) : template;
}

/** True when the key has a translation (in the active language or in English). */
export const hasString = (key: string): boolean => key in active || key in bundled;
