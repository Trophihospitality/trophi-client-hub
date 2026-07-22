import { createFileRoute } from '@tanstack/react-router';
import { createHmac, timingSafeEqual } from 'crypto';

// ============================================================
// PandaDoc webhook receiver.
// Registered in the PandaDoc dashboard as a "Shared key" webhook.
// PandaDoc signs the raw request body with HMAC-SHA256 using the
// key we configured, and sends the hex digest as ?signature=...
// Payload is an array of events.
// ============================================================

const BUNDLE_KINDS = ['msa', 'order_form', 'client_authorization'] as const;

function verifySignature(rawBody: string, signature: string | null, secret: string): boolean {
  if (!signature) return false;
  try {
    const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
    const a = Buffer.from(signature, 'hex');
    const b = Buffer.from(expected, 'hex');
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

async function handleEvent(supabaseAdmin: any, ev: any) {
  const data = ev?.data;
  const docId: string | undefined = data?.id;
  if (!docId) return;

  const status: string = data?.status ?? '';
  const businessId: string | undefined = data?.metadata?.business_id;
  const kind: string | undefined = data?.metadata?.kind;

  // Match by pandadoc_document_id first (authoritative), fall back to metadata.
  const { data: rows } = await supabaseAdmin
    .from('client_contracts')
    .select('id, business_id, kind, status, metadata, location_ids, signed_pdf_path')
    .eq('pandadoc_document_id', docId)
    .limit(1);
  const row = rows?.[0]
    ?? (businessId && kind
      ? (await supabaseAdmin.from('client_contracts')
          .select('id, business_id, kind, status, metadata, location_ids, signed_pdf_path')
          .eq('business_id', businessId).eq('kind', kind).limit(1)).data?.[0]
      : null);

  if (!row) {
    console.warn(`[pandadoc webhook] no client_contracts row for ${docId} (bid=${businessId}, kind=${kind})`);
    return;
  }

  await supabaseAdmin.from('client_contracts').update({
    status,
    pandadoc_document_id: docId,
    updated_at: new Date().toISOString(),
  }).eq('id', row.id);

  await supabaseAdmin.from('client_activity').insert({
    business_id: row.business_id,
    type: 'info_updated',
    description: `Contract "${row.kind}" → ${status}`,
    actor: 'PandaDoc',
  });

  // Archive the signed PDF into the contracts storage bucket, stamp
  // executed_at / location_ids / signed_pdf_path on the row.
  if (status === 'document.completed') {
    try {
      const { archiveCompletedContract } = await import('@/lib/contract-archive.server');
      await archiveCompletedContract({
        id: row.id, business_id: row.business_id, kind: row.kind,
        pandadoc_document_id: docId,
        signed_pdf_path: (row as any).signed_pdf_path ?? null,
        metadata: (row as any).metadata ?? {},
        location_ids: (row as any).location_ids ?? null,
      });
    } catch (err) {
      console.error(`[pandadoc webhook] archive failed for ${docId}:`, err);
    }
  }


  // Auto-advance onboarding step 4 (bundle) or step 5 (payment auth)
  // when the corresponding document(s) reach document.completed.
  if (status !== 'document.completed') return;

  if (row.kind === 'payment_authorization') {
    await autoCompleteOnboardingStep(supabaseAdmin, row.business_id, 5, 6, {
      description: 'Onboarding step 5 auto-completed by PandaDoc: Payment Authorization fully signed',
    });
    return;
  }

  if (!(BUNDLE_KINDS as readonly string[]).includes(row.kind)) return;

  const { data: all } = await supabaseAdmin
    .from('client_contracts')
    .select('kind, status')
    .eq('business_id', row.business_id)
    .in('kind', BUNDLE_KINDS);
  const complete = new Set((all ?? []).filter((r: any) => r.status === 'document.completed').map((r: any) => r.kind));
  const allDone = BUNDLE_KINDS.every((k) => complete.has(k));
  if (!allDone) return;

  await autoCompleteOnboardingStep(supabaseAdmin, row.business_id, 4, 5, {
    description: 'Onboarding step 4 auto-completed by PandaDoc: all three documents fully signed',
    onAdvance: async () => {
      const { data: client } = await supabaseAdmin.from('clients')
        .select('journey_status').eq('business_id', row.business_id).maybeSingle();
      if (client && client.journey_status !== 'Signed') {
        await supabaseAdmin.from('clients')
          .update({ journey_status: 'Signed' })
          .eq('business_id', row.business_id);
        await supabaseAdmin.from('client_activity').insert({
          business_id: row.business_id,
          type: 'status_change',
          description: `Status changed: ${client.journey_status} → Signed · Contract bundle fully executed (PandaDoc)`,
          actor: 'System',
        });
      }
    },
  });
}

// Small helper: mark a step complete, unlock the next step, bump
// onboarding_records.current_step, log activity. Idempotent — no-ops
// if the step is already complete.
async function autoCompleteOnboardingStep(
  supabaseAdmin: any,
  businessId: string,
  stepNumber: number,
  nextStepNumber: number | null,
  opts: { description: string; onAdvance?: () => Promise<void> },
) {
  const { data: prog } = await supabaseAdmin
    .from('onboarding_step_progress').select('id, status')
    .eq('business_id', businessId).eq('step_number', stepNumber).maybeSingle();
  if (!prog || prog.status === 'complete') return;

  const now = new Date().toISOString();
  await supabaseAdmin.from('onboarding_step_progress').update({
    status: 'complete', completed_at: now,
  }).eq('id', prog.id);

  if (nextStepNumber != null) {
    const { data: next } = await supabaseAdmin
      .from('onboarding_step_progress').select('id, status')
      .eq('business_id', businessId).eq('step_number', nextStepNumber).maybeSingle();
    if (next && next.status === 'locked') {
      await supabaseAdmin.from('onboarding_step_progress').update({
        status: 'in_progress', started_at: now,
      }).eq('id', next.id);
    }
    await supabaseAdmin.from('onboarding_records').update({ current_step: nextStepNumber })
      .eq('business_id', businessId);
  }

  if (opts.onAdvance) { try { await opts.onAdvance(); } catch (e) { console.error('[pandadoc webhook] onAdvance error', e); } }

  await supabaseAdmin.from('client_activity').insert({
    business_id: businessId, type: 'info_updated', description: opts.description, actor: 'PandaDoc',
  });
}


export const Route = createFileRoute('/api/public/hooks/pandadoc')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.PANDADOC_WEBHOOK_KEY;
        if (!secret) {
          console.error('[pandadoc webhook] PANDADOC_WEBHOOK_KEY not configured');
          return new Response('Webhook not configured', { status: 500 });
        }

        const raw = await request.text();
        const url = new URL(request.url);
        const signature = url.searchParams.get('signature');
        if (!verifySignature(raw, signature, secret)) {
          return new Response('Invalid signature', { status: 401 });
        }

        let events: any[] = [];
        try {
          const parsed = JSON.parse(raw);
          events = Array.isArray(parsed) ? parsed : [parsed];
        } catch {
          return new Response('Invalid JSON', { status: 400 });
        }

        const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
        for (const ev of events) {
          try { await handleEvent(supabaseAdmin, ev); }
          catch (err) { console.error('[pandadoc webhook] event error', err); }
        }
        return new Response('ok');
      },
    },
  },
});
