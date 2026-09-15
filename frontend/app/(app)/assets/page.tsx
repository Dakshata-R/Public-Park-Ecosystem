'use client';

/**
 * Module 3 — Park Asset Management.
 *
 * Assets share one collection with a free-form `attributes` map rather than
 * living in six near-identical tables, so this page stays generic: the table,
 * filters and detail drawer work for a tree, a bench or a lake without
 * branching on type.
 */

import { useMemo, useState } from 'react';
import {
  Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { Plus, Pencil, Trash2, Wrench, History, AlertTriangle, ExternalLink, Sparkles } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Slider } from '@/components/ui/slider';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip as UiTooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { PageHeader } from '@/components/shared/page-header';
import { DataTable } from '@/components/shared/data-table';
import { FilterBar } from '@/components/shared/filter-bar';
import { Pagination } from '@/components/shared/pagination';
import { StatusBadge } from '@/components/shared/status-badges';
import { MetricTile, ScoreBar, NO_DATA } from '@/components/shared/score-badge';
import { DataNotice, SourceBadge } from '@/components/shared/data-source';
import { ParkFilter, ALL_PARKS, parkParam } from '@/components/shared/park-filter';
import { QueryState, SkeletonCards, LoadingState, EmptyState, ErrorState } from '@/components/shared/query-state';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { useAuth } from '@/components/providers/auth-provider';
import {
  useAssets, useAssetStats, useAssetHistory, useParks,
  useCreateAsset, useUpdateAsset, useDeleteAsset, useAddMaintenance,
} from '@/lib/hooks/use-api';
import { ApiError } from '@/lib/api/client';
import { makePoint } from '@/lib/api/geo';
import { cn } from '@/lib/utils';
import type { Asset, AssetType } from '@/lib/types';

const ASSET_TYPES: AssetType[] = ['tree', 'plant', 'bench', 'lake', 'path', 'light', 'structure'];
const CONDITION_STATUSES = ['excellent', 'good', 'fair', 'poor', 'critical'];

const TOOLTIP_STYLE = {
  background: 'hsl(var(--popover))',
  border: '1px solid hsl(var(--border))',
  borderRadius: 'var(--radius)',
  fontSize: 12,
};

/** An empty coordinate box is "not set", not zero. */
const coordinate = (label: string, min: number, max: number) =>
  z.coerce
    .number({ invalid_type_error: `Enter a ${label}`, required_error: `Enter a ${label}` })
    .min(min, `${label[0].toUpperCase()}${label.slice(1)} must be between ${min} and ${max}`)
    .max(max, `${label[0].toUpperCase()}${label.slice(1)} must be between ${min} and ${max}`);

/** Matches the server's `assets.create` schema, minus the fields we derive. */
const assetSchema = z
  .object({
    name: z.string().min(2, 'Give the asset a name'),
    type: z.enum(['tree', 'plant', 'bench', 'lake', 'path', 'light', 'structure']),
    park: z.string().min(1, 'Select a park'),
    condition: z.number().min(0).max(100),
    lat: coordinate('latitude', -90, 90),
    lng: coordinate('longitude', -180, 180),
    notes: z.string().max(2000).optional(),
  })
  // The API rejects [0, 0]: it is what an unset location looks like, and it is in the Atlantic.
  .refine((v) => !(v.lat === 0 && v.lng === 0), {
    message: 'Set a real location — choose a park to start from its centre',
    path: ['lat'],
  });

type AssetValues = z.infer<typeof assetSchema>;

type ParkOption = { id: string; name: string; location: { coordinates: [number, number] } };

const parkName = (park: Asset['park']) => (typeof park === 'object' && park ? park.name : '—');
const shortDate = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString() : '—');

/** `node/123` or `way/123` → the OpenStreetMap page for that element. */
const osmUrl = (id: string) => `https://www.openstreetmap.org/${id}`;
const isOsm = (asset: Asset) => asset.source?.provider === 'OpenStreetMap' && Boolean(asset.source.id);

const DEMO_CONDITION_TOOLTIP =
  'Condition and maintenance history are demonstration values. The asset’s position and type are real (OpenStreetMap), but no condition survey has been recorded for it.';

