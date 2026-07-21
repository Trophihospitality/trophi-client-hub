import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { AlertTriangle, MapPin } from 'lucide-react';
import { Client, JourneyStatus } from '@/lib/types';
import { JOURNEY_STATUSES, STAGE_PROBABILITY, isOverdue, statusDotStyle } from '@/lib/statusConfig';
import { useSalesTeam } from '@/hooks/useSalesTeam';

// ============================================================
// PIPELINE BOARD — kanban view of the customer journey
// Drag a card to a new column to change its status (auto-saved;
// Approved column triggers the automatic Onboarding hand-off via
// the same store action as the table view).
// Uses native HTML5 drag-and-drop — no extra dependencies.
// ============================================================

interface Props {
  clients: Client[];
  onStatusChange: (businessId: string, company: string, status: JourneyStatus) => void;
  canEdit: (client: Client) => boolean;
  isAdmin?: boolean;
}

function money(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

export function PipelineBoard({ clients, onStatusChange, canEdit, isAdmin = false }: Props) {
  const navigate = useNavigate();
  const SALES_TEAM = useSalesTeam();
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<JourneyStatus | null>(null);
  const monthlyValue = (c: Client) => (c.budget ?? 0) * c.locations.filter((l) => l.status === 'active').length;

  const handleDrop = (status: JourneyStatus) => {
    if (!dragId) return;
    const client = clients.find((c) => c.businessId === dragId);
    setDragId(null);
    setOverCol(null);
    if (!client || client.journeyStatus === status) return;
    if (status === 'Signed' && !isAdmin) return; // admins only
    onStatusChange(client.businessId, client.company, status);
  };

  return (
    <div className="flex gap-3 overflow-x-auto pb-4 -mx-1 px-1">
      {JOURNEY_STATUSES.map((status) => {
        const col = clients.filter((c) => c.journeyStatus === status);
        const colValue = col.reduce((sum, c) => sum + monthlyValue(c), 0);
        const isSignedCol = status === 'Signed';
        const dropBlocked = isSignedCol && !isAdmin;
        return (
          <div
            key={status}
            className={`flex w-64 shrink-0 flex-col rounded-xl border bg-secondary/40 transition-colors ${
              overCol === status && !dropBlocked ? 'border-[hsl(var(--trophi-gold))] bg-[hsl(var(--trophi-gold-soft))]' : ''
            } ${dropBlocked ? 'opacity-70' : ''}`}
            onDragOver={(e) => { if (dropBlocked) return; e.preventDefault(); setOverCol(status); }}
            onDragLeave={() => setOverCol((o) => (o === status ? null : o))}
            onDrop={() => handleDrop(status)}
          >
            <div className="flex items-center justify-between px-3 pt-3 pb-2">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full" style={statusDotStyle(status)} />
                <span className="text-sm font-medium">{status}</span>
                <span className="text-xs text-muted-foreground">{col.length}</span>
              </div>
            </div>
            {colValue > 0 && (
              <div className="px-3 pb-2 text-[11px] text-muted-foreground">
                {money(colValue)}
              </div>
            )}
            <div className="flex-1 space-y-2 px-2 pb-2 min-h-[80px]">
              {col.map((c) => {
                const owner = SALES_TEAM.find((sp) => sp.id === c.salesPersonId);
                const od = isOverdue(c);
                const editable = canEdit(c);
                return (
                  <div
                    key={c.businessId}
                    draggable={editable}
                    onDragStart={() => setDragId(c.businessId)}
                    onDragEnd={() => { setDragId(null); setOverCol(null); }}
                    onClick={() => navigate({ to: '/crm/$businessId', params: { businessId: c.businessId } })}
                    className={`rounded-lg border bg-card p-3 shadow-sm transition-shadow hover:shadow-md ${
                      editable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer opacity-80'
                    } ${dragId === c.businessId ? 'opacity-40' : ''}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-sm font-medium leading-tight">{c.company}</span>
                      {od.overdue && (
                        <span title={od.reason}>
                          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-[hsl(var(--status-restrictions))]" />
                        </span>
                      )}
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                      <MapPin className="h-3 w-3" />
                      {c.locations.filter((l) => l.status !== 'closed').length} loc · {c.packageType}
                    </div>
                    <div className="mt-2 flex items-center justify-between text-xs">
                      <span className="font-medium">{monthlyValue(c) ? `${money(monthlyValue(c))}/mo` : '—'}</span>
                      <span className="text-muted-foreground">{owner?.name.split(' ')[0] ?? '—'}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
