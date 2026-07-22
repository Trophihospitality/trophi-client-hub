import { createFileRoute } from '@tanstack/react-router';

// ============================================================
// One-off backfill: fetch completed PandaDoc PDFs for a business
// and archive them into the `contracts` bucket. Two ways to auth:
//   1. Header: x-lovable-secret: <PANDADOC_WEBHOOK_KEY>
//      (for automation / this app's own scripts)
//   2. Header: Authorization: Bearer <Supabase user JWT> for a
//      signed-in Trophi admin or manager (used from the app UI).
// POST /api/public/hooks/backfill-contracts
//   Body: { "business_id": "TRP-U8RZKR" }
// ============================================================

async function isAdminOrManager(bearer: string): Promise<boolean> {
  const url = process.env.SUPABASE_URL;
  const pk = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !pk) return false;
  try {
    const { createClient } = await import('@supabase/supabase-js');
    const cli = createClient(url, pk, {
      global: { headers: { Authorization: `Bearer ${bearer}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: user } = await cli.auth.getUser(bearer);
    if (!user?.user?.id) return false;
    const uid = user.user.id;
    const [{ data: a }, { data: m }] = await Promise.all([
      cli.rpc('has_role', { _user_id: uid, _role: 'admin' }),
      cli.rpc('has_role', { _user_id: uid, _role: 'manager' }),
    ]);
    return !!a || !!m;
  } catch {
    return false;
  }
}

export const Route = createFileRoute('/api/public/hooks/backfill-contracts')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.PANDADOC_WEBHOOK_KEY;
        const provided = request.headers.get('x-lovable-secret');
        const auth = request.headers.get('authorization');
        const bearer = auth?.startsWith('Bearer ') ? auth.slice(7) : null;

        let ok = false;
        if (secret && provided && provided === secret) ok = true;
        else if (bearer && (await isAdminOrManager(bearer))) ok = true;
        if (!ok) return new Response('unauthorized', { status: 401 });

        let body: any = {};
        try { body = await request.json(); } catch { /* empty */ }
        const businessId = String(body.business_id ?? '').trim();
        if (!businessId) return new Response('business_id required', { status: 400 });

        const { archiveAllCompletedForBusiness } = await import('@/lib/contract-archive.server');
        try {
          const result = await archiveAllCompletedForBusiness(businessId);
          return new Response(JSON.stringify({ ok: true, businessId, result }, null, 2), {
            status: 200, headers: { 'content-type': 'application/json' },
          });
        } catch (err: any) {
          return new Response(JSON.stringify({ ok: false, error: String(err?.message ?? err) }), {
            status: 500, headers: { 'content-type': 'application/json' },
          });
        }
      },
    },
  },
});
