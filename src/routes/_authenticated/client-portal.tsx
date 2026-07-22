import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/store/userStore';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, Clock, Lock, Circle } from 'lucide-react';

export const Route = createFileRoute('/_authenticated/client-portal')({
  ssr: false,
  head: () => ({ meta: [
    { title: 'Client Portal · Trophi' },
    { name: 'description', content: 'Your onboarding progress with Trophi Hospitality.' },
  ]}),
  component: ClientPortalPage,
});

function ClientPortalPage() {
  const { client, isClient, loading } = useAuth();

  const { data, isLoading } = useQuery({
    enabled: !!client?.businessId,
    queryKey: ['client-portal', client?.businessId],
    queryFn: async () => {
      const bid = client!.businessId;
      const [record, defs, progress] = await Promise.all([
        supabase.from('onboarding_records').select('current_step, status').eq('business_id', bid).maybeSingle(),
        supabase.from('onboarding_step_definitions').select('step_number, title, description, client_visible').eq('client_visible', true).order('step_number'),
        supabase.from('onboarding_step_progress').select('step_number, status, completed_at').eq('business_id', bid),
      ]);
      return {
        record: record.data,
        defs: defs.data ?? [],
        progress: Object.fromEntries((progress.data ?? []).map((r: any) => [r.step_number, r])),
      };
    },
  });

  if (loading || isLoading) {
    return <div className="p-6 text-sm text-muted-foreground">Loading your portal…</div>;
  }

  if (!isClient || !client) {
    return <div className="p-6 text-sm text-muted-foreground">No client portal access on this account.</div>;
  }

  const firstName = client.firstName || 'there';
  const currentStep = data?.record?.current_step;

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Welcome, {firstName}</h1>
        {client.company && (
          <p className="mt-1 text-sm text-muted-foreground">{client.company} · Onboarding in progress</p>
        )}
      </header>

      <Card className="p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-medium">Your onboarding</h2>
          {currentStep != null && (
            <Badge variant="secondary">Currently on step {currentStep}</Badge>
          )}
        </div>

        {(!data?.defs.length) && (
          <p className="text-sm text-muted-foreground">
            Your onboarding hasn't started yet. Your Trophi team will be in touch shortly.
          </p>
        )}

        <ol className="space-y-3">
          {data?.defs.map((d: any) => {
            const p = data.progress[d.step_number];
            const status = p?.status ?? 'locked';
            const isCurrent = status === 'in_progress';
            const isDone = status === 'completed';
            return (
              <li
                key={d.step_number}
                className={`rounded-xl border p-4 transition-colors ${
                  isCurrent ? 'border-[hsl(var(--trophi-gold))] bg-[hsl(var(--trophi-gold))]/5' : 'border-border'
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className="mt-0.5">
                    {isDone ? <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                      : isCurrent ? <Clock className="h-5 w-5 text-[hsl(var(--trophi-gold))]" />
                      : status === 'locked' ? <Lock className="h-4 w-4 text-muted-foreground" />
                      : <Circle className="h-5 w-5 text-muted-foreground" />}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs uppercase tracking-wider text-muted-foreground">Step {d.step_number}</span>
                      {isCurrent && <Badge className="bg-[hsl(var(--trophi-gold))] text-black">Action needed</Badge>}
                      {isDone && <Badge variant="secondary">Completed</Badge>}
                    </div>
                    <div className="mt-1 font-medium">{d.title}</div>
                    {d.description && (
                      <p className="mt-1 text-sm text-muted-foreground">{d.description}</p>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      </Card>
    </div>
  );
}
