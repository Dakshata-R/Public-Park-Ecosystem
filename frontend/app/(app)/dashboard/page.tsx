'use client';

/**
 * Module 1 — Ecosystem Monitoring Dashboard.
 *
 * The whole page is served by three endpoints (`/dashboard/overview`,
 * `/dashboard/trend`, `/dashboard/activity`) plus the live-conditions panel.
 * The overview call deliberately returns everything the page needs in one
 * round trip rather than making the browser stitch a dozen requests together.
 */

import { useState } from 'react';
import Link from 'next/link';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { ArrowRight, Download, Info, Siren, Wrench, Megaphone, Gauge as GaugeIcon } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip as UiTooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { PageHeader } from '@/components/shared/page-header';
import { KpiCard } from '@/components/shared/kpi-card';
import { HealthGauge } from '@/components/shared/health-gauge';
import { DynamicIcon } from '@/components/shared/dynamic-icon';
import { ConditionsPanel } from '@/components/shared/conditions-panel';
import { ParkFilter, ALL_PARKS, parkParam } from '@/components/shared/park-filter';
import { QueryState, SkeletonCards, ErrorState } from '@/components/shared/query-state';
import { GradeBadge, ScoreBar, scoreText } from '@/components/shared/score-badge';
import { useDashboard, useHealthTrend, useActivityFeed } from '@/lib/hooks/use-api';
import { cn } from '@/lib/utils';
import type { Grade } from '@/lib/types';

/** Recharts tooltip styling, applied identically to every chart on the page. */
const TOOLTIP_STYLE = {
  background: 'hsl(var(--popover))',
  border: '1px solid hsl(var(--border))',
  borderRadius: 'var(--radius)',
  color: 'hsl(var(--popover-foreground))',
  fontSize: 12,
};

/** Stable colour per species class, so the pie matches the biodiversity page. */
const CLASS_COLOURS: Record<string, string> = {
  bird: 'hsl(var(--chart-1))',
  mammal: 'hsl(var(--chart-3))',
  butterfly: 'hsl(var(--chart-5))',
  reptile: 'hsl(var(--chart-4))',
  amphibian: 'hsl(var(--chart-2))',
  tree: 'hsl(var(--chart-6))',
  plant: 'hsl(var(--chart-2))',
  insect: 'hsl(var(--chart-5))',
};

