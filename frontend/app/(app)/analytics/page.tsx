'use client';

/**
 * Module 10 — Analytics & Reports.
 *
 * Export is split deliberately: CSV is fetched from the API with the signed-in
 * officer's token and handed to the browser as a file, while PDF is rendered
 * client-side with jsPDF. Generating PDFs server-side would mean shipping a
 * headless browser into the deployment for something the client already does
 * well.
 */

import { useState } from 'react';
import Link from 'next/link';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, ComposedChart, Legend,
  Line, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import {
  FileText, FileSpreadsheet, TrendingUp, Loader2, Trash2, Sparkles, Send, Archive, Lock, LogIn,
} from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { PageHeader } from '@/components/shared/page-header';
import { MetricTile, ScoreBar, NO_DATA, fmt } from '@/components/shared/score-badge';
import { StatusBadge } from '@/components/shared/status-badges';
import { ParkFilter, ALL_PARKS, parkParam } from '@/components/shared/park-filter';
import { QueryState, SkeletonCards, LoadingState } from '@/components/shared/query-state';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { Pagination } from '@/components/shared/pagination';
import { SourceBadge, DataNotice, type Provenance } from '@/components/shared/data-source';
import { useAuth } from '@/components/providers/auth-provider';
import {
  useAnalyticsSummary, useEnvironmentalTrend, useBiodiversityTrend,
  useIncidentTrend, useEngagementTrend, useParkComparison, useEcoReports,
  useDeleteEcoReport, useUpdateEcoReport, useGenerateReport, usePublicSettings,
} from '@/lib/hooks/use-api';
import { analyticsApi, type ExportDataset } from '@/lib/api/endpoints';
import { ApiError } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import type { EcoReport, EcoReportType } from '@/lib/types';

const TOOLTIP_STYLE = {
  background: 'hsl(var(--popover))',
  border: '1px solid hsl(var(--border))',
  borderRadius: 'var(--radius)',
  fontSize: 12,
};

const DATASETS: { value: ExportDataset; label: string; note: string; source: Provenance; sourceNote: string }[] = [
  { value: 'incidents', label: 'Incidents', note: 'Reference, type, priority score, resolution time', source: 'demo', sourceNote: 'Demo records' },
  { value: 'assets', label: 'Park assets', note: 'Inventory with condition and maintenance counts', source: 'osm', sourceNote: 'Positions © OpenStreetMap contributors; condition and maintenance are demo values' },
  { value: 'observations', label: 'Species observations', note: 'The occurrence-record counts behind the indices', source: 'gbif', sourceNote: 'GBIF.org occurrence records' },
  { value: 'citizen-reports', label: 'Citizen reports', note: 'Submissions, status and upvotes', source: 'demo', sourceNote: 'Demo records' },
  { value: 'work-orders', label: 'Work orders', note: 'Schedule, progress and cost', source: 'demo', sourceNote: 'Demo records' },
];

const WINDOWS = [
  { value: 30, label: '30 days' },
  { value: 90, label: '90 days' },
  { value: 180, label: '6 months' },
  { value: 365, label: '1 year' },
];

const REPORT_TYPES: { value: EcoReportType; label: string }[] = [
  { value: 'ecosystem', label: 'Ecosystem health assessment' },
  { value: 'biodiversity', label: 'Biodiversity assessment' },
  { value: 'air', label: 'Air quality review' },
  { value: 'water', label: 'Water quality review' },
  { value: 'soil', label: 'Soil moisture review' },
  { value: 'maintenance', label: 'Maintenance and asset review' },
  { value: 'engagement', label: 'Citizen engagement report' },
];

/** The GBIF snapshot behind the observation records begins here. */
const GBIF_SNAPSHOT_START = Date.UTC(2023, 0, 1);

const ENGAGEMENT_KEYS = ['issue', 'wildlife-sighting', 'feedback', 'suggestion'];

/** `airQuality` → "Air quality". */
const humanise = (key: string) => {
  const words = key.replace(/([A-Z])/g, ' $1').trim().toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
};
const dateOnly = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString() : NO_DATA);

/** Tooltip text for a series value; a gap reads "No data", never 0. */
const tooltipValue = (value: unknown) => (value == null ? NO_DATA : (value as number | string));

