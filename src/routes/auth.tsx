import { createFileRoute, redirect } from '@tanstack/react-router';
import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { lovable } from '@/integrations/lovable/index';
import trophiMarkAsset from '@/assets/trophi-mark.png.asset.json';
const trophiMark = trophiMarkAsset.url;
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';

export const Route = createFileRoute('/auth')({
  ssr: false,
  beforeLoad: async () => {
    const { data } = await supabase.auth.getSession();
    if (data.session) throw redirect({ to: '/crm' });
  },
  component: AuthPage,
});

function AuthPage() {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === 'signup') {
        const { error } = await supabase.auth.signUp({
          email, password,
          options: { emailRedirectTo: window.location.origin + '/crm', data: { name } },
        });
        if (error) throw error;
        toast.success('Account created. Signed in.');
        window.location.href = '/crm';
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        window.location.href = '/crm';
      }
    } catch (err: any) {
      toast.error(err.message ?? 'Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  const onGoogle = async () => {
    const result = await lovable.auth.signInWithOAuth('google', { redirect_uri: window.location.origin });
    if (result.error) { toast.error(result.error.message ?? 'Google sign-in failed'); return; }
    if (result.redirected) return;
    window.location.href = '/crm';
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[hsl(var(--trophi-ink))] p-6">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-2xl">
        <div className="flex flex-col items-center gap-3 mb-6">
          <img src={trophiMark} alt="Trophi" className="h-16 w-16 object-contain" />
          <div className="text-center">
            <div className="text-gold-gradient font-display font-semibold text-xl tracking-widest">TROPHI</div>
            <div className="text-[10px] uppercase tracking-[0.24em] text-muted-foreground font-display">Hospitality</div>
          </div>
          <div className="gold-rule w-16 rounded" />
        </div>
        <h1 className="text-center font-display text-lg font-semibold mb-1">
          {mode === 'signin' ? 'Sign in to the portal' : 'Create your portal account'}
        </h1>
        <p className="text-center text-sm text-muted-foreground mb-6">Internal use — Trophi team</p>
        <form onSubmit={onSubmit} className="space-y-4">
          {mode === 'signup' && (
            <div className="space-y-1.5">
              <Label htmlFor="name">Full name</Label>
              <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">Password</Label>
            <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
          </div>
          <Button type="submit" disabled={loading} className="w-full bg-[hsl(var(--trophi-ink))] hover:bg-[hsl(var(--trophi-ink))]/90">
            {loading ? '…' : mode === 'signin' ? 'Sign in' : 'Create account'}
          </Button>
        </form>
        <div className="my-4 flex items-center gap-3 text-xs text-muted-foreground">
          <div className="h-px flex-1 bg-border" /> or <div className="h-px flex-1 bg-border" />
        </div>
        <Button type="button" variant="outline" onClick={onGoogle} className="w-full">
          Continue with Google
        </Button>
        <button
          type="button"
          onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')}
          className="mt-6 w-full text-center text-sm text-muted-foreground hover:text-foreground"
        >
          {mode === 'signin' ? "New here? Create an account" : 'Already have an account? Sign in'}
        </button>
      </div>
    </div>
  );
}
