'use client';

/**
 * Park selector, shared by every module that can be scoped to one park.
 *
 * The park list is loaded through `useParks`, which TanStack Query shares
 * between the pages that render this control. A selected park that is no
 * longer in the list (deleted, or the database was reseeded) falls back to
 * all parks rather than leaving every panel empty.
 */

import { useEffect } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useParks } from '@/lib/hooks/use-api';
import { cn } from '@/lib/utils';

/** Sentinel for "no park filter". Empty string is not a valid Radix value. */
export const ALL_PARKS = 'all';

export function ParkFilter({
  value,
  onChange,
  className,
  allLabel = 'All parks',
  includeAll = true,
}: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  allLabel?: string;
  includeAll?: boolean;
}) {
  const { data, isPending } = useParks();
  const known = !data || value === ALL_PARKS || data.items.some((park) => park.id === value);

  useEffect(() => {
    if (!known) onChange(includeAll ? ALL_PARKS : data?.items[0]?.id ?? ALL_PARKS);
  }, [known, includeAll, data, onChange]);

  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className={cn('w-full sm:w-[220px]', className)}>
        <SelectValue placeholder={isPending ? 'Loading parks…' : 'Select a park'} />
      </SelectTrigger>
      <SelectContent>
        {includeAll && <SelectItem value={ALL_PARKS}>{allLabel}</SelectItem>}
        {data?.items.map((park) => (
          <SelectItem key={park.id} value={park.id}>
            {park.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * Translate the selector's value into the query parameter the API expects:
 * the sentinel means "send nothing", which the backend reads as citywide.
 */
export const parkParam = (value: string) => (value === ALL_PARKS ? undefined : value);
