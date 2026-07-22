import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { toast } from 'sonner';
import { FileText, AlertCircle, CheckCircle2, ExternalLink, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getContractBundleFn, generateContractBundleFn, voidAndRegenerateContractBundleFn, reconcileContractBundleFn } from '@/lib/contracts.functions';
import { RefreshCw } from 'lucide-react';


interface Props {
  businessId: string;
  canEdit: boolean;
  onGenerated?: () => void;
}

const STATUS_STYLES: Record<string, string> = {
  not_created: 'bg-muted text-muted-foreground',
  'document.draft': 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
  draft: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
  'document.sent': 'bg-sky-500/10 text-sky-700 dark:text-sky-300',
  sent: 'bg-sky-500/10 text-sky-700 dark:text-sky-300',
  'document.viewed': 'bg-indigo-500/10 text-indigo-700 dark:text-indigo-300',
  viewed: 'bg-indigo-500/10 text-indigo-700 dark:text-indigo-300',
  'document.completed': 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  completed: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  error: 'bg-red-500/10 text-red-700 dark:text-red-300',
};

const STATUS_LABELS: Record<string, string> = {
  not_created: 'Not created',
  'document.draft': 'Draft',
  draft: 'Draft',
  'document.sent': 'Sent',
  sent: 'Sent',
  'document.viewed': 'Viewed',
  viewed: 'Viewed',
  'document.completed': 'Completed',
  completed: 'Completed',
  error: 'Error',
};

