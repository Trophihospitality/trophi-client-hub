import { createFileRoute, Outlet, redirect, Link, useRouterState } from '@tanstack/react-router';
import { useState } from 'react';
import { Users, ClipboardCheck, BarChart3, Wrench, Globe, LogOut, ShieldCheck, FileText, LineChart, Trophy, ScrollText, ChevronDown, ChevronRight } from 'lucide-react';

import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/store/userStore';
import trophiMarkAsset from '@/assets/trophi-mark.png.asset.json';
const trophiMark = trophiMarkAsset.url;

export const Route = createFileRoute('/_authenticated')({
  ssr: false,
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) throw redirect({ to: '/auth' });
    return { user: data.user };
  },
  component: AuthedLayout,
});

const NAV = [
  { to: '/crm', label: 'CRM', icon: Users },
  { to: '/onboarding', label: 'Onboarding', icon: ClipboardCheck },
  { to: '/accounts', label: 'Account Management', icon: BarChart3 },
  { to: '/leaderboards', label: 'Leaderboards', icon: Trophy },
  { to: '/support', label: 'Tech / Support', icon: Wrench },
  { to: '/client-portal', label: 'Client Portal', icon: Globe },
] as const;

const ADMIN_NAV = [
  { to: '/audit', label: 'Audit Log', icon: ScrollText },
  { to: '/settings/pandadoc-templates', label: 'PandaDoc Templates', icon: FileText },
] as const;

const USER_MGMT_CHILDREN = [
  { to: '/users/trophi', label: 'Trophi Users' },
  { to: '/users/client', label: 'Client Users' },
] as const;


function TrophiMark() {
  return (
    <div className="flex items-center gap-2.5 px-2">
      <img src={trophiMark} alt="Trophi Hospitality" className="h-10 w-10 object-contain" />
      <div className="leading-tight">
        <div className="font-display font-semibold text-[15px] tracking-[0.06em] text-gold-gradient">TROPHI</div>
        <div className="text-[10px] uppercase tracking-[0.22em] text-white/50 font-display font-light">Hospitality</div>
      </div>
    </div>
  );
}

function AuthedLayout() {
  const { profile, signOut } = useAuth();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <div className="flex min-h-screen">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 flex-col bg-[hsl(var(--trophi-ink))] md:flex">
        <div className="py-6"><TrophiMark /></div>
        <nav className="flex-1 space-y-1 px-3">
          {NAV.map(({ to, label, icon: Icon }) => {
            const active = pathname.startsWith(to);
            return (
              <Link key={to} to={to}
                className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${
                  active
                    ? 'bg-white/10 text-white font-medium border-l-2 border-[hsl(var(--trophi-gold))]'
                    : 'text-white/60 hover:bg-white/5 hover:text-white'
                }`}
              >
                <Icon className="h-4 w-4" />{label}
              </Link>
            );
          })}
          {(profile?.role === 'admin' || profile?.role === 'manager') && (
            <>
              <div className="pt-4 pb-1 px-3 text-[10px] uppercase tracking-wider text-white/30">Admin</div>
              {(() => {
                const items = [
                  { to: '/reports', label: 'Reports', icon: LineChart, adminOnly: false },
                  ...(profile?.role === 'admin' ? ADMIN_NAV.map((n) => ({ ...n, adminOnly: true })) : []),
                ];
                return items.map(({ to, label, icon: Icon }) => {
                  const active = pathname.startsWith(to);
                  return (
                    <Link key={to} to={to}
                      className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${
                        active
                          ? 'bg-white/10 text-white font-medium border-l-2 border-[hsl(var(--trophi-gold))]'
                          : 'text-white/60 hover:bg-white/5 hover:text-white'
                      }`}
                    >
                      <Icon className="h-4 w-4" />{label}
                    </Link>
                  );
                });
              })()}
            </>
          )}
        </nav>
        <div className="border-t border-white/10 px-3 py-3 space-y-2">
          <div className="px-2 text-[10px] uppercase tracking-wider text-white/40">Signed in as</div>
          <div className="px-2 text-sm text-white truncate">{profile?.name ?? '…'}</div>
          <div className="px-2 text-[11px] text-white/40">
            {profile?.role === 'admin' ? 'Admin · full access'
              : profile?.role === 'manager' ? 'Manager · sees all'
              : profile?.role === 'onboarding_specialist' ? 'Onboarding Specialist'
              : profile?.role === 'account_manager' ? 'Account Manager'
              : 'Sales Rep · own accounts'}
          </div>
          <button onClick={signOut}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-white/60 hover:bg-white/5 hover:text-white">
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        </div>
      </aside>

      <div className="fixed inset-x-0 top-0 z-40 flex items-center justify-between bg-[hsl(var(--trophi-ink))] px-4 py-3 md:hidden">
        <TrophiMark />
        <nav className="flex gap-1">
          {NAV.slice(0, 3).map(({ to, icon: Icon, label }) => (
            <Link key={to} to={to} aria-label={label}
              className={`rounded-lg p-2 ${pathname.startsWith(to) ? 'bg-white/10 text-white' : 'text-white/60'}`}>
              <Icon className="h-5 w-5" />
            </Link>
          ))}
        </nav>
      </div>

      <main className="flex-1 px-5 pb-10 pt-20 md:ml-60 md:px-10 md:pt-8">
        <div className="mx-auto max-w-7xl"><Outlet /></div>
      </main>
    </div>
  );
}
