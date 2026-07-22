import * as React from 'react'
import { render } from '@react-email/render'
import { sendLovableEmail } from '@lovable.dev/email-js'
import { createFileRoute } from '@tanstack/react-router'
import { InviteEmail } from '@/lib/email-templates/invite'

// One-shot: re-fires the Trophi auth invite for the new onboarding specialist.
// Mints a fresh invite link via admin.generateLink and delivers our branded
// invite template through Lovable's email API. Safe as a public endpoint;
// hard-coded recipient. Delete after use.
const TARGET_EMAIL = 'paisanspizza@trophihospitality.com'
const SITE_NAME = 'Trophi Client Hub'
const SENDER_DOMAIN = 'notify.trophihospitality.com'
const FROM_DOMAIN = 'trophihospitality.com'
const SITE_URL = `https://${FROM_DOMAIN}`

export const Route = createFileRoute('/api/public/hooks/reinvite-paisans')({
  server: {
    handlers: {
      POST: async () => {
        try {
          const { supabaseAdmin } = await import('@/integrations/supabase/client.server')
          const { ACCEPT_INVITE_URL } = await import('@/lib/app-urls')

          const { data, error } = await supabaseAdmin.auth.admin.generateLink({
            type: 'invite',
            email: TARGET_EMAIL,
            options: { redirectTo: ACCEPT_INVITE_URL },
          } as any)
          if (error) throw error
          const props: any = (data as any)?.properties ?? {}
          const token = props.hashed_token ?? props.email_otp ?? ''
          const acceptUrl = `${SITE_URL === 'https://trophihospitality.com' ? 'https://trophi-client-hub.lovable.app' : SITE_URL}/accept-invite`
            + `?token=${encodeURIComponent(token)}`
            + `&email=${encodeURIComponent(TARGET_EMAIL)}`
            + `&type=invite`

          const element = React.createElement(InviteEmail, {
            siteName: SITE_NAME,
            siteUrl: SITE_URL,
            confirmationUrl: acceptUrl,
          })
          const html = await render(element)
          const text = await render(element, { plainText: true })

          await sendLovableEmail(
            {
              to: TARGET_EMAIL,
              from: `${SITE_NAME} <noreply@${FROM_DOMAIN}>`,
              sender_domain: SENDER_DOMAIN,
              subject: "You've been invited",
              html,
              text,
              purpose: 'transactional',
              label: 'trophi_user.invite_resend',
              idempotency_key: `trophi-reinvite-${TARGET_EMAIL}-${Date.now()}`,
            },
            { apiKey: process.env.LOVABLE_API_KEY!, sendUrl: process.env.LOVABLE_SEND_URL },
          )

          const now = new Date().toISOString()
          await supabaseAdmin.from('profiles')
            .update({ invited_at: now, invite_last_attempt_at: now, invite_last_error: null } as any)
            .eq('email', TARGET_EMAIL)

          return Response.json({ ok: true, sentTo: TARGET_EMAIL, tokenPresent: !!token })
        } catch (e: any) {
          return Response.json({ ok: false, error: e?.message || String(e), code: e?.code, status: e?.status }, { status: 500 })
        }
      },
    },
  },
})