export function Step1ContractBundle({ businessId, canEdit, onGenerated }: Props) {
  const qc = useQueryClient();
  const getBundle = useServerFn(getContractBundleFn);
  const generate = useServerFn(generateContractBundleFn);
  const voidRegen = useServerFn(voidAndRegenerateContractBundleFn);
  const reconcile = useServerFn(reconcileContractBundleFn);


  const { data, isLoading, error } = useQuery({
    queryKey: ['contract-bundle', businessId],
    queryFn: () => getBundle({ data: { businessId } }),
  });

  const gen = useMutation({
    mutationFn: () => generate({ data: { businessId } }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['contract-bundle', businessId] });
      qc.invalidateQueries({ queryKey: ['client-contracts', businessId] });
      if (r.errored.length > 0) {
        toast.error(`Created ${r.created.length}, but ${r.errored.length} came back with blank fields — see error below.`);
      } else {
        toast.success(`Bundle generated (${r.created.length} new, ${r.skipped.length} existing).`);
      }
      onGenerated?.();
    },
    onError: (e: any) => toast.error(e?.message ?? 'Could not generate bundle'),
  });

  const regen = useMutation({
    mutationFn: () => voidRegen({ data: { businessId } }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['contract-bundle', businessId] });
      qc.invalidateQueries({ queryKey: ['client-contracts', businessId] });
      if (r.errored.length > 0) {
        toast.error(`Regenerated ${r.recreated.length}, but ${r.errored.length} came back with blank fields — see error below.`);
      } else {
        toast.success(`Voided ${r.voided} and recreated ${r.recreated.length} with current signer email.`);
      }
      onGenerated?.();
    },
    onError: (e: any) => toast.error(e?.message ?? 'Could not void & regenerate'),
  });

  const recon = useMutation({
    mutationFn: () => reconcile({ data: { businessId } }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['contract-bundle', businessId] });
      qc.invalidateQueries({ queryKey: ['client-contracts', businessId] });
      const cleared = r.reconciled.filter((x) => x.cleared).length;
      const sent = r.reconciled.filter((x) => x.sent).length;
      const stillBlank = r.reconciled.filter((x) => x.stillBlank.length > 0).length;
      if (stillBlank > 0) {
        toast.error(`Refreshed ${r.reconciled.length} — ${stillBlank} still have blank fields.`);
      } else {
        toast.success(`Refreshed status for ${r.reconciled.length} docs (${cleared} cleared stale errors, ${sent} silent-sent).`);
      }
      onGenerated?.();
    },
    onError: (e: any) => toast.error(e?.message ?? 'Could not refresh status'),
  });


  if (isLoading) {
    return (
      <div className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">
        <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Loading bundle preview…
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-4 text-sm text-red-700 dark:text-red-300">
        Could not load bundle preview.
      </div>
    );
  }

  const allExist = data.contracts.every((c) => c.status !== 'not_created' && c.status !== 'error');

  return (
    <div className="rounded-xl border bg-card">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-[hsl(var(--trophi-gold))]" />
          <div className="text-sm font-semibold">Step 1 — Contract bundle</div>
        </div>
        <div className="text-xs text-muted-foreground">MSA + Order Form + Client Authorization</div>
      </div>

      <div className="grid grid-cols-1 gap-4 p-4 md:grid-cols-2">
        <MergeField label="Company" value={data.merge.Company} />
        <MergeField label="Business ID" value={data.merge.BusinessId} mono />
        <MergeField label="Brands" value={data.merge.Brands} />
        <MergeField label="Package" value={data.merge.PackageType} />
        <MergeField label="Point of contact" value={`${data.merge.ContactName || '—'} · ${data.merge.ContactRole || '—'}`} />
        <MergeField label="Contact email" value={data.merge.ContactEmail} />
        <MergeField label="Monthly budget / location" value={data.merge.MonthlyBudgetPerLocation} />
        <MergeField label="Active locations" value={String(data.merge.ActiveLocationCount)} />
        <div className="md:col-span-2">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Location list ({data.locations.length})
          </div>
          {data.locations.length === 0 ? (
            <div className="mt-1 text-sm text-muted-foreground">—</div>
          ) : (
            <ul className="mt-2 divide-y rounded-md border">
              {data.locations.map((l) => (
                <li key={l.locationId} className="flex items-center justify-between gap-3 px-3 py-2">
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{l.name}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      {l.address || 'Address not set'}
                    </div>
                  </div>
                  <span className="font-mono text-xs rounded bg-secondary px-2 py-1 shrink-0">
                    {l.locationId}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <MergeField
          label="Client signer"
          value={data.clientSigner ? `${data.clientSigner.firstName} ${data.clientSigner.lastName} · ${data.clientSigner.email}` : '—'}
        />
        <MergeField
          label="Trophi signer"
          value={data.trophiSigner ? `${data.trophiSigner.firstName} ${data.trophiSigner.lastName} · ${data.trophiSigner.email}` : '—'}
        />
      </div>

      {!data.ready && data.readyReasons.length > 0 && (
        <div className="mx-4 mb-3 flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-200">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <div className="mb-1 font-semibold">Can't generate yet — fix the following:</div>
            <ul className="list-disc space-y-0.5 pl-4">
              {data.readyReasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </div>
        </div>
      )}


      <div className="border-t border-border">
        <ul className="divide-y divide-border">
          {data.contracts.map((c) => (
            <li key={c.kind} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
              <div className="flex items-center gap-2">
                {c.status === 'completed' || c.status === 'document.completed' ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                ) : (
                  <FileText className="h-4 w-4 text-muted-foreground" />
                )}
                <span className="font-medium">{c.label}</span>
                {c.pandadocDocumentId && (
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {c.pandadocDocumentId.slice(0, 10)}…
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {c.errorMessage && (
                  <span className="max-w-xs truncate text-[11px] text-red-600" title={c.errorMessage}>
                    {c.errorMessage}
                  </span>
                )}
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS_STYLES[c.status] ?? STATUS_STYLES.not_created}`}>
                  {STATUS_LABELS[c.status] ?? c.status}
                </span>
                {c.pandadocDocumentId && (
                  <a
                    href={`https://app.pandadoc.com/a/#/documents/${c.pandadocDocumentId}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-[hsl(var(--trophi-gold))] hover:underline"
                  >
                    Open <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3">
        <div className="text-xs text-muted-foreground">
          {allExist
            ? 'All three documents exist in PandaDoc. Use "Void & regenerate" if signer email changed.'
            : 'Generates draft documents in PandaDoc from the templates. No email is sent yet.'}
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            disabled={recon.isPending || gen.isPending || regen.isPending}
            onClick={() => recon.mutate()}
            title="Re-read each document's true state from PandaDoc and clear stale errors caused by throttling."
          >
            {recon.isPending ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Refreshing…</>
            ) : (
              <><RefreshCw className="mr-2 h-4 w-4" /> Refresh status</>
            )}
          </Button>

          {allExist && (
            <Button
              size="sm"
              variant="outline"
              disabled={!canEdit || !data.ready || regen.isPending || gen.isPending || recon.isPending}
              onClick={() => {
                if (confirm('This will delete all current PandaDoc drafts for this client and create fresh ones using the CURRENT contact email. Continue?')) {
                  regen.mutate();
                }
              }}
            >
              {regen.isPending ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Voiding & regenerating…</>
              ) : 'Void & regenerate'}
            </Button>
          )}
          <Button
            size="sm"
            disabled={!canEdit || !data.ready || gen.isPending || regen.isPending || recon.isPending}
            onClick={() => gen.mutate()}
          >
            {gen.isPending ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Generating…</>
            ) : allExist ? (
              'Regenerate missing / errored'
            ) : (
              'Generate contract bundle'
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

function MergeField({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`mt-0.5 text-sm ${mono ? 'font-mono' : ''}`}>{value || '—'}</div>
    </div>
  );
}
