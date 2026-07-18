import { useState } from 'react';
import { useCrm } from '@/store/crmStore';
import { Client, ContactMethod } from '@/lib/types';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';

// ============================================================
// LOG CONTACT — quick action
// Records a touchpoint: updates Last Contact date + method
// automatically, adds it to the activity timeline, and optionally
// schedules the next follow-up in one step.
// ============================================================

const METHODS: ContactMethod[] = ['Email', 'Phone', 'In-Person', 'Video Call', 'Text'];

interface Props {
  client: Client;
  actorName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function LogContactDialog({ client, actorName, open, onOpenChange }: Props) {
  const { logContact } = useCrm();
  const [method, setMethod] = useState<ContactMethod>('Email');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [summary, setSummary] = useState('');
  const [nextFollowUp, setNextFollowUp] = useState('');

  const handleSave = () => {
    logContact(client.businessId, method, date, summary.trim(), actorName, nextFollowUp || undefined);
    toast.success('Contact logged', {
      description: `${method} with ${client.company} · Last Contact updated${nextFollowUp ? ` · Follow-up ${nextFollowUp}` : ''}`,
    });
    setSummary('');
    setNextFollowUp('');
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Log contact — {client.company}</DialogTitle>
          <DialogDescription>
            Saves to the activity timeline and updates Last Contact automatically.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Method</Label>
              <Select value={method} onValueChange={(v) => setMethod(v as ContactMethod)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {METHODS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Date</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>What was discussed? <span className="text-muted-foreground text-xs">(optional)</span></Label>
            <Textarea rows={3} value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="Left voicemail about the revised proposal…" />
          </div>
          <div className="space-y-1.5">
            <Label>Schedule next follow-up <span className="text-muted-foreground text-xs">(optional)</span></Label>
            <Input type="date" value={nextFollowUp} onChange={(e) => setNextFollowUp(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave}>Log contact</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
