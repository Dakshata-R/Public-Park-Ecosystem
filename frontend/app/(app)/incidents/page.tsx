'use client';

/**
 * Module 8 — Incident & Alert Management.
 *
 * "Priority-based solving" is named as a differentiator in the project deck,
 * so priority here is *computed*, never typed in by whoever files the report.
 * The triage queue shows the score and the factor breakdown behind it, which
 * is what turns the ranking from an assertion into something an officer can
 * check and argue with.
 */

import { useState } from 'react';
import {
  Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import {
  Siren, Clock, UserCheck, CheckCircle2, Wrench, BellRing, Plus,
  TriangleAlert, Info, ArrowDownWideNarrow, Timer,
} from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { PageHeader } from '@/components/shared/page-header';
import { FilterBar } from '@/components/shared/filter-bar';
import { Pagination } from '@/components/shared/pagination';
import { PriorityBadge, StatusBadge } from '@/components/shared/status-badges';
import { MetricTile } from '@/components/shared/score-badge';
import { ParkFilter, ALL_PARKS, parkParam } from '@/components/shared/park-filter';
import { QueryState, SkeletonCards, LoadingState, EmptyState } from '@/components/shared/query-state';
import { useAuth } from '@/components/providers/auth-provider';
import {
  useTriageQueue, useIncidents, useIncidentStats, useAlerts, useParks, useUsers,
  useCreateIncident, useAssignIncident, useResolveIncident,
  useCreateWorkOrderFromIncident, useAcknowledgeAlert, useResolveAlert, useAcknowledgeAllAlerts,
} from '@/lib/hooks/use-api';
import { makePoint } from '@/lib/api/geo';
import { cn } from '@/lib/utils';
import type { Incident, IncidentType, TriagedIncident, TriageVerdict } from '@/lib/types';

const INCIDENT_TYPES: IncidentType[] = [
  'tree-fall', 'illegal-dumping', 'fire', 'water-pollution',
  'dead-animal', 'vandalism', 'infrastructure-damage', 'air-pollution',
];

/** Hazard weight per type, mirroring `TYPE_PROFILE` in the priority service. */
const HAZARD_WEIGHTS: Record<IncidentType, number> = {
  fire: 1.0,
  'water-pollution': 0.8,
  'air-pollution': 0.75,
  'tree-fall': 0.7,
  'infrastructure-damage': 0.6,
  'illegal-dumping': 0.5,
  'dead-animal': 0.45,
  vandalism: 0.4,
};

const TOOLTIP_STYLE = {
  background: 'hsl(var(--popover))',
  border: '1px solid hsl(var(--border))',
  borderRadius: 'var(--radius)',
  fontSize: 12,
};

const incidentSchema = z.object({
  type: z.enum(INCIDENT_TYPES as [IncidentType, ...IncidentType[]]),
  title: z.string().min(4, 'Give the incident a clear title').max(200),
  description: z.string().max(2000).optional(),
  park: z.string().min(1, 'Select a park'),
  severity: z.coerce.number().min(1).max(5),
  affectedPeople: z.coerce.number().min(0),
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
});

type IncidentValues = z.infer<typeof incidentSchema>;

const typeLabel = (type: string) => type.replace(/-/g, ' ');
const parkName = (park: Incident['park']) => (typeof park === 'object' && park ? park.name : '');

export default function IncidentsPage() {
  const { can } = useAuth();
  const [park, setPark] = useState(ALL_PARKS);
  const [creating, setCreating] = useState(false);
  const [detail, setDetail] = useState<Incident | TriagedIncident | null>(null);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Incident & Alert Management"
        description="Incidents ordered by a computed triage score rather than by arrival time — hazard type, severity, exposure, age against the response target, and community signal."
        icon="Siren"
        action={
          <div className="flex flex-wrap items-center gap-2">
            <ParkFilter value={park} onChange={setPark} />
            {can('officer') && (
              <Button onClick={() => setCreating(true)}>
                <Plus className="mr-2 h-4 w-4" />
                Report an incident
              </Button>
            )}
          </div>
        }
      />

      <Tabs defaultValue="triage" className="space-y-4">
        <TabsList>
          <TabsTrigger value="triage">Triage queue</TabsTrigger>
          <TabsTrigger value="all">All incidents</TabsTrigger>
          <TabsTrigger value="alerts">Alerts</TabsTrigger>
          <TabsTrigger value="stats">Statistics</TabsTrigger>
        </TabsList>

        <TabsContent value="triage"><TriageTab park={parkParam(park)} onSelect={setDetail} /></TabsContent>
        <TabsContent value="all"><AllIncidentsTab park={parkParam(park)} onSelect={setDetail} /></TabsContent>
        <TabsContent value="alerts"><AlertsTab park={parkParam(park)} /></TabsContent>
        <TabsContent value="stats"><StatsTab park={parkParam(park)} /></TabsContent>
      </Tabs>

      <IncidentFormDialog open={creating} onClose={() => setCreating(false)} />
      <IncidentDetailSheet incident={detail} onClose={() => setDetail(null)} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Triage
// ---------------------------------------------------------------------------

/** The five weighted factors, matching the formula in `priority.service.js`. */
const FACTORS = [
  { key: 'hazard', label: 'Hazard', weight: 0.35, note: 'Intrinsic danger of the incident type' },
  { key: 'severity', label: 'Severity', weight: 0.25, note: "Officer's 1–5 judgement" },
  { key: 'exposure', label: 'Exposure', weight: 0.2, note: 'People affected, log-scaled' },
  { key: 'urgency', label: 'Urgency', weight: 0.1, note: 'Age against the response target' },
  { key: 'community', label: 'Community', weight: 0.1, note: 'Upvotes on the linked report' },
] as const;

function TriageTab({ park, onSelect }: { park?: string; onSelect: (i: TriagedIncident) => void }) {
  const query = useTriageQueue(park);

  return (
    <div className="space-y-4">
      <Alert className="border-primary/20 bg-primary/5">
        <ArrowDownWideNarrow className="h-4 w-4 text-primary" />
        <AlertDescription className="text-xs leading-relaxed">
          <strong>P = 100 · (0.35·H + 0.25·Ŝ + 0.20·Ê + 0.10·Û + 0.10·Ĉ)</strong>
          <br />
          Exposure is log-scaled because the difference between 10 and 100 people affected matters
          far more than between 4 000 and 4 090. Urgency follows Û(t) = 1 − e^(−t/τ), so an
          unattended incident climbs quickly while genuinely late and then stops — it can never
          outrank a new fire.
        </AlertDescription>
      </Alert>

      <QueryState
        query={query}
        isEmpty={(data) => data.items.length === 0}
        emptyTitle="Nothing in the queue"
        emptyDescription="Every incident has been resolved or closed."
        emptyIcon="CheckCircle2"
        skeleton={<LoadingState label="Building the triage queue…" />}
      >
        {(data) => (
          <>
            <div className="grid grid-cols-3 gap-4">
              <MetricTile label="Open" value={data.meta.total} />
              <MetricTile
                label="Overdue"
                value={(data.meta.overdue as number) ?? 0}
                hint="Past the response target"
                tone={((data.meta.overdue as number) ?? 0) > 0 ? 'warning' : 'success'}
              />
              <MetricTile
                label="Critical"
                value={(data.meta.critical as number) ?? 0}
                tone={((data.meta.critical as number) ?? 0) > 0 ? 'destructive' : 'success'}
              />
            </div>

            <div className="space-y-3">
              {data.items.map((incident, index) => (
                <Card
                  key={incident.id}
                  onClick={() => onSelect(incident)}
                  className={cn(
                    'cursor-pointer transition-shadow hover:shadow-md',
                    incident.triage.priority === 'critical' && 'border-destructive/40',
                    incident.triage.isOverdue && 'border-l-4 border-l-warning'
                  )}
                >
                  <CardContent className="p-4">
                    <div className="flex flex-wrap items-start gap-4">
                      {/* Queue position and score. */}
                      <div className="flex shrink-0 flex-col items-center">
                        <span className="text-[11px] text-muted-foreground">#{index + 1}</span>
                        <span
                          className={cn(
                            'text-2xl font-bold tabular-nums',
                            incident.triage.priority === 'critical' ? 'text-destructive'
                            : incident.triage.priority === 'high' ? 'text-warning'
                            : 'text-muted-foreground'
                          )}
                        >
                          {incident.triage.score}
                        </span>
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-medium">{incident.title}</p>
                          <PriorityBadge priority={incident.triage.priority} />
                          <StatusBadge status={incident.status} />
                          {incident.triage.isOverdue && (
                            <Badge variant="outline" className="gap-1 border-warning/30 bg-warning/10 text-[10px] text-warning">
                              <Timer className="h-3 w-3" />Overdue
                            </Badge>
                          )}
                        </div>

                        <p className="mt-1 text-xs text-muted-foreground">
                          <span className="font-mono">{incident.referenceCode}</span> ·{' '}
                          <span className="capitalize">{typeLabel(incident.type)}</span> ·{' '}
                          {parkName(incident.park)} · {Math.round(incident.triage.ageHours)} h old
                          (target {incident.triage.responseTargetHours} h)
                        </p>

                        {/* Factor contributions, so the ranking is inspectable. */}
                        <div className="mt-2.5 flex flex-wrap gap-1.5">
                          {FACTORS.map((factor) => {
                            const value = incident.triage.factors[factor.key];
                            return (
                              <div
                                key={factor.key}
                                title={`${factor.note} — ${value.toFixed(2)} × weight ${factor.weight}`}
                                className="flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[10px]"
                              >
                                <span className="text-muted-foreground">{factor.label}</span>
                                <span className="font-medium tabular-nums">{value.toFixed(2)}</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      <div className="shrink-0 text-right">
                        {incident.assignedTo && typeof incident.assignedTo === 'object' ? (
                          <p className="text-xs text-muted-foreground">
                            <UserCheck className="mr-1 inline h-3 w-3" />
                            {incident.assignedTo.name}
                          </p>
                        ) : (
                          <Badge variant="outline" className="text-[10px]">Unassigned</Badge>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </>
        )}
      </QueryState>
    </div>
  );
}

// ---------------------------------------------------------------------------
// All incidents
// ---------------------------------------------------------------------------

function AllIncidentsTab({ park, onSelect }: { park?: string; onSelect: (i: Incident) => void }) {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [type, setType] = useState('all');
  const [status, setStatus] = useState('all');

  const query = useIncidents({
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
      <FilterBar
        search={search}
        onSearch={applyFilter(setSearch)}
        searchPlaceholder="Search incidents…"
        filters={[
          {
            label: 'Type',
            value: type,
            onChange: applyFilter(setType),
            options: [
              { label: 'All types', value: 'all' },
              ...INCIDENT_TYPES.map((t) => ({ label: typeLabel(t), value: t })),
            ],
          },
          {
            label: 'Status',
            value: status,
            onChange: applyFilter(setStatus),
            options: [
              { label: 'All statuses', value: 'all' },
              ...['reported', 'assigned', 'in-progress', 'resolved', 'closed'].map((s) => ({ label: s, value: s })),
            ],
          },
        ]}
      />

      <QueryState
        query={query}
        isEmpty={(data) => data.items.length === 0}
        emptyTitle="No incidents match those filters"
        emptyIcon="Siren"
        skeleton={<LoadingState label="Loading incidents…" />}
      >
        {(data) => (
          <>
            <div className="space-y-2">
              {data.items.map((incident) => (
                <Card
                  key={incident.id}
                  onClick={() => onSelect(incident)}
                  className="cursor-pointer transition-colors hover:bg-muted/40"
                >
                  <CardContent className="flex flex-wrap items-center gap-3 p-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium">{incident.title}</p>
                        <PriorityBadge priority={incident.priority} />
                        <StatusBadge status={incident.status} />
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        <span className="font-mono">{incident.referenceCode}</span> ·{' '}
                        <span className="capitalize">{typeLabel(incident.type)}</span> ·{' '}
                        {parkName(incident.park)} · {new Date(incident.reportedAt).toLocaleDateString()}
                        {incident.resolutionMinutes !== null &&
                          ` · resolved in ${(incident.resolutionMinutes / 60).toFixed(1)} h`}
                      </p>
                    </div>
                    <span className="shrink-0 text-lg font-bold tabular-nums text-muted-foreground">
                      {incident.priorityScore}
                    </span>
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
// Alerts
// ---------------------------------------------------------------------------

function AlertsTab({ park }: { park?: string }) {
  const { can } = useAuth();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('active');

  const query = useAlerts({ page, limit: 20, park, status: status === 'all' ? undefined : status });
  const acknowledge = useAcknowledgeAlert();
  const resolve = useResolveAlert();
  const acknowledgeAll = useAcknowledgeAllAlerts();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <FilterBar
          filters={[
            {
              label: 'Status',
              value: status,
              onChange: (v) => { setStatus(v); setPage(1); },
              options: [
                { label: 'Active', value: 'active' },
                { label: 'Acknowledged', value: 'acknowledged' },
                { label: 'Resolved', value: 'resolved' },
                { label: 'All', value: 'all' },
              ],
            },
          ]}
        />
        {can('officer') && status === 'active' && (
          <Button variant="outline" onClick={() => acknowledgeAll.mutate({ park })} disabled={acknowledgeAll.isPending}>
            Acknowledge all
          </Button>
        )}
      </div>

      <Alert className="border-dashed">
        <Info className="h-4 w-4" />
        <AlertDescription className="text-xs">
          Alerts are generated, never authored. A sensor breaching a threshold, an anomaly detector
          firing, or a high-severity AI finding each raise one — and a condition that stays
          breached refreshes its existing alert rather than producing a new row every minute.
        </AlertDescription>
      </Alert>

      <QueryState
        query={query}
        isEmpty={(data) => data.items.length === 0}
        emptyTitle="No alerts"
        emptyDescription="Nothing needs attention right now."
        emptyIcon="BellRing"
        skeleton={<LoadingState label="Loading alerts…" />}
      >
        {(data) => (
          <>
            <div className="space-y-2">
              {data.items.map((alert) => (
                <Card key={alert.id}>
                  <CardContent className="flex flex-wrap items-start gap-3 p-4">
                    <div
                      className={cn(
                        'mt-1 h-2.5 w-2.5 shrink-0 rounded-full',
                        alert.severity === 'critical' || alert.severity === 'high' ? 'bg-destructive'
                        : alert.severity === 'medium' ? 'bg-warning'
                        : 'bg-muted-foreground'
                      )}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium">{alert.title}</p>
                        <Badge variant="outline" className="text-[10px] capitalize">{alert.severity}</Badge>
                        <StatusBadge status={alert.status} />
                        {alert.occurrences > 1 && (
                          <Badge variant="outline" className="text-[10px]">×{alert.occurrences}</Badge>
                        )}
                      </div>
                      <p className="mt-0.5 text-sm text-muted-foreground">{alert.message}</p>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        {alert.module} · {typeof alert.park === 'object' && alert.park ? `${alert.park.name} · ` : ''}
                        {new Date(alert.createdAt).toLocaleString()}
                      </p>
                    </div>

                    {can('officer') && alert.status !== 'resolved' && (
                      <div className="flex shrink-0 gap-1.5">
                        {alert.status === 'active' && (
                          <Button size="sm" variant="outline" onClick={() => acknowledge.mutate(alert.id)}>
                            Acknowledge
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" onClick={() => resolve.mutate(alert.id)}>
                          Resolve
                        </Button>
                      </div>
                    )}
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
// Statistics
// ---------------------------------------------------------------------------

function StatsTab({ park }: { park?: string }) {
  const query = useIncidentStats(park);

  return (
    <QueryState query={query} skeleton={<SkeletonCards count={4} />}>
      {(data) => (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <MetricTile label="Total incidents" value={data.total} />
            <MetricTile label="Open" value={data.open} tone={data.open > 0 ? 'warning' : 'success'} />
            <MetricTile label="Active alerts" value={data.activeAlerts} tone={data.activeAlerts > 0 ? 'destructive' : 'success'} />
            <MetricTile
              label="Resolution rate"
              value={`${data.total ? Math.round(((data.total - data.open) / data.total) * 100) : 0}%`}
              tone="success"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Incidents by Type</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={data.byType} layout="vertical" margin={{ left: 30 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                    <XAxis type="number" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                    <YAxis type="category" dataKey="label" width={130} stroke="hsl(var(--muted-foreground))" fontSize={10} />
                    <Tooltip contentStyle={TOOLTIP_STYLE} />
                    <Bar dataKey="count" name="Incidents" radius={[0, 4, 4, 0]}>
                      {data.byType.map((row) => (
                        <Cell
                          key={row.type}
                          fill={`hsl(var(--destructive) / ${0.35 + (HAZARD_WEIGHTS[row.type as IncidentType] ?? 0.5) * 0.65})`}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
                <p className="mt-2 text-xs text-muted-foreground">
                  Bar intensity follows the hazard weight the triage formula assigns each type.
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">By Priority Band</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={280}>
                  <PieChart>
                    <Pie data={data.byPriority} dataKey="count" nameKey="priority" cx="50%" cy="50%" outerRadius={90} innerRadius={55} paddingAngle={2}>
                      {data.byPriority.map((row) => (
                        <Cell
                          key={row.priority}
                          fill={
                            row.priority === 'critical' ? 'hsl(var(--destructive))'
                            : row.priority === 'high' ? 'hsl(var(--warning))'
                            : row.priority === 'medium' ? 'hsl(var(--info))'
                            : 'hsl(var(--muted-foreground))'
                          }
                        />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={TOOLTIP_STYLE} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="mt-2 flex flex-wrap justify-center gap-3">
                  {data.byPriority.map((row) => (
                    <div key={row.priority} className="flex items-center gap-1.5 text-[11px]">
                      <span className="capitalize text-muted-foreground">{row.priority}</span>
                      <span className="font-medium">{row.count}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Response Time Against Target</CardTitle>
              <CardDescription>
                Mean hours to resolve, compared with the response target the triage formula uses
                as its ageing constant τ
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!data.meanResolution.length ? (
                <EmptyState title="Nothing resolved yet" icon="Clock" className="py-8" />
              ) : (
                <div className="space-y-3">
                  {data.meanResolution.map((row) => {
                    const missed = row.targetHours !== null && row.hours > row.targetHours;
                    return (
                      <div key={row.type} className="space-y-1.5">
                        <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                          <span className="capitalize">{typeLabel(row.type)}</span>
                          <span className={cn('tabular-nums', missed ? 'text-destructive' : 'text-success')}>
                            {row.hours} h
                            {row.targetHours !== null && (
                              <span className="text-muted-foreground"> / {row.targetHours} h target</span>
                            )}
                          </span>
                        </div>
                        {row.targetHours !== null && (
                          <Progress
                            value={Math.min(100, (row.hours / row.targetHours) * 100)}
                            className={cn('h-2', missed && '[&>div]:bg-destructive')}
                          />
                        )}
                        <p className="text-[11px] text-muted-foreground">{row.resolved} resolved</p>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </QueryState>
  );
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

function IncidentFormDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data: parks } = useParks();
  const createIncident = useCreateIncident();

  const form = useForm<IncidentValues>({
    resolver: zodResolver(incidentSchema),
    defaultValues: {
      type: 'tree-fall', title: '', description: '', park: '',
      severity: 3, affectedPeople: 50, lat: 0, lng: 0,
    },
  });

  const type = form.watch('type');
  const severity = form.watch('severity');
  const affected = form.watch('affectedPeople');
  const selectedPark = form.watch('park');

  /**
   * A live preview of the score the server will compute.
   *
   * This mirrors the formula rather than calling the API, purely so the
   * officer sees the consequence of their severity and exposure estimates as
   * they type. The server's value is authoritative.
   */
  const previewScore = (() => {
    const hazard = HAZARD_WEIGHTS[type] ?? 0.5;
    const s = Math.min(1, Math.max(0, (severity - 1) / 4));
    const exposure = Math.min(1, Math.log1p(Math.max(0, affected)) / Math.log1p(5000));
    // A new incident has no age and no upvotes yet.
    return Math.round((100 * (0.35 * hazard + 0.25 * s + 0.2 * exposure)) * 10) / 10;
  })();

  const band =
    previewScore >= 75 ? 'critical' : previewScore >= 55 ? 'high' : previewScore >= 35 ? 'medium' : 'low';

  const applyParkCentre = () => {
    const park = parks?.items.find((p) => p.id === selectedPark);
    if (park) {
      form.setValue('lng', park.location.coordinates[0]);
      form.setValue('lat', park.location.coordinates[1]);
    }
  };

  const submit = form.handleSubmit(async (values) => {
    await createIncident.mutateAsync({
      type: values.type,
      title: values.title,
      description: values.description,
      park: values.park,
      severity: values.severity,
      affectedPeople: values.affectedPeople,
      location: makePoint(values.lat, values.lng),
      source: 'officer-patrol',
    });
    form.reset();
    onClose();
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Report an incident</DialogTitle>
          <DialogDescription>
            Priority is computed from these facts — it is not a field you set.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label>Type</Label>
            <Select value={type} onValueChange={(v) => form.setValue('type', v as IncidentType)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {INCIDENT_TYPES.map((t) => (
                  <SelectItem key={t} value={t} className="capitalize">
                    {typeLabel(t)} <span className="text-muted-foreground">(hazard {HAZARD_WEIGHTS[t]})</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="title">Title</Label>
            <Input id="title" placeholder="Large branch down across the trail" {...form.register('title')} />
            {form.formState.errors.title && (
              <p className="text-xs text-destructive">{form.formState.errors.title.message}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="description">Description</Label>
            <Textarea id="description" rows={3} {...form.register('description')} />
          </div>

          <div className="space-y-1.5">
            <Label>Park</Label>
            <Select value={selectedPark} onValueChange={(v) => form.setValue('park', v)}>
              <SelectTrigger><SelectValue placeholder="Select a park" /></SelectTrigger>
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

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Severity (1–5)</Label>
              <Select value={String(severity)} onValueChange={(v) => form.setValue('severity', Number(v))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[1, 2, 3, 4, 5].map((s) => (
                    <SelectItem key={s} value={String(s)}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>People affected</Label>
              <Input type="number" min={0} {...form.register('affectedPeople')} />
            </div>
          </div>

          {/* Live consequence of the inputs above. */}
          <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
            <div className="flex items-baseline justify-between">
              <p className="text-xs font-medium">Projected triage score</p>
              <span className="text-2xl font-bold tabular-nums">{previewScore}</span>
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Lands in the <strong className="capitalize">{band}</strong> band. Urgency and community
              signal start at zero and grow as the incident ages and attracts upvotes.
            </p>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label>Location</Label>
              <Button type="button" variant="ghost" size="sm" className="h-6 text-xs" onClick={applyParkCentre} disabled={!selectedPark}>
                Use park centre
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Input type="number" step="any" placeholder="Latitude" {...form.register('lat')} />
              <Input type="number" step="any" placeholder="Longitude" {...form.register('lng')} />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={createIncident.isPending}>
              {createIncident.isPending ? 'Opening…' : 'Open incident'}
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

function IncidentDetailSheet({
  incident,
  onClose,
}: {
  incident: (Incident & { triage?: TriageVerdict }) | null;
  onClose: () => void;
}) {
  const { can } = useAuth();
  const { data: staff } = useUsers({ role: 'officer', limit: 50 });

  const assign = useAssignIncident();
  const resolve = useResolveIncident();
  const createWorkOrder = useCreateWorkOrderFromIncident();

  const [officer, setOfficer] = useState('');
  const [notes, setNotes] = useState('');

  if (!incident) return null;

  const assignedName =
    typeof incident.assignedTo === 'object' && incident.assignedTo ? incident.assignedTo.name : null;
  const closed = ['resolved', 'closed'].includes(incident.status);

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{incident.title}</SheetTitle>
          <SheetDescription className="font-mono text-xs">{incident.referenceCode}</SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          <div className="flex flex-wrap gap-2">
            <PriorityBadge priority={incident.priority} />
            <StatusBadge status={incident.status} />
            <Badge variant="outline" className="capitalize">{typeLabel(incident.type)}</Badge>
            <Badge variant="outline" className="capitalize">{incident.source.replace(/-/g, ' ')}</Badge>
          </div>

          {incident.description && <p className="text-sm leading-relaxed">{incident.description}</p>}

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <MetricTile label="Triage score" value={incident.priorityScore} hint="0–100" />
            <MetricTile label="Severity" value={`${incident.severity}/5`} />
            <MetricTile label="Affected" value={incident.affectedPeople.toLocaleString()} hint="People" />
            <MetricTile
              label="Time open"
              value={
                incident.resolutionMinutes !== null
                  ? `${(incident.resolutionMinutes / 60).toFixed(1)} h`
                  : `${Math.round((Date.now() - new Date(incident.reportedAt).getTime()) / 3_600_000)} h`
              }
              hint={incident.resolutionMinutes !== null ? 'To resolution' : 'And counting'}
            />
          </div>

          {/* Factor breakdown when the queue supplied one. */}
          {incident.triage && (
            <div className="rounded-xl border p-4">
              <p className="mb-3 text-sm font-medium">Why it scores {incident.triage.score}</p>
              <div className="space-y-2">
                {FACTORS.map((factor) => {
                  const value = incident.triage!.factors[factor.key];
                  const contribution = value * factor.weight * 100;
                  return (
                    <div key={factor.key} className="space-y-1">
                      <div className="flex items-baseline justify-between text-xs">
                        <span>{factor.label}</span>
                        <span className="tabular-nums text-muted-foreground">
                          {value.toFixed(2)} × {factor.weight} = {contribution.toFixed(1)}
                        </span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                        <div className="h-full rounded-full bg-primary" style={{ width: `${contribution}%` }} />
                      </div>
                      <p className="text-[10px] text-muted-foreground">{factor.note}</p>
                    </div>
                  );
                })}
              </div>
              <p className="mt-3 text-xs text-muted-foreground">{incident.triage.explanation}</p>
            </div>
          )}

          <div>
            <p className="mb-2 text-sm font-medium">Timeline</p>
            <div className="space-y-3">
              {incident.timeline.map((entry, index) => (
                <div key={entry.id ?? index} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <div className="h-2 w-2 rounded-full bg-primary" />
                    {index < incident.timeline.length - 1 && <div className="w-px flex-1 bg-border" />}
                  </div>
                  <div className="pb-3">
                    <p className="text-sm font-medium capitalize">{entry.status.replace(/-/g, ' ')}</p>
                    {entry.note && <p className="text-xs text-muted-foreground">{entry.note}</p>}
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {entry.byName} · {new Date(entry.at).toLocaleString()}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {assignedName && (
            <p className="flex items-center gap-2 rounded-lg bg-muted p-3 text-sm">
              <UserCheck className="h-4 w-4 text-muted-foreground" />
              Assigned to <strong>{assignedName}</strong>
            </p>
          )}

          {incident.resolutionNotes && (
            <div className="rounded-lg bg-success/10 p-3">
              <p className="text-xs font-medium text-success">Resolution</p>
              <p className="mt-1 text-sm">{incident.resolutionNotes}</p>
            </div>
          )}

          {/* --- Actions --- */}
          {can('officer') && !closed && (
            <div className="space-y-4 border-t pt-4">
              <p className="text-sm font-medium">Actions</p>

              <div className="space-y-1.5">
                <Label className="text-xs">Assign an officer</Label>
                <div className="flex gap-2">
                  <Select value={officer} onValueChange={setOfficer}>
                    <SelectTrigger className="flex-1"><SelectValue placeholder="Select an officer" /></SelectTrigger>
                    <SelectContent>
                      {staff?.items.map((user) => (
                        <SelectItem key={user.id} value={user.id}>
                          {user.name} <span className="capitalize text-muted-foreground">({user.role})</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    disabled={!officer || assign.isPending}
                    onClick={() => assign.mutate({ id: incident.id, assignedTo: officer })}
                  >
                    Assign
                  </Button>
                </div>
              </div>

              <Button
                variant="outline"
                className="w-full"
                disabled={createWorkOrder.isPending}
                onClick={() =>
                  createWorkOrder.mutate({
                    id: incident.id,
                    body: { title: `Resolve: ${incident.title}`, type: 'repair' },
                  })
                }
              >
                <Wrench className="mr-2 h-4 w-4" />
                Raise a work order
              </Button>

              <div className="space-y-1.5">
                <Label className="text-xs">Resolution notes</Label>
                <Textarea
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Site inspected, hazard removed, area reopened."
                />
                <Button
                  className="w-full"
                  disabled={resolve.isPending}
                  onClick={async () => {
                    await resolve.mutateAsync({ id: incident.id, resolutionNotes: notes });
                    onClose();
                  }}
                >
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                  Mark resolved
                </Button>
              </div>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
