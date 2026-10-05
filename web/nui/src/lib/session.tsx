import { createContext, type ReactNode, useContext } from 'react';
import type { PanelPermission, PanelSession } from '../../../../shared/contracts/panel';

interface SessionValue {
  session: PanelSession;
  can: (permission: PanelPermission) => boolean;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({
  session,
  children,
}: {
  session: PanelSession;
  children: ReactNode;
}) {
  const permissions = new Set(session.staff.permissions);
  return (
    <SessionContext.Provider value={{ session, can: (permission) => permissions.has(permission) }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside a SessionProvider');
  return value;
}
