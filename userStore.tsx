import React, { createContext, useContext, useEffect, useState } from 'react';
import { Client, SalesPerson } from '@/lib/types';
import { SALES_TEAM } from '@/data/seedData';

// ============================================================
// USER / PERMISSIONS STORE
// Role model:
//   manager   → sees and edits every account, can reassign owners
//   sales_rep → sees only accounts they own; cannot reassign owners
// The sidebar has a user switcher so you can demo both roles.
// TODO: replace with Supabase Auth — map the authed user's email
// to their SalesPerson record and delete the switcher.
// ============================================================

const USER_KEY = 'trophi-current-user';

interface UserContextValue {
  currentUser: SalesPerson;
  isManager: boolean;
  setCurrentUserId: (id: string) => void;
  /** Accounts this user is allowed to see. */
  visibleClients: (clients: Client[]) => Client[];
  /** Can this user edit the given client? */
  canEdit: (client: Client) => boolean;
}

const UserContext = createContext<UserContextValue | null>(null);

export function UserProvider({ children }: { children: React.ReactNode }) {
  const [userId, setUserId] = useState<string>(() => localStorage.getItem(USER_KEY) ?? SALES_TEAM[0].id);

  useEffect(() => {
    localStorage.setItem(USER_KEY, userId);
  }, [userId]);

  const currentUser = SALES_TEAM.find((sp) => sp.id === userId) ?? SALES_TEAM[0];
  const isManager = currentUser.role === 'manager';

  const value: UserContextValue = {
    currentUser,
    isManager,
    setCurrentUserId: setUserId,
    visibleClients: (clients) =>
      isManager ? clients : clients.filter((c) => c.salesPersonId === currentUser.id),
    canEdit: (client) => isManager || client.salesPersonId === currentUser.id,
  };

  return <UserContext.Provider value={value}>{children}</UserContext.Provider>;
}

export function useUser(): UserContextValue {
  const ctx = useContext(UserContext);
  if (!ctx) throw new Error('useUser must be used within UserProvider');
  return ctx;
}
