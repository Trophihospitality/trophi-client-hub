import { createFileRoute } from '@tanstack/react-router'
import { sendTemplateEmail } from '@/lib/email-templates/send-email'

// Onboarding reminder engine. Called by pg_cron hourly.
// - Skips weekends (Sat/Sun) entirely.
// - Client reminder to POC: step (actor='client') in_progress >= 48 business hours, once.
// - Owner escalation: same step >= 72 business hours, repeats every 72 business hours.
// - Unassigned reminders for Steps 6/13: >= 24 business hours, daily.

const PORTAL_BASE_URL =
  process.env.PORTAL_BASE_URL || 'https://portal.trophihospitality.com'

async function businessHoursSince(supabase: any, ts: string): Promise<number> {
  const { data, error } = await supabase.rpc('business_hours_since', { _ts: ts })
  if (error) {
    // Fallback: naive calendar hours if function signature differs
    return (Date.now() - new Date(ts).getTime()) / (1000 * 60 * 60)
  }
  return Number(data) || 0
}

export const Route = createFileRoute('/api/public/hooks/onboarding-reminders')({
  server: {
    handlers: {
      POST: async () => {
        const { supabaseAdmin } = await import(
          '@/integrations/supabase/client.server'
        )

        // Skip on weekends (Sat=6, Sun=0)
        const now = new Date()
        const dow = now.getUTCDay()
        if (dow === 0 || dow === 6) {
          return Response.json({ ok: true, skipped: 'weekend' })
        }

        const summary = {
          client_reminders: 0,
          owner_escalations: 0,
          unassigned_reminders: 0,
          errors: [] as string[],
        }

        // --- Load step defs ---
        const { data: stepDefs } = await supabaseAdmin
          .from('onboarding_step_definitions')
          .select('step_number, name, actor')
        const stepByNum = new Map<number, { name: string; actor: string }>(
          (stepDefs || []).map((s: any) => [
            s.step_number,
            { name: s.name, actor: s.actor },
          ]),
        )

        // --- Load active in-progress steps ---
        const { data: progress } = await supabaseAdmin
          .from('onboarding_step_progress')
          .select('business_id, step_number, started_at, status')
          .eq('status', 'in_progress')

        // --- Load onboarding records (need owner via client) ---
        const bizIds = Array.from(
          new Set([...(progress || []).map((p: any) => p.business_id)]),
        )

        const clientsById = new Map<string, any>()
        const profilesById = new Map<string, any>()
        if (bizIds.length) {
          const { data: clients } = await supabaseAdmin
            .from('clients')
            .select(
              'business_id, company, contact_name, contact_email, sales_person_id',
            )
            .in('business_id', bizIds)
          for (const c of clients || []) clientsById.set(c.business_id, c)

          const ownerIds = Array.from(
            new Set(
              (clients || [])
                .map((c: any) => c.sales_person_id)
                .filter(Boolean),
            ),
          )
          if (ownerIds.length) {
            const { data: profs } = await supabaseAdmin
              .from('profiles')
              .select('user_id, name, email')
              .in('user_id', ownerIds)
            for (const p of profs || []) profilesById.set(p.user_id, p)
          }
        }

        async function lastSentAt(
          business_id: string,
          kind: string,
          step_number: number | null,
        ): Promise<string | null> {
          const q = supabaseAdmin
            .from('onboarding_notifications')
            .select('sent_at')
            .eq('business_id', business_id)
            .eq('kind', kind)
            .order('sent_at', { ascending: false })
            .limit(1)
          const { data } = step_number == null
            ? await q.is('step_number', null)
            : await q.eq('step_number', step_number)
          return data && data[0] ? data[0].sent_at : null
        }

        async function logSent(
          business_id: string,
          kind: string,
          step_number: number | null,
          recipient: string,
        ) {
          await supabaseAdmin.from('onboarding_notifications').insert({
            business_id,
            kind,
            step_number,
            recipient,
          })
          await supabaseAdmin.from('client_activity').insert({
            business_id,
            type: 'email_sent',
            description: `Email sent (${kind})${step_number ? ` for Step ${step_number}` : ''} to ${recipient}`,
            actor: 'system',
          })
        }

        // --- Iterate in-progress steps ---
        for (const step of progress || []) {
          const def = stepByNum.get(step.step_number)
          const client = clientsById.get(step.business_id)
          if (!def || !client || !step.started_at) continue

          const hoursInStep = await businessHoursSince(
            supabaseAdmin,
            step.started_at,
          )

          // ---- Client reminder (48h, once) ----
          if (def.actor === 'client' && hoursInStep >= 48 && client.contact_email) {
            const prior = await lastSentAt(
              step.business_id,
              'client_reminder',
              step.step_number,
            )
            if (!prior) {
              try {
                const res = await sendTemplateEmail(
                  'onboarding-client-reminder',
                  client.contact_email,
                  {
                    idempotencyKey: `client-reminder-${step.business_id}-${step.step_number}`,
                    templateData: {
                      contactName: client.contact_name,
                      companyName: client.company,
                      stepNumber: step.step_number,
                      stepName: def.name,
                      portalUrl: `${PORTAL_BASE_URL}/portal/onboarding`,
                    },
                  },
                )
                if (res.sent) {
                  await logSent(
                    step.business_id,
                    'client_reminder',
                    step.step_number,
                    client.contact_email,
                  )
                  summary.client_reminders++
                }
              } catch (e: any) {
                summary.errors.push(`client_reminder ${step.business_id}: ${e?.message || e}`)
              }
            }
          }

          // ---- Owner escalation (72h, every 72h) ----
          if (def.actor === 'client' && hoursInStep >= 72) {
            const owner = profilesById.get(client.sales_person_id)
            if (owner?.email) {
              const prior = await lastSentAt(
                step.business_id,
                'owner_escalation',
                step.step_number,
              )
              const dueAgain =
                !prior ||
                (await businessHoursSince(supabaseAdmin, prior)) >= 72
              if (dueAgain) {
                try {
                  const res = await sendTemplateEmail(
                    'onboarding-owner-escalation',
                    owner.email,
                    {
                      idempotencyKey: `owner-escalation-${step.business_id}-${step.step_number}-${new Date().toISOString().slice(0, 10)}`,
                      templateData: {
                        ownerName: owner.name,
                        companyName: client.company,
                        contactName: client.contact_name,
                        stepNumber: step.step_number,
                        stepName: def.name,
                        detailUrl: `${PORTAL_BASE_URL}/onboarding/${step.business_id}`,
                      },
                    },
                  )
                  if (res.sent) {
                    await logSent(
                      step.business_id,
                      'owner_escalation',
                      step.step_number,
                      owner.email,
                    )
                    summary.owner_escalations++
                  }
                } catch (e: any) {
                  summary.errors.push(`owner_escalation ${step.business_id}: ${e?.message || e}`)
                }
              }
            }
          }

          // ---- Unassigned Step 6/13 (24h, daily) ----
          if (step.step_number === 6 || step.step_number === 13) {
            const { data: rec } = await supabaseAdmin
              .from('onboarding_records')
              .select('specialist_id, account_manager_id')
              .eq('business_id', step.business_id)
              .maybeSingle()
            const missing =
              (step.step_number === 6 && !rec?.specialist_id) ||
              (step.step_number === 13 && !rec?.account_manager_id)
            if (missing && hoursInStep >= 24) {
              const owner = profilesById.get(client.sales_person_id)
              if (owner?.email) {
                const prior = await lastSentAt(
                  step.business_id,
                  'unassigned_reminder',
                  step.step_number,
                )
                const dueAgain =
                  !prior ||
                  (await businessHoursSince(supabaseAdmin, prior)) >= 24
                if (dueAgain) {
                  try {
                    const res = await sendTemplateEmail(
                      'onboarding-unassigned-reminder',
                      owner.email,
                      {
                        idempotencyKey: `unassigned-${step.business_id}-${step.step_number}-${new Date().toISOString().slice(0, 10)}`,
                        templateData: {
                          ownerName: owner.name,
                          companyName: client.company,
                          stepNumber: step.step_number,
                          roleLabel:
                            step.step_number === 6
                              ? 'Onboarding Specialist'
                              : 'Account Manager',
                          detailUrl: `${PORTAL_BASE_URL}/onboarding/${step.business_id}`,
                        },
                      },
                    )
                    if (res.sent) {
                      await logSent(
                        step.business_id,
                        'unassigned_reminder',
                        step.step_number,
                        owner.email,
                      )
                      summary.unassigned_reminders++
                    }
                  } catch (e: any) {
                    summary.errors.push(`unassigned ${step.business_id}: ${e?.message || e}`)
                  }
                }
              }
            }
          }
        }

        return Response.json({ ok: true, summary })
      },
    },
  },
})
