'use client';

/**
 * Small presentational pieces for the 0–100 indices that appear throughout
 * the application. Every score in the system uses the same five colour bands,
 * defined once here, so "72" means the same shade of amber on the dashboard,
 * the map popup and the analytics table.
 */

import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import type { Grade } from '@/lib/types';

/** The band boundaries match `gradeFor()` in the backend scoring service. */
export function gradeFor(score: number): Grade {
  if (score >= 85) return 'excellent';
  if (score >= 70) return 'good';
  if (score >= 55) return 'moderate';
  if (score >= 40) return 'poor';
  return 'critical';
}

const GRADE_TEXT: Record<Grade, string> = {
  excellent: 'text-success',
  good: 'text-success',
  moderate: 'text-warning',
  poor: 'text-destructive',
  critical: 'text-destructive',
};

const GRADE_BG: Record<Grade, string> = {
  excellent: 'bg-success',
  good: 'bg-success',
  moderate: 'bg-warning',
  poor: 'bg-destructive',
  critical: 'bg-destructive',
};

const GRADE_CHIP: Record<Grade, string> = {
  excellent: 'bg-success/15 text-success border-success/30',
  good: 'bg-success/15 text-success border-success/30',
  moderate: 'bg-warning/15 text-warning border-warning/30',
  poor: 'bg-destructive/15 text-destructive border-destructive/30',
  critical: 'bg-destructive/15 text-destructive border-destructive/30',
};

export const scoreText = (score: number | null | undefined) => (score == null ? 'text-muted-foreground' : GRADE_TEXT[gradeFor(score)]);
export const scoreBg = (score: number | null | undefined) => (score == null ? 'bg-muted-foreground/30' : GRADE_BG[gradeFor(score)]);

/** Shown wherever a score or reading has no data. Never render a missing value as 0. */
export const NO_DATA = 'No data';

/** Format a possibly-missing number: `fmt(null)` → 'No data', `fmt(72.345, 1)` → "72.3". */
export function fmt(value: number | null | undefined, decimals = 0, fallback = NO_DATA) {
  if (value == null || !Number.isFinite(value)) return fallback;
  const factor = 10 ** decimals;
  return String(Math.round(value * factor) / factor);
}

/** `72 / 100` with the grade colour applied. */
export function ScoreValue({ score, className }: { score: number | null | undefined; className?: string }) {
  if (score == null) return <span className={cn('text-sm text-muted-foreground', className)}>{NO_DATA}</span>;
  return (
    <span className={cn('font-semibold tabular-nums', scoreText(score), className)}>
      {Math.round(score * 10) / 10}
    </span>
  );
}

/** Coloured chip naming the band — "good", "critical". */
export function GradeBadge({ score, grade }: { score?: number | null; grade?: Grade | null }) {
  if (!grade && score == null) {
    return (
      <Badge variant="outline" className='text-muted-foreground'>
        {NO_DATA}
      </Badge>
    );
  }
  const band = grade ?? gradeFor(score as number);
  return (
    <Badge variant="outline" className={cn('capitalize', GRADE_CHIP[band])}>
      {band}
    </Badge>
  );
}

/**
 * Horizontal score bar. Used in tables and list rows where a full gauge would
 * be too heavy but a bare number too easy to skim past.
 */
export function ScoreBar({
  score,
  showValue = true,
  className,
}: {
  score: number | null | undefined;
  showValue?: boolean;
  className?: string;
}) {
  if (score == null) {
    return <span className={cn('text-xs text-muted-foreground', className)}>{NO_DATA}</span>;
  }
  const clamped = Math.max(0, Math.min(100, score));
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
        <div
          className={cn('h-full rounded-full transition-all duration-500', scoreBg(clamped))}
          style={{ width: `${clamped}%` }}
        />
      </div>
      {showValue && (
        <span className={cn('w-10 shrink-0 text-right text-xs font-medium tabular-nums', scoreText(clamped))}>
          {Math.round(clamped)}
        </span>
      )}
    </div>
  );
}

/**
 * Compact metric tile — a label, a value and an optional footnote.
 * Used for the ecological index readouts, where the footnote carries the
 * symbol (H′, J′) that names the quantity.
 */
export function MetricTile({
  label,
  value,
  hint,
  tone,
  className,
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: 'default' | 'success' | 'warning' | 'destructive';
  className?: string;
}) {
  const toneClass =
    tone === 'success' ? 'text-success'
    : tone === 'warning' ? 'text-warning'
    : tone === 'destructive' ? 'text-destructive'
    : '';

  return (
    <div className={cn('rounded-xl border bg-card p-4', className)}>
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn('mt-1 text-2xl font-bold tabular-nums', toneClass)}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
