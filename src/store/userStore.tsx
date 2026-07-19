import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { User } from '@supabase/supabase-js';
import type { SalesPerson } from '@/lib/types';

interface AuthState {
  user: User | null;
  profile: SalesPerson | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({ user: null, profile: null, loading: true, signOut: async () => {} });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<SalesPerson | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_ev, session) => {
      setUser(session?.user ?? null);
      if (!session?.user) { setProfile(null); setLoading(false); return; }
      setTimeout(() => {
        Promise.all([
          supabase.from('profiles').select('user_id, name, email').eq('user_id', session.user.id).maybeSingle(),
          supabase.from('user_roles').select('role').eq('user_id', session.user.id),
        ]).then(([p, r]) => {
          const roles = (r.data ?? []).map((row: any) => row.role);
          const rank = (x: string) =>
            x === 'admin' ? 5 : x === 'manager' ? 4
              : x === 'onboarding_specialist' ? 3 : x === 'account_manager' ? 3
              : x === 'sales_rep' ? 2 : 1;
          const role = (roles.length ? roles.reduce((a: string, b: string) => rank(b) > rank(a) ? b : a) : 'sales_rep') as SalesPerson['role'];
          if (p.data) {
            setProfile({
              id: p.data.user_id, name: p.data.name, email: p.data.email,
              role,
            });
          }
          setLoading(false);
        });
      }, 0);
    });
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) setLoading(false);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
    window.location.href = '/auth';
  };

  return <AuthContext.Provider value={{ user, profile, loading, signOut }}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
// Legacy compatibility for CRM UI components
export function useUser() {
  const { profile } = useAuth();
  const currentUser = profile ?? { id: '', name: '', email: '', role: 'sales_rep' as const };
  const isAdmin = currentUser.role === 'admin';
  const isManager = isAdmin || currentUser.role === 'manager';
  return {
    currentUser,
    isAdmin,
    isManager,
    setCurrentUserId: () => {},
    visibleClients: <T extends { salesPersonId: string }>(clients: T[]) =>
      isManager ? clients : clients.filter((c) => c.salesPersonId === currentUser.id),
    canEdit: (client: { salesPersonId: string }) => isManager || client.salesPersonId === currentUser.id,
  };
}
