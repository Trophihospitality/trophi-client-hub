import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
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
  const [saving, setSaving] = useState(false);

  const reset = () => { setName(''); setAddress(''); setCity(''); setState(''); };

  const save = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const res = await addLocation(businessId, { name: name.trim(), address, city, state });
      toast.success('Location added', { description: `${name.trim()} · ${res.locationId}` });
      reset();
      onOpenChange(false);
    } catch (e: any) {
      toast.error('Could not add location', { description: e?.message ?? 'Unknown error' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add location</DialogTitle>
          <DialogDescription>
            The Location ID is generated automatically, continuing this client's sequence.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Location name *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Downtown Flagship" />
          </div>
          <div className="space-y-1.5">
            <Label>Street address</Label>
            <Input value={address} onChange={(e) => setAddress(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>City</Label>
              <Input value={city} onChange={(e) => setCity(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>State</Label>
              <Input value={state} onChange={(e) => setState(e.target.value)} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving || !name.trim()}>
            {saving ? 'Adding…' : 'Add location'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
