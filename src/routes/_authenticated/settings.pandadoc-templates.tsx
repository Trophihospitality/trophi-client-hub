import { createFileRoute } from '@tanstack/react-router';
import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { toast } from 'sonner';
import { FileText, CheckCircle2, AlertCircle } from 'lucide-react';
import { useAuth } from '@/store/userStore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  listPandadocTemplatesFn,
  updatePandadocTemplateFn,
  type TemplateRow,
} from '@/lib/pandadoc-templates.functions';

export const Route = createFileRoute('/_authenticated/settings/pandadoc-templates')({
  component: PandaDocTemplatesPage,
});

const MERGE_FIELDS: Record<string, string[]> = {
  msa: ['Company', 'Brands', 'ContactName', 'ContactRole', 'ContactEmail', 'BusinessId'],
  order_form: ['Company', 'PackageType', 'MonthlyBudgetPerLocation', 'ActiveLocationsList', 'BusinessId'],
  client_authorization: ['Company', 'ContactName', 'ContactRole', 'BusinessId'],
  payment_authorization: [
    'Company', 'BusinessId', 'PaymentScope',
    'ActiveLocationsList', 'AuthorizationLanguage',
    'SignerName', 'SignerRole', 'SignatureDate', 'PaymentLast4',
  ],
};

function PandaDocTemplatesPage() {
  const { profile } = useAuth();
  const list = useServerFn(listPandadocTemplatesFn);
  const update = useServerFn(updatePandadocTemplateFn);
  const qc = useQueryClient();

  const { data = [], isLoading } = useQuery({
    queryKey: ['pandadoc-templates'],
    queryFn: () => list(),
    enabled: profile?.role === 'admin',
  });

  if (profile && profile.role !== 'admin') {
    return <div className="text-sm text-muted-foreground">Admins only.</div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold">PandaDoc Templates</h1>
        <p className="mt-1 text-sm text-muted-foreground max-w-2xl">
          Paste the PandaDoc template IDs here. The integration reads these at runtime — swap in real
          legal documents later by creating new templates in PandaDoc and updating the IDs here. No
          code changes required.
        </p>
      </div>
      <div className="gold-rule w-24" />

      {isLoading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : (
        <div className="space-y-3">
          {data.map((row) => (
            <TemplateCard
              key={row.key}
              row={row}
              fields={MERGE_FIELDS[row.key] ?? []}
              onSave={async (id) => {
                await update({ data: { key: row.key, templateId: id } });
                await qc.invalidateQueries({ queryKey: ['pandadoc-templates'] });
                toast.success(`${row.label} saved`);
              }}
            />
          ))}
        </div>
      )}

      <SetupGuide />
    </div>
  );
}

function TemplateCard({
  row,
  fields,
  onSave,
}: {
  row: TemplateRow;
  fields: string[];
  onSave: (id: string | null) => Promise<void>;
}) {
  const [value, setValue] = useState(row.templateId ?? '');
  const [saving, setSaving] = useState(false);
  useEffect(() => setValue(row.templateId ?? ''), [row.templateId]);
  const dirty = value.trim() !== (row.templateId ?? '');
  const set = !!row.templateId;

  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <FileText className="mt-0.5 h-5 w-5 text-[hsl(var(--trophi-gold))]" />
          <div>
            <div className="font-medium flex items-center gap-2">
              {row.label}
              {set ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-300">
                  <CheckCircle2 className="h-3 w-3" /> Configured
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300">
                  <AlertCircle className="h-3 w-3" /> Not set
                </span>
              )}
            </div>
            {row.notes && <div className="mt-0.5 text-xs text-muted-foreground">{row.notes}</div>}
            <div className="mt-2 text-[11px] text-muted-foreground">
              Required merge fields:{' '}
              <span className="font-mono">{fields.map((f) => `{{${f}}}`).join(', ')}</span>
            </div>
          </div>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="e.g. TEMPLATE_ABC123…"
          className="font-mono text-sm"
        />
        <Button
          size="sm"
          disabled={!dirty || saving}
          onClick={async () => {
            setSaving(true);
            try {
              await onSave(value.trim() || null);
            } finally {
              setSaving(false);
            }
          }}
        >
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </div>
  );
}

function SetupGuide() {
  return (
    <div className="mt-8 rounded-xl border border-dashed bg-card p-5 text-sm">
      <div className="font-semibold">How to create the four placeholder templates</div>
      <ol className="mt-3 list-decimal space-y-2 pl-5 text-muted-foreground">
        <li>
          Sign in to PandaDoc sandbox → <b>Templates</b> → <b>New Template</b> → <b>Blank</b>.
        </li>
        <li>Name it exactly as shown above (e.g. "Master Services Agreement").</li>
        <li>
          Paste placeholder body text (any short text is fine). Then add each merge field listed on
          the card by clicking <b>+ Add Field → Text</b> and setting the <b>Field Name</b> to match
          exactly (e.g. <code className="font-mono">Company</code>). Fields with{' '}
          <code className="font-mono">List</code> in the name can just be a large multi-line Text
          field — the integration passes a formatted string.
        </li>
        <li>
          On <b>MSA</b>, <b>Order Form</b>, and <b>Client Authorization</b>: add two recipient roles
          named <code className="font-mono">client</code> and <code className="font-mono">trophi</code>. Drop a Signature
          field for each role.
        </li>
        <li>
          On <b>Payment Authorization</b>: only the <code className="font-mono">client</code> role,
          plus fields for signature, printed name, role, and date. Include standard ACH/card
          authorization language in the body. The integration will fill{' '}
          <code className="font-mono">PaymentLast4</code> after Stripe tokenization — never write
          full card or bank numbers into the template.
        </li>
        <li>
          Save & publish the template. Open it → the URL ends with the template ID
          (e.g. <code className="font-mono">/templates/TEMPLATE_ABC123XYZ</code>). Copy that ID and
          paste it into the field above, then click <b>Save</b>.
        </li>
        <li>Repeat for all four templates.</li>
      </ol>
    </div>
  );
}
