import { createFileRoute } from '@tanstack/react-router'

// One-shot: re-fires the Trophi auth invite for the new onboarding specialist
// after we wired invite-tracking + resend on the Trophi user path. Hard-coded
// to a single recipient; safe as a public endpoint. Delete after use.
const TARGET_EMAIL = 'paisanspizza@trophihospitality.com'

export const Route = createFileRoute('/api/public/hooks/reinvite-paisans')({
  server: {
    handlers: {
      POST: async () => {
        try {
          const { supabaseAdmin } = await import('@/integrations/supabase/client.server')
          const { ACCEPT_INVITE_URL } = await import('@/lib/app-urls')

          // Find current auth user (if any).
          let existingId: string | null = null
          let page = 1
          while (page < 10) {
            const { data } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 200 })
            const users = data?.users ?? []
            const hit = users.find((u: any) => u.email?.toLowerCase() === TARGET_EMAIL.toLowerCase())
            if (hit) { existingId = hit.id; break }
            if (users.length < 200) break
            page += 1
          }

          let method = 'inviteUserByEmail'
          let result: any
          if (existingId) {
            method = 'generateLink(invite)'
            const { data, error } = await supabaseAdmin.auth.admin.generateLink({
              type: 'invite',
              email: TARGET_EMAIL,
              options: { redirectTo: ACCEPT_INVITE_URL },
            } as any)
            if (error) throw error
            result = { action_link_present: !!(data as any)?.properties?.action_link }
          } else {
            const { data, error } = await supabaseAdmin.auth.admin.inviteUserByEmail(TARGET_EMAIL, {
              redirectTo: ACCEPT_INVITE_URL,
            })
            if (error) throw error
            result = { user_id: data.user?.id }
          }

          // Stamp profile invited_at so UI reflects the resend.
          const now = new Date().toISOString()
          await supabaseAdmin.from('profiles')
            .update({ invited_at: now, invite_last_attempt_at: now, invite_last_error: null } as any)
            .eq('email', TARGET_EMAIL)

          return Response.json({ ok: true, method, existingId, result })
        } catch (e: any) {
          return Response.json({ ok: false, error: e?.message || String(e), code: e?.code, status: e?.status }, { status: 500 })
        }
      },
    },
  },
})
