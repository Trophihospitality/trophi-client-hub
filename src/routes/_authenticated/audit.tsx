import { createFileRoute, redirect } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { listAuditLogFn, type AuditLogEntry } from '@/lib/client-users.functions';
import { useAuth } from '@/store/userStore';
import { Search } from 'lucide-react';

export const Route = createFileRoute('/_authenticated/audit')({
  component: AuditPage,
});

function AuditPage() {
  const { profile } = useAuth();
  if (profile && profile.role !== 'admin') {
    throw redirect({ to: '/crm' });
  }

  const list = useServerFn(listAuditLogFn);
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['audit-log', search],
    queryFn: () => list({ data: { limit: 200, search: search || undefined } as any }),
  });

  const rows = useMemo(() => data ?? [], [data]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold">Audit Log</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Read-only record of sign-ins and data-changing actions. Admin only.
        </p>
      </div>

      <div className="relative max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search action, actor, entity…"
          className="w-full rounded-md border border-input bg-background pl-9 pr-3 py-2 text-sm"
        />
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-4 py-3">When</th>
              <th className="px-4 py-3">Actor</th>
              <th className="px-4 py-3">Action</th>
              <th className="px-4 py-3">Entity</th>
              <th className="px-4 py-3">Result</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {isLoading && <tr><td className="px-4 py-6 text-muted-foreground" colSpan={5}>Loading…</td></tr>}
            {rows.map((r) => (
              <AuditRow key={r.id} row={r} expanded={expanded === r.id} onToggle={() => setExpanded(expanded === r.id ? null : r.id)} />
            ))}
            {!isLoading && rows.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">No audit entries</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AuditRow({ row, expanded, onToggle }: { row: AuditLogEntry; expanded: boolean; onToggle: () => void }) {
  return (
    <>
      <tr className="hover:bg-muted/20 cursor-pointer" onClick={onToggle}>
        <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
          {new Date(row.createdAt).toLocaleString()}
        </td>
        <td className="px-4 py-3">
          <div className="text-sm">{row.actorEmail ?? '—'}</div>
          <div className="text-xs text-muted-foreground capitalize">{row.actorType}</div>
        </td>
        <td className="px-4 py-3 font-mono text-xs">{row.action}</td>
        <td className="px-4 py-3 text-xs text-muted-foreground">
          {row.entityType ? <>{row.entityType} <span className="font-mono">{row.entityId ?? ''}</span></> : '—'}
        </td>
        <td className="px-4 py-3">
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${row.success ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
            {row.success ? 'ok' : 'fail'}
          </span>
        </td>
      </tr>
      {expanded && (row.before || row.after || row.metadata) && (
        <tr className="bg-muted/20">
          <td colSpan={5} className="px-4 py-3">
            <div className="grid grid-cols-3 gap-4 text-xs">
              {row.before && (
                <div>
                  <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">Before</div>
                  <pre className="whitespace-pre-wrap rounded bg-background p-2 font-mono">{JSON.stringify(row.before, null, 2)}</pre>
                </div>
              )}
              {row.after && (
                <div>
                  <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">After</div>
                  <pre className="whitespace-pre-wrap rounded bg-background p-2 font-mono">{JSON.stringify(row.after, null, 2)}</pre>
                </div>
              )}
              {row.metadata && (
                <div>
                  <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">Meta</div>
                  <pre className="whitespace-pre-wrap rounded bg-background p-2 font-mono">{JSON.stringify(row.metadata, null, 2)}</pre>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
