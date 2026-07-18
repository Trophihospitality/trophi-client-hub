import { useMemo, useState } from 'react';
import { Plus, Trash2, Building2, AlertTriangle } from 'lucide-react';
import { useCrm } from '@/store/crmStore';
import { useUser } from '@/store/userStore';
import { ClientType, JourneyStatus, PackageType, SalesPerson } from '@/lib/types';
import { CLIENT_TYPES, JOURNEY_STATUSES, PACKAGE_TYPES } from '@/lib/statusConfig';
import { uid } from '@/lib/ids';
import { useQuery } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { createClientFn, listSalesTeam } from '@/lib/crm.functions';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';

// ============================================================
// ADD NEW CLIENT — two-step flow
// Step 1: choose client type (Ind Location / Group / Multi-Location /
//         Franchise / Franchisor)
// Step 2: client details aligned to table headers + locations.
// On save: auto-generates the Business ID and a Location ID for
// every location, mapped to the parent Business ID.
// ============================================================

interface LocationDraft {
  key: string;
  name: string;
  address: string;
  city: string;
  state: string;
}

const emptyLocation = (): LocationDraft => ({ key: uid(), name: '', address: '', city: '', state: '' });

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AddClientDialog({ open, onOpenChange }: Props) {
  const { clients } = useCrm();
  const { currentUser, isManager } = useUser();
  const [step, setStep] = useState<1 | 2>(1);
  const createFn = useServerFn(createClientFn);
  const teamFn = useServerFn(listSalesTeam);
  const { data: SALES_TEAM = [] } = useQuery<SalesPerson[]>({
    queryKey: ['sales-team'],
    queryFn: () => teamFn({} as any),
  });

  const [clientType, setClientType] = useState<ClientType | null>(null);
  const [company, setCompany] = useState('');
  const [brands, setBrands] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [isDecisionMaker, setIsDecisionMaker] = useState(false);
  const [journeyStatus, setJourneyStatus] = useState<JourneyStatus>('Cold Lead');
  const [packageType, setPackageType] = useState<PackageType>('TBD');
  const [budget, setBudget] = useState('');
  const [salesPersonId, setSalesPersonId] = useState(isManager ? '' : currentUser.id);
  const [leadSource, setLeadSource] = useState('');
  const [locations, setLocations] = useState<LocationDraft[]>([emptyLocation()]);

  const reset = () => {
    setStep(1); setClientType(null); setCompany(''); setBrands('');
    setContactName(''); setContactEmail(''); setContactPhone('');
    setIsDecisionMaker(false); setJourneyStatus('Cold Lead');
    setPackageType('TBD'); setBudget(''); setSalesPersonId(isManager ? '' : currentUser.id);
    setLeadSource(''); setLocations([emptyLocation()]);
  };

  const close = (o: boolean) => { if (!o) reset(); onOpenChange(o); };

  const updateLocation = (key: string, field: keyof LocationDraft, value: string) =>
    setLocations((ls) => ls.map((l) => (l.key === key ? { ...l, [field]: value } : l)));

  // DUPLICATE DETECTION — warns when the company name matches an
  // existing client (exact or near match, ignoring case/punctuation).
  const duplicate = useMemo(() => {
    const norm = (n: string) => n.toLowerCase().replace(/[^a-z0-9]/g, '');
    const target = norm(company);
    if (target.length < 3) return null;
    return clients.find((c) => {
      const existing = norm(c.company);
      return existing === target || existing.includes(target) || target.includes(existing);
    }) ?? null;
  }, [company, clients]);

  const canSave =
    clientType && company.trim() && contactName.trim() && salesPersonId &&
    locations.every((l) => l.name.trim());

  const handleSave = async () => {
    if (!canSave || !clientType) return;
    try {
      const res = await createFn({ data: {
        company: company.trim(),
        brands: brands.split(',').map((b) => b.trim()).filter(Boolean),
        clientType,
        journeyStatus,
        contactName: contactName.trim(),
        contactEmail: contactEmail.trim(),
        contactPhone: contactPhone.trim(),
        isDecisionMaker,
        packageType,
        budget: budget ? Number(budget) : null,
        salesPersonId,
        leadSource: leadSource.trim() || undefined,
        locations: locations.map(l => ({
          name: l.name.trim(), address: l.address.trim(),
          city: l.city.trim(), state: l.state.trim(),
        })),
      } });
      toast.success('Client created', {
        description: `${company.trim()} · ${res.businessId} · ${locations.length} location ID${locations.length > 1 ? 's' : ''} generated`,
      });
      close(false);
    } catch (e: any) {
      toast.error(e.message ?? 'Could not create client');
    }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-2xl max-h-[88vh] overflow-y-auto">
        {step === 1 && (
          <>
            <DialogHeader>
              <DialogTitle>Add New Client</DialogTitle>
              <DialogDescription>What type of business is this?</DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 py-2">
              {CLIENT_TYPES.map((t) => (
                <button
                  key={t}
                  onClick={() => { setClientType(t); setStep(2); }}
                  className="flex items-center gap-3 rounded-lg border bg-card p-4 text-left transition-colors hover:border-[hsl(var(--trophi-gold))] hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Building2 className="h-5 w-5 text-[hsl(var(--trophi-gold))]" />
                  <div>
                    <div className="font-medium">{t}</div>
                    <div className="text-xs text-muted-foreground">
                      {t === 'Independent Location' && 'Single, independently owned location'}
                      {t === 'Group' && 'Restaurant group with multiple concepts'}
                      {t === 'Multi-Location' && 'One brand, multiple locations'}
                      {t === 'Franchise' && 'Franchisee-operated location(s)'}
                      {t === 'Franchisor' && 'Brand owner licensing to franchisees'}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </>
        )}

        {step === 2 && clientType && (
          <>
            <DialogHeader>
              <DialogTitle>New {clientType}</DialogTitle>
              <DialogDescription>
                A Business ID and Location IDs will be generated automatically when you save.
              </DialogDescription>
            </DialogHeader>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 py-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="company">Company name *</Label>
                <Input id="company" value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Harvest & Vine Restaurant Group" />
                {duplicate && (
                  <p className="flex items-center gap-1.5 text-xs text-[hsl(var(--status-restrictions))]">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    Possible duplicate of {duplicate.company} ({duplicate.businessId}). You can still save if this is a different business.
                  </p>
                )}
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="brands">Brand(s) <span className="text-muted-foreground text-xs">— comma separated</span></Label>
                <Input id="brands" value={brands} onChange={(e) => setBrands(e.target.value)} placeholder="Harvest Table, Vine & Barrel" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="contactName">Point of contact *</Label>
                <Input id="contactName" value={contactName} onChange={(e) => setContactName(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="contactEmail">Email</Label>
                <Input id="contactEmail" type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="contactPhone">Phone</Label>
                <Input id="contactPhone" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} placeholder="(615) 555-0100" />
              </div>
              <div className="flex items-center justify-between rounded-lg border px-3 py-2 mt-6">
                <Label htmlFor="dm" className="cursor-pointer">Decision maker?</Label>
                <Switch id="dm" checked={isDecisionMaker} onCheckedChange={setIsDecisionMaker} />
              </div>
              <div className="space-y-1.5">
                <Label>Journey status</Label>
                <Select value={journeyStatus} onValueChange={(v) => setJourneyStatus(v as JourneyStatus)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {JOURNEY_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Package type</Label>
                <Select value={packageType} onValueChange={(v) => setPackageType(v as PackageType)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PACKAGE_TYPES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="budget">Annual budget (USD)</Label>
                <Input id="budget" type="number" min="0" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="48000" />
              </div>
              <div className="space-y-1.5">
                <Label>Assigned sales person *</Label>
                <Select value={salesPersonId} onValueChange={setSalesPersonId} disabled={!isManager}>
                  <SelectTrigger><SelectValue placeholder="Select owner" /></SelectTrigger>
                  <SelectContent>
                    {SALES_TEAM.map((sp) => <SelectItem key={sp.id} value={sp.id}>{sp.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="leadSource">Lead source</Label>
                <Input id="leadSource" value={leadSource} onChange={(e) => setLeadSource(e.target.value)} placeholder="Referral, Trade Show, Outbound…" />
              </div>
            </div>

            {/* Locations */}
            <div className="space-y-3 pt-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-semibold">
                  Locations ({locations.length}) — each gets an auto-generated Location ID
                </Label>
                <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => setLocations((ls) => [...ls, emptyLocation()])}>
                  <Plus className="h-3.5 w-3.5" /> Add location
                </Button>
              </div>
              {locations.map((l, i) => (
                <div key={l.key} className="rounded-lg border p-3 space-y-2 bg-secondary/40">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono text-muted-foreground">Location {String(i + 1).padStart(2, '0')}</span>
                    {locations.length > 1 && (
                      <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => setLocations((ls) => ls.filter((x) => x.key !== l.key))}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                  <Input placeholder="Location name *" value={l.name} onChange={(e) => updateLocation(l.key, 'name', e.target.value)} />
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <Input placeholder="Street address" value={l.address} onChange={(e) => updateLocation(l.key, 'address', e.target.value)} />
                    <Input placeholder="City" value={l.city} onChange={(e) => updateLocation(l.key, 'city', e.target.value)} />
                    <Input placeholder="State" value={l.state} onChange={(e) => updateLocation(l.key, 'state', e.target.value)} />
                  </div>
                </div>
              ))}
            </div>

            <DialogFooter className="pt-4">
              <Button variant="outline" onClick={() => setStep(1)}>Back</Button>
              <Button onClick={handleSave} disabled={!canSave}>Create client</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
