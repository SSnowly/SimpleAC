declare function GetCurrentResourceName(): string;
declare function GetResourceState(resourceName: string): string;
declare function GetResourcePath(resourceName: string): string;
declare function GetConvar(name: string, defaultValue: string): string;
declare function emit(eventName: string, ...args: unknown[]): void;
declare function GetResourceMetadata(
  resourceName: string,
  key: string,
  index: number,
): string | null;
declare function on(eventName: string, listener: (...args: unknown[]) => void): void;
declare function RegisterCommand(
  commandName: string,
  handler: (source: number, args: string[], rawCommand: string) => void,
  restricted: boolean,
): void;

declare const exports: {
  [resourceName: string]: unknown;
  oxmysql: {
    query_async(query: string, values?: unknown[]): Promise<unknown>;
    single_async(query: string, values?: unknown[]): Promise<unknown>;
    scalar_async(query: string, values?: unknown[]): Promise<unknown>;
    update_async(query: string, values?: unknown[]): Promise<unknown>;
    transaction_async(statements: { query: string; values: unknown[] }[]): Promise<unknown>;
  };
};

declare module '@citizenfx/http-wrapper' {
  import type { RequestListener } from 'node:http';
  export function setHttpCallback(callback: RequestListener): void;
}

declare const source: number;
declare function onNet(eventName: string, listener: (...args: unknown[]) => void): void;
declare function emitNet(eventName: string, target: number | string, ...args: unknown[]): void;
declare function TriggerLatentClientEvent(
  eventName: string,
  target: number | string,
  bytesPerSecond: number,
  ...args: unknown[]
): void;
declare function IsPlayerAceAllowed(player: string, object: string): boolean;
declare function IsPrincipalAceAllowed(principal: string, object: string): boolean;
declare function GetNumPlayerIdentifiers(player: string): number;
declare function GetPlayerIdentifier(player: string, index: number): string | null;
declare function GetPlayerName(player: string): string | null;
declare function GetNumPlayerIndices(): number;
declare function GetPlayerPing(player: string): number;
declare function GetGameTimer(): number;

declare module 'node-turn' {
  interface TurnOptions {
    authMech?: string;
    credentials?: Record<string, string>;
    realm?: string;
    listeningIps?: string[];
    listeningPort?: number;
    minPort?: number;
    maxPort?: number;
    externalIps?: string | Record<string, string>;
    debugLevel?: string;
    log?: (message: unknown) => void;
  }
  export default class Turn {
    constructor(options?: TurnOptions);
    start(): void;
    stop(): void;
    addUser(username: string, password: string): void;
    removeUser(username: string): void;
  }
}
