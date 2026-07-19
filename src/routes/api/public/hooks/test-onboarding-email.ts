import { createFileRoute } from '@tanstack/react-router'
import { sendTemplateEmail } from '@/lib/email-templates/send-email'

// One-shot test endpoint: sends the client reminder template to Spiro with sample data.
// Kept as a public route for easy triggering; safe because it's hardcoded to a single
// recipient/template.
export const Route = createFileRoute('/api/public/hooks/test-onboarding-email')({
  server: {
    handlers: {
      POST: async () => {
        try {
          const res = await sendTemplateEmail(
            'onboarding-client-reminder',
            'Spiro@TrophiHospitality.com',
            {
              idempotencyKey: `test-${Date.now()}`,
              templateData: {
                contactName: 'Spiro',
                companyName: "Darla's Sweet Treats",
                stepNumber: 4,
                stepName: 'Sign Contract & Authorization',
                portalUrl: 'https://portal.trophihospitality.com/portal/onboarding',
              },
            },
          )
          return Response.json({ ok: true, result: res })
        } catch (e: any) {
          return Response.json(
            {
              ok: false,
              error: e?.message || String(e),
              code: e?.code,
              status: e?.status,
            },
            { status: 500 },
          )
        }
      },
    },
  },
})
