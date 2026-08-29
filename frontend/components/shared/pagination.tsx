'use client';

import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { PaginationMeta } from '@/lib/api/client';

/**
 * Pagination bar driven by the API's own `meta` block.
 *
 * Taking `meta` wholesale rather than page/pageSize/total separately means the
 * control cannot disagree with the server about how many pages there are — the
 * server already computed `totalPages`, `hasNextPage` and `hasPrevPage`.
 */
export function Pagination({
  meta,
  onPageChange,
  className,
}: {
  meta: PaginationMeta;
  onPageChange: (page: number) => void;
  className?: string;
}) {
  const from = meta.total === 0 ? 0 : (meta.page - 1) * meta.limit + 1;
  const to = Math.min(meta.page * meta.limit, meta.total);

  // A single page of results needs no controls.
  if (meta.totalPages <= 1 && meta.total <= meta.limit) {
    return (
      <p className={className ?? 'text-sm text-muted-foreground'}>
        <span className="font-medium text-foreground">{meta.total}</span>{' '}
        {meta.total === 1 ? 'record' : 'records'}
      </p>
    );
  }

  return (
    <div className={className ?? 'flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'}>
      <p className="text-sm text-muted-foreground">
        Showing <span className="font-medium text-foreground">{from}</span>–
        <span className="font-medium text-foreground">{to}</span> of{' '}
        <span className="font-medium text-foreground">{meta.total}</span>
      </p>

      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" disabled={!meta.hasPrevPage} onClick={() => onPageChange(meta.page - 1)}>
          <ChevronLeft className="h-4 w-4" />
          Prev
        </Button>
        <span className="text-sm text-muted-foreground">
          Page {meta.page} of {meta.totalPages}
        </span>
        <Button variant="outline" size="sm" disabled={!meta.hasNextPage} onClick={() => onPageChange(meta.page + 1)}>
          Next
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

export function PageSizeSelect({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <Select value={String(value)} onValueChange={(v) => onChange(Number(v))}>
      <SelectTrigger className="w-[110px]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {[10, 15, 25, 50].map((n) => (
          <SelectItem key={n} value={String(n)}>
            {n} / page
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
