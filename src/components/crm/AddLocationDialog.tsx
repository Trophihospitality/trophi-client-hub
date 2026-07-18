import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { US_STATES } from '@/lib/statusConfig';
import { useCrm } from '@/store/crmStore';
import { toast } from 'sonner';

export function AddLocationDialog({
  businessId, open, onOpenChange,
}: { businessId: string; open: boolean; onOpenChange: (v: boolean) => void }) {
  const { addLocation } = useCrm();
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);

  const reset = () => { setName(''); setAddress(''); setCity(''); setState(''); setSubmitted(false); };

  const canSave = name.trim() && address.trim() && city.trim() && state.length === 2;

  const save = async () => {
    setSubmitted(true);
    if (!canSave) return;
    setSaving(true);
    try {
      const res = await addLocation(businessId, { name: name.trim(), address: address.trim(), city: city.trim(), state });
      toast.success('Location added', { description: `${name.trim()} · ${res.locationId}` });
      reset();
      onOpenChange(false);
    } catch (e: any) {
      toast.error('Could not add location', { description: e?.message ?? 'Unknown error' });
    } finally {
      setSaving(false);
    }
  };

  const Err = ({ show }: { show: boolean }) =>
    show ? <p className="text-xs text-[hsl(var(--status-restrictions))]">Required</p> : null;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add location</DialogTitle>
          <DialogDescription>
            All fields required. The Location ID is generated automatically, continuing this client's sequence.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Location name *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Downtown Flagship" />
            <Err show={submitted && !name.trim()} />
          </div>
          <div className="space-y-1.5">
            <Label>Street address *</Label>
            <Input value={address} onChange={(e) => setAddress(e.target.value)} />
            <Err show={submitted && !address.trim()} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>City *</Label>
              <Input value={city} onChange={(e) => setCity(e.target.value)} />
              <Err show={submitted && !city.trim()} />
            </div>
            <div className="space-y-1.5">
              <Label>State *</Label>
              <Select value={state} onValueChange={setState}>
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent className="max-h-64">
                  {US_STATES.map((s) => <SelectItem key={s.code} value={s.code}>{s.code} — {s.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <Err show={submitted && state.length !== 2} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving || (submitted && !canSave)}>
            {saving ? 'Adding…' : 'Add location'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
