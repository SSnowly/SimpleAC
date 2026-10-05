import type { ApiScope } from '../../shared/contracts/api.js';

export interface AuthenticatedKey {
  id: string;
  name: string;
  scopes: readonly ApiScope[];
}

export interface HttpState {
  requestId?: string;
  auth?: AuthenticatedKey;
  /** Raw request body bytes, captured for idempotency fingerprinting. */
  rawBody?: string;
  body?: unknown;
}
