import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from '@tanstack/react-router';
import { ArrowLeft, MapPin, StickyNote, Clock, Send, PhoneCall, AlertTriangle, Plus, Ban, RotateCcw } from 'lucide-react';
import { useCrm } from '@/store/crmStore';
import { useUser } from '@/store/userStore';
import { LogContactDialog } from '@/components/crm/LogContactDialog';
import { AttachmentsSection } from '@/components/crm/AttachmentsSection';
import { isOverdue } from '@/lib/statusConfig';
import { useSalesTeam } from '@/hooks/useSalesTeam';
import { ContactRole, JourneyStatus, LeadSource, PackageType } from '@/lib/types';
import { PACKAGE_TYPES, CONTACT_ROLES, LEAD_SOURCES } from '@/lib/statusConfig';
import { StatusBadge, StatusSelect } from '@/components/crm/StatusBadge';
import { uid } from '@/lib/ids';
import { formatPhoneInput, phoneToDigits } from '@/lib/phone';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { AddLocationDialog } from '@/components/crm/AddLocationDialog';

// ============================================================
// CLIENT DETAIL
// - Full client record with inline editing
// - Sticky "Unsaved changes" bar appears the moment any field is
//   edited; changes are only persisted on Save (or discarded)
// - Notes: sales person adds notes, saved explicitly
// - Activity timeline shows time & effort invested in the client
// - Status changes save immediately; Approved → auto-sent to
//   Onboarding with confirmation toast
// ============================================================

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  return `${months} month${months > 1 ? 's' : ''} ago`;
}

