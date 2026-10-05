import { type ApiScope, apiScopes } from '../shared/contracts/api.js';
import { simpleAcIdSchema } from '../shared/contracts/ids.js';
import { isApiScope } from './security/scopes.js';
import type { ApiKeyService } from './services/api-keys.js';

const USAGE = [
  'Usage:',
  '  simpleac:apikey create <name> <scope[,scope...]> [expiryDays] [allowedIp[,ip...]]',
  '  simpleac:apikey list',
  '  simpleac:apikey revoke <SAC-KEY-id>',
  `Scopes: ${apiScopes.join(', ')}`,
].join('\n');

function print(message: string): void {
  console.log(`[SimpleAC] ${message}`);
}

export function parseScopes(value: string): ApiScope[] | null {
  const scopes = value.split(',').map((scope) => scope.trim());
  if (scopes.length === 0 || scopes.some((scope) => !isApiScope(scope))) return null;
  return [...new Set(scopes)].filter(isApiScope);
}

export async function runApiKeyCommand(
  keys: ApiKeyService,
  args: readonly string[],
): Promise<void> {
  const [subcommand, ...rest] = args;

  if (subcommand === 'create') {
    const [name, scopeText, daysText, ipText] = rest;
    const scopes = scopeText ? parseScopes(scopeText) : null;
    const days = daysText === undefined ? undefined : Number(daysText);
    if (
      !name ||
      name.length > 128 ||
      !scopes ||
      (days !== undefined && (!Number.isInteger(days) || days < 1 || days > 3650))
    ) {
      print(USAGE);
      return;
    }
    const allowedIps = ipText ? ipText.split(',').filter((ip) => ip.length > 0) : [];
    const created = await keys.create({
      name,
      scopes,
      ...(days === undefined ? {} : { expiresInDays: days }),
      ...(allowedIps.length > 0 ? { allowedIps } : {}),
    });
    print(`Created API key ${created.id} ("${name}"). Copy it now; it cannot be shown again:`);
    print(created.token);
    return;
  }

  if (subcommand === 'list') {
    const listing = await keys.list();
    if (listing.length === 0) print('No API keys exist.');
    for (const key of listing) {
      const state = key.revokedAt ? 'revoked' : 'active';
      print(
        `${key.id} ${state} "${key.name}" prefix=${key.prefix} scopes=${key.scopes.join(',')} ` +
          `expires=${key.expiresAt ?? 'never'} lastUsed=${key.lastUsedAt ?? 'never'}`,
      );
    }
    return;
  }

  if (subcommand === 'revoke') {
    const id = simpleAcIdSchema.safeParse(rest[0]);
    if (!id.success || !id.data.startsWith('SAC-KEY-')) {
      print(USAGE);
      return;
    }
    print((await keys.revoke(id.data)) ? `Revoked ${id.data}.` : `No active key ${id.data}.`);
    return;
  }

  print(USAGE);
}

export function registerCommands(keys: ApiKeyService): void {
  RegisterCommand(
    'simpleac:apikey',
    (source, args) => {
      // Raw keys are only ever printed to the server console.
      if (source !== 0) return;
      runApiKeyCommand(keys, args).catch((error: unknown) => {
        print(`Command failed: ${error instanceof Error ? error.message : 'unknown error'}`);
      });
    },
    true,
  );
}
