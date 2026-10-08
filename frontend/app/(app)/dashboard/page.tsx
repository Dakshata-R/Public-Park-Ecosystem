'use client';

/**
 * Module 1 — Ecosystem Monitoring Dashboard.
 *
 * The page is served by two endpoints (`/dashboard/overview` and
 * `/dashboard/trend`) plus the live-conditions panel.
 * The overview call deliberately returns everything the page needs in one
 * round trip rather than making the browser stitch a dozen requests together.
 *
 * Any index can be null when its inputs are missing. Null is rendered as
 * "No data" and drawn as a gap — never as 0, which would read as "terrible".
 */

import { useState } from 'react';
import Link from 'next/link';
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { ArrowRight, Siren, Wrench, Megaphone, Gauge as GaugeIcon } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PageHeader } from '@/components/shared/page-header';
import { KpiCard } from '@/components/shared/kpi-card';
import { HealthGauge } from '@/components/shared/health-gauge';
import { SourceInfo, type DataSourceKey } from '@/components/shared/source-info';
import { ParkReportButton } from '@/components/shared/park-report-button';
import { ConditionsPanel } from '@/components/shared/conditions-panel';
import { ParkFilter, ALL_PARKS, parkParam } from '@/components/shared/park-filter';
import { QueryState, SkeletonCards, ErrorState, LoadingState } from '@/components/shared/query-state';
import { GradeBadge, ScoreBar, fmt, scoreText } from '@/components/shared/score-badge';
import { useDashboard, useHealthTrend, useParks } from '@/lib/hooks/use-api';
import { cn } from '@/lib/utils';
import type { DashboardOverview, HealthSubIndices, TrendPoint } from '@/lib/types';

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

/** Trend series, in legend order. */
const TREND_SERIES: { key: Exclude<keyof TrendPoint, 'date'>; name: string; colour: string }[] = [
  { key: 'air', name: 'Air (AQI score)', colour: 'var(--chart-2)' },
  { key: 'temperature', name: 'Temperature', colour: 'var(--chart-4)' },
  { key: 'humidity', name: 'Humidity', colour: 'var(--chart-5)' },
  { key: 'water', name: 'Water', colour: 'var(--chart-1)' },
  { key: 'soil', name: 'Soil', colour: 'var(--chart-6)' },
  { key: 'noise', name: 'Noise', colour: 'var(--chart-3)' },
];