export default function ClientDetail() {
  const { businessId } = useParams({ strict: false }) as { businessId: string };
  const navigate = useNavigate();
  const { getClient, updateClient, changeStatus, addNote, setLocationStatus } = useCrm();
  const client = getClient(businessId ?? '');

  // Editable draft of client info
  const [draft, setDraft] = useState(() =>
    client
      ? {
          company: client.company,
          brands: client.brands.join(', '),
          contactName: client.contactName,
          contactEmail: client.contactEmail,
          contactPhone: client.contactPhone,
          contactRole: client.contactRole,
          isDecisionMaker: client.isDecisionMaker,
          packageType: client.packageType,
          budget: client.budget?.toString() ?? '',
          salesPersonId: client.salesPersonId,
          leadSource: client.leadSource,
          lastContactDate: client.lastContactDate,
          lastContactMethod: client.lastContactMethod,
          nextFollowUpDate: client.nextFollowUpDate ?? '',
        }
      : null
  );
  const [newNote, setNewNote] = useState('');
  const [logOpen, setLogOpen] = useState(false);
  const [addLocOpen, setAddLocOpen] = useState(false);
  const [tab, setTab] = useState<'summary' | 'contact' | 'attachments' | 'activity'>('summary');


  const { currentUser, isAdmin, isManager, canEdit } = useUser();
  const SALES_TEAM = useSalesTeam();
  const owner = SALES_TEAM.find((sp) => sp.id === client?.salesPersonId);
  const CURRENT_USER = currentUser.name;
  const editable = client ? canEdit(client) : false;
  // Signed records: contact logging + notes still allowed for the team; info/status/owner locked for non-admins.
  const signedLocked = !!client && client.journeyStatus === 'Signed' && !isAdmin;
  const editableInfo = editable && !signedLocked;

  const isDirty = useMemo(() => {
    if (!client || !draft) return false;
    return (
      draft.company !== client.company ||
      draft.brands !== client.brands.join(', ') ||
      draft.contactName !== client.contactName ||
      draft.contactEmail !== client.contactEmail ||
      draft.contactPhone !== client.contactPhone ||
      draft.contactRole !== client.contactRole ||
      draft.isDecisionMaker !== client.isDecisionMaker ||
      draft.packageType !== client.packageType ||
      draft.budget !== (client.budget?.toString() ?? '') ||
      draft.salesPersonId !== client.salesPersonId ||
      draft.leadSource !== client.leadSource ||
      draft.lastContactDate !== client.lastContactDate ||
      draft.lastContactMethod !== client.lastContactMethod ||
      draft.nextFollowUpDate !== (client.nextFollowUpDate ?? '')
    );
  }, [client, draft]);

  // Warn before leaving the page with unsaved changes
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (isDirty) { e.preventDefault(); e.returnValue = ''; }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  if (!client || !draft) {
    return (
      <div className="py-24 text-center space-y-3">
        <p className="text-muted-foreground">Client not found.</p>
        <Button variant="outline" onClick={() => navigate({ to: '/crm' })}>Back to CRM</Button>
      </div>
    );
  }

  const set = <K extends keyof typeof draft>(key: K, value: (typeof draft)[K]) =>
    setDraft((d) => (d ? { ...d, [key]: value } : d));

  const handleSave = () => {
    updateClient(client.businessId, {
      company: draft.company.trim(),
      brands: draft.brands.split(',').map((b) => b.trim()).filter(Boolean),
      contactName: draft.contactName.trim(),
      contactEmail: draft.contactEmail.trim(),
      contactPhone: phoneToDigits(draft.contactPhone),
      contactRole: draft.contactRole,
      isDecisionMaker: draft.isDecisionMaker,
      packageType: draft.packageType as PackageType,
      budget: draft.budget ? Number(draft.budget) : null,
      salesPersonId: draft.salesPersonId,
      leadSource: draft.leadSource,
      lastContactDate: draft.lastContactDate,
      lastContactMethod: draft.lastContactMethod as typeof client.lastContactMethod,
      nextFollowUpDate: draft.nextFollowUpDate || undefined,
    }, CURRENT_USER);
    toast.success('Changes saved', { description: `${draft.company} updated.` });
  };

  const handleDiscard = () => {
    setDraft({
      company: client.company,
      brands: client.brands.join(', '),
      contactName: client.contactName,
      contactEmail: client.contactEmail,
      contactPhone: client.contactPhone,
      contactRole: client.contactRole,
      isDecisionMaker: client.isDecisionMaker,
      packageType: client.packageType,
      budget: client.budget?.toString() ?? '',
      salesPersonId: client.salesPersonId,
      leadSource: client.leadSource,
      lastContactDate: client.lastContactDate,
      lastContactMethod: client.lastContactMethod,
      nextFollowUpDate: client.nextFollowUpDate ?? '',
    });
  };

  const handleStatusChange = (status: JourneyStatus) => {
    if (status === 'Signed' && !isAdmin) {
      toast.error('Only admins can set Signed', { description: 'Signed is applied automatically when Step 4 completes.' });
      return;
    }
    changeStatus(client.businessId, status, CURRENT_USER);
    if (status === 'Approved') {
      toast.success(`${client.company} approved`, { description: 'Automatically sent to Onboarding.' });
    } else {
      toast.success('Status saved', { description: `${client.company} → ${status}` });
    }
  };

  const handleAddNote = () => {
    if (!newNote.trim()) return;
    addNote(client.businessId, {
      id: uid(),
      authorName: CURRENT_USER,
      body: newNote.trim(),
      createdAt: new Date().toISOString(),
    });
    setNewNote('');
    toast.success('Note saved');
  };

  const handleBack = () => {
    if (isDirty && !window.confirm('You have unsaved changes. Leave without saving?')) return;
    navigate({ to: '/crm' });
  };

  return (
    <div className="space-y-6 pb-24">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <Button variant="ghost" size="icon" onClick={handleBack} aria-label="Back to CRM">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-semibold">{client.company}</h1>
              <StatusBadge status={client.journeyStatus} />
              {client.sentToOnboarding && (
                <span className="inline-flex items-center gap-1 rounded-full bg-[hsl(var(--trophi-gold-soft))] px-2.5 py-0.5 text-xs font-medium text-[hsl(var(--trophi-ink))]">
                  <Send className="h-3 w-3" /> In Onboarding
                </span>
              )}
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              <span className="font-mono">{client.businessId}</span> · {client.clientType} · Owned by {owner?.name ?? '—'} · Created {timeAgo(client.createdAt)}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {editable && (
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setLogOpen(true)}>
              <PhoneCall className="h-3.5 w-3.5" /> Log contact
            </Button>
          )}
          <span className="text-sm text-muted-foreground">Journey status:</span>
          {editable ? (
            <StatusSelect
              value={client.journeyStatus}
              onChange={handleStatusChange}
              allowSigned={isAdmin}
              disabled={signedLocked}
            />
          ) : (
            <StatusBadge status={client.journeyStatus} />
          )}
        </div>
      </div>

      <div className="gold-rule w-24 ml-12" />

      {isOverdue(client).overdue && (
        <div className="ml-12 flex items-center gap-2 rounded-lg border border-[hsl(var(--status-restrictions))]/40 bg-[hsl(var(--status-restrictions))]/10 px-4 py-2.5 text-sm text-[hsl(var(--status-restrictions))]">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {isOverdue(client).reason} — log a contact or reschedule the follow-up.
        </div>
      )}

      {signedLocked && (
        <div className="ml-12 rounded-lg border border-[hsl(var(--status-signed))]/40 bg-[hsl(var(--status-signed))]/10 px-4 py-2.5 text-sm text-[hsl(var(--status-signed))]">
          🔒 This client is <strong>Signed</strong> — client info, status, and ownership are read-only. You can still log contacts and add notes as the relationship continues. Admins can make edits.
        </div>
      )}

      {!editable && (
        <div className="ml-12 rounded-lg border bg-secondary/60 px-4 py-2.5 text-sm text-muted-foreground">
          Read-only: this account is owned by {owner?.name ?? 'another rep'}. Ask a manager to reassign it if you need edit access.
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        <TabButton active={tab === 'summary'} onClick={() => setTab('summary')}>Client Summary</TabButton>
        <TabButton active={tab === 'contact'} onClick={() => setTab('contact')}>Contact Log</TabButton>
        <TabButton active={tab === 'attachments'} onClick={() => setTab('attachments')}>Attachments</TabButton>
        <TabButton active={tab === 'activity'} onClick={() => setTab('activity')}>Activity</TabButton>
      </div>

      {tab === 'summary' && (
        <div className={`grid grid-cols-1 lg:grid-cols-3 gap-6 ${signedLocked ? 'opacity-95' : ''}`}>
          <div className="lg:col-span-2 space-y-6">
            <section className="rounded-xl border bg-card p-5 space-y-4">
              <h2 className="font-semibold">Client information</h2>
              <fieldset disabled={!editableInfo} className="grid grid-cols-1 sm:grid-cols-2 gap-4 disabled:opacity-70">
                <div className="space-y-1.5">
                  <Label>Company</Label>
                  <Input value={draft.company} onChange={(e) => set('company', e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Brand(s)</Label>
                  <Input value={draft.brands} onChange={(e) => set('brands', e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Point of contact</Label>
                  <Input value={draft.contactName} onChange={(e) => set('contactName', e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Contact role</Label>
                  <Select value={draft.contactRole || undefined} onValueChange={(v) => set('contactRole', v as ContactRole)}>
                    <SelectTrigger><SelectValue placeholder="Select role" /></SelectTrigger>
                    <SelectContent>
                      {CONTACT_ROLES.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Email</Label>
                  <Input type="email" value={draft.contactEmail} onChange={(e) => set('contactEmail', e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Phone</Label>
                  <Input value={formatPhoneInput(draft.contactPhone)} onChange={(e) => set('contactPhone', formatPhoneInput(e.target.value))} />
                </div>
                <div className="flex items-center justify-between rounded-lg border px-3 py-2 mt-6">
                  <Label className="cursor-pointer">Decision maker?</Label>
                  <Switch checked={draft.isDecisionMaker} onCheckedChange={(v) => set('isDecisionMaker', v)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Package type</Label>
                  <Select value={draft.packageType} onValueChange={(v) => set('packageType', v as PackageType)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {PACKAGE_TYPES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Monthly budget / location (USD)</Label>
                  <Input type="number" min="0" value={draft.budget} onChange={(e) => set('budget', e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Lead source</Label>
                  <Select value={draft.leadSource || undefined} onValueChange={(v) => set('leadSource', v as LeadSource)}>
                    <SelectTrigger><SelectValue placeholder="Select lead source" /></SelectTrigger>
                    <SelectContent>
                      {LEAD_SOURCES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Assigned sales person {!isManager && <span className="text-xs text-muted-foreground">(managers only)</span>}</Label>
                  <Select value={draft.salesPersonId} onValueChange={(v) => set('salesPersonId', v)} disabled={!isManager}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {SALES_TEAM.map((sp) => <SelectItem key={sp.id} value={sp.id}>{sp.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Last contact date</Label>
                  <Input type="date" value={draft.lastContactDate} onChange={(e) => set('lastContactDate', e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Last contact method</Label>
                  <Select value={draft.lastContactMethod} onValueChange={(v) => set('lastContactMethod', v as typeof draft.lastContactMethod)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {['Email', 'Phone', 'In-Person', 'Video Call', 'Text', 'None'].map((m) => (
                        <SelectItem key={m} value={m}>{m}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Next follow-up</Label>
                  <Input type="date" value={draft.nextFollowUpDate} onChange={(e) => set('nextFollowUpDate', e.target.value)} />
                </div>
              </fieldset>
            </section>

            {/* Locations */}
            <section className="rounded-xl border bg-card p-5 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-semibold flex items-center gap-2">
                  <MapPin className="h-4 w-4 text-[hsl(var(--trophi-gold))]" />
                  Locations ({client.locations.filter((l) => l.status !== 'closed').length} active
                  {client.locations.some((l) => l.status === 'closed')
                    ? ` · ${client.locations.filter((l) => l.status === 'closed').length} closed`
                    : ''})
                </h2>
                {editableInfo && (
                  <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setAddLocOpen(true)}>
                    <Plus className="h-4 w-4" /> Add location
                  </Button>
                )}
              </div>
              <div className="divide-y">
                {client.locations.map((l) => {
                  const closed = l.status === 'closed';
                  return (
                    <div
                      key={l.locationId}
                      className={`py-3 flex flex-wrap items-center justify-between gap-2 ${closed ? 'opacity-50' : ''}`}
                    >
                      <div>
                        <div className="font-medium text-sm flex items-center gap-2">
                          <span className={closed ? 'line-through' : ''}>{l.name}</span>
                          {closed && (
                            <span className="text-[10px] uppercase tracking-wide rounded bg-muted px-1.5 py-0.5 text-muted-foreground">
                              Closed
                            </span>
                          )}
                          {l.needsOnboarding && !closed && (
                            <span className="text-[10px] uppercase tracking-wide rounded bg-[hsl(var(--trophi-gold))]/15 text-[hsl(var(--trophi-gold))] px-1.5 py-0.5">
                              Needs onboarding
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {[l.address, l.city, l.state].filter(Boolean).join(', ') || 'Address not set'}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs rounded bg-secondary px-2 py-1">{l.locationId}</span>
                        {isManager && (
                          closed ? (
                            <Button
                              size="sm" variant="ghost" className="gap-1.5 h-7"
                              onClick={async () => {
                                try {
                                  await setLocationStatus(l.locationId, 'active');
                                  toast.success('Location reopened');
                                } catch (e: any) {
                                  toast.error('Could not reopen', { description: e?.message });
                                }
                              }}
                            >
                              <RotateCcw className="h-3.5 w-3.5" /> Reopen
                            </Button>
                          ) : (
                            <Button
                              size="sm" variant="ghost" className="gap-1.5 h-7 text-muted-foreground hover:text-destructive"
                              onClick={async () => {
                                if (!confirm(`Mark "${l.name}" as closed? The location keeps its ID and history.`)) return;
                                try {
                                  await setLocationStatus(l.locationId, 'closed');
                                  toast.success('Location closed');
                                } catch (e: any) {
                                  toast.error('Could not close', { description: e?.message });
                                }
                              }}
                            >
                              <Ban className="h-3.5 w-3.5" /> Close
                            </Button>
                          )
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* Notes */}
            <section className="rounded-xl border bg-card p-5 space-y-4">
              <h2 className="font-semibold flex items-center gap-2">
                <StickyNote className="h-4 w-4 text-[hsl(var(--trophi-gold))]" />
                Client notes ({client.notes.length})
              </h2>
              <div className="space-y-2" style={editable ? undefined : { display: 'none' }}>
                <Textarea
                  placeholder={`Add a note as ${CURRENT_USER}…`}
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                  rows={3}
                />
                <div className="flex justify-end">
                  <Button size="sm" onClick={handleAddNote} disabled={!newNote.trim()}>Save note</Button>
                </div>
              </div>
              <div className="space-y-3">
                {client.notes.length === 0 && (
                  <p className="text-sm text-muted-foreground">No notes yet. Add the first note to start the record.</p>
                )}
                {client.notes.map((n) => (
                  <div key={n.id} className="rounded-lg bg-secondary/50 p-3">
                    <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                      <span className="font-medium text-foreground">{n.authorName}</span>
                      <span>{new Date(n.createdAt).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
                    </div>
                    <p className="text-sm whitespace-pre-wrap">{n.body}</p>
                  </div>
                ))}
              </div>
            </section>
          </div>

          {/* Right: engagement summary */}
          <div className="space-y-6">
            <section className="rounded-xl border bg-card p-5 space-y-3">
              <h2 className="font-semibold text-sm">Engagement summary</h2>
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between"><dt className="text-muted-foreground">In pipeline</dt><dd className="font-medium">{timeAgo(client.createdAt).replace(' ago', '')}</dd></div>
                <div className="flex justify-between"><dt className="text-muted-foreground">Last contact</dt><dd className="font-medium">{timeAgo(client.lastContactDate)} · {client.lastContactMethod}</dd></div>
                <div className="flex justify-between"><dt className="text-muted-foreground">Touchpoints logged</dt><dd className="font-medium">{client.activity.length}</dd></div>
                <div className="flex justify-between"><dt className="text-muted-foreground">Notes</dt><dd className="font-medium">{client.notes.length}</dd></div>
                {client.leadSource && (
                  <div className="flex justify-between"><dt className="text-muted-foreground">Lead source</dt><dd className="font-medium">{client.leadSource}</dd></div>
                )}
                {client.nextFollowUpDate && (
                  <div className="flex justify-between"><dt className="text-muted-foreground">Next follow-up</dt><dd className="font-medium">{new Date(client.nextFollowUpDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</dd></div>
                )}
              </dl>
            </section>
          </div>
          <AddLocationDialog businessId={client.businessId} open={addLocOpen} onOpenChange={setAddLocOpen} />
        </div>
      )}

      {tab === 'contact' && (
        <section className="rounded-xl border bg-card p-5 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-semibold flex items-center gap-2">
              <PhoneCall className="h-4 w-4 text-[hsl(var(--trophi-gold))]" />
              Contact log ({client.contactLogs.length})
            </h2>
            {editable && (
              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setLogOpen(true)}>
                <PhoneCall className="h-3.5 w-3.5" /> Log contact
              </Button>
            )}
          </div>
          <div className="space-y-3">
            {client.contactLogs.length === 0 && (
              <p className="text-sm text-muted-foreground">No logged contacts yet. Use “Log contact” to record the next touchpoint.</p>
            )}
            {client.contactLogs.map((l) => (
              <div key={l.id} className="rounded-lg bg-secondary/50 p-3">
                <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-foreground">{l.loggedByName}</span>
                    <span className="rounded bg-background px-1.5 py-0.5 text-[10px] uppercase tracking-wide border">{l.method}</span>
                  </div>
                  <span>{new Date(l.contactDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                </div>
                <p className="text-sm whitespace-pre-wrap">{l.discussion}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {tab === 'attachments' && (
        <AttachmentsSection client={client} actorName={CURRENT_USER} canEdit={editable} />
      )}

      {tab === 'activity' && (
        <section className="rounded-xl border bg-card p-5 space-y-3">
          <h2 className="font-semibold text-sm flex items-center gap-2">
            <Clock className="h-4 w-4 text-[hsl(var(--trophi-gold))]" />
            Activity timeline
          </h2>
          <ol className="relative border-l border-border pl-4 space-y-4">
            {client.activity.map((a) => (
              <li key={a.id} className="relative">
                <span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full bg-[hsl(var(--trophi-gold))]" />
                <p className="text-sm">{a.description}</p>
                <p className="text-xs text-muted-foreground">
                  {a.actor} · {new Date(a.timestamp).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                </p>
              </li>
            ))}
          </ol>
        </section>
      )}


      <LogContactDialog client={client} actorName={CURRENT_USER} open={logOpen} onOpenChange={setLogOpen} />

      {/* Sticky unsaved-changes save bar */}
      {isDirty && editableInfo && (
        <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2">
          <div className="flex items-center gap-3 rounded-full border bg-[hsl(var(--trophi-ink))] px-5 py-2.5 text-white shadow-lg">
            <span className="text-sm">Unsaved changes</span>
            <Button size="sm" variant="ghost" className="text-white/70 hover:text-white hover:bg-white/10" onClick={handleDiscard}>
              Discard
            </Button>
            <Button size="sm" className="bg-[hsl(var(--trophi-gold))] text-[hsl(var(--trophi-ink))] hover:bg-[hsl(var(--trophi-gold))]/90" onClick={handleSave}>
              Save changes
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
