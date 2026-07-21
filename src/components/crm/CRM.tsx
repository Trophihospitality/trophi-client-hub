import { useMemo, useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import {
  Plus, Search, AlertTriangle, Download, Upload, LayoutGrid, List,
} from 'lucide-react';
import { useCrm } from '@/store/crmStore';
import { useUser } from '@/store/userStore';
import { useSalesTeam } from '@/hooks/useSalesTeam';
import { JourneyStatus } from '@/lib/types';
import { JOURNEY_STATUSES, ACTIVE_STATUSES, isOverdue } from '@/lib/statusConfig';
import { clientsToCsv, downloadCsv, csvToClients } from '@/lib/csv';
import { formatPhone } from '@/lib/phone';
import { StatusSelect, StatusBadge } from '@/components/crm/StatusBadge';
import { AddClientDialog } from '@/components/crm/AddClientDialog';
import { PipelineBoard } from '@/components/crm/PipelineBoard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { toast } from 'sonner';

function money(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

function formatDate(iso: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function CRM() {
  const { clients, changeStatus, importClients } = useCrm();
  const { currentUser, isManager, visibleClients, canEdit } = useUser();
  const SALES_TEAM = useSalesTeam();
  const navigate = useNavigate();
  const importRef = useRef<HTMLInputElement>(null);

  const [addOpen, setAddOpen] = useState(false);
  const [view, setView] = useState<'table' | 'pipeline'>('table');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [ownerFilter, setOwnerFilter] = useState<string>('all');
  const [attentionOnly, setAttentionOnly] = useState(false);

  const mine = visibleClients(clients);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return mine.filter((c) => {
      if (statusFilter !== 'all' && c.journeyStatus !== statusFilter) return false;
      if (ownerFilter !== 'all' && c.salesPersonId !== ownerFilter) return false;
      if (attentionOnly && !isOverdue(c).overdue) return false;
      if (!q) return true;
      return [c.company, c.brands.join(' '), c.contactName, c.contactEmail, c.businessId]
        .join(' ').toLowerCase().includes(q);
    });
  }, [mine, search, statusFilter, ownerFilter, attentionOnly]);

  // ---- Forecast metrics: monthly value = budget-per-location × ACTIVE locations ----
  const clientMonthlyValue = (c: (typeof mine)[number]) =>
    (c.budget ?? 0) * c.locations.filter((l) => l.status === 'active').length;

  const metrics = useMemo(() => {
    const active = mine.filter((c) => ACTIVE_STATUSES.includes(c.journeyStatus));
    const pipelineValue = active.reduce((s, c) => s + clientMonthlyValue(c), 0);
    const weighted = active.reduce((s, c) => s + clientMonthlyValue(c) * STAGE_PROBABILITY[c.journeyStatus], 0);
    const approvedValue = mine
      .filter((c) => c.journeyStatus === 'Approved')
      .reduce((s, c) => s + clientMonthlyValue(c), 0);
    const needsAttention = mine.filter((c) => isOverdue(c).overdue).length;
    return { activeCount: active.length, pipelineValue, weighted, approvedValue, needsAttention };
  }, [mine]);

  const handleStatusChange = (businessId: string, company: string, status: JourneyStatus) => {
    changeStatus(businessId, status, currentUser.name);
    if (status === 'Approved') {
      toast.success(`${company} approved`, { description: 'Client automatically sent to Onboarding.' });
    } else {
      toast.success('Status saved', { description: `${company} → ${status}` });
    }
  };

  const handleExport = () => {
    downloadCsv(`trophi-crm-${new Date().toISOString().slice(0, 10)}.csv`, clientsToCsv(filtered));
    toast.success('CSV exported', { description: `${filtered.length} clients` });
  };

  const handleImportFile = async (file: File | undefined) => {
    if (!file) return;
    const text = await file.text();
    const result = csvToClients(
      text,
      clients.map((c) => c.businessId),
      clients.map((c) => c.company),
      currentUser.id,
      currentUser.name
    );
    if (result.clients.length > 0) {
      importClients(result.clients);
      toast.success(`Imported ${result.clients.length} client${result.clients.length > 1 ? 's' : ''}`, {
        description: 'Business IDs and Location IDs were auto-generated for every row.',
      });
    }
    if (result.skipped.length > 0) {
      toast.warning(`${result.skipped.length} row${result.skipped.length > 1 ? 's' : ''} skipped`, {
        description: result.skipped.slice(0, 3).map((s) => `Row ${s.row}: ${s.reason}`).join(' · '),
      });
    }
    if (importRef.current) importRef.current.value = '';
  };

  const stats = [
    { label: 'Active pipeline (monthly)', value: money(metrics.pipelineValue), sub: `${metrics.activeCount} open leads` },
    { label: 'Weighted monthly forecast', value: money(metrics.weighted), sub: 'monthly × active locations × probability', icon: TrendingUp },
    { label: 'Approved monthly value', value: money(metrics.approvedValue), sub: 'in onboarding' },
    {
      label: 'Needs attention', value: String(metrics.needsAttention),
      sub: 'overdue follow-ups', alert: metrics.needsAttention > 0,
    },
  ];

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">CRM</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {isManager
              ? `${mine.length} clients & leads across the team`
              : `${mine.length} accounts owned by you`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            ref={importRef} type="file" accept=".csv" className="hidden"
            onChange={(e) => handleImportFile(e.target.files?.[0])}
          />
          <Button variant="outline" className="gap-2" onClick={() => importRef.current?.click()}>
            <Upload className="h-4 w-4" /> Import CSV
          </Button>
          <Button variant="outline" className="gap-2" onClick={handleExport}>
            <Download className="h-4 w-4" /> Export CSV
          </Button>
          <Button onClick={() => setAddOpen(true)} className="gap-2">
            <Plus className="h-4 w-4" /> Add New Client
          </Button>
        </div>
      </div>

      <div className="gold-rule w-24" />

      {/* Forecast stat cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="rounded-xl border bg-card p-4">
            <div className="text-xs text-muted-foreground">{s.label}</div>
            <div className={`mt-1 font-display text-xl font-semibold ${s.alert ? 'text-[hsl(var(--status-restrictions))]' : ''}`}>
              {s.value}
            </div>
            <div className="text-[11px] text-muted-foreground">{s.sub}</div>
          </div>
        ))}
      </div>

      {/* Filters + view toggle */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search company, brand, contact, ID…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 bg-card"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-44 bg-card"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {JOURNEY_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
        {isManager && (
          <Select value={ownerFilter} onValueChange={setOwnerFilter}>
            <SelectTrigger className="w-44 bg-card"><SelectValue placeholder="Owner" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All owners</SelectItem>
              {SALES_TEAM.map((sp) => <SelectItem key={sp.id} value={sp.id}>{sp.name}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        <Button
          variant={attentionOnly ? 'default' : 'outline'}
          size="sm"
          className="gap-1.5"
          onClick={() => setAttentionOnly((v) => !v)}
        >
          <AlertTriangle className="h-3.5 w-3.5" />
          Needs attention
        </Button>
        <div className="ml-auto flex rounded-lg border bg-card p-0.5">
          <Button
            variant={view === 'table' ? 'secondary' : 'ghost'} size="sm" className="gap-1.5 h-8"
            onClick={() => setView('table')}
          >
            <List className="h-4 w-4" /> Table
          </Button>
          <Button
            variant={view === 'pipeline' ? 'secondary' : 'ghost'} size="sm" className="gap-1.5 h-8"
            onClick={() => setView('pipeline')}
          >
            <LayoutGrid className="h-4 w-4" /> Pipeline
          </Button>
        </div>
      </div>

      {/* Pipeline (kanban) view */}
      {view === 'pipeline' && (
        <PipelineBoard clients={filtered} onStatusChange={handleStatusChange} canEdit={canEdit} />
      )}

      {/* Table view */}
      {view === 'table' && (
        <div className="rounded-xl border bg-card overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-8"></TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Brand(s)</TableHead>
                <TableHead className="text-center"># Locations</TableHead>
                <TableHead>Customer Journey Status</TableHead>
                <TableHead>Last Contact</TableHead>
                <TableHead>
                  Point of Contact
                  <div className="text-[10px] font-normal text-muted-foreground">Role shown below name</div>
                </TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead className="text-center">Decision Maker</TableHead>
                <TableHead>Package</TableHead>
                <TableHead className="text-right">Monthly Budget / Location</TableHead>
                <TableHead className="text-right">Weighted (monthly)</TableHead>
                <TableHead>Owner</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={14} className="h-32 text-center text-muted-foreground">
                    No clients match. Adjust filters or add a new client to get started.
                  </TableCell>
                </TableRow>
              )}
              {filtered.map((c) => {
                const owner = SALES_TEAM.find((sp) => sp.id === c.salesPersonId);
                const od = isOverdue(c);
                const weighted = clientMonthlyValue(c) * STAGE_PROBABILITY[c.journeyStatus];
                return (
                  <TableRow
                    key={c.businessId}
                    className="cursor-pointer"
                    onClick={() => navigate({ to: '/crm/$businessId', params: { businessId: c.businessId } })}
                  >
                    <TableCell className="pr-0">
                      {od.overdue && (
                        <span title={od.reason}>
                          <AlertTriangle className="h-4 w-4 text-[hsl(var(--status-restrictions))]" />
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="font-medium">{c.company}</div>
                      <div className="text-xs text-muted-foreground font-mono">{c.businessId}</div>
                    </TableCell>
                    <TableCell className="max-w-[160px] truncate">{c.brands.join(', ')}</TableCell>
                    <TableCell className="text-center">{c.locations.filter((l) => l.status !== 'closed').length}</TableCell>
                    <TableCell>
                      {canEdit(c) ? (
                        <StatusSelect
                          value={c.journeyStatus}
                          stopPropagation
                          onChange={(s) => handleStatusChange(c.businessId, c.company, s)}
                        />
                      ) : (
                        <span className="text-sm">{c.journeyStatus}</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="text-sm">{formatDate(c.lastContactDate)}</div>
                      <div className="text-xs text-muted-foreground">{c.lastContactMethod}</div>
                    </TableCell>
                    <TableCell>
                      <div>{c.contactName}</div>
                      {c.contactRole && <div className="text-xs text-muted-foreground">{c.contactRole}</div>}
                    </TableCell>
                    <TableCell className="max-w-[180px] truncate text-sm">{c.contactEmail}</TableCell>
                    <TableCell className="whitespace-nowrap text-sm">{formatPhone(c.contactPhone)}</TableCell>
                    <TableCell className="text-center">
                      <span className={c.isDecisionMaker ? 'text-[hsl(var(--status-approved))] font-medium' : 'text-muted-foreground'}>
                        {c.isDecisionMaker ? 'Yes' : 'No'}
                      </span>
                    </TableCell>
                    <TableCell>{c.packageType}</TableCell>
                    <TableCell className="text-right font-medium">{c.budget !== null ? money(c.budget) : '—'}</TableCell>
                    <TableCell className="text-right text-sm text-muted-foreground">
                      {c.budget !== null ? money(weighted) : '—'}
                    </TableCell>
                    <TableCell className="text-sm">{owner?.name ?? '—'}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <AddClientDialog open={addOpen} onOpenChange={setAddOpen} />
    </div>
  );
}