/** Sub-index key → the short name the contribution breakdown uses. */
const SUB_INDEX_NAMES: Record<keyof HealthSubIndices, string> = {
  airQuality: 'air',
  waterQuality: 'water',
  soilHealth: 'soil',
  treeHealth: 'tree',
  biodiversity: 'biodiversity',
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

/** Bar fill for the ranking chart; grey when a park has no score. */
const rankingFill = (score: number | null) =>
  score == null ? 'hsl(var(--muted-foreground))'
  : score >= 70 ? 'hsl(var(--success))'
  : score >= 55 ? 'hsl(var(--warning))'
  : 'hsl(var(--destructive))';

type RankingRow = DashboardOverview['parkRanking'][number];

/** Ranking tooltip — says "No data" for a missing score instead of leaving a blank. */
function RankingTooltip({ active, payload }: { active?: boolean; payload?: { payload: RankingRow }[] }) {
  const row = active ? payload?.[0]?.payload : undefined;
  if (!row) return null;
  return (
    <div style={TOOLTIP_STYLE} className="space-y-0.5 px-3 py-2">
      <p className="font-medium">{row.name}</p>
      <p>
        Ecosystem health: {fmt(row.score, 1)}
        {row.grade ? <span className="capitalize"> · {row.grade}</span> : null}
      </p>
      <p>Biodiversity: {fmt(row.biodiversity, 1)}</p>
      <p className="text-muted-foreground">{fmt(row.areaAcres, 1, '—')} acres</p>
      {row.weeklyVisitors != null && (
        <p className="text-muted-foreground">{row.weeklyVisitors.toLocaleString()} visitors / week</p>
      )}
    </div>
  );
}

const capitalise = (text: string) => `${text[0].toUpperCase()}${text.slice(1)}`;

/** The four headline figures; the remaining sub-indices appear in the health breakdown. */
const HEADLINE_KPIS = ['ecosystemHealth', 'airQuality', 'species', 'alerts'];

/** Data sources behind each headline figure, shown in its info icon. */
const KPI_SOURCES: Record<string, { sources: DataSourceKey[]; note: string }> = {
  ecosystemHealth: { sources: ['openMeteoAir', 'gbif'], note: 'Weighted mean of air, water, soil, tree and biodiversity sub-indices.' },
  airQuality: { sources: ['openMeteoAir'], note: 'Mean across parks, scored on the CPCB National AQI scale.' },
  species: { sources: ['gbif', 'gbifSpecies'], note: 'Distinct species in GBIF occurrence records inside park boundaries since 2023.' },
};

/** Number of rows shown in each "needs attention" list. */
const LIST_LIMIT = 5;

export default function DashboardPage() {
  const [park, setPark] = useState(ALL_PARKS);
  const [trendDays, setTrendDays] = useState(30);

  const overview = useDashboard(parkParam(park));
  const trend = useHealthTrend(trendDays, parkParam(park));
  const parks = useParks();

  const trendIsEmpty =
    !trend.data?.length || trend.data.every((point) => TREND_SERIES.every((s) => point[s.key] == null));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        description="Ecosystem health, biodiversity and live conditions across Bengaluru's monitored parks."
        icon="LayoutDashboard"
        action={
          <div className="flex flex-wrap items-center gap-2">
            <ParkFilter value={park} onChange={setPark} allLabel="All parks" />
            <ParkReportButton
              park={parkParam(park)}
              parkLabel={parks.data?.items.find((p) => p.id === park)?.name ?? 'All monitored parks'}
            />
          </div>
        }
      />

      <QueryState query={overview} skeleton={<SkeletonCards count={4} />}>
        {(data) => (
          <div className="space-y-6">
            {/* --- Headline figures --- */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {data.kpis
                .filter((kpi) => HEADLINE_KPIS.includes(kpi.key))
                .map((kpi, index) => (
                  <KpiCard
                    key={kpi.key}
                    label={kpi.key === 'airQuality' ? 'Air Quality' : kpi.label}
                    value={kpi.value}
                    unit={kpi.unit}
                    icon={kpi.icon}
                    tone={toneFor(kpi.score)}
                    index={index}
                    info={KPI_SOURCES[kpi.key] && <SourceInfo {...KPI_SOURCES[kpi.key]} />}
                  />
                ))}
            </div>

            {/* --- Health index, live conditions, biodiversity --- */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <Card>
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-1.5">
                        <CardTitle className="text-lg">Ecosystem Health Index</CardTitle>
                        <SourceInfo
                          sources={['openMeteoAir', 'gbif']}
                          note="Combines air, water, soil, tree health and biodiversity into one score out of 100."
                        />
                      </div>
                      <CardDescription>
                        {data.scope === 'park' ? 'This park' : 'Weighted across all parks'}
                      </CardDescription>
                    </div>
                    <GradeBadge score={data.health.score} grade={data.health.grade} />
                  </div>
                </CardHeader>
                <CardContent className="flex flex-col items-center gap-5 pb-6">
                  <HealthGauge
                    value={data.health.score}
                    label={
                      data.health.score == null || !data.health.grade
                        ? 'Not enough data yet'
                        : capitalise(data.health.grade)
                    }
                  />
                  {/* Each indicator's score, so the composite can be read, not just trusted. */}
                  <div className="w-full space-y-2">
                    {(Object.keys(SUB_INDEX_NAMES) as (keyof HealthSubIndices)[]).map((key) => (
                      <div key={key} className="flex items-center gap-3 text-xs">
                        <span className="w-20 shrink-0 capitalize text-muted-foreground">{SUB_INDEX_NAMES[key]}</span>
                        <ScoreBar score={data.health.subIndices[key]} className="flex-1" />
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              <ConditionsPanel park={parkParam(park)} />

              <Card>
                <CardHeader className="pb-2">
                  <div className="flex items-center gap-1.5">
                    <CardTitle className="text-lg">Biodiversity</CardTitle>
                    <SourceInfo
                      sources={['gbif', 'osm']}
                      note="Species recorded inside each park's OpenStreetMap boundary since 2023."
                    />
                  </div>
                  <CardDescription>
                    {data.biodiversity.richness} species recorded since 2023
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {!Object.keys(data.biodiversity.byClass).length ? (
                    <p className="py-12 text-center text-sm text-muted-foreground">No species records.</p>
                  ) : (
                    <>
                      <ResponsiveContainer width="100%" height={170}>
                        <PieChart>
                          <Pie
                            data={Object.entries(data.biodiversity.byClass).map(([name, value]) => ({ name, value }))}
                            dataKey="value"
                            nameKey="name"
                            cx="50%"
                            cy="50%"
                            outerRadius={70}
                            innerRadius={46}
                            paddingAngle={2}
                          >
                            {Object.keys(data.biodiversity.byClass).map((name) => (
                              <Cell key={name} fill={CLASS_COLOURS[name] ?? 'hsl(var(--chart-1))'} />
                            ))}
                          </Pie>
                          <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number, n: string) => [v, capitalise(n)]} />
                        </PieChart>
                      </ResponsiveContainer>
                      <div className="flex flex-wrap justify-center gap-x-3 gap-y-1.5">
                        {Object.keys(data.biodiversity.byClass).map((name) => (
                          <div key={name} className="flex items-center gap-1.5 text-[11px]">
                            <span className="h-2 w-2 rounded-full" style={{ background: CLASS_COLOURS[name] }} />
                            <span className="capitalize text-muted-foreground">{name}</span>
                          </div>
                        ))}
                      </div>
                    </>
                  )}

                  <div className="grid grid-cols-2 gap-2 border-t pt-3 text-center">
                    {[
                      { label: 'Species', value: data.biodiversity.richness },
                      { label: 'Threatened species', value: data.biodiversity.threatenedSpecies },
                    ].map((metric) => (
                      <div key={metric.label}>
                        <p className="text-lg font-bold tabular-nums">{metric.value}</p>
                        <p className="text-[11px] text-muted-foreground">{metric.label}</p>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* --- Trend --- */}
            <Card>
              <CardHeader className="flex-row items-start justify-between space-y-0">
                <div>
                  <div className="flex items-center gap-1.5">
                    <CardTitle className="text-lg">Environmental Trends</CardTitle>
                    <SourceInfo
                      sources={['openMeteoWeather', 'openMeteoAir']}
                      note="Air quality, temperature and humidity series."
                    />
                  </div>
                  <CardDescription>Daily scores on a common 0–100 scale (higher is better)</CardDescription>
                </div>
                <Tabs value={String(trendDays)} onValueChange={(v) => setTrendDays(Number(v))}>
                  <TabsList className="h-8">
                    {[7, 30, 90].map((d) => (
                      <TabsTrigger key={d} value={String(d)} className="h-6 px-2.5 text-xs">{d} days</TabsTrigger>
                    ))}
                  </TabsList>
                </Tabs>
              </CardHeader>
              <CardContent>
                {trend.isPending ? (
                  <LoadingState label="Loading sensor history…" className="h-[280px] py-0" />
                ) : trend.isError ? (
                  <ErrorState error={trend.error} onRetry={() => void trend.refetch()} />
                ) : trendIsEmpty ? (
                  <p className="py-12 text-center text-sm text-muted-foreground">No sensor history in this window yet.</p>
                ) : (
                  // No `connectNulls`: a day without readings is drawn as a gap, not interpolated or zeroed.
                  <ResponsiveContainer width="100%" height={280}>
                    <LineChart data={trend.data}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                      <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} />
                      <YAxis domain={[0, 100]} stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} width={32} />
                      <Tooltip contentStyle={TOOLTIP_STYLE} />
                      <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" iconSize={8} />
                      {TREND_SERIES.map(({ key, name, colour }) => (
                        <Line key={key} type="monotone" dataKey={key} name={name} stroke={`hsl(${colour})`} strokeWidth={2} dot={false} />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            {/* --- What needs action --- */}
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              {[
                { icon: Siren, label: 'Open incidents', value: data.counts.openIncidents, href: '/incidents', tone: 'text-destructive' },
                { icon: Megaphone, label: 'Reports to review', value: data.counts.pendingReports, href: '/citizen', tone: 'text-warning' },
                { icon: Wrench, label: 'Work orders due', value: data.counts.dueWorkOrders, href: '/maintenance', tone: 'text-info' },
                {
                  icon: GaugeIcon,
                  label: 'Sensors online',
                  value: `${data.counts.sensorsOnline}/${data.counts.sensorsOnline + data.counts.sensorsWarning + data.counts.sensorsOffline}`,
                  href: '/sensors',
                  tone: 'text-success',
                },
              ].map((tile) => (
                <Link key={tile.label} href={tile.href}>
                  <Card className="h-full transition-shadow hover:shadow-md">
                    <CardContent className="flex items-center gap-3 p-4">
                      <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted', tile.tone)}>
                        <tile.icon className="h-5 w-5" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-xl font-bold tabular-nums">{tile.value}</p>
                        <p className="truncate text-xs text-muted-foreground">{tile.label}</p>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
                  <div>
                    <CardTitle className="text-lg">Priority Incidents</CardTitle>
                    <CardDescription>Ranked by triage score</CardDescription>
                  </div>
                  <Button variant="ghost" size="sm" asChild>
                    <Link href="/incidents">View all <ArrowRight className="ml-1 h-3.5 w-3.5" /></Link>
                  </Button>
                </CardHeader>
                <CardContent className="divide-y">
                  {!data.priorityIncidents.length ? (
                    <p className="py-8 text-center text-sm text-muted-foreground">No open incidents.</p>
                  ) : (
                    data.priorityIncidents.slice(0, LIST_LIMIT).map((incident) => (
                      <div key={incident.id} className="flex items-center gap-3 py-2.5">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{incident.title}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            {typeof incident.park === 'object' && incident.park ? incident.park.name : incident.referenceCode}
                            {' · '}
                            <span className="capitalize">{incident.status.replace(/_/g, ' ')}</span>
                          </p>
                        </div>
                        <span className={cn('shrink-0 text-sm font-bold tabular-nums', scoreText(100 - incident.priorityScore))}>
                          {incident.priorityScore}
                        </span>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
                  <div>
                    <CardTitle className="text-lg">Active Alerts</CardTitle>
                    <CardDescription>Most recent first</CardDescription>
                  </div>
                  <Button variant="ghost" size="sm" asChild>
                    <Link href="/incidents">View all <ArrowRight className="ml-1 h-3.5 w-3.5" /></Link>
                  </Button>
                </CardHeader>
                <CardContent className="divide-y">
                  {!data.recentAlerts.length ? (
                    <p className="py-8 text-center text-sm text-muted-foreground">Nothing needs attention.</p>
                  ) : (
                    data.recentAlerts.slice(0, LIST_LIMIT).map((alert) => (
                      <div key={alert.id} className="flex items-center gap-3 py-2.5">
                        <span
                          className={cn(
                            'h-2 w-2 shrink-0 rounded-full',
                            alert.status === 'active' ? 'bg-destructive' : 'bg-warning'
                          )}
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{alert.title}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            {typeof alert.park === 'object' && alert.park ? `${alert.park.name} · ` : ''}
                            {relativeTime(alert.createdAt)}
                          </p>
                        </div>
                        <Badge variant="outline" className="shrink-0 text-[10px] capitalize">{alert.severity}</Badge>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>
            </div>

            {/* --- Park ranking --- */}
            <Card>
              <CardHeader>
                <div className="flex items-center gap-1.5">
                  <CardTitle className="text-lg">Park Ranking</CardTitle>
                  <SourceInfo sources={['osm', 'gbif', 'openMeteoAir']} note="Ecosystem Health Index per park." />
                </div>
                <CardDescription>Ecosystem health by park — lowest scores are prioritised for action</CardDescription>
              </CardHeader>
              <CardContent>
                {!data.parkRanking.length ? (
                  <p className="py-12 text-center text-sm text-muted-foreground">No parks to rank.</p>
                ) : (
                  <ResponsiveContainer width="100%" height={Math.max(160, data.parkRanking.length * 40)}>
                    <BarChart data={data.parkRanking} layout="vertical" margin={{ left: 8, right: 16 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                      <XAxis type="number" domain={[0, 100]} stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} />
                      <YAxis type="category" dataKey="name" width={170} stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} />
                      <Tooltip content={<RankingTooltip />} cursor={{ fill: 'hsl(var(--muted) / 0.4)' }} />
                      <Bar dataKey="score" name="Ecosystem health" radius={[0, 4, 4, 0]} barSize={18}>
                        {data.parkRanking.map((entry) => (
                          <Cell key={entry.id} fill={rankingFill(entry.score)} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </QueryState>
    </div>
  );
}
