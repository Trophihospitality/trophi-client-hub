import { NavLink, Outlet } from 'react-router-dom';
import { Users, ClipboardCheck, BarChart3, Wrench, Globe } from 'lucide-react';
import trophiMark from '@/assets/trophi-mark.png';
import { useUser } from '@/store/userStore';
import { SALES_TEAM } from '@/data/seedData';       // gold "H" trophy mark (dark backgrounds)
// trophi-wordmark.png (full logo) is also in /src/assets for light backgrounds,
// e.g. login screens, client-facing portal headers, PDF exports.

// ============================================================
// APP SHELL — dark ink sidebar + light content area
// Uses official Trophi brand assets from /src/assets
// ============================================================

function TrophiMark() {
  return (
    <div className="flex items-center gap-2.5 px-2">
      <img src={trophiMark} alt="Trophi Hospitality mark" className="h-10 w-10 object-contain" />
      <div className="leading-tight">
        <div
          className="font-display font-semibold text-[15px]"
          style={{
            letterSpacing: '0.06em',
            background: 'linear-gradient(90deg, hsl(var(--trophi-gold)) 0%, hsl(var(--trophi-gold-light)) 100%)',
            WebkitBackgroundClip: 'text',
            backgroundClip: 'text',
            color: 'transparent',
          }}
        >
          TROPHI
        </div>
        <div className="text-[10px] uppercase tracking-[0.22em] text-white/50 font-display font-light">
          Hospitality
        </div>
      </div>
    </div>
  );
}

const NAV = [
  { to: '/crm', label: 'CRM', icon: Users },
  { to: '/onboarding', label: 'Onboarding', icon: ClipboardCheck },
  { to: '/accounts', label: 'Account Management', icon: BarChart3 },
  { to: '/support', label: 'Tech / Support', icon: Wrench },
  { to: '/client-portal', label: 'Client Portal', icon: Globe },
];

export default function AppShell() {
  const { currentUser, setCurrentUserId } = useUser();
  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 flex-col bg-[hsl(var(--trophi-ink))] md:flex">
        <div className="py-6">
          <TrophiMark />
        </div>
        <nav className="flex-1 space-y-1 px-3">
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${
                  isActive
                    ? 'bg-white/10 text-white font-medium border-l-2 border-[hsl(var(--trophi-gold))]'
                    : 'text-white/60 hover:bg-white/5 hover:text-white'
                }`
              }
            >
              <Icon className="h-4 w-4" />
              {label}
            </NavLink>
          ))}
        </nav>
        {/* Demo user switcher — replace with real auth (Supabase) later */}
        <div className="border-t border-white/10 px-3 py-3 space-y-2">
          <div className="px-2 text-[10px] uppercase tracking-wider text-white/40">Signed in as</div>
          <select
            value={currentUser.id}
            onChange={(e) => setCurrentUserId(e.target.value)}
            className="w-full rounded-lg border border-white/10 bg-white/5 px-2.5 py-2 text-sm text-white outline-none focus:border-[hsl(var(--trophi-gold))]"
            aria-label="Switch demo user"
          >
            {SALES_TEAM.map((sp) => (
              <option key={sp.id} value={sp.id} className="text-black">
                {sp.name} — {sp.role === 'manager' ? 'Manager' : 'Sales Rep'}
              </option>
            ))}
          </select>
          <div className="px-2 text-[11px] text-white/35">
            {currentUser.role === 'manager' ? 'Sees all accounts' : 'Sees own accounts only'} · v0.2
          </div>
        </div>
      </aside>

      {/* Mobile top bar */}
      <div className="fixed inset-x-0 top-0 z-40 flex items-center justify-between bg-[hsl(var(--trophi-ink))] px-4 py-3 md:hidden">
        <TrophiMark />
        <nav className="flex gap-1">
          {NAV.slice(0, 3).map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              aria-label={label}
              className={({ isActive }) =>
                `rounded-lg p-2 ${isActive ? 'bg-white/10 text-white' : 'text-white/60'}`
              }
            >
              <Icon className="h-5 w-5" />
            </NavLink>
          ))}
        </nav>
      </div>

      {/* Content */}
      <main className="flex-1 px-5 pb-10 pt-20 md:ml-60 md:px-10 md:pt-8">
        <div className="mx-auto max-w-7xl">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
