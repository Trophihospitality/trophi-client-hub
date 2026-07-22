import { createFileRoute } from '@tanstack/react-router';

// ============================================================
// One-off backfill: fetch completed PandaDoc PDFs for a business
// and archive them into the `contracts` bucket. Guarded by the
// same shared key we already use for the PandaDoc webhook.
// POST /api/public/hooks/backfill-contracts
//   Header: x-lovable-secret: <PANDADOC_WEBHOOK_KEY>
//   Body:   { "business_id": "TRP-U8RZKR" }
// ============================================================

export const Route = createFileRoute('/api/public/hooks/backfill-contracts')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.PANDADOC_WEBHOOK_KEY;
        if (!secret) return new Response('not configured', { status: 500 });
        const provided = request.headers.get('x-lovable-secret');
        if (provided !== secret) return new Response('unauthorized', { status: 401 });

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
