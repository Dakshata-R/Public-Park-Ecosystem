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

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import {
  UserCheck, CheckCircle2, Wrench, Plus, Info, ArrowDownWideNarrow, Timer, RefreshCw, ThumbsUp, ExternalLink,
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
import { MetricTile, NO_DATA } from '@/components/shared/score-badge';
import { SourceBadge } from '@/components/shared/data-source';
import { ParkFilter, ALL_PARKS, parkParam } from '@/components/shared/park-filter';
import { QueryState, SkeletonCards, LoadingState, EmptyState } from '@/components/shared/query-state';
import { useAuth } from '@/components/providers/auth-provider';
import {
  useTriageQueue, useIncidents, useIncident, useIncidentStats, useAlerts, useParks, useStaff, useWorkOrders,
  useCreateIncident, useAssignIncident, useResolveIncident, useUpdateIncident,
  useCreateWorkOrderFromIncident, useAcknowledgeAlert, useResolveAlert, useAcknowledgeAllAlerts,
} from '@/lib/hooks/use-api';
import { makePoint } from '@/lib/api/geo';
import { mediaUrl } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import type {
  Alert as AlertRecord, Incident, IncidentStatus, IncidentType, TriagedIncident, TriageVerdict, WorkOrder,
} from '@/lib/types';

const INCIDENT_TYPES: IncidentType[] = [
  'tree-fall', 'illegal-dumping', 'fire', 'water-pollution',
  'dead-animal', 'vandalism', 'infrastructure-damage', 'air-pollution',
];

const INCIDENT_STATUSES: IncidentStatus[] = ['reported', 'assigned', 'in-progress', 'resolved', 'closed'];

/** A work order in one of these states blocks raising another (the API answers 409). */
const OPEN_ORDER_STATUSES = 'scheduled,in-progress,overdue';

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

const incidentSchema = z
  .object({
    type: z.enum(INCIDENT_TYPES as [IncidentType, ...IncidentType[]]),
    title: z.string().min(4, 'Give the incident a clear title').max(200),
    description: z.string().max(2000).optional(),
    park: z.string().min(1, 'Select a park'),
    severity: z.coerce.number().int().min(1).max(5),
    affectedPeople: z.coerce.number().int('Whole people only').min(0),
    lat: z.coerce.number().min(-90).max(90),
    lng: z.coerce.number().min(-180).max(180),
  })
  // The API rejects [0, 0]; say so before the request rather than after.
  .refine((v) => !(v.lat === 0 && v.lng === 0), { message: 'Pick a location — choose a park to use its centre', path: ['lat'] });

type IncidentValues = z.infer<typeof incidentSchema>;

const typeLabel = (type: string) => type.replace(/-/g, ' ');
const parkName = (park: Incident['park']) => (typeof park === 'object' && park ? park.name : '');
const isClosed = (status: IncidentStatus) => status === 'resolved' || status === 'closed';
const refId = (ref: { id: string } | string | null | undefined) => (typeof ref === 'object' && ref ? ref.id : ref ?? null);

export default function IncidentsPage() {
  const { can, loading, signedIn } = useAuth();
  const [park, setPark] = useState(ALL_PARKS);
  const [creating, setCreating] = useState(false);
  const [detail, setDetail] = useState<Incident | TriagedIncident | null>(null);

  // Incident records are officer-only on the API; below that role only the
  // public alert feed can be shown.
  const isOfficer = can('officer');

  return (
    <div className="space-y-6">
      <PageHeader
        title="Incident & Alert Management"
        description="Incidents ordered by a computed triage score rather than by arrival time — hazard type, severity, exposure, age against the response target, and community signal."
        icon="Siren"
        action={
          <div className="flex flex-wrap items-center gap-2">
            <ParkFilter value={park} onChange={setPark} />
            {isOfficer && (
              <Button onClick={() => setCreating(true)}>
                <Plus className="mr-2 h-4 w-4" />
                Report an incident
              </Button>
            )}
          </div>
        }
      />

      {loading ? (
        <LoadingState label="Checking your access…" />
      ) : !isOfficer ? (
        <div className="space-y-4">
          <Card>
            <CardContent>
              <EmptyState
                icon="ShieldAlert"
                title="Incident management is for park officers"
                description="Incident records carry reporter identities, exact hazard locations and assignment history, so the triage queue, the incident list and the statistics are available to officers and administrators only. The public alert feed is shown below."
                action={
                  signedIn ? (
                    <Button asChild variant="outline" size="sm">
                      <Link href="/citizen">Report an issue through the citizen portal</Link>
                    </Button>
                  ) : (
                    <Button asChild variant="outline" size="sm">
                      <Link href="/login?next=/incidents">Sign in as an officer</Link>
                    </Button>
                  )
                }
              />
            </CardContent>
          </Card>
          <AlertsTab park={parkParam(park)} />
        </div>
      ) : (
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
      )}

      {isOfficer && <IncidentFormDialog open={creating} onClose={() => setCreating(false)} />}
      {isOfficer && detail && (
        <IncidentDetailSheet
          key={detail.id}
          initial={detail}
          park={parkParam(park)}
          onClose={() => setDetail(null)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Triage
// ---------------------------------------------------------------------------

/** The five factors behind an incident's priority, matching `priority.service.js`. */
const FACTORS = [
  { key: 'hazard', label: 'Hazard', weight: 0.35, note: 'How dangerous this type of incident is' },
  { key: 'severity', label: 'Severity', weight: 0.25, note: "Officer's 1–5 judgement" },
  { key: 'exposure', label: 'Exposure', weight: 0.2, note: 'How many people are affected' },
  { key: 'urgency', label: 'Urgency', weight: 0.1, note: 'How long it has been open' },
  { key: 'community', label: 'Community', weight: 0.1, note: 'Upvotes from citizens' },
] as const;

const upvoteLabel = (n: number) => `${n} upvote${n === 1 ? '' : 's'}`;

function TriageTab({ park, onSelect }: { park?: string; onSelect: (i: TriagedIncident) => void }) {
  const query = useTriageQueue(park);

  return (
    <div className="space-y-4">
      <Alert className="border-primary/20 bg-primary/5">
        <ArrowDownWideNarrow className="h-4 w-4 text-primary" />
        <AlertDescription className="text-xs leading-relaxed">
          Incidents are ranked by priority: how dangerous the incident type is, how severe it is,
          how many people are affected, how long it has been open and how many citizens upvoted it.
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
                      {/* Queue position and live score. */}
                      <div className="flex shrink-0 flex-col items-center" title="Live triage score">
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
                          {incident.demo && <SourceBadge source="demo" compact />}
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
                            const note =
                              factor.key === 'community'
                                ? `${upvoteLabel(incident.upvotes ?? 0)} on the linked citizen report`
                                : factor.note;
                            return (
                              <div
                                key={factor.key}
                                title={`${note} — ${value.toFixed(2)} × weight ${factor.weight}`}
                                className="flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[10px]"
                              >
                                <span className="text-muted-foreground">{factor.label}</span>
                                <span className="font-medium tabular-nums">{value.toFixed(2)}</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      <div className="shrink-0 space-y-1 text-right">
                        {incident.assignedTo && typeof incident.assignedTo === 'object' ? (
                          <p className="text-xs text-muted-foreground">
                            <UserCheck className="mr-1 inline h-3 w-3" />
                            {incident.assignedTo.name}
                          </p>
                        ) : (
                          <Badge variant="outline" className="text-[10px]">Unassigned</Badge>
                        )}
                        {(incident.upvotes ?? 0) > 0 && (
                          <p className="text-[11px] text-muted-foreground">
                            <ThumbsUp className="mr-1 inline h-3 w-3" />
                            {upvoteLabel(incident.upvotes)}
                          </p>
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
              ...INCIDENT_STATUSES.map((s) => ({ label: s, value: s })),
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
                        {incident.demo && <SourceBadge source="demo" compact />}
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        <span className="font-mono">{incident.referenceCode}</span> ·{' '}
                        <span className="capitalize">{typeLabel(incident.type)}</span> ·{' '}
                        {parkName(incident.park)} · {new Date(incident.reportedAt).toLocaleDateString()}
                        {isClosed(incident.status) && incident.resolutionMinutes !== null &&
                          ` · resolved in ${(incident.resolutionMinutes / 60).toFixed(1)} h`}
                      </p>
                    </div>
                    <div className="shrink-0 text-right" title="Triage score stored at the incident's last update">
                      <span className="text-lg font-bold tabular-nums text-muted-foreground">
                        {incident.priorityScore}
                      </span>
                      <p className="text-[10px] text-muted-foreground">at last update</p>
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

  /**
   * Alerts with a request in flight, keyed to the status they had when the
   * button was pressed. A row stays locked until the refreshed list shows a
   * different status, so a second click cannot send a duplicate request in
   * the gap between the response and the refetch.
   */
  const [busy, setBusy] = useState<Record<string, AlertRecord['status']>>({});

  const act = async (alert: AlertRecord, action: (id: string) => Promise<unknown>) => {
    if (busy[alert.id] === alert.status) return;
    setBusy((current) => ({ ...current, [alert.id]: alert.status }));
    try {
      await action(alert.id);
    } catch {
      // Toast already shown; unlock the row so it can be retried.
      setBusy((current) => {
        const next = { ...current };
        delete next[alert.id];
        return next;
      });
    }
  };

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
            {acknowledgeAll.isPending ? 'Acknowledging…' : 'Acknowledge all'}
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
              {data.items.map((alert) => {
                const locked = busy[alert.id] === alert.status;
                return (
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
                          {alert.demo && <SourceBadge source="demo" compact />}
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
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={locked}
                              onClick={() => void act(alert, (id) => acknowledge.mutateAsync(id))}
                            >
                              Acknowledge
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={locked}
                            onClick={() => void act(alert, (id) => resolve.mutateAsync(id))}
                          >
                            Resolve
                          </Button>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
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
              value={data.total ? `${Math.round(((data.total - data.open) / data.total) * 100)}%` : NO_DATA}
              hint={data.total ? 'Resolved or closed' : 'No incidents recorded'}
              tone={data.total ? 'success' : undefined}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Incidents by Type</CardTitle>
              </CardHeader>
              <CardContent>
                {!data.byType.length ? (
                  <EmptyState title="No incidents recorded" icon="Siren" className="py-8" />
                ) : (
                  <>
                    <ResponsiveContainer width="100%" height={280}>
                      <BarChart data={data.byType} layout="vertical" margin={{ left: 30 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                        <XAxis type="number" stroke="hsl(var(--muted-foreground))" fontSize={11} allowDecimals={false} />
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
                      Darker bars are the more hazardous incident types.
                    </p>
                  </>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">By Priority Band</CardTitle>
              </CardHeader>
              <CardContent>
                {!data.byPriority.length ? (
                  <EmptyState title="No incidents recorded" icon="Siren" className="py-8" />
                ) : (
                  <>
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
                    <p className="mt-2 text-center text-[11px] text-muted-foreground">
                      Bands as stored at each incident&apos;s last update.
                    </p>
                  </>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Response Time Against Target</CardTitle>
              <CardDescription>
                Average hours to resolve each incident type, against its response target
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
    const exposure = Math.min(1, Math.log1p(Math.max(0, Number(affected) || 0)) / Math.log1p(5000));
    // A new incident has no age, and one logged by an officer has no linked report to upvote.
    return Math.round((100 * (0.35 * hazard + 0.25 * s + 0.2 * exposure)) * 10) / 10;
  })();

  const band =
    previewScore >= 75 ? 'critical' : previewScore >= 55 ? 'high' : previewScore >= 35 ? 'medium' : 'low';

  const applyParkCentre = (parkId: string) => {
    const park = parks?.items.find((p) => p.id === parkId);
    if (park) {
      form.setValue('lng', park.location.coordinates[0]);
      form.setValue('lat', park.location.coordinates[1], { shouldValidate: form.formState.isSubmitted });
    }
  };

  const submit = form.handleSubmit(async (values) => {
    try {
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
    } catch {
      /* toast already shown */
    }
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
            <Select
              value={selectedPark}
              onValueChange={(v) => {
                form.setValue('park', v, { shouldValidate: form.formState.isSubmitted });
                // Default the location to the park centre; it can be refined below.
                applyParkCentre(v);
              }}
            >
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
              <Input type="number" min={0} step={1} {...form.register('affectedPeople')} />
              {form.formState.errors.affectedPeople && (
                <p className="text-xs text-destructive">{form.formState.errors.affectedPeople.message}</p>
              )}
            </div>
          </div>

          {/* Live consequence of the inputs above. */}
          <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
            <div className="flex items-baseline justify-between">
              <p className="text-xs font-medium">Projected triage score</p>
              <span className="text-2xl font-bold tabular-nums">{previewScore}</span>
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Lands in the <strong className="capitalize">{band}</strong> band. Urgency starts at zero
              and grows as the incident ages. The community factor stays at zero for incidents logged
              directly — it only follows upvotes on a citizen report an incident was opened from.
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
                onClick={() => applyParkCentre(selectedPark)}
                disabled={!selectedPark}
              >
                Use park centre
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Input type="number" step="any" placeholder="Latitude" {...form.register('lat')} />
              <Input type="number" step="any" placeholder="Longitude" {...form.register('lng')} />
            </div>
            {form.formState.errors.lat && (
              <p className="text-xs text-destructive">{form.formState.errors.lat.message}</p>
            )}
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

/**
 * The incident sheet reads the incident through its own query rather than
 * holding the row that was clicked, so assigning, raising a work order or
 * changing the status is reflected here as soon as the cache refreshes. The
 * clicked row is shown only until the first response arrives.
 */
function IncidentDetailSheet({
  initial,
  park,
  onClose,
}: {
  initial: Incident | TriagedIncident;
  park?: string;
  onClose: () => void;
}) {
  const { can } = useAuth();
  const query = useIncident(initial.id);
  // The live factor breakdown only exists in the triage queue (open incidents).
  const triageQuery = useTriageQueue(park);
  const staff = useStaff();
  // `sourceIncident` is filtered here as well as sent, so the lookup is correct
  // whether or not the API honours the parameter.
  const linkedOrders = useWorkOrders({ sourceIncident: initial.id, status: OPEN_ORDER_STATUSES, limit: 200 });

  const assign = useAssignIncident();
  const resolve = useResolveIncident();
  const updateIncident = useUpdateIncident();
  const createWorkOrder = useCreateWorkOrderFromIncident();

  const [assignee, setAssignee] = useState('');
  const [notes, setNotes] = useState('');
  const [raisedOrder, setRaisedOrder] = useState<WorkOrder | null>(null);

  // Unsaved edits; null means "show the stored value".
  const [statusDraft, setStatusDraft] = useState<IncidentStatus | null>(null);
  const [severityDraft, setSeverityDraft] = useState<string | null>(null);
  const [affectedDraft, setAffectedDraft] = useState<string | null>(null);
  const [statusNote, setStatusNote] = useState('');

  const incident: Incident = query.data ?? initial;

  // When the stored incident changes (after a save or any other mutation),
  // drop the drafts so the form starts again from the server's copy.
  useEffect(() => {
    setStatusDraft(null);
    setSeverityDraft(null);
    setAffectedDraft(null);
    setStatusNote('');
  }, [incident.updatedAt]);

  const triage: TriageVerdict | undefined = triageQuery.data
    ? triageQuery.data.items.find((item) => item.id === incident.id)?.triage
    : 'triage' in initial
    ? initial.triage
    : undefined;

  const assignedName =
    typeof incident.assignedTo === 'object' && incident.assignedTo ? incident.assignedTo.name : null;
  const assignedId = refId(incident.assignedTo);
  const closed = isClosed(incident.status);

  const linkedOrder: Pick<WorkOrder, 'id' | 'orderCode' | 'status'> | null =
    linkedOrders.data?.items.find((order) => refId(order.sourceIncident) === incident.id) ?? raisedOrder;

  // --- Edit form ---
  const status = statusDraft ?? incident.status;
  const severity = severityDraft ?? String(incident.severity);
  const affected = affectedDraft ?? String(incident.affectedPeople);
  const affectedNumber = Number(affected);
  const affectedInvalid = affected.trim() === '' || !Number.isInteger(affectedNumber) || affectedNumber < 0;

  const changes: { status?: IncidentStatus; severity?: number; affectedPeople?: number } = {};
  if (status !== incident.status) changes.status = status;
  if (Number(severity) !== incident.severity) changes.severity = Number(severity);
  if (!affectedInvalid && affectedNumber !== incident.affectedPeople) changes.affectedPeople = affectedNumber;
  const dirty = Object.keys(changes).length > 0;

  const saveChanges = async () => {
    if (!dirty || affectedInvalid) return;
    try {
      await updateIncident.mutateAsync({
        id: incident.id,
        body: { ...changes, ...(changes.status && statusNote.trim() ? { statusNote: statusNote.trim() } : {}) },
      });
    } catch {
      /* toast already shown */
    }
  };

  const assignTo = async () => {
    if (!assignee) return;
    try {
      await assign.mutateAsync({ id: incident.id, assignedTo: assignee });
      setAssignee('');
    } catch {
      /* toast already shown */
    }
  };

  const raiseWorkOrder = async () => {
    try {
      const order = await createWorkOrder.mutateAsync({
        id: incident.id,
        body: { title: `Resolve: ${incident.title}`, type: 'repair' },
      });
      setRaisedOrder(order);
    } catch {
      // A 409 means an order is already open — refresh so it is shown.
      void linkedOrders.refetch();
    }
  };

  const markResolved = async () => {
    try {
      await resolve.mutateAsync({ id: incident.id, resolutionNotes: notes || undefined });
      setNotes('');
    } catch {
      /* toast already shown */
    }
  };

  const hoursOpen = Math.round((Date.now() - new Date(incident.reportedAt).getTime()) / 3_600_000);

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{incident.title}</SheetTitle>
          <SheetDescription className="font-mono text-xs">{incident.referenceCode}</SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          {query.isError && (
            <Alert variant="destructive">
              <AlertDescription className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span>Could not load the latest version of this incident — showing the copy from the list.</span>
                <Button size="sm" variant="outline" className="h-7" onClick={() => void query.refetch()}>
                  <RefreshCw className="mr-1.5 h-3 w-3" />
                  Retry
                </Button>
              </AlertDescription>
            </Alert>
          )}

          <div className="flex flex-wrap gap-2">
            <PriorityBadge priority={incident.priority} />
            <StatusBadge status={incident.status} />
            <Badge variant="outline" className="capitalize">{typeLabel(incident.type)}</Badge>
            <Badge variant="outline" className="capitalize">{incident.source.replace(/-/g, ' ')}</Badge>
            {incident.demo && <SourceBadge source="demo" />}
          </div>

          {incident.description && <p className="text-sm leading-relaxed">{incident.description}</p>}

          {incident.images.length > 0 && (
            <div className="grid grid-cols-2 gap-2">
              {incident.images.map((src, index) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={`${src}-${index}`}
                  src={mediaUrl(src)}
                  alt={`${incident.title} — photo ${index + 1}`}
                  className="h-32 w-full rounded-lg object-cover"
                />
              ))}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <MetricTile label="Score at last update" value={incident.priorityScore} hint="Stored, 0–100" />
            <MetricTile label="Severity" value={`${incident.severity}/5`} />
            <MetricTile label="Affected" value={incident.affectedPeople.toLocaleString()} hint="People" />
            <MetricTile
              label="Time open"
              value={
                closed
                  ? incident.resolutionMinutes !== null
                    ? `${(incident.resolutionMinutes / 60).toFixed(1)} h`
                    : NO_DATA
                  : `${hoursOpen} h`
              }
              hint={closed ? 'To resolution' : 'And counting'}
            />
          </div>

          {/* Live factor breakdown for open incidents. */}
          {triage ? (
            <div className="rounded-xl border p-4">
              <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm font-medium">Live score now: {triage.score}</p>
                {triageQuery.isFetching && <span className="text-[11px] text-muted-foreground">Refreshing…</span>}
              </div>
              <p className="mb-3 text-[11px] text-muted-foreground">
                Recomputed on request. Urgency keeps growing while the incident waits, so this can be
                higher than the score stored at the last update.
              </p>
              <div className="space-y-2">
                {FACTORS.map((factor) => {
                  const value = triage.factors[factor.key];
                  const contribution = value * factor.weight * 100;
                  return (
                    <div key={factor.key} className="space-y-1">
                      <div className="flex items-baseline justify-between text-xs">
                        <span>{factor.label}</span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                        <div className="h-full rounded-full bg-primary" style={{ width: `${contribution}%` }} />
                      </div>
                      <p className="text-[10px] text-muted-foreground">
                        {factor.key === 'community'
                          ? incident.source === 'citizen-report'
                            ? `${upvoteLabel(incident.upvotes ?? 0)} on the citizen report it came from`
                            : 'Not opened from a citizen report, so there are no upvotes to count'
                          : factor.note}
                      </p>
                    </div>
                  );
                })}
              </div>
              <p className="mt-3 text-xs text-muted-foreground">{triage.explanation}</p>
            </div>
          ) : closed ? (
            <p className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
              Resolved and closed incidents stop ageing, so the stored score is final.
            </p>
          ) : triageQuery.isPending ? (
            <LoadingState label="Computing the live score…" className="py-6" />
          ) : null}

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

          {assignedName ? (
            <p className="flex items-center gap-2 rounded-lg bg-muted p-3 text-sm">
              <UserCheck className="h-4 w-4 text-muted-foreground" />
              Assigned to <strong>{assignedName}</strong>
            </p>
          ) : (
            <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">Not assigned yet</p>
          )}

          {incident.resolutionNotes && (
            <div className="rounded-lg bg-success/10 p-3">
              <p className="text-xs font-medium text-success">Resolution</p>
              <p className="mt-1 text-sm">{incident.resolutionNotes}</p>
            </div>
          )}

          {/* --- Actions --- */}
          {can('officer') && (
            <div className="space-y-5 border-t pt-4">
              <p className="text-sm font-medium">Actions</p>

              {!closed && (
                <div className="space-y-1.5">
                  <Label className="text-xs">Assign to</Label>
                  <div className="flex gap-2">
                    <Select value={assignee} onValueChange={setAssignee} disabled={!staff.data?.length}>
                      <SelectTrigger className="flex-1">
                        <SelectValue
                          placeholder={
                            staff.isPending ? 'Loading staff…'
                            : staff.isError ? 'Staff list unavailable'
                            : 'Select a member of staff'
                          }
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {staff.data?.map((member) => (
                          <SelectItem key={member.id} value={member.id}>
                            {member.name}{' '}
                            <span className="capitalize text-muted-foreground">
                              ({member.role}{member.park ? ` · ${member.park.name}` : ''})
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      disabled={!assignee || assignee === assignedId || assign.isPending}
                      onClick={() => void assignTo()}
                    >
                      {assign.isPending ? 'Assigning…' : 'Assign'}
                    </Button>
                  </div>
                  {staff.isError && (
                    <button type="button" className="text-[11px] text-destructive underline" onClick={() => void staff.refetch()}>
                      Could not load staff — retry
                    </button>
                  )}
                </div>
              )}

              {!closed && (
                linkedOrder ? (
                  <div className="flex flex-wrap items-center gap-2 rounded-lg border p-3 text-sm">
                    <Wrench className="h-4 w-4 text-muted-foreground" />
                    <span className="min-w-0 flex-1">
                      Work order <span className="font-mono">{linkedOrder.orderCode}</span> is open for this incident
                    </span>
                    <StatusBadge status={linkedOrder.status} />
                    <Button asChild size="sm" variant="ghost" className="h-7 px-2">
                      <Link href="/maintenance">
                        View <ExternalLink className="ml-1 h-3 w-3" />
                      </Link>
                    </Button>
                  </div>
                ) : (
                  <Button
                    variant="outline"
                    className="w-full"
                    disabled={createWorkOrder.isPending || createWorkOrder.isSuccess || linkedOrders.isPending}
                    onClick={() => void raiseWorkOrder()}
                  >
                    <Wrench className="mr-2 h-4 w-4" />
                    {createWorkOrder.isPending ? 'Raising…' : linkedOrders.isPending ? 'Checking for open work orders…' : 'Raise a work order'}
                  </Button>
                )
              )}

              {/* Status, severity and exposure. Severity and exposure re-score the incident. */}
              <div className="space-y-3 rounded-lg border p-3">
                <p className="text-xs font-medium">Update status &amp; details</p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Status</Label>
                    <Select value={status} onValueChange={(v) => setStatusDraft(v as IncidentStatus)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {INCIDENT_STATUSES.map((s) => (
                          <SelectItem key={s} value={s} className="capitalize">{s.replace(/-/g, ' ')}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Severity (1–5)</Label>
                    <Select value={severity} onValueChange={setSeverityDraft}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {['1', '2', '3', '4', '5'].map((s) => (
                          <SelectItem key={s} value={s}>{s}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">People affected</Label>
                    <Input
                      type="number"
                      min={0}
                      step={1}
                      value={affected}
                      onChange={(e) => setAffectedDraft(e.target.value)}
                    />
                  </div>
                </div>
                {affectedInvalid && (
                  <p className="text-xs text-destructive">People affected must be a whole number, 0 or more.</p>
                )}

                {changes.status && (
                  <div className="space-y-1.5">
                    <Label className="text-xs">Status note (optional)</Label>
                    <Textarea
                      rows={2}
                      value={statusNote}
                      maxLength={500}
                      onChange={(e) => setStatusNote(e.target.value)}
                      placeholder="Added to the timeline with the status change."
                    />
                    {isClosed(changes.status) && !closed && (
                      <p className="text-[11px] text-muted-foreground">
                        Closing out stops the incident ageing and resolves its alert.
                      </p>
                    )}
                  </div>
                )}

                <div className="flex gap-2">
                  <Button
                    className="flex-1"
                    variant="secondary"
                    disabled={!dirty || affectedInvalid || updateIncident.isPending}
                    onClick={() => void saveChanges()}
                  >
                    {updateIncident.isPending ? 'Saving…' : 'Save changes'}
                  </Button>
                  {dirty && (
                    <Button
                      variant="ghost"
                      disabled={updateIncident.isPending}
                      onClick={() => {
                        setStatusDraft(null);
                        setSeverityDraft(null);
                        setAffectedDraft(null);
                        setStatusNote('');
                      }}
                    >
                      Discard
                    </Button>
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Priority is recomputed by the server from severity, exposure, age and upvotes on every save.
                </p>
              </div>

              {!closed && (
                <div className="space-y-1.5">
                  <Label className="text-xs">Resolution notes</Label>
                  <Textarea
                    rows={2}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Site inspected, hazard removed, area reopened."
                  />
                  <Button className="w-full" disabled={resolve.isPending} onClick={() => void markResolved()}>
                    <CheckCircle2 className="mr-2 h-4 w-4" />
                    {resolve.isPending ? 'Resolving…' : 'Mark resolved'}
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
