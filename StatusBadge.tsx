import { JourneyStatus } from '@/lib/types';
import { JOURNEY_STATUSES, STATUS_CONFIG, statusBadgeStyle, statusDotStyle } from '@/lib/statusConfig';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

/** Color-coded pill for displaying a journey status. */
export function StatusBadge({ status }: { status: JourneyStatus }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap"
      style={statusBadgeStyle(status)}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={statusDotStyle(status)} />
      {status}
    </span>
  );
}

interface StatusSelectProps {
  value: JourneyStatus;
  onChange: (status: JourneyStatus) => void;
  /** Stop row-level click handlers (table rows navigate on click). */
  stopPropagation?: boolean;
}

/** Dropdown for changing a journey status — saves immediately on change. */
export function StatusSelect({ value, onChange, stopPropagation }: StatusSelectProps) {
  return (
    <div onClick={(e) => stopPropagation && e.stopPropagation()}>
      <Select value={value} onValueChange={(v) => onChange(v as JourneyStatus)}>
        <SelectTrigger className="h-8 w-[168px] border-none bg-transparent px-1 shadow-none focus:ring-1">
          <SelectValue>
            <StatusBadge status={value} />
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {JOURNEY_STATUSES.map((s) => (
            <SelectItem key={s} value={s}>
              <div className="flex flex-col items-start gap-0.5">
                <StatusBadge status={s} />
                <span className="text-[11px] text-muted-foreground pl-1">
                  {STATUS_CONFIG[s].description}
                </span>
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
