import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { User } from '@supabase/supabase-js';
import type { SalesPerson } from '@/lib/types';

type StaffRole = SalesPerson['role'];

interface ClientContext {
  businessId: string;
  firstName: string | null;
  lastName: string | null;
  company: string | null;
  permissionLevel: string | null;
}

interface AuthState {
  user: User | null;
  profile: SalesPerson | null;
  client: ClientContext | null;
  isClient: boolean;
  isStaff: boolean;
  loading: boolean;
  avatarPath: string | null;
  avatarUrl: string | null;
  refreshAvatar: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({
  user: null, profile: null, client: null, isClient: false, isStaff: false,
  loading: true, avatarPath: null, avatarUrl: null,
  refreshAvatar: async () => {}, signOut: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<SalesPerson | null>(null);
  const [client, setClient] = useState<ClientContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [avatarPath, setAvatarPath] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

  async function resolveAvatarUrl(path: string | null) {
    if (!path) { setAvatarUrl(null); return; }
    const { data } = await supabase.storage.from('trophi-avatars').createSignedUrl(path, 3600);
    setAvatarUrl(data?.signedUrl ?? null);
  }

  async function refreshAvatar() {
    if (!user) return;
    const { data } = await supabase.from('profiles').select('avatar_path').eq('user_id', user.id).maybeSingle();
    const path = (data as any)?.avatar_path ?? null;
    setAvatarPath(path);
    await resolveAvatarUrl(path);
  }

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_ev, session) => {
      setUser(session?.user ?? null);
      if (!session?.user) {
        setProfile(null); setClient(null); setAvatarPath(null); setAvatarUrl(null); setLoading(false); return;
      }
      setTimeout(() => {
        Promise.all([
          supabase.from('profiles').select('user_id, name, email, avatar_path').eq('user_id', session.user.id).maybeSingle(),
          supabase.from('user_roles').select('role').eq('user_id', session.user.id),
          supabase.from('client_users')
            .select('business_id, first_name, last_name, permission_level, clients:business_id(company)')
            .eq('user_id', session.user.id)
            .maybeSingle(),
        ]).then(([p, r, cu]) => {
          const roles = (r.data ?? []).map((row: any) => row.role);
          const rank = (x: string) =>
            x === 'admin' ? 5 : x === 'manager' ? 4
              : x === 'onboarding_specialist' ? 3 : x === 'account_manager' ? 3
              : x === 'sales_rep' ? 2 : 0;
          const role = (roles.length
            ? roles.reduce((a: string, b: string) => rank(b) > rank(a) ? b : a)
            : null) as StaffRole | null;

          if (role && p.data) {
            setProfile({
              id: p.data.user_id, name: p.data.name, email: p.data.email, role,
            });
            const path = (p.data as any).avatar_path ?? null;
            setAvatarPath(path);
            resolveAvatarUrl(path);
          } else {
            setProfile(null);
            setAvatarPath(null);
            setAvatarUrl(null);
          }

          if (cu.data) {
            setClient({
              businessId: cu.data.business_id,
              firstName: cu.data.first_name,
              lastName: cu.data.last_name,
              company: (cu.data.clients as any)?.company ?? null,
              permissionLevel: cu.data.permission_level,
            });
          } else {
            setClient(null);
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

  const isStaff = !!profile;
  const isClient = !isStaff && !!client;

  return (
    <AuthContext.Provider value={{ user, profile, client, isClient, isStaff, loading, avatarPath, avatarUrl, refreshAvatar, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);

// Legacy compatibility for CRM UI components (Trophi staff surfaces only).
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
