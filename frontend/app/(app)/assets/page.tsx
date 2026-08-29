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
import { Plus, Pencil, Trash2, Wrench, History, TreePine, AlertTriangle } from 'lucide-react';
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
import { PageHeader } from '@/components/shared/page-header';
import { DataTable } from '@/components/shared/data-table';
import { FilterBar } from '@/components/shared/filter-bar';
import { Pagination } from '@/components/shared/pagination';
import { StatusBadge } from '@/components/shared/status-badges';
import { MetricTile, ScoreBar } from '@/components/shared/score-badge';
import { ParkFilter, ALL_PARKS, parkParam } from '@/components/shared/park-filter';
import { QueryState, SkeletonCards, LoadingState } from '@/components/shared/query-state';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { useAuth } from '@/components/providers/auth-provider';
import {
  useAssets, useAssetStats, useAssetHistory, useParks,
  useCreateAsset, useUpdateAsset, useDeleteAsset, useAddMaintenance,
} from '@/lib/hooks/use-api';
import { makePoint } from '@/lib/api/geo';
import type { Asset, AssetType } from '@/lib/types';

const ASSET_TYPES: AssetType[] = ['tree', 'plant', 'bench', 'lake', 'path', 'light', 'structure'];
const CONDITION_STATUSES = ['excellent', 'good', 'fair', 'poor', 'critical'];

const TOOLTIP_STYLE = {
  background: 'hsl(var(--popover))',
  border: '1px solid hsl(var(--border))',
  borderRadius: 'var(--radius)',
  fontSize: 12,
};

/** Matches the server's `assets.create` schema, minus the fields we derive. */
const assetSchema = z.object({
  name: z.string().min(2, 'Give the asset a name'),
  type: z.enum(['tree', 'plant', 'bench', 'lake', 'path', 'light', 'structure']),
  park: z.string().min(1, 'Select a park'),
  condition: z.number().min(0).max(100),
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  notes: z.string().max(2000).optional(),
});

type AssetValues = z.infer<typeof assetSchema>;

const parkName = (park: Asset['park']) => (typeof park === 'object' && park ? park.name : '—');
const shortDate = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString() : '—');

export default function AssetsPage() {
  const { can } = useAuth();
  const canEdit = can('officer');

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
            <p className="font-mono text-[11px] text-muted-foreground">{asset.assetCode}</p>
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
        className: 'w-[180px]',
        render: (asset: Asset) => <ScoreBar score={asset.condition} />,
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
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-destructive"
                  onClick={() => setDeleting(asset)}
                  title="Retire"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </>
            )}
          </div>
        ),
      },
    ],
    [canEdit]
  );

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

      {/* --- Inventory summary --- */}
      <QueryState query={stats} skeleton={<SkeletonCards count={4} height="h-24" />}>
        {(data) => (
          <>
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <MetricTile label="Total assets" value={data.total} hint="Active in the register" />
              <MetricTile
                label="Mean condition"
                value={`${data.avgCondition}`}
                hint="0–100 across every asset"
                tone={data.avgCondition >= 70 ? 'success' : data.avgCondition >= 50 ? 'warning' : 'destructive'}
              />
              <MetricTile
                label="Needs attention"
                value={data.needsAttention}
                hint="Condition below 50"
                tone={data.needsAttention > 0 ? 'warning' : 'success'}
              />
              <MetricTile
                label="Maintenance spend"
                value={`₹${data.maintenanceSpend.toLocaleString()}`}
                hint="Logged against all assets"
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
              </CardContent>
            </Card>
          </>
        )}
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
        onClose={() => { setCreating(false); setEditing(null); }}
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
          if (deleting) await deleteAsset.mutateAsync(deleting.id);
        }}
      />
    </div>
  );
}

/** Create / edit form. */
function AssetFormDialog({
  open, asset, parks, onClose, onSubmit, submitting,
}: {
  open: boolean;
  asset: Asset | null;
  parks: { id: string; name: string; location: { coordinates: [number, number] } }[];
  onClose: () => void;
  onSubmit: (values: AssetValues) => Promise<void>;
  submitting: boolean;
}) {
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
      : { name: '', type: 'tree', park: '', condition: 85, lat: 0, lng: 0, notes: '' },
  });

  const condition = form.watch('condition');
  const selectedPark = form.watch('park');

  /**
   * Placing a new asset at 0,0 puts it in the Atlantic. Defaulting to the
   * park centre gives a sensible starting point the user can then nudge.
   */
  const applyParkCentre = () => {
    const park = parks.find((p) => p.id === selectedPark);
    if (park) {
      form.setValue('lng', park.location.coordinates[0]);
      form.setValue('lat', park.location.coordinates[1]);
    }
  };

  const handle = form.handleSubmit(async (values) => {
    await onSubmit(values);
    onClose();
    form.reset();
  });

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
              <Select value={selectedPark} onValueChange={(v) => form.setValue('park', v)}>
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
              <Input type="number" step="any" placeholder="Latitude" {...form.register('lat')} />
              <Input type="number" step="any" placeholder="Longitude" {...form.register('lng')} />
            </div>
            {(form.formState.errors.lat || form.formState.errors.lng) && (
              <p className="text-xs text-destructive">Enter a valid latitude and longitude.</p>
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
    await addMaintenance.mutateAsync({
      id: asset.id,
      body: { type, description, cost: Number(cost) || 0, technician },
    });
    setDescription(''); setCost(''); setTechnician('');
    onClose();
  };

  return (
    <Dialog open={Boolean(asset)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Log maintenance</DialogTitle>
          <DialogDescription>
            {asset?.name} · condition currently {asset?.condition}/100. Recording work also
            advances the condition, so the register does not stay pessimistic after a repair.
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
            <div className="grid grid-cols-2 gap-3">
              <MetricTile label="Condition" value={asset.condition} hint={asset.status} />
              <MetricTile label="Installed" value={shortDate(asset.installedAt)} hint="Date entered service" />
            </div>

            {Object.keys(asset.attributes ?? {}).length > 0 && (
              <div>
                <p className="mb-2 text-sm font-medium">Attributes</p>
                <div className="space-y-1 rounded-lg border p-3">
                  {Object.entries(asset.attributes).map(([key, value]) => (
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
              <p className="mb-2 text-sm font-medium">Maintenance history</p>
              {history.isPending ? (
                <LoadingState label="Loading history…" />
              ) : !history.data?.maintenance.length ? (
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
                  order. Assets in poor condition also drag down the park&apos;s tree-health
                  sub-index, and through it the Ecosystem Health Index.
                </p>
              </div>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
