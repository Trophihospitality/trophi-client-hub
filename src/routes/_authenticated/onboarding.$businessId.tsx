import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { ArrowLeft, CheckCircle2, Circle, Clock, Lock } from 'lucide-react';
import { toast } from 'sonner';
import {
  getOnboardingDetailFn, completeStepFn, assignSpecialistFn, assignAccountManagerFn,
  listSpecialistCandidatesFn, listAccountManagerCandidatesFn,
} from '@/lib/onboarding.functions';
import { useAuth } from '@/store/userStore';
import { Button } from '@/components/ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Step1ContractBundle } from '@/components/onboarding/Step1ContractBundle';
import { CountersignPanel } from '@/components/onboarding/CountersignPanel';
import { formatPhone } from '@/lib/phone';
import { listClientUsersForBusinessFn, resendClientInviteFn } from '@/lib/client-users.functions';
import { InviteStatusCell } from '@/routes/_authenticated/users.client-users';
import { RefreshCcw } from 'lucide-react';

export const Route = createFileRoute('/_authenticated/onboarding/$businessId')({
  component: OnboardingDetailPage,
});

function money(n: number | null): string {
  if (n == null) return '—';
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}
function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function OnboardingDetailPage() {
  const { businessId } = Route.useParams();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const qc = useQueryClient();

  const getDetail = useServerFn(getOnboardingDetailFn);
  const listSpec = useServerFn(listSpecialistCandidatesFn);
  const listAM = useServerFn(listAccountManagerCandidatesFn);
  const completeStep = useServerFn(completeStepFn);
  const assignSpec = useServerFn(assignSpecialistFn);
  const assignAM = useServerFn(assignAccountManagerFn);

  const { data, isLoading } = useQuery({
    queryKey: ['onboarding-detail', businessId],
    queryFn: () => getDetail({ data: { businessId } }),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['onboarding-detail', businessId] });
    qc.invalidateQueries({ queryKey: ['onboarding-list'] });
  };

  const completeMut = useMutation({
    mutationFn: (stepNumber: number) => completeStep({ data: { businessId, stepNumber } }),
    onSuccess: () => { invalidate(); toast.success('Step completed'); },
    onError: (e: any) => toast.error(e?.message ?? 'Could not complete step'),
  });

  const specCandidates = useQuery({
    queryKey: ['specialist-candidates'], queryFn: () => listSpec(),
    enabled: !!data && data.currentStep >= 6 && !data.specialistId,
  });
  const amCandidates = useQuery({
    queryKey: ['am-candidates'], queryFn: () => listAM(),
    enabled: !!data && data.currentStep >= 13 && !data.accountManagerId,
  });

  const assignSpecMut = useMutation({
    mutationFn: (userId: string) => assignSpec({ data: { businessId, userId } }),
    onSuccess: () => { invalidate(); toast.success('Specialist assigned'); },
    onError: (e: any) => toast.error(e?.message ?? 'Could not assign specialist'),
  });
  const assignAMMut = useMutation({
    mutationFn: (userId: string) => assignAM({ data: { businessId, userId } }),
    onSuccess: () => { invalidate(); toast.success('Account manager assigned'); },
    onError: (e: any) => toast.error(e?.message ?? 'Could not assign account manager'),
  });

  if (isLoading) return <div className="text-sm text-muted-foreground">Loading…</div>;
  if (!data) return <div className="text-sm text-muted-foreground">Onboarding record not found.</div>;

  const canCompleteStep = (actor: string) => {
    if (!profile) return false;
    if (profile.role === 'admin' || profile.role === 'manager') return true;
    if (actor === 'account_owner' || actor === 'system' || actor === 'client') return data.salesPersonId === profile.id;
    if (actor === 'specialist') return data.specialistId === profile.id;
    if (actor === 'account_manager') return data.accountManagerId === profile.id;
    return false;
  };

  return (
    <div className="space-y-6">
      <button onClick={() => navigate({ to: '/onboarding' })}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to onboarding
      </button>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold">{data.company}</h1>
          <div className="mt-1 font-mono text-xs text-muted-foreground">{data.businessId}</div>
          <div className="mt-2 text-sm text-muted-foreground">
            {data.brands.join(', ')} · {data.activeLocations} active location{data.activeLocations !== 1 ? 's' : ''} · {data.packageType} · {money(data.budget)}/loc/mo
          </div>
        </div>
        <div className="text-right text-sm">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Status</div>
          <div className="font-medium">{data.status === 'live' ? '🟢 Live' : `Step ${data.currentStep} of 16`}</div>
          <div className="mt-2 text-xs text-muted-foreground">Started {formatDate(data.startedAt)}</div>
        </div>
      </div>
      <div className="gold-rule w-24" />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-4">
          {data.currentStep === 1 && data.status !== 'live' && (
            <Step1ContractBundle
              businessId={data.businessId}
              canEdit={
                !!profile &&
                (profile.role === 'admin' ||
                  profile.role === 'manager' ||
                  profile.id === data.salesPersonId)
              }
            />
          )}
          <div className="rounded-xl border bg-card">
            <div className="border-b border-border px-4 py-3 text-sm font-semibold">Step checklist</div>
            <ul className="divide-y divide-border">
              {data.steps.map((s) => {
                const isAssign6 = s.stepNumber === 6 && s.status === 'in_progress' && !data.specialistId;
                const isAssign13 = s.stepNumber === 13 && s.status === 'in_progress' && !data.accountManagerId;
                const needsAssignment = isAssign6 || isAssign13;
                return (
                  <li key={s.stepNumber} className="flex items-start gap-3 px-4 py-3">
                    <div className="pt-0.5">
                      {s.status === 'complete' ? <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                        : s.status === 'in_progress' ? <Clock className="h-5 w-5 text-[hsl(var(--trophi-gold))]" />
                        : <Lock className="h-5 w-5 text-muted-foreground/50" />}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono text-muted-foreground">#{s.stepNumber}</span>
                        <span className="font-medium">{s.name}</span>
                        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                          · {s.actor.replace('_', ' ')}
                          {s.clientVisible && ' · client-visible'}
                        </span>
                      </div>
                      {s.status === 'in_progress' && s.startedAt && (
                        <div className="text-xs text-muted-foreground mt-0.5">Started {formatDate(s.startedAt)}</div>
                      )}
                      {s.status === 'complete' && s.completedAt && (
                        <div className="text-xs text-muted-foreground mt-0.5">Completed {formatDate(s.completedAt)}</div>
                      )}

                      {isAssign6 && (
                        <div className="mt-2 flex items-center gap-2">
                          <Select onValueChange={(v) => assignSpecMut.mutate(v)}>
                            <SelectTrigger className="h-8 w-72"><SelectValue placeholder="Assign onboarding specialist…" /></SelectTrigger>
                            <SelectContent>
                              {(specCandidates.data ?? []).map((c) => (
                                <SelectItem key={c.id} value={c.id}>
                                  {c.name} · {c.activeCount} active
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                      {isAssign13 && (
                        <div className="mt-2 flex items-center gap-2">
                          <Select onValueChange={(v) => assignAMMut.mutate(v)}>
                            <SelectTrigger className="h-8 w-72"><SelectValue placeholder="Assign account manager…" /></SelectTrigger>
                            <SelectContent>
                              {(amCandidates.data ?? []).map((c) => (
                                <SelectItem key={c.id} value={c.id}>
                                  {c.name} · {c.activeCount} active
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                    </div>
                    {s.status === 'in_progress' && canCompleteStep(s.actor) && !needsAssignment && (
                      <Button size="sm" onClick={() => completeMut.mutate(s.stepNumber)} disabled={completeMut.isPending}>
                        Mark complete
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-xl border bg-card p-4 text-sm">
            <div className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">Client summary</div>
            <div className="space-y-1">
              <div><span className="text-muted-foreground">Contact:</span> {data.contactName}</div>
              <div className="text-muted-foreground">{data.contactEmail}</div>
              <div className="text-muted-foreground">{formatPhone(data.contactPhone)}</div>
              <div className="pt-2"><span className="text-muted-foreground">Sales owner:</span> {data.salesPersonName}</div>
              <div><span className="text-muted-foreground">Specialist:</span> {data.specialistName ?? '—'}</div>
              <div><span className="text-muted-foreground">Account mgr:</span> {data.accountManagerName ?? '—'}</div>
            </div>
          </div>

          <PortalAccessCard businessId={data.businessId} />

          <div className="rounded-xl border bg-card">

            <div className="border-b border-border px-4 py-3 text-sm font-semibold">Activity</div>
            <ul className="divide-y divide-border max-h-96 overflow-y-auto">
              {data.activity.length === 0 && (
                <li className="px-4 py-3 text-sm text-muted-foreground">No activity yet.</li>
              )}
              {data.activity.map((a) => (
                <li key={a.id} className="px-4 py-3 text-sm">
                  <div>{a.description}</div>
                  <div className="text-xs text-muted-foreground">{a.actor} · {formatDate(a.timestamp)}</div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

function PortalAccessCard({ businessId }: { businessId: string }) {
  const qc = useQueryClient();
  const listFn = useServerFn(listClientUsersForBusinessFn);
  const resend = useServerFn(resendClientInviteFn);
  const { data: users = [], isLoading } = useQuery({
    queryKey: ['client-users-for-business', businessId],
    queryFn: () => listFn({ data: { businessId } }),
  });
  const resendM = useMutation({
    mutationFn: (id: string) => resend({ data: { id } }),
    onSuccess: (r: any) => {
      qc.invalidateQueries({ queryKey: ['client-users-for-business', businessId] });
      qc.invalidateQueries({ queryKey: ['client-users'] });
      toast.success(`Invite sent to ${r?.sentTo ?? 'user'}`);
    },
    onError: (e: any) => toast.error(e?.message ?? 'Failed'),
  });

  return (
    <div className="rounded-xl border bg-card">
      <div className="border-b border-border px-4 py-3 text-sm font-semibold flex items-center justify-between">
        <span>Client portal access <span className="text-xs font-normal text-muted-foreground">· Step 3</span></span>
      </div>
      <ul className="divide-y divide-border">
        {isLoading && <li className="px-4 py-3 text-sm text-muted-foreground">Loading…</li>}
        {!isLoading && users.length === 0 && (
          <li className="px-4 py-3 text-sm text-muted-foreground">
            No portal users yet. Add one from the Client Users admin page.
          </li>
        )}
        {users.map((u) => {
          const canResend = u.inviteStatus === 'invited' || u.inviteStatus === 'expired' || u.inviteStatus === 'never_sent' || u.inviteStatus === 'failed';
          return (
            <li key={u.id} className="px-4 py-3 text-sm">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-medium">{u.firstName} {u.lastName}</div>
                  <div className="text-xs text-muted-foreground truncate">{u.email}</div>
                  <div className="mt-1"><InviteStatusCell user={u} /></div>
                </div>
                {canResend && (
                  <button
                    onClick={() => resendM.mutate(u.id)}
                    disabled={resendM.isPending}
                    className="shrink-0 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                  >
                    <RefreshCcw className="h-3.5 w-3.5" /> {u.inviteStatus === 'never_sent' ? 'Send invite' : 'Resend'}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
