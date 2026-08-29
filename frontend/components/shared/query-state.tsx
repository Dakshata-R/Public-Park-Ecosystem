'use client';

/**
 * Loading, error and empty states for data-driven views.
 *
 * Every page in the application fetches from the API, and every one of them
 * needs the same three fallbacks. Centralising them means a page body only
 * ever renders the success case, and it means an API outage produces one
 * recognisable, actionable message everywhere rather than twelve different
 * blank screens.
 */

import type { UseQueryResult } from '@tanstack/react-query';
import { AlertTriangle, Inbox, Loader2, RefreshCw, WifiOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError } from '@/lib/api/client';
import { DynamicIcon } from './dynamic-icon';
import { cn } from '@/lib/utils';

/** Centred spinner for a whole panel. */
export function LoadingState({ label = 'Loading…', className }: { label?: string; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground', className)}>
      <Loader2 className="h-6 w-6 animate-spin" />
      <p className="text-sm">{label}</p>
    </div>
  );
}

/** Skeleton grid, for card layouts where the shape is known in advance. */
export function SkeletonCards({ count = 4, height = 'h-32' }: { count?: number; height?: string }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className={cn('w-full rounded-xl', height)} />
      ))}
    </div>
  );
}

/**
 * Failure state.
 *
 * A network-level failure (status 0) means the backend is not running, which
 * is overwhelmingly the most common problem during development — so it gets
 * its own message telling the reader exactly what to start, rather than a
 * generic "something went wrong".
 */
export function ErrorState({
  error,
  onRetry,
  className,
}: {
  error: unknown;
  onRetry?: () => unknown;
  className?: string;
}) {
  const apiError = error instanceof ApiError ? error : null;
  const offline = apiError?.status === 0;

  return (
    <Card className={cn('border-destructive/30', className)}>
      <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
          {offline ? <WifiOff className="h-6 w-6" /> : <AlertTriangle className="h-6 w-6" />}
        </div>

        <div className="space-y-1">
          <p className="font-medium">
            {offline ? 'Cannot reach the API' : apiError?.isForbidden ? 'Not permitted' : 'Something went wrong'}
          </p>
          <p className="mx-auto max-w-md text-sm text-muted-foreground">
            {apiError?.message || (error instanceof Error ? error.message : 'An unexpected error occurred.')}
          </p>
        </div>

        {offline && (
          <pre className="mt-1 rounded-lg bg-muted px-3 py-2 text-left text-xs text-muted-foreground">
            cd server{'\n'}npm run dev
          </pre>
        )}

        {onRetry && (
          <Button variant="outline" size="sm" onClick={() => onRetry()} className="mt-1">
            <RefreshCw className="mr-2 h-3.5 w-3.5" />
            Try again
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

/** Nothing-to-show state, with an optional call to action. */
export function EmptyState({
  title = 'Nothing here yet',
  description,
  icon = 'Inbox',
  action,
  className,
}: {
  title?: string;
  description?: string;
  icon?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center gap-3 py-14 text-center', className)}>
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted text-muted-foreground">
        {icon ? <DynamicIcon name={icon} className="h-6 w-6" /> : <Inbox className="h-6 w-6" />}
      </div>
      <div className="space-y-1">
        <p className="font-medium">{title}</p>
        {description && <p className="mx-auto max-w-sm text-sm text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  );
}

/**
 * The three states in one wrapper.
 *
 *   <QueryState query={parks} isEmpty={(d) => !d.items.length}>
 *     {(data) => <ParkTable rows={data.items} />}
 *   </QueryState>
 *
 * The render prop receives non-nullable data, so page bodies never guard
 * against `undefined`.
 */
export function QueryState<T>({
  query,
  children,
  isEmpty,
  loadingLabel,
  emptyTitle,
  emptyDescription,
  emptyIcon,
  emptyAction,
  skeleton,
}: {
  /**
   * Typed as TanStack's own result rather than a structural subset — the
   * subset form defeats inference of `T`, which silently degrades every
   * `children(data)` callback to `any`.
   */
  query: UseQueryResult<T, unknown>;
  children: (data: T) => React.ReactNode;
  isEmpty?: (data: T) => boolean;
  loadingLabel?: string;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyIcon?: string;
  emptyAction?: React.ReactNode;
  skeleton?: React.ReactNode;
}) {
  if (query.isPending) return <>{skeleton ?? <LoadingState label={loadingLabel} />}</>;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  if (query.data === undefined) {
    return <EmptyState title={emptyTitle} description={emptyDescription} icon={emptyIcon} />;
  }

  if (isEmpty?.(query.data)) {
    return (
      <EmptyState
        title={emptyTitle}
        description={emptyDescription}
        icon={emptyIcon}
        action={emptyAction}
      />
    );
  }

  return <>{children(query.data)}</>;
}
