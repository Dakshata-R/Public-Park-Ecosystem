import { cn } from '@/lib/utils';
import { Card } from '@/components/ui/card';
import { DynamicIcon } from './dynamic-icon';
import { TrendingUp, TrendingDown } from 'lucide-react';
import { motion } from 'framer-motion';

interface KpiCardProps {
  label: string;
  value: number | string;
  unit?: string;
  icon: string;
  trend?: number;
  tone?: 'success' | 'warning' | 'destructive' | 'info' | 'primary';
  index?: number;
}

const toneStyles: Record<string, string> = {
  primary: 'bg-primary/10 text-primary',
  success: 'bg-success/10 text-success',
  warning: 'bg-warning/10 text-warning',
  destructive: 'bg-destructive/10 text-destructive',
  info: 'bg-info/10 text-info',
};

export function KpiCard({
  label,
  value,
  unit,
  icon,
  trend,
  tone = 'primary',
  index = 0,
}: KpiCardProps) {
  const trendUp = (trend ?? 0) >= 0;
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: index * 0.05 }}
    >
      <Card className="relative overflow-hidden p-5 hover:shadow-md transition-shadow">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <p className="text-sm font-medium text-muted-foreground">{label}</p>
            <div className="flex items-baseline gap-1">
              <span className="text-3xl font-bold tracking-tight">{value}</span>
              {unit && (
                <span className="text-sm text-muted-foreground">{unit}</span>
              )}
            </div>
          </div>
          <div
            className={cn(
              'flex h-11 w-11 items-center justify-center rounded-xl',
              toneStyles[tone]
            )}
          >
            <DynamicIcon name={icon} className="h-5 w-5" />
          </div>
        </div>
        {typeof trend === 'number' && (
          <div className="mt-3 flex items-center gap-1.5 text-xs">
            <span
              className={cn(
                'inline-flex items-center gap-0.5 font-medium',
                trendUp ? 'text-success' : 'text-destructive'
              )}
            >
              {trendUp ? (
                <TrendingUp className="h-3.5 w-3.5" />
              ) : (
                <TrendingDown className="h-3.5 w-3.5" />
              )}
              {Math.abs(trend)}%
            </span>
            <span className="text-muted-foreground">vs last period</span>
          </div>
        )}
      </Card>
    </motion.div>
  );
}
