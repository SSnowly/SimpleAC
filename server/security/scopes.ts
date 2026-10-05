import { type ApiScope, apiScopes } from '../../shared/contracts/api.js';

const scopeSet: ReadonlySet<string> = new Set(apiScopes);

export function isApiScope(value: string): value is ApiScope {
  return scopeSet.has(value);
}

/** `admin` grants everything; `<resource>:write` implies `<resource>:read`. */
export function hasScope(granted: readonly ApiScope[], required: ApiScope): boolean {
  if (granted.includes('admin') || granted.includes(required)) return true;
  if (required.endsWith(':read')) {
    const writeScope = `${required.slice(0, -':read'.length)}:write`;
    return granted.some((scope) => scope === writeScope);
  }
  return false;
}
