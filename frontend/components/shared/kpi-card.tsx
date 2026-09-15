import { cn } from '@/lib/utils';
import { Card } from '@/components/ui/card';
import { DynamicIcon } from './dynamic-icon';
import { NO_DATA } from './score-badge';
import { SourceBadge, type Provenance } from './data-source';
import { motion } from 'framer-motion';

interface KpiCardProps {
  label: string;
  /** null / undefined = no data. Rendered as "No data", never as 0. */
  value: number | string | null | undefined;
  unit?: string;
  icon: string;
  tone?: 'success' | 'warning' | 'destructive' | 'info' | 'primary';
  /** Where the value came from, shown as a small provenance badge. */
  source?: Provenance | null;
  index?: number;
}

const toneStyles: Record<string, string> = {
  primary: 'bg-primary/10 text-primary',
  success: 'bg-success/10 text-success',
  warning: 'bg-warning/10 text-warning',
  destructive: 'bg-destructive/10 text-destructive',
  info: 'bg-info/10 text-info',
  muted: 'bg-muted text-muted-foreground',
};

export function KpiCard({
  label,
  value,
  unit,
  icon,
  tone = 'primary',
  source,
  index = 0,
}: KpiCardProps) {
  const missing = value === null || value === undefined || value === '';

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: index * 0.05 }}
    >
      <Card className="relative overflow-hidden p-5 hover:shadow-md transition-shadow">
        <div className="flex items-start justify-between">
          <div className="min-w-0 space-y-1">
            <p className="text-sm font-medium text-muted-foreground">{label}</p>
            {missing ? (
              // A missing value gets no colour band: grey says "unknown", not "bad".
              <p className="py-1.5 text-lg font-medium text-muted-foreground">{NO_DATA}</p>
            ) : (
              <div className="flex items-baseline gap-1">
                <span className="text-3xl font-bold tracking-tight">{value}</span>
                {unit && (
                  <span className="text-sm text-muted-foreground">{unit}</span>
                )}
              </div>
            )}
            {source && <SourceBadge source={source} className="text-[10px]" />}
          </div>
          <div
            className={cn(
              'flex h-11 w-11 shrink-0 items-center justify-center rounded-xl',
              toneStyles[missing ? 'muted' : tone]
            )}
          >
            <DynamicIcon name={icon} className="h-5 w-5" />
          </div>
        </div>
      </Card>
    </motion.div>
  );
}
