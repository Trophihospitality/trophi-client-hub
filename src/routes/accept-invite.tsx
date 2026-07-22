import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import trophiMarkAsset from '@/assets/trophi-mark.png.asset.json';
const trophiMark = trophiMarkAsset.url;
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { PasswordInput } from '@/components/ui/password-input';
import { toast } from 'sonner';

export const Route = createFileRoute('/accept-invite')({
  ssr: false,
  component: AcceptInvitePage,
});

type Ctx = {
  email: string;
  name: string | null;
  company: string | null;
} | null;

function AcceptInvitePage() {
  const [ready, setReady] = useState(false);
  const [ctx, setCtx] = useState<Ctx>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  const [tokenError, setTokenError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      // Supabase JS auto-processes the URL hash and sets the session.
      // Wait briefly for that, then confirm session + fetch context.
      await new Promise((r) => setTimeout(r, 50));
      const { data: sess } = await supabase.auth.getSession();
      if (!sess.session) {
        // Try one more time after another tick — hash processing can be async.
        await new Promise((r) => setTimeout(r, 300));
        const { data: sess2 } = await supabase.auth.getSession();
        if (!sess2.session) {
          if (!cancelled) {
            setTokenError('This invite link is invalid or has expired. Ask your Trophi contact to resend it.');
            setReady(true);
          }
          return;
        }
      }
      const { data: userData } = await supabase.auth.getUser();
      const user = userData.user;
      if (!user) {
        if (!cancelled) { setTokenError('Could not load your invite.'); setReady(true); }
        return;
      }
      // Look up client_users row for name + company
      const { data: cu } = await supabase
        .from('client_users')
        .select('first_name, last_name, business_id, clients:business_id(company)')
        .eq('email', user.email!)
        .maybeSingle();
      if (cancelled) return;
      setCtx({
        email: user.email ?? '',
        name: cu ? `${cu.first_name} ${cu.last_name}`.trim() : (user.user_metadata?.name ?? null),
        company: (cu?.clients as any)?.company ?? null,
      });
      setReady(true);
      // Clean the hash so tokens are not left in the URL bar
      if (window.location.hash) {
        history.replaceState(null, '', window.location.pathname + window.location.search);
      }
    };
    load();
    return () => { cancelled = true; };
  }, []);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) { toast.error('Password must be at least 8 characters'); return; }
    if (password !== confirm) { toast.error('Passwords do not match'); return; }
    setSaving(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      toast.success('Password set. Welcome!');
      window.location.href = '/client-portal';
    } catch (err: any) {
      toast.error(err.message ?? 'Could not set password');
    } finally {
      setSaving(false);
    }
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

        {!ready ? (
          <p className="text-center text-sm text-muted-foreground">Verifying your invite…</p>
        ) : tokenError ? (
          <div className="text-center space-y-3">
            <h1 className="font-display text-lg font-semibold">Invite link problem</h1>
            <p className="text-sm text-muted-foreground">{tokenError}</p>
            <Button asChild variant="outline" className="w-full"><a href="/auth">Back to sign in</a></Button>
          </div>
        ) : (
          <>
            <h1 className="text-center font-display text-lg font-semibold mb-1">Accept your invitation</h1>
            <p className="text-center text-sm text-muted-foreground mb-6">
              {ctx?.name ? <><strong>{ctx.name}</strong>, y</> : 'Y'}ou're joining{' '}
              <strong>{ctx?.company ?? 'the Trophi portal'}</strong>. Set a password to finish creating your account.
            </p>
            <div className="mb-4 rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
              Signed in as <strong className="text-foreground">{ctx?.email}</strong>
            </div>
            <form onSubmit={onSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="password">Create password</Label>
                <PasswordInput id="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="confirm">Confirm password</Label>
                <PasswordInput id="confirm" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required minLength={8} />
              </div>
              <Button type="submit" disabled={saving} className="w-full bg-[hsl(var(--trophi-ink))] hover:bg-[hsl(var(--trophi-ink))]/90">
                {saving ? '…' : 'Set password & continue'}
              </Button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