/** Marks an asset whose condition and maintenance history are demonstration values. */
function DemoConditionBadge({ compact = false, className }: { compact?: boolean; className?: string }) {
  return (
    <TooltipProvider delayDuration={200}>
      <UiTooltip>
        <TooltipTrigger asChild>
          <Badge
            variant="outline"
            className={cn('gap-1 whitespace-nowrap border-muted-foreground/30 bg-muted font-normal text-muted-foreground', className)}
          >
            <Sparkles className="h-3 w-3" />
            {!compact && 'Demo condition'}
          </Badge>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs text-xs">{DEMO_CONDITION_TOOLTIP}</TooltipContent>
      </UiTooltip>
    </TooltipProvider>
  );
}

export default function AssetsPage() {
  const { can } = useAuth();
  const canEdit = can('officer');
  // Retiring an asset is an administrator action on the API.
  const canRetire = can('admin');

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [type, setType] = useState('all');
  const [status, setStatus] = useState('all');
  const [park, setPark] = useState(ALL_PARKS);

  const [editing, setEditing] = useState<Asset | null>(null);
  const [creating, setCreating] = useState(false);
  const [detail, setDetail] = useState<Asset | null>(null);
  const [deleting, setDeleting] = useState<Asset | null>(null);
  const [maintaining, setMaintaining] = useState<Asset | null>(null);

  const filters = {
    page,
    limit: 15,
    q: search || undefined,
    type: type === 'all' ? undefined : type,
    status: status === 'all' ? undefined : status,
    park: parkParam(park),
  };

  const assets = useAssets(filters);
  const stats = useAssetStats(parkParam(park));
  const { data: parks } = useParks();

  const createAsset = useCreateAsset();
  const updateAsset = useUpdateAsset();
  const deleteAsset = useDeleteAsset();

  /** Reset to the first page whenever a filter changes, or the view goes blank. */
  const applyFilter = (setter: (value: string) => void) => (value: string) => {
    setter(value);
    setPage(1);
  };

  const columns = useMemo(
    () => [
      {
        key: 'name',
        header: 'Asset',
        render: (asset: Asset) => (
          <div className="min-w-0">
            <p className="truncate font-medium">{asset.name}</p>
            <div className="flex items-center gap-1.5">
              <p className="font-mono text-[11px] text-muted-foreground">{asset.assetCode}</p>
              {isOsm(asset) && <SourceBadge source="osm" compact className="px-1 py-0" />}
            </div>
          </div>
        ),
      },
      {
        key: 'type',
        header: 'Type',
        render: (asset: Asset) => <Badge variant="outline" className="capitalize">{asset.type}</Badge>,
      },
      { key: 'park', header: 'Park', render: (asset: Asset) => parkName(asset.park) },
      {
        key: 'condition',
        header: 'Condition',
        className: 'w-[200px]',
        render: (asset: Asset) => (
          <div className="flex items-center gap-1.5">
            <ScoreBar score={asset.condition} className="flex-1" />
            {asset.demo && <DemoConditionBadge compact className="px-1 py-0" />}
          </div>
        ),
      },
      {
        key: 'status',
        header: 'Status',
        render: (asset: Asset) => <StatusBadge status={asset.status} />,
      },
      {
        key: 'lastMaintenanceAt',
        header: 'Last serviced',
        render: (asset: Asset) => (
          <span className="text-muted-foreground">{shortDate(asset.lastMaintenanceAt)}</span>
        ),
      },
      {
        key: 'actions',
        header: '',
        className: 'w-[130px]',
        render: (asset: Asset) => (
          <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setDetail(asset)} title="History">
              <History className="h-4 w-4" />
            </Button>
            {canEdit && (
              <>
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setMaintaining(asset)} title="Log maintenance">
                  <Wrench className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setEditing(asset)} title="Edit">
                  <Pencil className="h-4 w-4" />
                </Button>
              </>
            )}
            {canRetire && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-destructive"
                onClick={() => setDeleting(asset)}
                title="Retire"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        ),
      },
    ],
    [canEdit, canRetire]
  );

  const selectedPark = parks?.items.find((p) => p.id === parkParam(park));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Park Asset Management"
        description="Digital inventory of every physical asset — trees, plants, benches, lakes, paths, lighting and structures — with condition tracking and maintenance history."
        icon="TreePine"
        action={
          <div className="flex flex-wrap items-center gap-2">
            <ParkFilter value={park} onChange={applyFilter(setPark)} />
            {canEdit && (
              <Button onClick={() => setCreating(true)}>
                <Plus className="mr-2 h-4 w-4" />
                Add asset
              </Button>
            )}
          </div>
        }
      />

      <DataNotice>
        Asset positions and types come from OpenStreetMap (© OpenStreetMap contributors). For assets
        marked &ldquo;Demo condition&rdquo;, the condition score and maintenance history are demonstration
        values — so the mean condition, needs-attention count and maintenance spend below illustrate the
        workflow rather than describe the parks.
      </DataNotice>

      {/* --- Inventory summary --- */}
      <QueryState query={stats} skeleton={<SkeletonCards count={4} height="h-24" />}>
        {(data) => {
          // An empty register has no mean condition; the API reports 0, which is not a score.
          const empty = data.total === 0;
          return (
          <>
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <MetricTile
                label="Total assets"
                value={data.total}
                hint={selectedPark ? `Active in ${selectedPark.name}` : 'Active in the register'}
              />
              <MetricTile
                label="Mean condition"
                value={empty ? NO_DATA : `${data.avgCondition}`}
                hint={empty ? 'No assets in this scope' : '0–100 across every asset'}
                tone={empty ? undefined : data.avgCondition >= 70 ? 'success' : data.avgCondition >= 50 ? 'warning' : 'destructive'}
              />
              <MetricTile
                label="Needs attention"
                value={empty ? NO_DATA : data.needsAttention}
                hint="Condition below 50"
                tone={empty ? undefined : data.needsAttention > 0 ? 'warning' : 'success'}
              />
              <MetricTile
                label="Maintenance spend"
                value={empty ? NO_DATA : `₹${data.maintenanceSpend.toLocaleString()}`}
                hint={selectedPark ? `Logged against ${selectedPark.name} assets` : 'Logged against all assets'}
              />
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Condition by Asset Type</CardTitle>
                <CardDescription>
                  Bars are coloured by mean condition — the weakest class is where a scheduled
                  maintenance cycle pays off most
                </CardDescription>
              </CardHeader>
              <CardContent>
                {data.byType.length === 0 ? (
                  <EmptyState title="No assets in this scope" icon="TreePine" />
                ) : (
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={data.byType}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="type" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                    <YAxis yAxisId="left" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                    <YAxis yAxisId="right" orientation="right" domain={[0, 100]} stroke="hsl(var(--muted-foreground))" fontSize={11} />
                    <Tooltip contentStyle={TOOLTIP_STYLE} />
                    <Bar yAxisId="left" dataKey="count" name="Count" fill="hsl(var(--chart-1))" radius={[4, 4, 0, 0]} />
                    <Bar yAxisId="right" dataKey="avgCondition" name="Mean condition" radius={[4, 4, 0, 0]}>
                      {data.byType.map((row) => (
                        <Cell
                          key={row.type}
                          fill={
                            row.avgCondition >= 70 ? 'hsl(var(--success))'
                            : row.avgCondition >= 50 ? 'hsl(var(--warning))'
                            : 'hsl(var(--destructive))'
                          }
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </>
          );
        }}
      </QueryState>

      {/* --- Filters + table --- */}
      <FilterBar
        search={search}
        onSearch={applyFilter(setSearch)}
        searchPlaceholder="Search by name, code or notes…"
        filters={[
          {
            label: 'Type',
            value: type,
            onChange: applyFilter(setType),
            options: [{ label: 'All types', value: 'all' }, ...ASSET_TYPES.map((t) => ({ label: t, value: t }))],
          },
          {
            label: 'Status',
            value: status,
            onChange: applyFilter(setStatus),
            options: [
              { label: 'All statuses', value: 'all' },
              ...CONDITION_STATUSES.map((s) => ({ label: s, value: s })),
            ],
          },
        ]}
      />

      <QueryState
        query={assets}
        isEmpty={(data) => data.items.length === 0}
        emptyTitle="No assets match those filters"
        emptyDescription="Try clearing the search or widening the type and status filters."
        emptyIcon="TreePine"
        skeleton={<LoadingState label="Loading assets…" />}
      >
        {(data) => (
          <>
            <DataTable
              columns={columns}
              data={data.items}
              rowKey={(asset) => asset.id}
              onRowClick={setDetail}
            />
            <Pagination meta={data.meta} onPageChange={setPage} />
          </>
        )}
      </QueryState>

      {/* --- Create / edit --- */}
      <AssetFormDialog
        open={creating || Boolean(editing)}
        asset={editing}
        parks={parks?.items ?? []}
        defaultParkId={parkParam(park)}
        onClose={() => { setCreating(false); setEditing(null); }}
        // Rejections propagate to the dialog, which keeps itself open and maps field errors.
        onSubmit={async (values) => {
          const payload = {
            name: values.name,
            type: values.type,
            park: values.park,
            condition: values.condition,
            location: makePoint(values.lat, values.lng),
            notes: values.notes,
          };
          if (editing) await updateAsset.mutateAsync({ id: editing.id, body: payload });
          else await createAsset.mutateAsync(payload);
        }}
        submitting={createAsset.isPending || updateAsset.isPending}
      />

      {/* --- Maintenance --- */}
      <MaintenanceDialog asset={maintaining} onClose={() => setMaintaining(null)} />

      {/* --- Detail --- */}
      <AssetDetailSheet asset={detail} onClose={() => setDetail(null)} />

      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Retire ${deleting?.name}?`}
        description="The asset is marked inactive rather than erased, so its maintenance history and any work orders referencing it stay intact."
        confirmLabel="Retire asset"
        onConfirm={async () => {
          if (!deleting) return;
          try {
            await deleteAsset.mutateAsync(deleting.id);
          } catch {
            /* toast already shown */
          }
        }}
      />
    </div>
  );
}

/** Create / edit form. */
function AssetFormDialog({
  open, asset, parks, defaultParkId, onClose, onSubmit, submitting,
}: {
  open: boolean;
  asset: Asset | null;
  parks: ParkOption[];
  /** The page's park filter, used to pre-fill a new asset's park and location. */
  defaultParkId?: string;
  onClose: () => void;
  onSubmit: (values: AssetValues) => Promise<void>;
  submitting: boolean;
}) {
  const defaultPark = parks.find((p) => p.id === defaultParkId);

  const form = useForm<AssetValues>({
    resolver: zodResolver(assetSchema),
    values: asset
      ? {
          name: asset.name,
          type: asset.type,
          park: typeof asset.park === 'object' ? asset.park.id : asset.park,
          condition: asset.condition,
          lat: asset.location.coordinates[1],
          lng: asset.location.coordinates[0],
          notes: asset.notes,
        }
      : {
          name: '',
          type: 'tree',
          park: defaultPark?.id ?? '',
          condition: 85,
          // Unset until a park is chosen — never 0,0, which the API rejects.
          lat: (defaultPark?.location.coordinates[1] ?? undefined) as number,
          lng: (defaultPark?.location.coordinates[0] ?? undefined) as number,
          notes: '',
        },
  });

  const condition = form.watch('condition');
  const selectedPark = form.watch('park');

  const setCentre = (park: ParkOption) => {
    const validate = form.formState.isSubmitted;
    form.setValue('lng', park.location.coordinates[0], { shouldValidate: validate });
    form.setValue('lat', park.location.coordinates[1], { shouldValidate: validate });
  };

  /**
   * Placing a new asset at 0,0 puts it in the Atlantic. Defaulting to the
   * park centre gives a sensible starting point the user can then nudge.
   */
  const applyParkCentre = () => {
    const park = parks.find((p) => p.id === selectedPark);
    if (park) setCentre(park);
  };

  /**
   * Choosing a park for a new asset moves the location to that park's centre,
   * unless the user has already typed a position of their own.
   */
  const onParkChange = (id: string) => {
    const previous = parks.find((p) => p.id === form.getValues('park'));
    form.setValue('park', id, { shouldValidate: form.formState.isSubmitted });
    const next = parks.find((p) => p.id === id);
    if (asset || !next) return;

    const lat = form.getValues('lat');
    const lng = form.getValues('lng');
    const unset = lat == null || lng == null || Number.isNaN(lat) || Number.isNaN(lng) || (lat === 0 && lng === 0);
    const atPreviousCentre =
      previous && lat === previous.location.coordinates[1] && lng === previous.location.coordinates[0];
    if (unset || atPreviousCentre) setCentre(next);
  };

  const handle = form.handleSubmit(async (values) => {
    try {
      await onSubmit(values);
      onClose();
      form.reset();
    } catch (err) {
      // The mutation has already toasted; also pin server validation onto the fields.
      if (err instanceof ApiError && err.details) {
        for (const [key, message] of Object.entries(err.details)) {
          if (key.startsWith('location')) form.setError('lat', { message });
          else if (['name', 'type', 'park', 'condition', 'notes'].includes(key)) {
            form.setError(key as keyof AssetValues, { message });
          }
        }
      }
    }
  });

  const coordinateInput = { setValueAs: (v: unknown) => (v === '' || v == null ? undefined : Number(v)) };
  const locationError = form.formState.errors.lat?.message ?? form.formState.errors.lng?.message;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{asset ? 'Edit asset' : 'Add an asset'}</DialogTitle>
          <DialogDescription>
            {asset
              ? `Updating ${asset.assetCode}. Status is derived from the condition value automatically.`
              : 'The asset code is generated from the type once you save.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handle} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="name">Name</Label>
            <Input id="name" placeholder="Heritage Banyan #12" {...form.register('name')} />
            {form.formState.errors.name && (
              <p className="text-xs text-destructive">{form.formState.errors.name.message}</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select value={form.watch('type')} onValueChange={(v) => form.setValue('type', v as AssetType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ASSET_TYPES.map((t) => (
                    <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Park</Label>
              <Select value={selectedPark} onValueChange={onParkChange}>
                <SelectTrigger><SelectValue placeholder="Select a park" /></SelectTrigger>
                <SelectContent>
                  {parks.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {form.formState.errors.park && (
                <p className="text-xs text-destructive">{form.formState.errors.park.message}</p>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Condition</Label>
              <span className="text-sm font-medium tabular-nums">{condition} / 100</span>
            </div>
            <Slider
              value={[condition]}
              onValueChange={([v]) => form.setValue('condition', v)}
              min={0}
              max={100}
              step={1}
            />
            <p className="text-xs text-muted-foreground">
              85+ excellent · 70+ good · 50+ fair · 30+ poor · below 30 critical
            </p>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label>Location</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 text-xs"
                onClick={applyParkCentre}
                disabled={!selectedPark}
              >
                Use park centre
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Input type="number" step="any" placeholder="Latitude" aria-label="Latitude" {...form.register('lat', coordinateInput)} />
              <Input type="number" step="any" placeholder="Longitude" aria-label="Longitude" {...form.register('lng', coordinateInput)} />
            </div>
            {locationError ? (
              <p className="text-xs text-destructive">{locationError}</p>
            ) : (
              !asset && (
                <p className="text-xs text-muted-foreground">
                  Choosing a park starts the location at its centre; adjust it to the asset&apos;s position.
                </p>
              )
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="notes">Notes</Label>
            <Textarea id="notes" rows={3} placeholder="Anything a field officer should know…" {...form.register('notes')} />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Saving…' : asset ? 'Save changes' : 'Add asset'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Log a maintenance visit against an asset. */
function MaintenanceDialog({ asset, onClose }: { asset: Asset | null; onClose: () => void }) {
  const addMaintenance = useAddMaintenance();
  const [type, setType] = useState('Inspection');
  const [description, setDescription] = useState('');
  const [cost, setCost] = useState('');
  const [technician, setTechnician] = useState('');

  const submit = async () => {
    if (!asset) return;
    try {
      await addMaintenance.mutateAsync({
        id: asset.id,
        body: { type, description, cost: Number(cost) || 0, technician },
      });
      setDescription(''); setCost(''); setTechnician('');
      onClose();
    } catch {
      /* toast already shown; keep the dialog open so nothing typed is lost */
    }
  };

  return (
    <Dialog open={Boolean(asset)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Log maintenance</DialogTitle>
          <DialogDescription>
            {asset?.name} · condition currently {asset?.condition}/100
            {asset?.demo && ' (a demonstration value)'}. Recording work also advances the condition, so
            the register does not stay pessimistic after a repair.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Work type</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {['Inspection', 'Pruning', 'Cleaning', 'Repair', 'Repainting', 'Irrigation', 'Replacement'].map((t) => (
                  <SelectItem key={t} value={t}>{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>What was done</Label>
            <Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Cost (₹)</Label>
              <Input type="number" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="0" />
            </div>
            <div className="space-y-1.5">
              <Label>Technician / team</Label>
              <Input value={technician} onChange={(e) => setTechnician(e.target.value)} placeholder="Grounds Crew A" />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={addMaintenance.isPending}>
            {addMaintenance.isPending ? 'Recording…' : 'Record maintenance'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Full history for one asset. */
function AssetDetailSheet({ asset, onClose }: { asset: Asset | null; onClose: () => void }) {
  const history = useAssetHistory(asset?.id ?? '');

  return (
    <Sheet open={Boolean(asset)} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{asset?.name}</SheetTitle>
          <SheetDescription className="font-mono text-xs">{asset?.assetCode}</SheetDescription>
        </SheetHeader>

        {asset && (
          <div className="mt-6 space-y-6">
            {(isOsm(asset) || asset.demo) && (
              <div className="space-y-2 rounded-lg border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  {isOsm(asset) && <SourceBadge source="osm" />}
                  {asset.demo && <DemoConditionBadge />}
                  {isOsm(asset) && (
                    <a
                      href={osmUrl(asset.source!.id)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                    >
                      <ExternalLink className="h-3 w-3" />
                      {asset.source!.id} on OpenStreetMap
                    </a>
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {isOsm(asset) && 'Position and type from OpenStreetMap (© OpenStreetMap contributors). '}
                  {asset.demo && 'Condition and maintenance history are demonstration values.'}
                </p>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <MetricTile
                label="Condition"
                value={asset.condition}
                hint={asset.demo ? `${asset.status} · demonstration value` : asset.status}
              />
              <MetricTile label="Installed" value={shortDate(asset.installedAt)} hint="Date entered service" />
            </div>

            {Object.values(asset.attributes ?? {}).some((value) => value !== '' && value != null) && (
              <div>
                <p className="mb-2 text-sm font-medium">Attributes</p>
                <div className="space-y-1 rounded-lg border p-3">
                  {Object.entries(asset.attributes)
                    .filter(([, value]) => value !== '' && value != null)
                    .map(([key, value]) => (
                    <p key={key} className="flex justify-between text-xs">
                      <span className="capitalize text-muted-foreground">
                        {key.replace(/([A-Z])/g, ' $1')}
                      </span>
                      <span className="font-medium">{value}</span>
                    </p>
                  ))}
                </div>
              </div>
            )}

            {asset.notes && (
              <div>
                <p className="mb-2 text-sm font-medium">Notes</p>
                <p className="rounded-lg bg-muted p-3 text-sm">{asset.notes}</p>
              </div>
            )}

            <div>
              <p className="mb-2 flex items-center gap-2 text-sm font-medium">
                Maintenance history
                {asset.demo && <DemoConditionBadge compact />}
              </p>
              {history.isPending ? (
                <LoadingState label="Loading history…" />
              ) : history.isError ? (
                <ErrorState error={history.error} onRetry={() => history.refetch()} />
              ) : !history.data.maintenance.length ? (
                <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
                  No maintenance recorded yet.
                </p>
              ) : (
                <div className="space-y-2">
                  {history.data.maintenance.map((record, index) => (
                    <div key={record.id ?? index} className="rounded-lg border p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-medium">{record.type}</p>
                          <p className="text-xs text-muted-foreground">{record.description}</p>
                        </div>
                        <span className="shrink-0 text-xs tabular-nums">₹{record.cost.toLocaleString()}</span>
                      </div>
                      <p className="mt-1.5 text-[11px] text-muted-foreground">
                        {shortDate(record.date)} · {record.technician || 'Unattributed'}
                      </p>
                    </div>
                  ))}
                  <p className="pt-1 text-right text-xs font-medium">
                    Total spend: ₹{history.data.totalSpend.toLocaleString()}
                  </p>
                </div>
              )}
            </div>

            {(history.data?.workOrders.length ?? 0) > 0 && (
              <div>
                <p className="mb-2 text-sm font-medium">Related work orders</p>
                <div className="space-y-2">
                  {history.data!.workOrders.map((order) => (
                    <div key={order.id} className="flex items-center justify-between rounded-lg border p-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{order.title}</p>
                        <p className="font-mono text-[11px] text-muted-foreground">{order.orderCode}</p>
                      </div>
                      <StatusBadge status={order.status} />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {asset.condition < 50 && (
              <div className="flex items-start gap-2.5 rounded-lg bg-warning/10 p-3">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                <p className="text-xs">
                  This asset is below a condition of 50 and should be prioritised for a work
                  order.
                  {(asset.type === 'tree' || asset.type === 'plant') &&
                    ' Trees and plants in poor condition also drag down the park’s tree-health sub-index, and through it the Ecosystem Health Index.'}
                  {asset.demo && ' (The condition is a demonstration value.)'}
                </p>
              </div>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
