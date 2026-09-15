import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import type {
  ConservationStatus,
  IncidentPriority,
  ReportStatus,
  WorkOrderStatus,
} from '@/lib/types';

type Tone = 'success' | 'warning' | 'destructive' | 'info' | 'secondary' | 'default';

const toneMap: Record<string, Tone> = {
  excellent: 'success',
  good: 'success',
  moderate: 'warning',
  fair: 'warning',
  poor: 'destructive',
  critical: 'destructive',
  online: 'success',
  offline: 'destructive',
  warning: 'warning',
  active: 'destructive',
  acknowledged: 'warning',
  resolved: 'success',
  published: 'success',
  draft: 'secondary',
  archived: 'secondary',
  submitted: 'secondary',
  'in-review': 'warning',
  rejected: 'destructive',
  reported: 'secondary',
  assigned: 'info',
  'in-progress': 'warning',
  scheduled: 'secondary',
  completed: 'success',
  overdue: 'destructive',
  cancelled: 'secondary',
  closed: 'secondary',
  maintenance: 'info',
};

export function StatusBadge({
  status,
  className,
}: {
  status: string;
  className?: string;
}) {
  const tone = toneMap[status] ?? 'default';
  return (
    <Badge
      className={cn(
        'capitalize',
        tone === 'success' && 'bg-success/15 text-success border-success/30',
        tone === 'warning' && 'bg-warning/15 text-warning border-warning/30',
        tone === 'destructive' &&
          'bg-destructive/15 text-destructive border-destructive/30',
        tone === 'info' && 'bg-info/15 text-info border-info/30',
        tone === 'secondary' &&
          'bg-secondary text-secondary-foreground border-border',
        className
      )}
      variant="outline"
    >
      {status.replace(/-/g, ' ')}
    </Badge>
  );
}

const priorityTone: Record<IncidentPriority, string> = {
  low: 'bg-secondary text-muted-foreground border-border',
  medium: 'bg-info/15 text-info border-info/30',
  high: 'bg-warning/15 text-warning border-warning/30',
  critical: 'bg-destructive/15 text-destructive border-destructive/30',
};

export function PriorityBadge({ priority }: { priority: IncidentPriority }) {
  return (
    <Badge variant="outline" className={cn('capitalize', priorityTone[priority])}>
      {priority}
    </Badge>
  );
}

const conservationTone: Record<ConservationStatus, string> = {
  // Not assessed is not "safe": neutral styling, never the green of Least Concern.
  'Not Evaluated': 'bg-secondary text-muted-foreground border-border',
  'Data Deficient': 'bg-secondary text-muted-foreground border-border',
  'Extinct in the Wild': 'bg-destructive/15 text-destructive border-destructive/30',
  'Least Concern': 'bg-success/15 text-success border-success/30',
  'Near Threatened': 'bg-info/15 text-info border-info/30',
  Vulnerable: 'bg-warning/15 text-warning border-warning/30',
  Endangered: 'bg-warning/20 text-warning border-warning/40',
  'Critically Endangered': 'bg-destructive/15 text-destructive border-destructive/30',
};

export function ConservationBadge({ status }: { status: ConservationStatus }) {
  return (
    <Badge variant="outline" className={conservationTone[status]}>
      {status}
    </Badge>
  );
}

export const reportStatusList: ReportStatus[] = [
  'submitted',
  'in-review',
  'resolved',
  'rejected',
];

export const workOrderStatusList: WorkOrderStatus[] = [
  'scheduled',
  'in-progress',
  'completed',
  'overdue',
];

export function scoreColor(score: number) {
  if (score >= 80) return 'text-success';
  if (score >= 60) return 'text-warning';
  return 'text-destructive';
}

export function scoreBg(score: number) {
  if (score >= 80) return 'bg-success';
  if (score >= 60) return 'bg-warning';
  return 'bg-destructive';
}
