import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
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
  name: string | null;
  company: string | null;
} | null;

function AcceptInvitePage() {
  const params = useMemo(() => {
    if (typeof window === 'undefined') return { token: '', email: '', type: '' };
    const q = new URLSearchParams(window.location.search);
    // Legacy fallback: some older invites still land with tokens in the hash
    // (after GoTrue /verify redirect). We do NOT consume anything on load —
    // we just read the params for use on submit.
    const hash = window.location.hash.startsWith('#')
      ? new URLSearchParams(window.location.hash.slice(1))
      : new URLSearchParams();
    return {
      token: q.get('token') ?? '',
      tokenHash: q.get('token_hash') ?? q.get('tokenHash') ?? '',
      email: q.get('email') ?? '',
      type: q.get('type') ?? 'invite',
      hashAccessToken: hash.get('access_token') ?? '',
    };
  }, []);

  const missingToken = !params.token && !params.tokenHash && !params.hashAccessToken;

  const [ctx, setCtx] = useState<Ctx>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    // Read-only context lookup for the greeting. Does NOT consume the token.
    // Uses the email from the query param against a public-safe lookup that
    // only returns first/last name + company — no auth artifacts.
    let cancelled = false;
    (async () => {
      if (!params.email) return;
      const { data: cu } = await supabase
        .from('client_users')
        .select('first_name, last_name, business_id, clients:business_id(company)')
        .eq('email', params.email)
        .maybeSingle();
      if (cancelled) return;
      if (cu) {
        setCtx({
          name: `${cu.first_name} ${cu.last_name}`.trim(),
          company: (cu.clients as any)?.company ?? null,
        });
      }
    })();
    return () => { cancelled = true; };
  }, [params.email]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) { toast.error('Password must be at least 8 characters'); return; }
    if (password !== confirm) { toast.error('Passwords do not match'); return; }
    setSaving(true);
    try {
      // Consume the one-time token ONLY now, on user submit.
      if (params.tokenHash) {
        // Token-hash verification is strict: the auth endpoint accepts ONLY
        // token_hash + type. supabase.auth.verifyOtp appends
        // gotrue_meta_security automatically, so call /verify directly and
        // then persist the returned session ourselves.
        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
        const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
        const verifyRes = await fetch(`${supabaseUrl}/auth/v1/verify`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            apikey: supabaseKey,
          },
          body: JSON.stringify({ token_hash: params.tokenHash, type: 'invite' }),
        });
        const verifyBody = await verifyRes.json().catch(() => null);
        if (!verifyRes.ok) {
          throw new Error(
            verifyBody?.message ?? verifyBody?.error_description ?? verifyBody?.error ?? 'Invite verification failed',
          );
        }
        if (verifyBody?.access_token && verifyBody?.refresh_token) {
          const { error: sessionErr } = await supabase.auth.setSession({
            access_token: verifyBody.access_token,
            refresh_token: verifyBody.refresh_token,
          });
          if (sessionErr) throw sessionErr;
        }
      } else if (params.token && params.email) {
        // Legacy token flow: needs email + token + type.
        const { error: verifyErr } = await supabase.auth.verifyOtp({
          email: params.email,
          token: params.token,
          type: 'invite',
        } as any);
        if (verifyErr) throw verifyErr;
      } else if (!params.hashAccessToken) {
        throw new Error('Missing invite token. Ask your Trophi contact to resend the invite.');
      }
      // If hash-token path (legacy): Supabase JS already established the
      // session on load. Either way, we now have a session — set the password.
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      toast.success('Password set. Welcome!');
      // Clean any sensitive fragments before navigating
      if (window.location.hash) {
        history.replaceState(null, '', window.location.pathname);
      }
      window.location.href = ctx?.company ? '/client-portal' : '/crm';
    } catch (err: any) {
      const msg = err?.message ?? 'Could not set password';
      // Common: "Token has expired or is invalid"
      toast.error(msg);
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

        {missingToken ? (
          <div className="text-center space-y-3">
            <h1 className="font-display text-lg font-semibold">Invite link problem</h1>
            <p className="text-sm text-muted-foreground">
              This invite link is missing its token. Ask your Trophi contact to resend it.
            </p>
            <Button asChild variant="outline" className="w-full"><a href="/auth">Back to sign in</a></Button>
          </div>
        ) : (
          <>
            <h1 className="text-center font-display text-lg font-semibold mb-1">
              {ctx?.name ? `Welcome, ${ctx.name}` : 'Accept your invitation'}
            </h1>
            <p className="text-center text-sm text-muted-foreground mb-6">
              Set up your{' '}
              <strong>{ctx?.company ? `${ctx.company} account` : 'Trophi portal account'}</strong>{' '}
              by choosing a password below.
            </p>
            <div className="mb-4 rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
              Setting password for <strong className="text-foreground">{params.email || 'your account'}</strong>
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