const relativeTime = (iso: string) => {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hr ago`;
  return `${Math.floor(seconds / 86400)} d ago`;
};

/** KPI colour band, driven by the normalised score rather than the raw value. */
function toneFor(score: number | null): 'success' | 'warning' | 'destructive' | 'primary' {
  if (score === null) return 'primary';
  if (score >= 70) return 'success';
  if (score >= 45) return 'warning';
  return 'destructive';
}

export default function DashboardPage() {
  const [park, setPark] = useState(ALL_PARKS);
  const [trendDays, setTrendDays] = useState(30);

  const overview = useDashboard(parkParam(park));
  const trend = useHealthTrend(trendDays, parkParam(park));
  const activity = useActivityFeed(12);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Ecosystem Monitoring Dashboard"
        description="Real-time overview of urban park ecosystem health, biodiversity and environmental quality across the monitored network."
        icon="LayoutDashboard"
        action={
          <div className="flex flex-wrap items-center gap-2">
            <ParkFilter value={park} onChange={setPark} allLabel="All parks (citywide)" />
            <Button asChild variant="outline">
              <Link href="/analytics">
                <Download className="mr-2 h-4 w-4" />
                Reports
              </Link>
            </Button>
          </div>
        }
      />

      <QueryState query={overview} skeleton={<SkeletonCards count={8} />}>
        {(data) => (
          <div className="space-y-6">
            {/* --- KPI row --- */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {data.kpis.map((kpi, index) => (
                <KpiCard
                  key={kpi.key}
                  label={kpi.label}
                  value={kpi.value}
                  unit={kpi.unit}
                  icon={kpi.icon}
                  tone={toneFor(kpi.score)}
                  index={index}
                />
              ))}
            </div>

            {/* --- Gauge + weighting + live conditions --- */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <Card>
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <CardTitle className="text-lg">Ecosystem Health Index</CardTitle>
                      <CardDescription>
                        {data.scope === 'park' ? 'This park' : 'Weighted mean across all parks'}
                      </CardDescription>
                    </div>
                    <GradeBadge grade={data.health.grade as Grade} />
                  </div>
                </CardHeader>
                <CardContent className="flex flex-col items-center gap-4 pb-6">
                  <HealthGauge
                    value={data.health.score}
                    label={`${data.health.grade[0].toUpperCase()}${data.health.grade.slice(1)}`}
                  />

                  {/*
                    The contribution breakdown makes the composite auditable:
                    a reader can see which sub-index is dragging the score
                    down and by how much, rather than being handed one number.
                  */}
                  <div className="w-full space-y-2">
                    <div className="flex items-center gap-1.5">
                      <p className="text-xs font-medium text-muted-foreground">
                        Weighted contributions
                      </p>
                      <TooltipProvider>
                        <UiTooltip>
                          <TooltipTrigger><Info className="h-3 w-3 text-muted-foreground" /></TooltipTrigger>
                          <TooltipContent className="max-w-xs">
                            <p className="text-xs">
                              EHI = Σ wₖ·Sₖ ⁄ Σ wₖ over the five sub-indices. Each bar is that
                              indicator&apos;s share of the final score. Weights are configurable in
                              Administration.
                            </p>
                          </TooltipContent>
                        </UiTooltip>
                      </TooltipProvider>
                    </div>
                    {data.health.contributions.map((c) => (
                      <div key={c.key} className="flex items-center gap-2 text-xs">
                        <span className="w-20 shrink-0 capitalize text-muted-foreground">{c.key}</span>
                        <ScoreBar score={c.score} showValue={false} className="flex-1" />
                        <span className="w-16 shrink-0 text-right tabular-nums text-muted-foreground">
                          {c.contribution} <span className="opacity-60">×{c.weight}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              {/* Live weather + real air quality from the public APIs. */}
              <ConditionsPanel park={parkParam(park)} />

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg">Biodiversity</CardTitle>
                  <CardDescription>
                    {data.biodiversity.richness} species recorded from verified observations
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <ResponsiveContainer width="100%" height={180}>
                    <PieChart>
                      <Pie
                        data={Object.entries(data.biodiversity.byClass).map(([name, value]) => ({ name, value }))}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        outerRadius={72}
                        innerRadius={44}
                        paddingAngle={2}
                      >
                        {Object.keys(data.biodiversity.byClass).map((name) => (
                          <Cell key={name} fill={CLASS_COLOURS[name] ?? 'hsl(var(--chart-1))'} />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number, n: string) => [v, n]} />
                    </PieChart>
                  </ResponsiveContainer>

                  <div className="flex flex-wrap justify-center gap-2">
                    {Object.keys(data.biodiversity.byClass).map((name) => (
                      <div key={name} className="flex items-center gap-1.5 text-[11px]">
                        <span className="h-2 w-2 rounded-full" style={{ background: CLASS_COLOURS[name] }} />
                        <span className="capitalize text-muted-foreground">{name}</span>
                      </div>
                    ))}
                  </div>

                  {/* The indices themselves, not just a pie of counts. */}
                  <div className="grid grid-cols-3 gap-2 border-t pt-3 text-center">
                    {[
                      { label: "Shannon H′", value: data.biodiversity.shannon.toFixed(2) },
                      { label: "Evenness J′", value: data.biodiversity.evenness.toFixed(2) },
                      { label: '1 − D', value: data.biodiversity.simpsonDiversity.toFixed(2) },
                    ].map((metric) => (
                      <div key={metric.label}>
                        <p className="text-lg font-bold tabular-nums">{metric.value}</p>
                        <p className="text-[10px] text-muted-foreground">{metric.label}</p>
                      </div>
                    ))}
                  </div>

                  {data.biodiversity.threatenedSpecies > 0 && (
                    <p className="rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning">
                      {data.biodiversity.threatenedSpecies} species of elevated conservation concern recorded.
                    </p>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* --- Trend --- */}
            <Card>
              <CardHeader className="flex-row items-start justify-between space-y-0">
                <div>
                  <CardTitle className="text-lg">Environmental Trends</CardTitle>
                  <CardDescription>
                    Indicators normalised to 0–100 so they share one axis — higher is always better
                  </CardDescription>
                </div>
                <Tabs value={String(trendDays)} onValueChange={(v) => setTrendDays(Number(v))}>
                  <TabsList className="h-8">
                    {[7, 30, 90].map((d) => (
                      <TabsTrigger key={d} value={String(d)} className="h-6 px-2.5 text-xs">{d}d</TabsTrigger>
                    ))}
                  </TabsList>
                </Tabs>
              </CardHeader>
              <CardContent>
                {trend.isError ? (
                  <ErrorState error={trend.error} onRetry={trend.refetch} />
                ) : !trend.data?.length ? (
                  <p className="py-12 text-center text-sm text-muted-foreground">
                    No sensor history in this window yet. Readings accumulate as the simulator runs.
                  </p>
                ) : (
                  <ResponsiveContainer width="100%" height={300}>
                    <AreaChart data={trend.data}>
                      <defs>
                        {[
                          ['air', 'var(--chart-2)'],
                          ['water', 'var(--chart-1)'],
                          ['soil', 'var(--chart-6)'],
                          ['noise', 'var(--chart-3)'],
                        ].map(([key, colour]) => (
                          <linearGradient key={key} id={`grad-${key}`} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor={`hsl(${colour})`} stopOpacity={0.3} />
                            <stop offset="95%" stopColor={`hsl(${colour})`} stopOpacity={0} />
                          </linearGradient>
                        ))}
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                      <YAxis domain={[0, 100]} stroke="hsl(var(--muted-foreground))" fontSize={11} />
                      <Tooltip contentStyle={TOOLTIP_STYLE} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Area type="monotone" dataKey="air" name="Air" stroke="hsl(var(--chart-2))" fill="url(#grad-air)" strokeWidth={2} />
                      <Area type="monotone" dataKey="water" name="Water" stroke="hsl(var(--chart-1))" fill="url(#grad-water)" strokeWidth={2} />
                      <Area type="monotone" dataKey="soil" name="Soil" stroke="hsl(var(--chart-6))" fill="url(#grad-soil)" strokeWidth={2} />
                      <Area type="monotone" dataKey="noise" name="Noise" stroke="hsl(var(--chart-3))" fill="url(#grad-noise)" strokeWidth={2} />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            {/* --- Operational queues --- */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              {[
                { icon: Siren, label: 'Open incidents', value: data.counts.openIncidents, href: '/incidents', tone: 'text-destructive' },
                { icon: Megaphone, label: 'Reports awaiting review', value: data.counts.pendingReports, href: '/citizen', tone: 'text-warning' },
                { icon: Wrench, label: 'Work orders due', value: data.counts.dueWorkOrders, href: '/maintenance', tone: 'text-info' },
              ].map((queue) => (
                <Link key={queue.label} href={queue.href}>
                  <Card className="transition-shadow hover:shadow-md">
                    <CardContent className="flex items-center gap-4 p-5">
                      <div className={cn('flex h-11 w-11 items-center justify-center rounded-xl bg-muted', queue.tone)}>
                        <queue.icon className="h-5 w-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-2xl font-bold tabular-nums">{queue.value}</p>
                        <p className="truncate text-sm text-muted-foreground">{queue.label}</p>
                      </div>
                      <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>

            {/* --- Alerts / priority incidents / activity --- */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <Card>
                <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
                  <CardTitle className="text-lg">Active Alerts</CardTitle>
                  <Button variant="ghost" size="sm" asChild>
                    <Link href="/incidents">All <ArrowRight className="ml-1 h-3.5 w-3.5" /></Link>
                  </Button>
                </CardHeader>
                <CardContent className="max-h-[320px] space-y-2 overflow-y-auto scrollbar-thin">
                  {!data.recentAlerts.length ? (
                    <p className="py-8 text-center text-sm text-muted-foreground">
                      Nothing needs attention.
                    </p>
                  ) : (
                    data.recentAlerts.map((alert) => (
                      <div key={alert.id} className="flex items-start gap-3 rounded-lg border p-3">
                        <span
                          className={cn(
                            'mt-1 h-2 w-2 shrink-0 rounded-full',
                            alert.status === 'active' ? 'bg-destructive' : 'bg-warning'
                          )}
                        />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium leading-snug">{alert.title}</p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {typeof alert.park === 'object' && alert.park ? `${alert.park.name} · ` : ''}
                            {relativeTime(alert.createdAt)}
                            {alert.occurrences > 1 && ` · ×${alert.occurrences}`}
                          </p>
                        </div>
                        <Badge variant="outline" className="shrink-0 text-[10px] capitalize">
                          {alert.severity}
                        </Badge>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg">Highest Priority</CardTitle>
                  <CardDescription>Ranked by the computed triage score</CardDescription>
                </CardHeader>
                <CardContent className="max-h-[320px] space-y-2 overflow-y-auto scrollbar-thin">
                  {!data.priorityIncidents.length ? (
                    <p className="py-8 text-center text-sm text-muted-foreground">No open incidents.</p>
                  ) : (
                    data.priorityIncidents.map((incident) => (
                      <Link key={incident.id} href="/incidents" className="block">
                        <div className="rounded-lg border p-3 transition-colors hover:bg-muted/50">
                          <div className="flex items-start justify-between gap-2">
                            <p className="min-w-0 text-sm font-medium leading-snug">{incident.title}</p>
                            <span className={cn('shrink-0 text-sm font-bold tabular-nums', scoreText(100 - incident.priorityScore))}>
                              {incident.priorityScore}
                            </span>
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {incident.referenceCode} ·{' '}
                            {typeof incident.park === 'object' ? incident.park.name : ''} · {incident.status}
                          </p>
                        </div>
                      </Link>
                    ))
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg">Recent Activity</CardTitle>
                  <CardDescription>Across every module</CardDescription>
                </CardHeader>
                <CardContent className="max-h-[320px] space-y-3 overflow-y-auto scrollbar-thin">
                  {activity.isPending ? (
                    <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>
                  ) : !activity.data?.length ? (
                    <p className="py-8 text-center text-sm text-muted-foreground">No recent activity.</p>
                  ) : (
                    activity.data.map((event) => (
                      <div key={`${event.type}-${event.id}`} className="flex items-start gap-2.5">
                        <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                          <DynamicIcon name={event.icon} className="h-3.5 w-3.5" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{event.title}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            {event.subtitle}
                            {event.park && ` · ${event.park}`}
                          </p>
                        </div>
                        <span className="shrink-0 text-[11px] text-muted-foreground">
                          {relativeTime(event.at)}
                        </span>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>
            </div>

            {/* --- Park ranking --- */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Parks Ranked by Ecosystem Health</CardTitle>
                <CardDescription>
                  The lowest-scoring site is where conservation and maintenance budget goes first
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={data.parkRanking} layout="vertical" margin={{ left: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                    <XAxis type="number" domain={[0, 100]} stroke="hsl(var(--muted-foreground))" fontSize={11} />
                    <YAxis
                      type="category"
                      dataKey="name"
                      width={150}
                      stroke="hsl(var(--muted-foreground))"
                      fontSize={11}
                    />
                    <Tooltip contentStyle={TOOLTIP_STYLE} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="score" name="Ecosystem health" radius={[0, 4, 4, 0]}>
                      {data.parkRanking.map((entry) => (
                        <Cell
                          key={entry.id}
                          fill={
                            entry.score >= 70 ? 'hsl(var(--success))'
                            : entry.score >= 55 ? 'hsl(var(--warning))'
                            : 'hsl(var(--destructive))'
                          }
                        />
                      ))}
                    </Bar>
                    <Bar dataKey="biodiversity" name="Biodiversity" fill="hsl(var(--chart-3))" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* --- Sensor health strip --- */}
            <Card>
              <CardContent className="flex flex-wrap items-center gap-6 p-5">
                <div className="flex items-center gap-2.5">
                  <GaugeIcon className="h-5 w-5 text-muted-foreground" />
                  <span className="text-sm font-medium">Sensor network</span>
                </div>
                {[
                  { label: 'Online', value: data.counts.sensorsOnline, tone: 'text-success' },
                  { label: 'Warning', value: data.counts.sensorsWarning, tone: 'text-warning' },
                  { label: 'Offline', value: data.counts.sensorsOffline, tone: 'text-destructive' },
                ].map((stat) => (
                  <div key={stat.label} className="flex items-baseline gap-1.5">
                    <span className={cn('text-xl font-bold tabular-nums', stat.tone)}>{stat.value}</span>
                    <span className="text-sm text-muted-foreground">{stat.label}</span>
                  </div>
                ))}
                <Button variant="ghost" size="sm" asChild className="ml-auto">
                  <Link href="/sensors">Sensor detail <ArrowRight className="ml-1 h-3.5 w-3.5" /></Link>
                </Button>
              </CardContent>
            </Card>
          </div>
        )}
      </QueryState>
    </div>
  );
}