export default function AnalyticsPage() {
  const [park, setPark] = useState(ALL_PARKS);
  const [days, setDays] = useState(90);

  const filters = { park: parkParam(park), days };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Analytics & Reports"
        description="Trends across ecosystem health, biodiversity, incidents and citizen engagement — with data exports for further analysis."
        icon="BarChart3"
        action={
          <div className="flex flex-wrap items-center gap-2">
            <ParkFilter value={park} onChange={setPark} />
            <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
              <SelectTrigger className="w-[130px]" aria-label="Date window"><SelectValue /></SelectTrigger>
              <SelectContent>
                {WINDOWS.map((w) => (
                  <SelectItem key={w.value} value={String(w.value)}>{w.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        }
      />

      <DataNotice>
        Species figures count GBIF.org occurrence records; air quality is Open-Meteo.com (CAMS); water,
        soil and noise sensors are simulated; asset positions are © OpenStreetMap contributors with demo
        condition values. Incidents, work orders and citizen reports are demo records.
      </DataNotice>

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList className="grid w-full grid-cols-3 sm:w-auto sm:grid-cols-5">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="trends">Trends</TabsTrigger>
          <TabsTrigger value="compare">Compare</TabsTrigger>
          <TabsTrigger value="reports">Reports</TabsTrigger>
          <TabsTrigger value="export">Export</TabsTrigger>
        </TabsList>

        <TabsContent value="overview"><OverviewTab filters={filters} /></TabsContent>
        <TabsContent value="trends"><TrendsTab filters={filters} /></TabsContent>
        <TabsContent value="compare"><CompareTab /></TabsContent>
        <TabsContent value="reports"><ReportsTab park={parkParam(park)} /></TabsContent>
        <TabsContent value="export"><ExportTab park={parkParam(park)} /></TabsContent>
      </Tabs>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

/** Where each health sub-index comes from. Air blends Open-Meteo AQI with simulated noise. */
const SUB_INDEX_SOURCES: Record<string, Provenance[]> = {
  airQuality: ['open-meteo', 'simulated'],
  waterQuality: ['simulated'],
  soilHealth: ['simulated'],
  treeHealth: ['demo'],
  biodiversity: ['gbif'],
};

const toneFor = (score: number | null | undefined, good = 70, fair = 55) =>
  score == null ? undefined : score >= good ? 'success' : score >= fair ? 'warning' : 'destructive';

function OverviewTab({ filters }: { filters: { park?: string; days: number } }) {
  const query = useAnalyticsSummary(filters);

  return (
    <QueryState query={query} skeleton={<SkeletonCards count={8} />}>
      {(data) => {
        const hasSpecies = data.biodiversity.richness > 0;
        return (
          <div className="space-y-6">
            <p className="text-sm text-muted-foreground">
              Window {dateOnly(data.window.from)} — {dateOnly(data.window.to)}. Incident, maintenance,
              report, AI and species-record figures cover this window; ecosystem health, sub-indices
              and assets are <strong className="font-medium text-foreground">current values</strong>.
            </p>

            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <MetricTile
                label="Ecosystem health · current"
                value={fmt(data.ecosystemHealth, 1)}
                hint={data.healthGrade ?? (data.ecosystemHealth == null ? 'No indicator has data' : undefined)}
                tone={toneFor(data.ecosystemHealth)}
              />
              <MetricTile
                label="Biodiversity score"
                value={hasSpecies ? fmt(data.biodiversity.score, 1) : NO_DATA}
                hint={
                  hasSpecies
                    ? `${data.biodiversity.richness} species · H′ ${fmt(data.biodiversity.shannon, 2)} · GBIF records`
                    : 'No verified records in this window'
                }
                tone={hasSpecies ? (data.biodiversity.score >= 65 ? 'success' : 'warning') : undefined}
              />
              <MetricTile
                label="Incident resolution"
                value={data.incidents.total ? `${data.incidents.resolutionRate}%` : NO_DATA}
                hint={
                  data.incidents.total
                    ? `${data.incidents.resolved} of ${data.incidents.total} closed · demo records`
                    : 'No incidents in this window'
                }
                tone={data.incidents.total ? (data.incidents.resolutionRate >= 75 ? 'success' : 'warning') : undefined}
              />
              <MetricTile
                label="Maintenance completion"
                value={data.maintenance.total ? `${data.maintenance.completionRate}%` : NO_DATA}
                hint={
                  data.maintenance.total
                    ? `₹${data.maintenance.cost.toLocaleString('en-IN')} recorded · demo records`
                    : 'No work orders in this window'
                }
                tone={data.maintenance.total ? (data.maintenance.completionRate >= 70 ? 'success' : 'warning') : undefined}
              />
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Health Sub-Indices · current</CardTitle>
                  <CardDescription>
                    The five components of the composite index as they stand now — not limited to the
                    selected window. The weakest one is where effort pays off.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {Object.entries(data.subIndices).map(([key, score]) => (
                    <div key={key} className="flex items-center gap-3">
                      <span className="flex w-40 shrink-0 items-center gap-1.5 text-sm capitalize">
                        {humanise(key)}
                        {(SUB_INDEX_SOURCES[key] ?? []).map((source) => (
                          <SourceBadge key={source} source={source} compact className="px-1 py-0" />
                        ))}
                      </span>
                      <ScoreBar score={score} className="flex-1" />
                    </div>
                  ))}
                  <p className="pt-1 text-[11px] text-muted-foreground">
                    Tree health is the mean condition of tree and plant assets, which are demonstration
                    values. A sub-index without inputs shows &ldquo;{NO_DATA}&rdquo; and is left out of the
                    composite.
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Operational Summary</CardTitle>
                  <CardDescription>
                    Incidents, citizen reports and work orders are demo records. AI detections are real
                    model inference over sample photographs.
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid grid-cols-2 gap-3">
                  <MetricTile label="Incidents raised" value={data.incidents.total} hint="In window" />
                  <MetricTile
                    label="Mean resolution"
                    value={data.incidents.avgResolutionHours != null ? `${fmt(data.incidents.avgResolutionHours, 1)} h` : NO_DATA}
                    hint="In window"
                  />
                  <MetricTile label="Citizen reports" value={data.citizenReports} hint="In window" />
                  <MetricTile label="AI detections" value={data.aiDetections} hint="In window" />
                  <MetricTile label="Assets tracked" value={data.assets.count} hint="Current · OpenStreetMap" />
                  <MetricTile
                    label="Mean asset condition"
                    value={data.assets.count ? fmt(data.assets.avgCondition, 1) : NO_DATA}
                    hint="Current · demo values"
                    tone={data.assets.count ? toneFor(data.assets.avgCondition, 70, 0) : undefined}
                  />
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="flex flex-wrap items-center gap-2 text-lg">
                  Threatened Species Recorded
                  <SourceBadge source="gbif" />
                </CardTitle>
                <CardDescription>
                  Species assessed Near Threatened or worse on the IUCN Red List with verified records in
                  this window. &ldquo;Not Evaluated&rdquo; and &ldquo;Data Deficient&rdquo; species are not
                  counted.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {hasSpecies ? (
                  <>
                    <div className="flex items-baseline gap-3">
                      <span className="text-4xl font-bold tabular-nums">{data.biodiversity.threatenedSpecies}</span>
                      <span className="text-sm text-muted-foreground">
                        of {data.biodiversity.richness} species recorded
                      </span>
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      Evenness J′ = {fmt(data.biodiversity.evenness, 3)}. A low value means a few species
                      dominate the records. Counts are GBIF occurrence records, not individuals, and recent
                      months are under-counted because records are published with a delay.
                    </p>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {NO_DATA} — no verified species records fall in this window. GBIF records are
                    published weeks to months after observation; try a longer window.
                  </p>
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
// Trends
// ---------------------------------------------------------------------------

function TrendsTab({ filters }: { filters: { park?: string; days: number } }) {
  // GBIF records lag by months, so a 30- or 90-day window is nearly empty.
  // The biodiversity chart defaults to the whole snapshot; the day count is
  // frozen at mount so the query key does not change on every render.
  const [snapshotDays] = useState(() => Math.ceil((Date.now() - GBIF_SNAPSHOT_START) / 86_400_000));
  const [bioScope, setBioScope] = useState<'snapshot' | 'window'>('snapshot');

  const environmental = useEnvironmentalTrend({ ...filters, interval: 'day' });
  const biodiversity = useBiodiversityTrend({
    park: filters.park,
    days: bioScope === 'snapshot' ? snapshotDays : filters.days,
  });
  const incidents = useIncidentTrend(filters);
  const engagement = useEngagementTrend(filters);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Environmental Indicators</CardTitle>
          <CardDescription>
            Daily means normalised to 0–100, with the count of readings the anomaly ensemble flagged each
            day. Gaps are days without readings.
          </CardDescription>
          <div className="flex flex-wrap items-center gap-1.5 pt-1 text-[11px] text-muted-foreground">
            Air <SourceBadge source="open-meteo" /> · Water, soil, noise <SourceBadge source="simulated" />
          </div>
        </CardHeader>
        <CardContent>
          <QueryState
            query={environmental}
            isEmpty={(rows) => rows.length === 0}
            emptyTitle="No readings in this window"
            emptyIcon="Gauge"
            skeleton={<LoadingState label="Loading…" />}
          >
            {(rows) => (
              <ResponsiveContainer width="100%" height={320}>
                <ComposedChart data={rows}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize={10} minTickGap={30} />
                  <YAxis yAxisId="left" domain={[0, 100]} stroke="hsl(var(--muted-foreground))" fontSize={11} />
                  <YAxis yAxisId="right" orientation="right" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} formatter={tooltipValue} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line yAxisId="left" type="monotone" dataKey="aqi" name="Air (Open-Meteo)" stroke="hsl(var(--chart-2))" strokeWidth={2} dot={false} />
                  <Line yAxisId="left" type="monotone" dataKey="water" name="Water (simulated)" stroke="hsl(var(--chart-1))" strokeWidth={2} dot={false} />
                  <Line yAxisId="left" type="monotone" dataKey="soil" name="Soil (simulated)" stroke="hsl(var(--chart-6))" strokeWidth={2} dot={false} />
                  <Line yAxisId="left" type="monotone" dataKey="noise" name="Noise (simulated)" stroke="hsl(var(--chart-3))" strokeWidth={2} dot={false} />
                  <Bar yAxisId="right" dataKey="anomalies" name="Anomalies" fill="hsl(var(--destructive) / 0.4)" radius={[3, 3, 0, 0]} />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </QueryState>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="space-y-1.5">
                <CardTitle className="flex flex-wrap items-center gap-2 text-lg">
                  Biodiversity Over Time
                  <SourceBadge source="gbif" />
                </CardTitle>
                <CardDescription>
                  Shannon H′ recomputed each month from that month&apos;s GBIF occurrence-record counts —
                  records, not individuals
                </CardDescription>
              </div>
              <Select value={bioScope} onValueChange={(v) => setBioScope(v as 'snapshot' | 'window')}>
                <SelectTrigger className="h-8 w-[160px] text-xs" aria-label="Biodiversity window"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="snapshot">Since Jan 2023</SelectItem>
                  <SelectItem value="window">Selected window</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            <QueryState
              query={biodiversity}
              isEmpty={(rows) => rows.length === 0}
              emptyTitle="No observation records in this window"
              emptyDescription="GBIF records are published weeks to months after observation. Choose “Since Jan 2023” to see the full snapshot."
              emptyIcon="Bird"
              skeleton={<LoadingState label="Loading…" />}
            >
              {(rows) => (
                <ResponsiveContainer width="100%" height={280}>
                  <ComposedChart data={rows}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="month" stroke="hsl(var(--muted-foreground))" fontSize={10} minTickGap={20} />
                    <YAxis yAxisId="left" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                    <YAxis yAxisId="right" orientation="right" domain={[0, 'auto']} stroke="hsl(var(--muted-foreground))" fontSize={11} />
                    <Tooltip contentStyle={TOOLTIP_STYLE} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar yAxisId="left" dataKey="richness" name="Species (S)" fill="hsl(var(--chart-1))" radius={[3, 3, 0, 0]} />
                    <Line yAxisId="right" type="monotone" dataKey="shannon" name="Shannon H′" stroke="hsl(var(--chart-3))" strokeWidth={2} dot={false} />
                    <Line yAxisId="right" type="monotone" dataKey="evenness" name="Evenness J′" stroke="hsl(var(--chart-5))" strokeWidth={2} strokeDasharray="4 4" dot={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              )}
            </QueryState>
            <p className="text-[11px] text-muted-foreground">
              The snapshot begins January 2023 and GBIF records arrive with a delay, so the most recent
              months are under-counted — a drop at the right-hand edge is not a decline. Source: GBIF.org.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2 text-lg">
              Incident Volume &amp; Backlog
              <SourceBadge source="demo" />
            </CardTitle>
            <CardDescription>Reported against resolved — the gap is the backlog</CardDescription>
          </CardHeader>
          <CardContent>
            <QueryState
              query={incidents}
              isEmpty={(rows) => rows.length === 0}
              emptyTitle="No incidents in this window"
              emptyIcon="Siren"
              skeleton={<LoadingState label="Loading…" />}
            >
              {(rows) => (
                <ResponsiveContainer width="100%" height={280}>
                  <ComposedChart data={rows}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="month" stroke="hsl(var(--muted-foreground))" fontSize={10} />
                    <YAxis yAxisId="left" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                    <YAxis yAxisId="right" orientation="right" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                    <Tooltip contentStyle={TOOLTIP_STYLE} formatter={tooltipValue} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar yAxisId="left" dataKey="reported" name="Reported" fill="hsl(var(--chart-1))" radius={[3, 3, 0, 0]} />
                    <Bar yAxisId="left" dataKey="resolved" name="Resolved" fill="hsl(var(--success))" radius={[3, 3, 0, 0]} />
                    <Line yAxisId="right" type="monotone" dataKey="avgResolutionHours" name="Mean hours" stroke="hsl(var(--warning))" strokeWidth={2} />
                  </ComposedChart>
                </ResponsiveContainer>
              )}
            </QueryState>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2 text-lg">
            Citizen Participation
            <SourceBadge source="demo" />
          </CardTitle>
          <CardDescription>Submissions by category over time</CardDescription>
        </CardHeader>
        <CardContent>
          <QueryState
            query={engagement}
            isEmpty={(rows) => rows.length === 0}
            emptyTitle="No submissions in this window"
            emptyIcon="Megaphone"
            skeleton={<LoadingState label="Loading…" />}
          >
            {(rows) => {
              // A category absent from a month had no submissions that month;
              // a stacked area needs the explicit zero to stack correctly.
              const series = rows.map((row) => ({
                ...row,
                ...Object.fromEntries(ENGAGEMENT_KEYS.map((key) => [key, Number(row[key] ?? 0)])),
              }));
              return (
                <ResponsiveContainer width="100%" height={280}>
                  <AreaChart data={series}>
                    <defs>
                      {ENGAGEMENT_KEYS.map((key, i) => (
                        <linearGradient key={key} id={`eng-${i}`} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={`hsl(var(--chart-${i + 1}))`} stopOpacity={0.35} />
                          <stop offset="95%" stopColor={`hsl(var(--chart-${i + 1}))`} stopOpacity={0} />
                        </linearGradient>
                      ))}
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="month" stroke="hsl(var(--muted-foreground))" fontSize={10} />
                    <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} allowDecimals={false} />
                    <Tooltip contentStyle={TOOLTIP_STYLE} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    {ENGAGEMENT_KEYS.map((key, i) => (
                      <Area
                        key={key}
                        type="monotone"
                        dataKey={key}
                        name={key.replace(/-/g, ' ')}
                        stackId="1"
                        stroke={`hsl(var(--chart-${i + 1}))`}
                        fill={`url(#eng-${i})`}
                      />
                    ))}
                  </AreaChart>
                </ResponsiveContainer>
              );
            }}
          </QueryState>
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Compare
// ---------------------------------------------------------------------------

/** A comparison cell as a number, or null when the park has no value. */
const cellNumber = (value: number | string | null | undefined) => {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

function CompareTab() {
  const query = useParkComparison();

  return (
    <QueryState
      query={query}
      isEmpty={(rows) => rows.length === 0}
      emptyTitle="No parks to compare"
      emptyIcon="Trees"
      skeleton={<LoadingState label="Comparing parks…" />}
    >
      {(rows) => {
        const anyVisitors = rows.some((row) => cellNumber(row.weeklyVisitors) != null);
        return (
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Ecosystem Health by Park · current</CardTitle>
                <CardDescription>
                  All five sub-indices side by side. A missing bar means that indicator is not measured
                  in the park — it is not a score of zero.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={340}>
                  <BarChart data={rows} margin={{ bottom: 60 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="park" angle={-25} textAnchor="end" height={90} interval={0} stroke="hsl(var(--muted-foreground))" fontSize={10} />
                    <YAxis domain={[0, 100]} stroke="hsl(var(--muted-foreground))" fontSize={11} />
                    <Tooltip contentStyle={TOOLTIP_STYLE} formatter={tooltipValue} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="airQuality" name="Air" fill="hsl(var(--chart-2))" radius={[3, 3, 0, 0]} />
                    <Bar dataKey="waterQuality" name="Water" fill="hsl(var(--chart-1))" radius={[3, 3, 0, 0]} />
                    <Bar dataKey="soilHealth" name="Soil" fill="hsl(var(--chart-6))" radius={[3, 3, 0, 0]} />
                    <Bar dataKey="treeHealth" name="Trees" fill="hsl(var(--chart-4))" radius={[3, 3, 0, 0]} />
                    <Bar dataKey="biodiversity" name="Biodiversity" fill="hsl(var(--chart-3))" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="overflow-x-auto p-0 scrollbar-thin">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                      <th className="px-4 py-3 font-medium">Park</th>
                      <th className="px-4 py-3 font-medium">Health</th>
                      <th className="px-4 py-3 text-right font-medium">Species</th>
                      <th className="px-4 py-3 text-right font-medium">H′</th>
                      <th className="px-4 py-3 text-right font-medium">Open incidents</th>
                      <th className="px-4 py-3 text-right font-medium">Assets</th>
                      <th className="px-4 py-3 text-right font-medium">Condition</th>
                      {anyVisitors && <th className="px-4 py-3 text-right font-medium">Visitors/wk</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => {
                      const openIncidents = cellNumber(row.openIncidents);
                      const visitors = cellNumber(row.weeklyVisitors);
                      return (
                        <tr key={String(row.parkId)} className="border-b last:border-0">
                          <td className="px-4 py-3 font-medium">{row.park}</td>
                          <td className="px-4 py-3">
                            <ScoreBar score={cellNumber(row.ecosystemHealth)} className="min-w-[110px]" />
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums">{fmt(cellNumber(row.speciesRichness), 0, '—')}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{fmt(cellNumber(row.shannon), 2, '—')}</td>
                          <td className="px-4 py-3 text-right tabular-nums">
                            <span className={cn((openIncidents ?? 0) > 0 && 'text-warning')}>
                              {fmt(openIncidents, 0, '—')}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums">{fmt(cellNumber(row.assetCount), 0, '—')}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{fmt(cellNumber(row.avgAssetCondition), 1, '—')}</td>
                          {anyVisitors && (
                            <td className="px-4 py-3 text-right tabular-nums">
                              {visitors == null ? '—' : visitors.toLocaleString()}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </CardContent>
            </Card>

            <p className="text-[11px] text-muted-foreground">
              Species and H′ from GBIF.org occurrence records; park boundaries and assets © OpenStreetMap
              contributors, with demo condition values; open incidents are demo records.
              {!anyVisitors && ' No park has a visitor count, so that column is hidden.'}
            </p>
          </div>
        );
      }}
    </QueryState>
  );
}

// ---------------------------------------------------------------------------
// Saved reports
// ---------------------------------------------------------------------------

/** Read a nested value from a report's metrics without trusting its shape. */
function metricAt(metrics: unknown, path: string): unknown {
  let current: unknown = metrics;
  for (const part of path.split('.')) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

interface MetricDef {
  label: string;
  path: string;
  decimals?: number;
  suffix?: string;
  hint?: string;
  /** `range` reads `{min, max}` from the object at `path`. */
  kind?: 'range';
  types: EcoReportType[] | 'all';
}

/** The headline figures worth showing for each report type. */
const KEY_METRICS: MetricDef[] = [
  { label: 'Ecosystem health', path: 'ecosystemHealth', decimals: 1, hint: 'At generation', types: ['ecosystem'] },
  { label: 'Species on record', path: 'biodiversity.richness', hint: 'GBIF records', types: ['ecosystem', 'biodiversity'] },
  { label: 'Shannon H′', path: 'biodiversity.shannon', decimals: 2, hint: 'GBIF records', types: ['ecosystem', 'biodiversity'] },
  { label: 'Records in period', path: 'biodiversity.recordsInPeriod', hint: 'GBIF records', types: ['biodiversity'] },
  { label: 'Species in period', path: 'biodiversity.richnessInPeriod', hint: 'GBIF records', types: ['biodiversity'] },
  { label: 'Threatened species', path: 'biodiversity.threatenedSpecies', hint: 'IUCN NT or worse', types: ['biodiversity'] },
  { label: 'Invasive-species records', path: 'biodiversity.invasiveRecords', hint: 'GRIIS India', types: ['biodiversity'] },
  { label: 'Mean AQI', path: 'sensors.aqi.mean', decimals: 1, hint: 'Open-Meteo (CAMS)', types: ['ecosystem', 'air'] },
  { label: 'AQI range', path: 'sensors.aqi', kind: 'range', hint: 'Open-Meteo (CAMS)', types: ['air'] },
  { label: 'AQI readings', path: 'sensors.aqi.readings', hint: 'Open-Meteo (CAMS)', types: ['air'] },
  { label: 'Mean water quality', path: 'sensors.water.mean', decimals: 1, hint: 'Simulated sensor', types: ['water'] },
  { label: 'Water readings', path: 'sensors.water.readings', hint: 'Simulated sensor', types: ['water'] },
  { label: 'Water anomalies', path: 'sensors.water.anomalies', hint: 'Simulated sensor', types: ['water'] },
  { label: 'Mean soil moisture', path: 'sensors.soil.mean', decimals: 1, suffix: ' %', hint: 'Simulated sensor', types: ['soil'] },
  { label: 'Soil readings', path: 'sensors.soil.readings', hint: 'Simulated sensor', types: ['soil'] },
  { label: 'Soil anomalies', path: 'sensors.soil.anomalies', hint: 'Simulated sensor', types: ['soil'] },
  { label: 'Incidents', path: 'incidents.total', hint: 'Demo records', types: ['ecosystem', 'maintenance'] },
  { label: 'Incident resolution', path: 'incidents.resolutionRate', decimals: 1, suffix: '%', hint: 'Demo records', types: ['maintenance'] },
  { label: 'Mean resolution', path: 'incidents.avgResolutionHours', decimals: 1, suffix: ' h', hint: 'Demo records', types: ['maintenance'] },
  { label: 'Work orders', path: 'maintenance.total', hint: 'Demo records', types: ['maintenance'] },
  { label: 'Completion rate', path: 'maintenance.completionRate', decimals: 1, suffix: '%', hint: 'Demo records', types: ['ecosystem', 'maintenance'] },
  { label: 'Overdue work orders', path: 'maintenance.overdue', hint: 'Demo records', types: ['maintenance'] },
  { label: 'Citizen reports', path: 'citizenReports.total', hint: 'Demo records', types: ['engagement'] },
  { label: 'Accepted reports', path: 'citizenReports.accepted', hint: 'Demo records', types: ['engagement'] },
  { label: 'Wildlife sightings', path: 'citizenReports.sightings', hint: 'Demo records', types: ['engagement'] },
  { label: 'Upvotes', path: 'citizenReports.upvotes', hint: 'Demo records', types: ['engagement'] },
];

/** Format one metric value: numbers rounded, missing values as "No data", nothing ever as 0. */
function formatMetric(def: MetricDef, value: unknown): string {
  if (def.kind === 'range') {
    const min = metricAt(value, 'min');
    const max = metricAt(value, 'max');
    return typeof min === 'number' && typeof max === 'number' ? `${fmt(min, 0)}–${fmt(max, 0)}` : NO_DATA;
  }
  if (typeof value === 'number') {
    const text = fmt(value, def.decimals ?? 0);
    return text === NO_DATA ? text : `${text}${def.suffix ?? ''}`;
  }
  if (typeof value === 'string' && value) return value;
  return NO_DATA;
}

/**
 * Key metrics for a report, rendered defensively. Generated reports carry the
 * nested snapshot from `report.service.js`; hand-written ones may carry a flat
 * object, which falls back to its primitive entries.
 */
function keyMetrics(report: EcoReport): { label: string; value: string; hint?: string }[] {
  const metrics = report.metrics && typeof report.metrics === 'object' ? report.metrics : {};
  const defs = KEY_METRICS.filter((def) => def.types === 'all' || def.types.includes(report.type));
  const structured = defs
    // A sensor block is null when no readings exist; the metric is still worth
    // showing as "No data" if its parent key is present.
    .filter((def) => metricAt(metrics, def.path.split('.')[0]) !== undefined)
    .map((def) => ({ label: def.label, value: formatMetric(def, metricAt(metrics, def.path)), hint: def.hint }));
  if (structured.length) return structured;

  return Object.entries(metrics)
    .filter(([, value]) => value == null || typeof value === 'number' || typeof value === 'string')
    .slice(0, 8)
    .map(([key, value]) => ({
      label: humanise(key),
      value: typeof value === 'number' ? fmt(value, 1) : typeof value === 'string' && value ? value : NO_DATA,
    }));
}

/** Generated reports store the sensor and sub-index blocks; hand-written ones do not. */
const isGenerated = (report: EcoReport) =>
  metricAt(report.metrics, 'subIndices') !== undefined && metricAt(report.metrics, 'sensors') !== undefined;

const parkName = (report: EcoReport) =>
  report.park && typeof report.park === 'object' ? report.park.name : report.park ? 'One park' : 'All monitored parks';

const periodLabel = (report: EcoReport) =>
  report.periodStart && report.periodEnd
    ? `${dateOnly(report.periodStart)} — ${dateOnly(report.periodEnd)}`
    : 'Period not recorded';

const GENERATED_NOTE =
  'Computed from recorded data when it was generated: GBIF.org occurrence records, Open-Meteo.com (CAMS) air quality, simulated water, soil and noise sensors, and demo incident, work-order and citizen-report records. Every finding is derived from the metrics stored with the report.';

function ReportsTab({ park }: { park?: string }) {
  const { can } = useAuth();
  const editor = can('ecologist');
  const isAdmin = can('admin');

  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('all');
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detailSnapshot, setDetailSnapshot] = useState<EcoReport | null>(null);
  const [deleting, setDeleting] = useState<EcoReport | null>(null);
  const [generating, setGenerating] = useState(false);

  const query = useEcoReports({ page, limit: 12, park, status: editor && status !== 'all' ? status : undefined });
  const updateReport = useUpdateEcoReport();
  const deleteReport = useDeleteEcoReport();

  // Read the open report from the live list so a status change shows at once.
  const detail = (detailId && query.data?.items.find((r) => r.id === detailId)) || detailSnapshot;

  const openReport = (report: EcoReport) => {
    setDetailId(report.id);
    setDetailSnapshot(report);
  };

  const setReportStatus = (report: EcoReport, next: 'published' | 'archived') => {
    updateReport.mutate(
      { id: report.id, body: { status: next } },
      { onSuccess: (updated) => { if (detailId === updated.id) setDetailSnapshot(updated); } }
    );
  };

  const actions = (report: EcoReport) =>
    editor || isAdmin ? (
      <ReportActions
        report={report}
        canEdit={editor}
        canDelete={isAdmin}
        busy={updateReport.isPending && updateReport.variables?.id === report.id}
        onPublish={() => setReportStatus(report, 'published')}
        onArchive={() => setReportStatus(report, 'archived')}
        onDelete={() => setDeleting(report)}
      />
    ) : null;

  return (
    <div className="space-y-4">
      {editor && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Select value={status} onValueChange={(v) => { setStatus(v); setPage(1); }}>
            <SelectTrigger className="w-[160px]" aria-label="Report status"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="draft">Drafts</SelectItem>
              <SelectItem value="published">Published</SelectItem>
              <SelectItem value="archived">Archived</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={() => setGenerating(true)}>
            <Sparkles className="mr-2 h-4 w-4" />
            Generate report
          </Button>
        </div>
      )}

      <QueryState
        query={query}
        isEmpty={(data) => data.items.length === 0}
        emptyTitle={editor ? 'No reports match' : 'No reports published'}
        emptyDescription={
          editor
            ? 'Generate a draft from recorded data, review it, then publish it for everyone.'
            : 'Ecological assessments appear here once an ecologist publishes one.'
        }
        emptyIcon="FileText"
        skeleton={<LoadingState label="Loading reports…" />}
      >
        {(data) => (
          <>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {data.items.map((report) => (
                <Card
                  key={report.id}
                  role="button"
                  tabIndex={0}
                  className="cursor-pointer transition-shadow hover:shadow-md"
                  onClick={() => openReport(report)}
                  onKeyDown={(e) => { if (e.key === 'Enter') openReport(report); }}
                >
                  <CardContent className="space-y-3 p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium leading-snug">{report.title}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {report.authorName || 'Unattributed'} · {periodLabel(report)}
                        </p>
                      </div>
                      <StatusBadge status={report.status} />
                    </div>

                    <p className="line-clamp-2 text-sm text-muted-foreground">{report.summary}</p>

                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className="capitalize">{report.type}</Badge>
                      <Badge variant="outline">{parkName(report)}</Badge>
                      {isGenerated(report) && (
                        <Badge variant="outline" className="gap-1 border-primary/30 bg-primary/5 font-normal text-primary">
                          <Sparkles className="h-3 w-3" />
                          Computed from data
                        </Badge>
                      )}
                      <span className="text-[11px] text-muted-foreground">
                        {report.findings.length} findings · {report.recommendations.length} recommendations
                      </span>
                    </div>

                    {actions(report)}
                  </CardContent>
                </Card>
              ))}
            </div>
            <Pagination meta={data.meta} onPageChange={setPage} />
          </>
        )}
      </QueryState>

      <ReportSheet
        report={detail}
        actions={detail ? actions(detail) : null}
        onClose={() => { setDetailId(null); setDetailSnapshot(null); }}
      />

      {/* Mounted per opening, so it starts from the page's current park filter. */}
      {editor && generating && (
        <GenerateReportDialog
          open={generating}
          defaultPark={park}
          onClose={() => setGenerating(false)}
          onGenerated={(report) => { setGenerating(false); openReport(report); }}
        />
      )}

      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Delete "${deleting?.title}"?`}
        description="The report and its frozen metric snapshot are removed permanently."
        onConfirm={async () => {
          if (!deleting) return;
          try {
            await deleteReport.mutateAsync(deleting.id);
            if (detailId === deleting.id) { setDetailId(null); setDetailSnapshot(null); }
          } catch {
            /* toast already shown */
          }
        }}
      />
    </div>
  );
}

function ReportActions({
  report, canEdit, canDelete, busy, onPublish, onArchive, onDelete,
}: {
  report: EcoReport;
  canEdit: boolean;
  canDelete: boolean;
  busy: boolean;
  onPublish: () => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  // Buttons sit inside a clickable card; keep their clicks from opening it.
  const stop = (fn: () => void) => (e: React.MouseEvent) => { e.stopPropagation(); fn(); };

  return (
    <div className="flex flex-wrap items-center gap-2" onKeyDown={(e) => e.stopPropagation()}>
      {canEdit && report.status === 'draft' && (
        <Button size="sm" disabled={busy} onClick={stop(onPublish)}>
          {busy ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Send className="mr-2 h-3.5 w-3.5" />}
          Publish
        </Button>
      )}
      {canEdit && report.status !== 'archived' && (
        <Button size="sm" variant="outline" disabled={busy} onClick={stop(onArchive)}>
          <Archive className="mr-2 h-3.5 w-3.5" />
          Archive
        </Button>
      )}
      {canDelete && (
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto text-destructive"
          aria-label={`Delete ${report.title}`}
          onClick={stop(onDelete)}
        >
          <Trash2 className="mr-1.5 h-3.5 w-3.5" />
          Delete
        </Button>
      )}
    </div>
  );
}

function GenerateReportDialog({
  open, defaultPark, onClose, onGenerated,
}: {
  open: boolean;
  defaultPark?: string;
  onClose: () => void;
  onGenerated: (report: EcoReport) => void;
}) {
  const generate = useGenerateReport();
  const [type, setType] = useState<EcoReportType>('ecosystem');
  const [park, setPark] = useState(defaultPark ?? ALL_PARKS);
  const [days, setDays] = useState(90);

  const submit = () => {
    generate.mutate(
      { type, park: parkParam(park) ?? null, days },
      { onSuccess: (report) => onGenerated(report) }
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !generate.isPending) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Generate a report</DialogTitle>
          <DialogDescription>
            Creates a draft whose metrics, findings and recommendations are computed from the recorded
            data. Review it, then publish it to make it visible to everyone.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Report type</Label>
            <Select value={type} onValueChange={(v) => setType(v as EcoReportType)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {REPORT_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Park</Label>
            <ParkFilter value={park} onChange={setPark} allLabel="All monitored parks" className="sm:w-full" />
          </div>

          <div className="space-y-1.5">
            <Label>Period</Label>
            <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {WINDOWS.map((w) => (
                  <SelectItem key={w.value} value={String(w.value)}>Last {w.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              GBIF records are published with a delay, so short periods may hold few species records.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={generate.isPending}>Cancel</Button>
          <Button onClick={submit} disabled={generate.isPending}>
            {generate.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
            {generate.isPending ? 'Computing…' : 'Generate draft'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReportSheet({
  report, actions, onClose,
}: {
  report: EcoReport | null;
  actions: React.ReactNode;
  onClose: () => void;
}) {
  const { data: publicSettings } = usePublicSettings();
  if (!report) return null;

  const metrics = keyMetrics(report);
  const generated = isGenerated(report);

  /**
   * Render the report as a PDF in the browser.
   *
   * jsPDF is imported lazily so the ~350 kB library is only fetched when
   * somebody actually exports — it should not sit in the initial bundle for a
   * feature most visitors never touch.
   */
  const exportPdf = async () => {
    try {
      const { jsPDF } = await import('jspdf');
      const doc = new jsPDF({ unit: 'pt', format: 'a4' });

      const marginX = 48;
      const pageHeight = doc.internal.pageSize.getHeight();
      const width = doc.internal.pageSize.getWidth() - marginX * 2;
      let y = 60;

      /** Write wrapped text, starting a new page when the cursor runs out. */
      const write = (text: string, size: number, style: 'normal' | 'bold' = 'normal', gap = 6) => {
        doc.setFont('helvetica', style);
        doc.setFontSize(size);
        for (const line of doc.splitTextToSize(text, width)) {
          if (y > pageHeight - 60) {
            doc.addPage();
            y = 60;
          }
          doc.text(line, marginX, y);
          y += size + 2;
        }
        y += gap;
      };

      const organisation = publicSettings?.organisationName?.trim();
      write(`GreenPulse — Ecological Report${organisation ? ` · ${organisation}` : ''}`, 10, 'normal', 2);
      write(report.title, 18, 'bold');
      write(
        `${report.type.toUpperCase()} · ${parkName(report)} · ${report.authorName || 'Unattributed'} · ` +
          `${report.publishedAt ? `Published ${new Date(report.publishedAt).toLocaleDateString()}` : report.status === 'draft' ? 'Draft' : report.status}`,
        9
      );
      write(`Reporting period: ${periodLabel(report)}`, 9);

      if (report.summary) {
        write('Summary', 13, 'bold', 3);
        write(report.summary, 10);
      }

      if (metrics.length) {
        write('Key metrics', 13, 'bold', 3);
        for (const metric of metrics) {
          write(`• ${metric.label}: ${metric.value}${metric.hint ? ` (${metric.hint})` : ''}`, 10, 'normal', 1);
        }
        y += 5;
      }

      if (report.findings.length) {
        write('Findings', 13, 'bold', 3);
        report.findings.forEach((finding, i) => write(`${i + 1}. ${finding}`, 10, 'normal', 3));
      }

      if (report.recommendations.length) {
        write('Recommendations', 13, 'bold', 3);
        report.recommendations.forEach((rec, i) => write(`${i + 1}. ${rec}`, 10, 'normal', 3));
      }

      if (generated) {
        y += 6;
        write(GENERATED_NOTE, 8);
      }
      write('Data: GBIF.org · Open-Meteo.com (CAMS) · © OpenStreetMap contributors. Demo records are labelled as such.', 8);

      doc.save(`greenpulse-${report.type}-${report.id.slice(-6)}.pdf`);
      toast.success('PDF downloaded');
    } catch {
      toast.error('Could not generate the PDF');
    }
  };

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{report.title}</SheetTitle>
          <SheetDescription>
            {report.authorName || 'Unattributed'} ·{' '}
            {report.publishedAt ? `Published ${dateOnly(report.publishedAt)}` : `Created ${dateOnly(report.createdAt)}`}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="capitalize">{report.type}</Badge>
            <Badge variant="outline">{parkName(report)}</Badge>
            <StatusBadge status={report.status} />
            <Button size="sm" variant="outline" className="ml-auto" onClick={exportPdf}>
              <FileText className="mr-2 h-3.5 w-3.5" />
              Export PDF
            </Button>
          </div>

          <div className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
            <p><span className="font-medium text-foreground">Period:</span> {periodLabel(report)}</p>
            <p><span className="font-medium text-foreground">Author:</span> {report.authorName || 'Unattributed'}</p>
          </div>

          {actions}

          {generated && <DataNotice>{GENERATED_NOTE}</DataNotice>}

          {report.summary && <p className="text-sm leading-relaxed">{report.summary}</p>}

          {metrics.length > 0 && (
            <div>
              <p className="mb-2 text-sm font-medium">Key metrics</p>
              <div className="grid grid-cols-2 gap-2">
                {metrics.map((metric) => (
                  <MetricTile key={metric.label} label={metric.label} value={metric.value} hint={metric.hint} />
                ))}
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">
                These figures are frozen when the report is generated, so it keeps showing what it was
                written against even after the live scores move on.
              </p>
            </div>
          )}

          <div>
            <p className="mb-2 text-sm font-medium">Findings</p>
            {report.findings.length > 0 ? (
              <ul className="space-y-2">
                {report.findings.map((finding, i) => (
                  <li key={i} className="flex gap-2 text-sm">
                    <span className="shrink-0 text-muted-foreground">{i + 1}.</span>
                    <span>{finding}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No findings recorded.</p>
            )}
          </div>

          <div>
            <p className="mb-2 text-sm font-medium">Recommendations</p>
            {report.recommendations.length > 0 ? (
              <ul className="space-y-2">
                {report.recommendations.map((rec, i) => (
                  <li key={i} className="flex gap-2 rounded-lg bg-primary/5 p-2.5 text-sm">
                    <TrendingUp className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    <span>{rec}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No recommendations recorded.</p>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

function ExportTab({ park }: { park?: string }) {
  const { can, loading, signedIn } = useAuth();
  const { data: publicSettings } = usePublicSettings();
  const [busy, setBusy] = useState<string | null>(null);

  /** CSV is fetched with the officer's token and saved by the browser. */
  const downloadCsv = async (dataset: ExportDataset) => {
    setBusy(`${dataset}:csv`);
    try {
      await analyticsApi.exportCsv(dataset, park);
    } catch (error) {
      // An expired session is announced once by AuthProvider.
      if (error instanceof ApiError && error.isAuthError) return;
      toast.error(error instanceof Error ? error.message : 'Could not download the CSV');
    } finally {
      setBusy(null);
    }
  };

  /** PDF is rendered client-side from the JSON export. */
  const downloadPdf = async (dataset: (typeof DATASETS)[number]) => {
    setBusy(`${dataset.value}:pdf`);
    try {
      const rows = await analyticsApi.exportJson(dataset.value, park);
      if (!rows.length) {
        toast.error('Nothing to export in this dataset');
        return;
      }

      const [{ jsPDF }, autoTableModule] = await Promise.all([
        import('jspdf'),
        import('jspdf-autotable'),
      ]);
      const autoTable = autoTableModule.default;

      // Landscape, because these tables are wide.
      const doc = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'landscape' });
      const columns = Object.keys(rows[0]);
      const organisation = publicSettings?.organisationName?.trim();

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(15);
      doc.text(`GreenPulse — ${dataset.label}`, 40, 40);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.text(
        `${organisation ? `${organisation} · ` : ''}${rows.length} records · exported ${new Date().toLocaleString()} · Source: ${dataset.sourceNote}`,
        40,
        56
      );

      autoTable(doc, {
        startY: 70,
        head: [columns.map((c) => humanise(c))],
        body: rows.map((row) => columns.map((c) => (row[c] == null ? '' : String(row[c])))),
        styles: { fontSize: 7, cellPadding: 3 },
        headStyles: { fillColor: [34, 116, 76] },
        alternateRowStyles: { fillColor: [245, 248, 246] },
      });

      doc.save(`greenpulse-${dataset.value}-${new Date().toISOString().slice(0, 10)}.pdf`);
      toast.success(`${rows.length} records exported`);
    } catch (error) {
      if (error instanceof ApiError && error.isAuthError) return;
      toast.error(error instanceof ApiError ? error.message : 'Could not generate the PDF');
    } finally {
      setBusy(null);
    }
  };

  if (loading) return <LoadingState label="Checking your access…" />;

  // Row-level exports include incident details and staff names, which the API
  // restricts to officers — so the controls are not offered to anyone else.
  if (!can('officer')) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted text-muted-foreground">
            <Lock className="h-6 w-6" />
          </div>
          <div className="space-y-1">
            <p className="font-medium">Exports require the officer role</p>
            <p className="mx-auto max-w-md text-sm text-muted-foreground">
              Row-level exports include incident details and staff names, so they are limited to park
              officers and administrators. Published reports on the Reports tab can be saved as PDF by anyone.
            </p>
          </div>
          {!signedIn && (
            <Button asChild size="sm">
              <Link href="/login?next=/analytics"><LogIn className="mr-2 h-4 w-4" />Sign in</Link>
            </Button>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="border-dashed">
        <CardContent className="p-4 text-xs text-muted-foreground">
          CSV files are fetched from the API with your session and saved by the browser. PDFs are rendered
          in your browser from the same data — no server-side rendering pipeline. Exports respect the park
          filter selected at the top of the page.
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {DATASETS.map((dataset) => (
          <Card key={dataset.value}>
            <CardHeader className="pb-3">
              <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                {dataset.label}
                <SourceBadge source={dataset.source} />
              </CardTitle>
              <CardDescription className="text-xs">{dataset.note} · {dataset.sourceNote}</CardDescription>
            </CardHeader>
            <CardContent className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="flex-1"
                disabled={busy !== null}
                onClick={() => downloadCsv(dataset.value)}
              >
                {busy === `${dataset.value}:csv` ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <FileSpreadsheet className="mr-2 h-4 w-4" />
                )}
                CSV
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="flex-1"
                disabled={busy !== null}
                onClick={() => downloadPdf(dataset)}
              >
                {busy === `${dataset.value}:pdf` ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <FileText className="mr-2 h-4 w-4" />
                )}
                PDF
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
