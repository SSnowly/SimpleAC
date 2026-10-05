import { type PanelPermission, panelPermissions } from '../../shared/contracts/panel.js';
import type { PanelMembers } from './members.js';

export interface StaffIdentity {
  /** The in-game server ID, or 0 for staff using the browser panel. */
  source: number;
  /** Where this staff member is: `game:<server id>` or `web:<session id>`. A live view belongs to one of these. */
  viewer: string;
  via: 'game' | 'web';
  name: string;
  identifiers: string[];
  /** The staff member's own SimpleAC player ID, when their identifier matches a player. */
  playerId: string | null;
  permissions: ReadonlySet<PanelPermission>;
}

/** Someone who signed in to the browser panel, already verified by Discord. */
export interface WebStaff {
  /** `discord:<id>`: the identifier panel members and ACE principals are keyed by. */
  identifier: string;
  name: string;
  sessionId: string;
}

export interface PanelAccess {
  resolve(source: number): Promise<StaffIdentity>;
  resolveWeb(staff: WebStaff): Promise<StaffIdentity>;
}

export interface AccessPlatform {
  aceAllowed(source: number, object: string): boolean;
  /** Whether an identifier holds an ACE, for someone who is not connected (browser panel staff). */
  principalAllowed(identifier: string, object: string): boolean;
  identifiers(source: number): string[];
  name(source: number): string;
  playerOf(source: number): Promise<string | null>;
  playerByIdentifier(identifier: string): Promise<string | null>;
}

/** ACE that grants everything. Individual permissions are `simpleac.<permission>`, for example `simpleac.cases.manage`. */
export const ADMIN_ACE = 'simpleac.admin';

/**
 * A staff member's permissions are the union of: everything, when they hold the `simpleac.admin` ACE; each
 * `simpleac.<permission>` ACE they hold; and what the database grants to any of their identifiers. The result is
 * recomputed for every request, so revoking access takes effect on the next click. Browser staff are checked the
 * same way against their Discord identifier, which also works for people who have never joined the server.
 */
export function createPanelAccess(members: PanelMembers, platform: AccessPlatform): PanelAccess {
  const permissionsFor = async (
    allowed: (object: string) => boolean,
    identifiers: readonly string[],
  ): Promise<Set<PanelPermission>> => {
    const permissions = new Set<PanelPermission>();
    if (allowed(ADMIN_ACE)) {
      for (const permission of panelPermissions) permissions.add(permission);
    } else {
      for (const permission of panelPermissions) {
        if (allowed(`simpleac.${permission}`)) permissions.add(permission);
      }
      for (const permission of await members.permissionsFor(identifiers)) {
        permissions.add(permission);
      }
    }
    // Reading is the base of every other permission: without it no screen could load.
    if (permissions.size > 0) permissions.add('players.view');
    return permissions;
  };

  return {
    async resolve(source) {
      const identifiers = platform.identifiers(source);
      return {
        source,
        viewer: `game:${String(source)}`,
        via: 'game',
        name: platform.name(source),
        identifiers,
        playerId: await platform.playerOf(source),
        permissions: await permissionsFor(
          (object) => platform.aceAllowed(source, object),
          identifiers,
        ),
      };
    },

    async resolveWeb(staff) {
      const identifiers = [staff.identifier];
      return {
        source: 0,
        viewer: `web:${staff.sessionId}`,
        via: 'web',
        name: staff.name,
        identifiers,
        playerId: await platform.playerByIdentifier(staff.identifier),
        permissions: await permissionsFor(
          (object) => platform.principalAllowed(staff.identifier, object),
          identifiers,
        ),
      };
    },
  };
}
