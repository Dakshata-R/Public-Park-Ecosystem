'use client';

import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { NO_DATA } from './score-badge';

interface HealthGaugeProps {
  /** 0–100, or null when there is not enough data to compute the index. */
  value: number | null;
  label: string;
  size?: number;
}

/** Same bands as `GradeBadge`, so the arc and the chip beside it always agree. */
const colourFor = (value: number) =>
  value >= 70 ? 'hsl(var(--success))' : value >= 55 ? 'hsl(var(--warning))' : 'hsl(var(--destructive))';

export function HealthGauge({ value, label, size = 180 }: HealthGaugeProps) {
  const radius = (size - 20) / 2;
  const circumference = 2 * Math.PI * radius;
  const missing = value === null || !Number.isFinite(value);
  const clamped = missing ? 0 : Math.max(0, Math.min(100, value as number));
  const offset = circumference - (clamped / 100) * circumference * 0.75;

  return (
    <div className="flex flex-col items-center">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-[135deg]">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="hsl(var(--muted))"
            strokeWidth={12}
            strokeDasharray={`${circumference * 0.75} ${circumference}`}
            strokeLinecap="round"
          />
          {/* No arc at all when the value is unknown — an empty track, not a zero. */}
          {!missing && (
            <motion.circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke={colourFor(clamped)}
              strokeWidth={12}
              strokeDasharray={`${circumference * 0.75} ${circumference}`}
              strokeLinecap="round"
              initial={{ strokeDashoffset: circumference * 0.75 }}
              animate={{ strokeDashoffset: offset }}
              transition={{ duration: 1.2, ease: 'easeOut' }}
            />
          )}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          {missing ? (
            <span className="text-base font-medium text-muted-foreground">{NO_DATA}</span>
          ) : (
            <>
              <motion.span
                className="text-4xl font-bold font-display"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.5 }}
              >
                {Math.round(clamped * 10) / 10}
              </motion.span>
              <span className="text-xs text-muted-foreground">/ 100</span>
            </>
          )}
        </div>
      </div>
      <p className={cn('mt-2 text-center text-sm font-medium', missing && 'text-muted-foreground')}>{label}</p>
    </div>
  );
}
