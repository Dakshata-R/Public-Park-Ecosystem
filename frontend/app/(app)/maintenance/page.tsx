'use client';

/**
 * Module 9 — Maintenance Management.
 *
 * Work orders are the planned counterpart to incidents: incidents are
 * unplanned events, work orders are scheduled tasks. Completing one is what
 * actually restores an asset's condition, which is why the asset register and
 * the maintenance log cannot drift apart — the same mutation writes both.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { Plus, ChevronLeft, ChevronRight, Users, CircleCheck } from 'lucide-react';
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
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PageHeader } from '@/components/shared/page-header';
import { FilterBar } from '@/components/shared/filter-bar';
import { Pagination } from '@/components/shared/pagination';
import { StatusBadge, PriorityBadge } from '@/components/shared/status-badges';
import { MetricTile } from '@/components/shared/score-badge';
import { ParkFilter, ALL_PARKS, parkParam } from '@/components/shared/park-filter';
import { QueryState, SkeletonCards, LoadingState, EmptyState } from '@/components/shared/query-state';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { useAuth } from '@/components/providers/auth-provider';
import {
  useWorkOrders, useMaintenanceCalendar, useMaintenanceStats, useParks, useAssets, useUsers,
  useCreateWorkOrder, useUpdateProgress, useDeleteWorkOrder,
} from '@/lib/hooks/use-api';
import { cn } from '@/lib/utils';
import type { WorkOrder, WorkOrderType } from '@/lib/types';

const WORK_ORDER_TYPES: WorkOrderType[] = [
  'cleaning', 'tree-trimming', 'repair', 'lake-cleaning', 'inspection', 'planting', 'irrigation',
];

const STATUSES = ['scheduled', 'in-progress', 'completed', 'overdue', 'cancelled'];

const TOOLTIP_STYLE = {
  background: 'hsl(var(--popover))',
  border: '1px solid hsl(var(--border))',
  borderRadius: 'var(--radius)',
  fontSize: 12,
};

const workOrderSchema = z.object({
  type: z.enum(WORK_ORDER_TYPES as [WorkOrderType, ...WorkOrderType[]]),
  title: z.string().min(4, 'Give the work order a clear title').max(200),
  description: z.string().max(2000).optional(),
  park: z.string().min(1, 'Select a park'),
  asset: z.string().optional(),
  assignedTo: z.string().optional(),
  assignedTeam: z.string().optional(),
  scheduledDate: z.string().min(1, 'Pick a date'),
  priority: z.enum(['low', 'medium', 'high', 'critical']),
  estimatedCost: z.coerce.number().min(0),
  estimatedHours: z.coerce.number().min(0),
});

type WorkOrderValues = z.infer<typeof workOrderSchema>;

const typeLabel = (type: string) => type.replace(/-/g, ' ');
const parkName = (park: WorkOrder['park']) => (typeof park === 'object' && park ? park.name : '');
const assigneeName = (order: WorkOrder) =>
  (typeof order.assignedTo === 'object' && order.assignedTo ? order.assignedTo.name : null) ||
  order.assignedTeam ||
  'Unassigned';

export default function MaintenancePage() {
  const { can } = useAuth();
  const [park, setPark] = useState(ALL_PARKS);
  const [creating, setCreating] = useState(false);
  const [detail, setDetail] = useState<WorkOrder | null>(null);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Maintenance Management"
        description="Work orders, scheduling and progress tracking. Completing an order logs the work against its asset and restores the asset's condition."
        icon="Wrench"
        action={
          <div className="flex flex-wrap items-center gap-2">
            <ParkFilter value={park} onChange={setPark} />
            {can('officer') && (
              <Button onClick={() => setCreating(true)}>
                <Plus className="mr-2 h-4 w-4" />
                New work order
              </Button>
            )}
          </div>
        }
      />

      <Tabs defaultValue="board" className="space-y-4">
        <TabsList>
          <TabsTrigger value="board">Work orders</TabsTrigger>
          <TabsTrigger value="calendar">Calendar</TabsTrigger>
          <TabsTrigger value="workload">Workload</TabsTrigger>
        </TabsList>

        <TabsContent value="board"><BoardTab park={parkParam(park)} onSelect={setDetail} /></TabsContent>
        <TabsContent value="calendar"><CalendarTab park={parkParam(park)} onSelect={setDetail} /></TabsContent>
        <TabsContent value="workload"><WorkloadTab park={parkParam(park)} /></TabsContent>
      </Tabs>

      <WorkOrderFormDialog open={creating} onClose={() => setCreating(false)} />
      <WorkOrderSheet order={detail} onClose={() => setDetail(null)} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Board
// ---------------------------------------------------------------------------

function BoardTab({ park, onSelect }: { park?: string; onSelect: (o: WorkOrder) => void }) {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [type, setType] = useState('all');
  const [status, setStatus] = useState('all');

  const stats = useMaintenanceStats(park);
  const query = useWorkOrders({
    page,
    limit: 15,
    park,
    q: search || undefined,
    type: type === 'all' ? undefined : type,
    status: status === 'all' ? undefined : status,
  });

  const applyFilter = (setter: (v: string) => void) => (value: string) => {
    setter(value);
    setPage(1);
  };

  return (
    <div className="space-y-4">
      <QueryState query={stats} skeleton={<SkeletonCards count={4} height="h-24" />}>
        {(data) => (
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <MetricTile label="Total orders" value={data.totals.total} />
            <MetricTile
              label="In progress"
              value={data.totals.inProgress}
              tone={data.totals.inProgress > 0 ? 'warning' : undefined}
            />
            <MetricTile
              label="Overdue"
              value={data.totals.overdue}
              hint="Past the scheduled date"
              tone={data.totals.overdue > 0 ? 'destructive' : 'success'}
            />
            <MetricTile
              label="Completion rate"
              value={`${data.totals.completionRate}%`}
              hint={`₹${data.totals.actualCost.toLocaleString()} actual spend`}
              tone={data.totals.completionRate >= 70 ? 'success' : 'warning'}
            />
          </div>
        )}
      </QueryState>

      <FilterBar
        search={search}
        onSearch={applyFilter(setSearch)}
        searchPlaceholder="Search work orders…"
        filters={[
          {
            label: 'Type',
            value: type,
            onChange: applyFilter(setType),
            options: [
              { label: 'All types', value: 'all' },
              ...WORK_ORDER_TYPES.map((t) => ({ label: typeLabel(t), value: t })),
            ],
          },
          {
            label: 'Status',
            value: status,
            onChange: applyFilter(setStatus),
            options: [
              { label: 'All statuses', value: 'all' },
              ...STATUSES.map((s) => ({ label: typeLabel(s), value: s })),
            ],
          },
        ]}
      />

      <QueryState
        query={query}
        isEmpty={(data) => data.items.length === 0}
        emptyTitle="No work orders match those filters"
        emptyIcon="Wrench"
        skeleton={<LoadingState label="Loading work orders…" />}
      >
        {(data) => (
          <>
            <div className="space-y-2">
              {data.items.map((order) => (
                <Card
                  key={order.id}
                  onClick={() => onSelect(order)}
                  className={cn(
                    'cursor-pointer transition-colors hover:bg-muted/40',
                    order.status === 'overdue' && 'border-l-4 border-l-destructive'
                  )}
                >
                  <CardContent className="flex flex-wrap items-center gap-4 p-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium">{order.title}</p>
                        <PriorityBadge priority={order.priority} />
                        <StatusBadge status={order.status} />
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        <span className="font-mono">{order.orderCode}</span> ·{' '}
                        <span className="capitalize">{typeLabel(order.type)}</span> ·{' '}
                        {parkName(order.park)} · {new Date(order.scheduledDate).toLocaleDateString()}
                        {order.assetName && ` · ${order.assetName}`}
                      </p>
                    </div>

                    <div className="w-full sm:w-40">
                      <div className="mb-1 flex justify-between text-[11px] text-muted-foreground">
                        <span className="truncate">{assigneeName(order)}</span>
                        <span>{order.progress}%</span>
                      </div>
                      <Progress
                        value={order.progress}
                        className={cn('h-2', order.status === 'overdue' && '[&>div]:bg-destructive')}
                      />
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
            <Pagination meta={data.meta} onPageChange={setPage} />
          </>
        )}
      </QueryState>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Calendar
// ---------------------------------------------------------------------------

const STATUS_DOT: Record<string, string> = {
  scheduled: 'bg-muted-foreground',
  'in-progress': 'bg-warning',
  completed: 'bg-success',
  overdue: 'bg-destructive',
  cancelled: 'bg-muted',
};

function CalendarTab({ park, onSelect }: { park?: string; onSelect: (o: WorkOrder) => void }) {
  // Month cursor as an offset from the current month, so "today" needs no
  // special casing when the component mounts.
  const [monthOffset, setMonthOffset] = useState(0);

  const cursor = useMemo(() => {
    const date = new Date();
    date.setDate(1);
    date.setMonth(date.getMonth() + monthOffset);
    return date;
  }, [monthOffset]);

  const monthKey = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`;
  const query = useMaintenanceCalendar(monthKey, park);

  /**
   * Grid cells for the month, padded so the first day lands on the correct
   * weekday. Nulls are the leading blanks.
   */
  const cells = useMemo(() => {
    const firstWeekday = new Date(cursor.getFullYear(), cursor.getMonth(), 1).getDay();
    const daysInMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
    const out: (number | null)[] = Array.from({ length: firstWeekday }, () => null);
    for (let day = 1; day <= daysInMonth; day += 1) out.push(day);
    return out;
  }, [cursor]);

  const todayKey = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => setMonthOffset((m) => m - 1)} aria-label="Previous month">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <p className="min-w-[160px] text-center font-medium">
            {cursor.toLocaleDateString([], { month: 'long', year: 'numeric' })}
          </p>
          <Button variant="outline" size="icon" onClick={() => setMonthOffset((m) => m + 1)} aria-label="Next month">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        {monthOffset !== 0 && (
          <Button variant="ghost" size="sm" onClick={() => setMonthOffset(0)}>Today</Button>
        )}
      </div>

      <QueryState query={query} skeleton={<LoadingState label="Loading calendar…" />}>
        {(data) => (
          <Card>
            <CardContent className="p-3">
              <div className="grid grid-cols-7 gap-1">
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((label) => (
                  <div key={label} className="pb-2 text-center text-[11px] font-medium text-muted-foreground">
                    {label}
                  </div>
                ))}

                {cells.map((day, index) => {
                  if (day === null) return <div key={`blank-${index}`} />;

                  const key = `${monthKey}-${String(day).padStart(2, '0')}`;
                  const orders = data.days[key] ?? [];
                  const isToday = key === todayKey;

                  return (
                    <div
                      key={key}
                      className={cn(
                        'min-h-[92px] rounded-lg border p-1.5 transition-colors',
                        isToday && 'border-primary bg-primary/5',
                        orders.length > 0 && !isToday && 'bg-muted/30'
                      )}
                    >
                      <p className={cn('mb-1 text-[11px]', isToday ? 'font-bold text-primary' : 'text-muted-foreground')}>
                        {day}
                      </p>
                      <div className="space-y-0.5">
                        {orders.slice(0, 3).map((order) => (
                          <button
                            key={order.id}
                            onClick={() => onSelect(order)}
                            className="flex w-full items-center gap-1 rounded px-1 py-0.5 text-left text-[10px] transition-colors hover:bg-muted"
                          >
                            <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', STATUS_DOT[order.status])} />
                            <span className="truncate">{order.title}</span>
                          </button>
                        ))}
                        {orders.length > 3 && (
                          <p className="px-1 text-[10px] text-muted-foreground">+{orders.length - 3} more</p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="mt-3 flex flex-wrap gap-3 border-t pt-3">
                {Object.entries(STATUS_DOT).map(([status, colour]) => (
                  <div key={status} className="flex items-center gap-1.5 text-[11px]">
                    <span className={cn('h-2 w-2 rounded-full', colour)} />
                    <span className="capitalize text-muted-foreground">{typeLabel(status)}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </QueryState>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Workload
// ---------------------------------------------------------------------------

function WorkloadTab({ park }: { park?: string }) {
  const query = useMaintenanceStats(park);

  return (
    <QueryState query={query} skeleton={<SkeletonCards count={4} />}>
      {(data) => {
        const busiest = Math.max(1, ...data.workload.map((p) => p.open));

        return (
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <MetricTile label="Completed" value={data.totals.completed} tone="success" />
              <MetricTile label="Estimated cost" value={`₹${data.totals.estimatedCost.toLocaleString()}`} />
              <MetricTile
                label="Actual cost"
                value={`₹${data.totals.actualCost.toLocaleString()}`}
                hint={
                  data.totals.estimatedCost > 0
                    ? `${Math.round((data.totals.actualCost / data.totals.estimatedCost) * 100)}% of estimate`
                    : undefined
                }
                tone={data.totals.actualCost > data.totals.estimatedCost ? 'warning' : 'success'}
              />
              <MetricTile label="Crew engaged" value={data.workload.length} hint="With open assignments" />
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Cost by Work Type</CardTitle>
                  <CardDescription>Where the maintenance budget actually goes</CardDescription>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={280}>
                    <BarChart data={data.byType} margin={{ bottom: 40 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis
                        dataKey="type"
                        angle={-30}
                        textAnchor="end"
                        height={70}
                        interval={0}
                        stroke="hsl(var(--muted-foreground))"
                        fontSize={10}
                        tickFormatter={typeLabel}
                      />
                      <YAxis yAxisId="left" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                      <YAxis yAxisId="right" orientation="right" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                      <Tooltip contentStyle={TOOLTIP_STYLE} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Bar yAxisId="left" dataKey="count" name="Orders" fill="hsl(var(--chart-1))" radius={[4, 4, 0, 0]} />
                      <Bar yAxisId="right" dataKey="cost" name="Cost (₹)" fill="hsl(var(--chart-3))" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Orders by Status</CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={280}>
                    <PieChart>
                      <Pie data={data.byStatus} dataKey="count" nameKey="status" cx="50%" cy="50%" outerRadius={90} innerRadius={55} paddingAngle={2}>
                        {data.byStatus.map((row) => (
                          <Cell
                            key={row.status}
                            fill={
                              row.status === 'completed' ? 'hsl(var(--success))'
                              : row.status === 'overdue' ? 'hsl(var(--destructive))'
                              : row.status === 'in-progress' ? 'hsl(var(--warning))'
                              : 'hsl(var(--muted-foreground))'
                            }
                          />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={TOOLTIP_STYLE} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="mt-2 flex flex-wrap justify-center gap-3">
                    {data.byStatus.map((row) => (
                      <div key={row.status} className="flex items-center gap-1.5 text-[11px]">
                        <span className="capitalize text-muted-foreground">{typeLabel(row.status)}</span>
                        <span className="font-medium">{row.count}</span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Users className="h-5 w-5" />
                  Open Assignments per Person
                </CardTitle>
                <CardDescription>
                  An unbalanced column here is the case for reallocating crew, not for hiring
                </CardDescription>
              </CardHeader>
              <CardContent>
                {!data.workload.length ? (
                  <EmptyState title="Nothing assigned" icon="Users" className="py-8" />
                ) : (
                  <div className="space-y-2">
                    {data.workload.map((person) => (
                      <div key={person.name} className="flex items-center gap-3">
                        <span className="w-40 shrink-0 truncate text-sm">{person.name}</span>
                        <Badge variant="outline" className="shrink-0 text-[10px] capitalize">{person.role}</Badge>
                        <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                          <div
                            className={cn('h-full rounded-full', person.open >= busiest * 0.8 ? 'bg-warning' : 'bg-primary')}
                            style={{ width: `${(person.open / busiest) * 100}%` }}
                          />
                        </div>
                        <span className="w-6 shrink-0 text-right text-sm font-medium tabular-nums">{person.open}</span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        );
      }}
    </QueryState>
  );
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

function WorkOrderFormDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data: parks } = useParks();
  const createWorkOrder = useCreateWorkOrder();

  const form = useForm<WorkOrderValues>({
    resolver: zodResolver(workOrderSchema),
    defaultValues: {
      type: 'inspection', title: '', description: '', park: '', asset: '',
      assignedTo: '', assignedTeam: '', priority: 'medium',
      scheduledDate: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10),
      estimatedCost: 0, estimatedHours: 2,
    },
  });

  const selectedPark = form.watch('park');

  // Only assets in the chosen park can be the target of the order.
  const { data: assets } = useAssets(selectedPark ? { park: selectedPark, limit: 100 } : { limit: 1 });
  const { data: staff } = useUsers({ role: 'officer', limit: 50 });

  const submit = form.handleSubmit(async (values) => {
    await createWorkOrder.mutateAsync({
      type: values.type,
      title: values.title,
      description: values.description,
      park: values.park,
      asset: values.asset || null,
      assetName: assets?.items.find((a) => a.id === values.asset)?.name ?? '',
      assignedTo: values.assignedTo || null,
      assignedTeam: values.assignedTeam,
      scheduledDate: values.scheduledDate,
      priority: values.priority,
      estimatedCost: values.estimatedCost,
      estimatedHours: values.estimatedHours,
    });
    form.reset();
    onClose();
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New work order</DialogTitle>
          <DialogDescription>
            Linking the order to an asset means completing it will restore that asset&apos;s
            condition and append to its maintenance history automatically.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select value={form.watch('type')} onValueChange={(v) => form.setValue('type', v as WorkOrderType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {WORK_ORDER_TYPES.map((t) => (
                    <SelectItem key={t} value={t} className="capitalize">{typeLabel(t)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Priority</Label>
              <Select
                value={form.watch('priority')}
                onValueChange={(v) => form.setValue('priority', v as WorkOrderValues['priority'])}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {['low', 'medium', 'high', 'critical'].map((p) => (
                    <SelectItem key={p} value={p} className="capitalize">{p}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="title">Title</Label>
            <Input id="title" placeholder="Crown reduction and deadwood removal" {...form.register('title')} />
            {form.formState.errors.title && (
              <p className="text-xs text-destructive">{form.formState.errors.title.message}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="description">Description</Label>
            <Textarea id="description" rows={3} {...form.register('description')} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Park</Label>
              <Select
                value={selectedPark}
                onValueChange={(v) => { form.setValue('park', v); form.setValue('asset', ''); }}
              >
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>
                  {parks?.items.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {form.formState.errors.park && (
                <p className="text-xs text-destructive">{form.formState.errors.park.message}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Asset (optional)</Label>
              <Select value={form.watch('asset')} onValueChange={(v) => form.setValue('asset', v)} disabled={!selectedPark}>
                <SelectTrigger>
                  <SelectValue placeholder={selectedPark ? 'Select an asset' : 'Choose a park first'} />
                </SelectTrigger>
                <SelectContent>
                  {assets?.items.map((asset) => (
                    <SelectItem key={asset.id} value={asset.id}>
                      {asset.name} ({asset.condition}/100)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Assign to</Label>
              <Select value={form.watch('assignedTo')} onValueChange={(v) => form.setValue('assignedTo', v)}>
                <SelectTrigger><SelectValue placeholder="Optional" /></SelectTrigger>
                <SelectContent>
                  {staff?.items.map((user) => (
                    <SelectItem key={user.id} value={user.id}>{user.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="assignedTeam">Team</Label>
              <Input id="assignedTeam" placeholder="Grounds Crew A" {...form.register('assignedTeam')} />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="scheduledDate">Date</Label>
              <Input id="scheduledDate" type="date" {...form.register('scheduledDate')} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="estimatedHours">Hours</Label>
              <Input id="estimatedHours" type="number" min={0} step="0.5" {...form.register('estimatedHours')} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="estimatedCost">Cost (₹)</Label>
              <Input id="estimatedCost" type="number" min={0} {...form.register('estimatedCost')} />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={createWorkOrder.isPending}>
              {createWorkOrder.isPending ? 'Scheduling…' : 'Schedule work order'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------

function WorkOrderSheet({ order, onClose }: { order: WorkOrder | null; onClose: () => void }) {
  const { can } = useAuth();
  const updateProgress = useUpdateProgress();
  const deleteOrder = useDeleteWorkOrder();

  const [progress, setProgress] = useState(0);
  const [notes, setNotes] = useState('');
  const [actualCost, setActualCost] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Re-sync the local editing state whenever a different order is opened.
  useEffect(() => {
    setProgress(order?.progress ?? 0);
    setNotes(order?.completionNotes ?? '');
    setActualCost(order?.actualCost ? String(order.actualCost) : '');
  }, [order?.id, order?.progress, order?.completionNotes, order?.actualCost]);

  if (!order) return null;

  const done = order.status === 'completed';

  return (
    <>
      <Sheet open onOpenChange={(o) => !o && onClose()}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>{order.title}</SheetTitle>
            <SheetDescription className="font-mono text-xs">{order.orderCode}</SheetDescription>
          </SheetHeader>

          <div className="mt-6 space-y-6">
            <div className="flex flex-wrap gap-2">
              <PriorityBadge priority={order.priority} />
              <StatusBadge status={order.status} />
              <Badge variant="outline" className="capitalize">{typeLabel(order.type)}</Badge>
              {order.recurrence !== 'none' && (
                <Badge variant="outline" className="capitalize">Repeats {order.recurrence}</Badge>
              )}
            </div>

            {order.description && <p className="text-sm leading-relaxed">{order.description}</p>}

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <MetricTile label="Progress" value={`${order.progress}%`} />
              <MetricTile label="Scheduled" value={new Date(order.scheduledDate).toLocaleDateString()} />
              <MetricTile label="Estimated" value={`₹${order.estimatedCost.toLocaleString()}`} hint={`${order.estimatedHours} h`} />
              <MetricTile
                label="Actual"
                value={order.actualCost ? `₹${order.actualCost.toLocaleString()}` : '—'}
                tone={order.actualCost > order.estimatedCost ? 'warning' : undefined}
              />
            </div>

            <div className="space-y-1.5 rounded-lg bg-muted/50 p-3 text-xs">
              <p><span className="text-muted-foreground">Park:</span> {parkName(order.park)}</p>
              {order.assetName && <p><span className="text-muted-foreground">Asset:</span> {order.assetName}</p>}
              <p><span className="text-muted-foreground">Assigned to:</span> {assigneeName(order)}</p>
              {order.startedAt && (
                <p><span className="text-muted-foreground">Started:</span> {new Date(order.startedAt).toLocaleString()}</p>
              )}
              {order.completedAt && (
                <p><span className="text-muted-foreground">Completed:</span> {new Date(order.completedAt).toLocaleString()}</p>
              )}
              {order.sourceIncident && typeof order.sourceIncident === 'object' && (
                <p>
                  <span className="text-muted-foreground">Raised from incident:</span>{' '}
                  <span className="font-mono">{order.sourceIncident.referenceCode}</span>
                </p>
              )}
            </div>

            {order.completionNotes && (
              <div className="rounded-lg bg-success/10 p-3">
                <p className="text-xs font-medium text-success">Completion notes</p>
                <p className="mt-1 text-sm">{order.completionNotes}</p>
              </div>
            )}

            {can('officer') && !done && (
              <div className="space-y-4 border-t pt-4">
                <p className="text-sm font-medium">Update progress</p>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs">Completion</Label>
                    <span className="text-sm font-medium tabular-nums">{progress}%</span>
                  </div>
                  <Slider value={[progress]} onValueChange={([v]) => setProgress(v)} min={0} max={100} step={5} />
                  {progress === 100 && (
                    <p className="flex items-start gap-1.5 rounded-lg bg-success/10 p-2 text-[11px] text-success">
                      <CircleCheck className="mt-0.5 h-3 w-3 shrink-0" />
                      Setting 100% marks the order complete, appends it to the asset&apos;s maintenance
                      history, and raises the asset&apos;s condition.
                    </p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs">Actual cost (₹)</Label>
                  <Input type="number" min={0} value={actualCost} onChange={(e) => setActualCost(e.target.value)} />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs">Notes</Label>
                  <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
                </div>

                <div className="flex gap-2">
                  <Button
                    className="flex-1"
                    disabled={updateProgress.isPending}
                    onClick={() =>
                      updateProgress.mutate({
                        id: order.id,
                        body: {
                          progress,
                          completionNotes: notes || undefined,
                          actualCost: actualCost ? Number(actualCost) : undefined,
                        },
                      })
                    }
                  >
                    Save progress
                  </Button>
                  {can('admin') && (
                    <Button variant="outline" className="text-destructive" onClick={() => setConfirmDelete(true)}>
                      Delete
                    </Button>
                  )}
                </div>
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete ${order.orderCode}?`}
        description="This removes the work order permanently. Maintenance already logged against the asset is unaffected."
        onConfirm={async () => {
          await deleteOrder.mutateAsync(order.id);
          onClose();
        }}
      />
    </>
  );
}
