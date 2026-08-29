'use client';

/**
 * Module 10 — Analytics & Reports.
 *
 * Export is split deliberately: CSV is a direct browser download from the API
 * (no round trip through JavaScript memory), while PDF is rendered client-side
 * with jsPDF. Generating PDFs server-side would mean shipping a headless
 * browser into the deployment for something the client already does well.
 */

import { useState } from 'react';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend,
  Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import {
  Download, FileText, FileSpreadsheet, TrendingUp, Loader2, Plus, Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { PageHeader } from '@/components/shared/page-header';
import { MetricTile, ScoreBar } from '@/components/shared/score-badge';
import { StatusBadge } from '@/components/shared/status-badges';
import { ParkFilter, ALL_PARKS, parkParam } from '@/components/shared/park-filter';
import { QueryState, SkeletonCards, LoadingState, EmptyState } from '@/components/shared/query-state';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { useAuth } from '@/components/providers/auth-provider';
import {
  useAnalyticsSummary, useEnvironmentalTrend, useBiodiversityTrend,
  useIncidentTrend, useEngagementTrend, useParkComparison, useEcoReports,
  useDeleteEcoReport,
} from '@/lib/hooks/use-api';
import { analyticsApi, type ExportDataset } from '@/lib/api/endpoints';
import { cn } from '@/lib/utils';
import type { EcoReport } from '@/lib/types';

const TOOLTIP_STYLE = {
  background: 'hsl(var(--popover))',
  border: '1px solid hsl(var(--border))',
  borderRadius: 'var(--radius)',
  fontSize: 12,
};

const DATASETS: { value: ExportDataset; label: string; note: string }[] = [
  { value: 'incidents', label: 'Incidents', note: 'Reference, type, priority score, resolution time' },
  { value: 'assets', label: 'Park assets', note: 'Inventory with condition and maintenance counts' },
  { value: 'observations', label: 'Species observations', note: 'The abundance records behind the indices' },
  { value: 'citizen-reports', label: 'Citizen reports', note: 'Submissions, status and upvotes' },
  { value: 'work-orders', label: 'Work orders', note: 'Schedule, progress and cost' },
];

const WINDOWS = [
  { value: 30, label: '30 days' },
  { value: 90, label: '90 days' },
  { value: 180, label: '6 months' },
  { value: 365, label: '1 year' },
];

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
              <SelectTrigger className="w-[130px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {WINDOWS.map((w) => (
                  <SelectItem key={w.value} value={String(w.value)}>{w.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        }
      />

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

function OverviewTab({ filters }: { filters: { park?: string; days: number } }) {
  const query = useAnalyticsSummary(filters);

  return (
    <QueryState query={query} skeleton={<SkeletonCards count={8} />}>
      {(data) => (
        <div className="space-y-6">
          <p className="text-sm text-muted-foreground">
            {new Date(data.window.from).toLocaleDateString()} — {new Date(data.window.to).toLocaleDateString()}
          </p>

          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <MetricTile
              label="Ecosystem health"
              value={data.ecosystemHealth}
              hint={data.healthGrade}
              tone={data.ecosystemHealth >= 70 ? 'success' : data.ecosystemHealth >= 55 ? 'warning' : 'destructive'}
            />
            <MetricTile
              label="Biodiversity score"
              value={data.biodiversity.score}
              hint={`${data.biodiversity.richness} species · H′ ${data.biodiversity.shannon.toFixed(2)}`}
              tone={data.biodiversity.score >= 65 ? 'success' : 'warning'}
            />
            <MetricTile
              label="Incident resolution"
              value={`${data.incidents.resolutionRate}%`}
              hint={`${data.incidents.resolved} of ${data.incidents.total} closed`}
              tone={data.incidents.resolutionRate >= 75 ? 'success' : 'warning'}
            />
            <MetricTile
              label="Maintenance completion"
              value={`${data.maintenance.completionRate}%`}
              hint={`₹${data.maintenance.cost.toLocaleString()} spent`}
              tone={data.maintenance.completionRate >= 70 ? 'success' : 'warning'}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Health Sub-Indices</CardTitle>
                <CardDescription>
                  The five components of the composite index — the weakest one is where effort pays off
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {Object.entries(data.subIndices).map(([key, score]) => (
                  <div key={key} className="flex items-center gap-3">
                    <span className="w-28 shrink-0 text-sm capitalize">
                      {key.replace(/([A-Z])/g, ' $1').trim()}
                    </span>
                    <ScoreBar score={score} className="flex-1" />
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Operational Summary</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-3">
                <MetricTile label="Incidents raised" value={data.incidents.total} />
                <MetricTile
                  label="Mean resolution"
                  value={data.incidents.avgResolutionHours !== null ? `${data.incidents.avgResolutionHours} h` : '—'}
                />
                <MetricTile label="Citizen reports" value={data.citizenReports} />
                <MetricTile label="AI detections" value={data.aiDetections} />
                <MetricTile label="Assets tracked" value={data.assets.count} />
                <MetricTile
                  label="Mean asset condition"
                  value={data.assets.avgCondition}
                  tone={data.assets.avgCondition >= 70 ? 'success' : 'warning'}
                />
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Threatened Species Recorded</CardTitle>
              <CardDescription>
                Species above &ldquo;Least Concern&rdquo; observed in this window — the conservation
                signal that raises the biodiversity score
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-baseline gap-3">
                <span className="text-4xl font-bold tabular-nums">{data.biodiversity.threatenedSpecies}</span>
                <span className="text-sm text-muted-foreground">
                  of {data.biodiversity.richness} species recorded
                </span>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Evenness J′ = {data.biodiversity.evenness.toFixed(3)}. A low value means a few
                species dominate — often an invasive one — even when the species list looks healthy.
              </p>
            </CardContent>
          </Card>
        </div>
      )}
    </QueryState>
  );
}

// ---------------------------------------------------------------------------
// Trends
// ---------------------------------------------------------------------------

function TrendsTab({ filters }: { filters: { park?: string; days: number } }) {
  const environmental = useEnvironmentalTrend({ ...filters, interval: 'day' });
  const biodiversity = useBiodiversityTrend(filters);
  const incidents = useIncidentTrend(filters);
  const engagement = useEngagementTrend(filters);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Environmental Indicators</CardTitle>
          <CardDescription>
            Normalised to 0–100, with the count of readings the anomaly ensemble flagged each day
          </CardDescription>
        </CardHeader>
        <CardContent>
          {environmental.isPending ? (
            <LoadingState label="Loading…" />
          ) : !environmental.data?.length ? (
            <EmptyState title="No readings in this window" icon="Gauge" />
          ) : (
            <ResponsiveContainer width="100%" height={320}>
              <ComposedChart data={environmental.data}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize={10} minTickGap={30} />
                <YAxis yAxisId="left" domain={[0, 100]} stroke="hsl(var(--muted-foreground))" fontSize={11} />
                <YAxis yAxisId="right" orientation="right" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                <Tooltip contentStyle={TOOLTIP_STYLE} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line yAxisId="left" type="monotone" dataKey="aqi" name="Air" stroke="hsl(var(--chart-2))" strokeWidth={2} dot={false} />
                <Line yAxisId="left" type="monotone" dataKey="water" name="Water" stroke="hsl(var(--chart-1))" strokeWidth={2} dot={false} />
                <Line yAxisId="left" type="monotone" dataKey="soil" name="Soil" stroke="hsl(var(--chart-6))" strokeWidth={2} dot={false} />
                <Line yAxisId="left" type="monotone" dataKey="noise" name="Noise" stroke="hsl(var(--chart-3))" strokeWidth={2} dot={false} />
                <Bar yAxisId="right" dataKey="anomalies" name="Anomalies" fill="hsl(var(--destructive) / 0.4)" radius={[3, 3, 0, 0]} />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Biodiversity Over Time</CardTitle>
            <CardDescription>
              Shannon H′ genuinely recomputed each month from that month&apos;s observations — not a
              rolling average of one number
            </CardDescription>
          </CardHeader>
          <CardContent>
            {biodiversity.isPending ? (
              <LoadingState label="Loading…" />
            ) : !biodiversity.data?.length ? (
              <EmptyState title="No observations in this window" icon="Bird" />
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <ComposedChart data={biodiversity.data}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="month" stroke="hsl(var(--muted-foreground))" fontSize={10} />
                  <YAxis yAxisId="left" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                  <YAxis yAxisId="right" orientation="right" domain={[0, 4]} stroke="hsl(var(--muted-foreground))" fontSize={11} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar yAxisId="left" dataKey="richness" name="Species (S)" fill="hsl(var(--chart-1))" radius={[3, 3, 0, 0]} />
                  <Line yAxisId="right" type="monotone" dataKey="shannon" name="Shannon H′" stroke="hsl(var(--chart-3))" strokeWidth={2} />
                  <Line yAxisId="right" type="monotone" dataKey="evenness" name="Evenness J′" stroke="hsl(var(--chart-5))" strokeWidth={2} strokeDasharray="4 4" />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Incident Volume &amp; Backlog</CardTitle>
            <CardDescription>Reported against resolved — the gap is the backlog</CardDescription>
          </CardHeader>
          <CardContent>
            {incidents.isPending ? (
              <LoadingState label="Loading…" />
            ) : !incidents.data?.length ? (
              <EmptyState title="No incidents in this window" icon="Siren" />
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <ComposedChart data={incidents.data}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="month" stroke="hsl(var(--muted-foreground))" fontSize={10} />
                  <YAxis yAxisId="left" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                  <YAxis yAxisId="right" orientation="right" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar yAxisId="left" dataKey="reported" name="Reported" fill="hsl(var(--chart-1))" radius={[3, 3, 0, 0]} />
                  <Bar yAxisId="left" dataKey="resolved" name="Resolved" fill="hsl(var(--success))" radius={[3, 3, 0, 0]} />
                  <Line yAxisId="right" type="monotone" dataKey="avgResolutionHours" name="Mean hours" stroke="hsl(var(--warning))" strokeWidth={2} />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Citizen Participation</CardTitle>
          <CardDescription>Submissions by category over time</CardDescription>
        </CardHeader>
        <CardContent>
          {engagement.isPending ? (
            <LoadingState label="Loading…" />
          ) : !engagement.data?.length ? (
            <EmptyState title="No submissions in this window" icon="Megaphone" />
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={engagement.data}>
                <defs>
                  {['issue', 'wildlife-sighting', 'feedback', 'suggestion'].map((key, i) => (
                    <linearGradient key={key} id={`eng-${i}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={`hsl(var(--chart-${i + 1}))`} stopOpacity={0.35} />
                      <stop offset="95%" stopColor={`hsl(var(--chart-${i + 1}))`} stopOpacity={0} />
                    </linearGradient>
                  ))}
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="month" stroke="hsl(var(--muted-foreground))" fontSize={10} />
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} />
                <Tooltip contentStyle={TOOLTIP_STYLE} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {['issue', 'wildlife-sighting', 'feedback', 'suggestion'].map((key, i) => (
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
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Compare
// ---------------------------------------------------------------------------

function CompareTab() {
  const query = useParkComparison();

  return (
    <QueryState query={query} skeleton={<LoadingState label="Comparing parks…" />}>
      {(rows) => (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Ecosystem Health by Park</CardTitle>
              <CardDescription>All five sub-indices side by side</CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={340}>
                <BarChart data={rows} margin={{ bottom: 60 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="park" angle={-25} textAnchor="end" height={90} interval={0} stroke="hsl(var(--muted-foreground))" fontSize={10} />
                  <YAxis domain={[0, 100]} stroke="hsl(var(--muted-foreground))" fontSize={11} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} />
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
                    <th className="px-4 py-3 text-right font-medium">Visitors/wk</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={String(row.parkId)} className="border-b last:border-0">
                      <td className="px-4 py-3 font-medium">{row.park}</td>
                      <td className="px-4 py-3">
                        <ScoreBar score={Number(row.ecosystemHealth)} className="min-w-[110px]" />
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">{row.speciesRichness}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{Number(row.shannon).toFixed(2)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        <span className={cn(Number(row.openIncidents) > 0 && 'text-warning')}>
                          {row.openIncidents}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">{row.assetCount}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{row.avgAssetCondition}</td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {Number(row.weeklyVisitors).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </div>
      )}
    </QueryState>
  );
}

// ---------------------------------------------------------------------------
// Saved reports
// ---------------------------------------------------------------------------

function ReportsTab({ park }: { park?: string }) {
  const { can } = useAuth();
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<EcoReport | null>(null);
  const [deleting, setDeleting] = useState<EcoReport | null>(null);

  const query = useEcoReports({ page, limit: 12, park });
  const deleteReport = useDeleteEcoReport();

  return (
    <div className="space-y-4">
      <QueryState
        query={query}
        isEmpty={(data) => data.items.length === 0}
        emptyTitle="No reports published"
        emptyDescription="Ecological assessments appear here once an ecologist publishes one."
        emptyIcon="FileText"
        skeleton={<LoadingState label="Loading reports…" />}
      >
        {(data) => (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {data.items.map((report) => (
              <Card key={report.id} className="cursor-pointer transition-shadow hover:shadow-md" onClick={() => setDetail(report)}>
                <CardContent className="space-y-3 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium leading-snug">{report.title}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {report.authorName} · {new Date(report.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                    <StatusBadge status={report.status} />
                  </div>

                  <p className="line-clamp-2 text-sm text-muted-foreground">{report.summary}</p>

                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="capitalize">{report.type}</Badge>
                    {report.park && typeof report.park === 'object' && (
                      <Badge variant="outline">{report.park.name}</Badge>
                    )}
                    <span className="text-[11px] text-muted-foreground">
                      {report.findings.length} findings · {report.recommendations.length} recommendations
                    </span>

                    {can('admin') && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="ml-auto h-7 w-7 text-destructive"
                        onClick={(e) => { e.stopPropagation(); setDeleting(report); }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </QueryState>

      <ReportSheet report={detail} onClose={() => setDetail(null)} />

      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Delete "${deleting?.title}"?`}
        description="The report and its frozen metric snapshot are removed permanently."
        onConfirm={async () => {
          if (deleting) await deleteReport.mutateAsync(deleting.id);
        }}
      />
    </div>
  );
}

function ReportSheet({ report, onClose }: { report: EcoReport | null; onClose: () => void }) {
  if (!report) return null;

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

      write('GreenPulse — Ecological Report', 10, 'normal', 2);
      write(report.title, 18, 'bold');
      write(
        `${report.type.toUpperCase()} · ${report.authorName || 'Unattributed'} · ` +
          `${report.publishedAt ? new Date(report.publishedAt).toLocaleDateString() : 'Draft'}`,
        9
      );

      if (report.periodStart && report.periodEnd) {
        write(
          `Reporting period: ${new Date(report.periodStart).toLocaleDateString()} — ${new Date(report.periodEnd).toLocaleDateString()}`,
          9
        );
      }

      if (report.summary) {
        write('Summary', 13, 'bold', 3);
        write(report.summary, 10);
      }

      const metrics = Object.entries(report.metrics ?? {});
      if (metrics.length) {
        write('Metrics at publication', 13, 'bold', 3);
        for (const [key, value] of metrics) {
          write(`• ${key.replace(/([A-Z])/g, ' $1').trim()}: ${value}`, 10, 'normal', 1);
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
            {report.authorName} · {report.publishedAt ? new Date(report.publishedAt).toLocaleDateString() : 'Draft'}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="capitalize">{report.type}</Badge>
            <StatusBadge status={report.status} />
            <Button size="sm" variant="outline" className="ml-auto" onClick={exportPdf}>
              <FileText className="mr-2 h-3.5 w-3.5" />
              Export PDF
            </Button>
          </div>

          {report.summary && <p className="text-sm leading-relaxed">{report.summary}</p>}

          {Object.keys(report.metrics ?? {}).length > 0 && (
            <div>
              <p className="mb-2 text-sm font-medium">Metrics at publication</p>
              <div className="grid grid-cols-2 gap-2">
                {Object.entries(report.metrics).map(([key, value]) => (
                  <MetricTile
                    key={key}
                    label={key.replace(/([A-Z])/g, ' $1').trim()}
                    value={String(value)}
                  />
                ))}
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">
                These figures are frozen at publication, so the report keeps showing what it was
                written against even after the live scores move on.
              </p>
            </div>
          )}

          {report.findings.length > 0 && (
            <div>
              <p className="mb-2 text-sm font-medium">Findings</p>
              <ul className="space-y-2">
                {report.findings.map((finding, i) => (
                  <li key={i} className="flex gap-2 text-sm">
                    <span className="shrink-0 text-muted-foreground">{i + 1}.</span>
                    <span>{finding}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {report.recommendations.length > 0 && (
            <div>
              <p className="mb-2 text-sm font-medium">Recommendations</p>
              <ul className="space-y-2">
                {report.recommendations.map((rec, i) => (
                  <li key={i} className="flex gap-2 rounded-lg bg-primary/5 p-2.5 text-sm">
                    <TrendingUp className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    <span>{rec}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

function ExportTab({ park }: { park?: string }) {
  const [busy, setBusy] = useState<string | null>(null);

  /**
   * CSV is a plain navigation to the API, so the browser streams the file
   * straight to disk without it ever passing through JavaScript memory.
   */
  const downloadCsv = (dataset: ExportDataset) => {
    window.open(analyticsApi.exportCsvUrl(dataset, park), '_blank');
  };

  /** PDF is rendered client-side from the JSON export. */
  const downloadPdf = async (dataset: ExportDataset, label: string) => {
    setBusy(dataset);
    try {
      const rows = await analyticsApi.exportJson(dataset, park);
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

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(15);
      doc.text(`GreenPulse — ${label}`, 40, 40);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.text(`${rows.length} records · exported ${new Date().toLocaleString()}`, 40, 56);

      autoTable(doc, {
        startY: 70,
        head: [columns.map((c) => c.replace(/([A-Z])/g, ' $1').trim())],
        body: rows.map((row) => columns.map((c) => String(row[c] ?? ''))),
        styles: { fontSize: 7, cellPadding: 3 },
        headStyles: { fillColor: [34, 116, 76] },
        alternateRowStyles: { fillColor: [245, 248, 246] },
      });

      doc.save(`greenpulse-${dataset}-${new Date().toISOString().slice(0, 10)}.pdf`);
      toast.success(`${rows.length} records exported`);
    } catch {
      toast.error('Could not generate the PDF');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      <Card className="border-dashed">
        <CardContent className="p-4 text-xs text-muted-foreground">
          CSV downloads stream directly from the API. PDFs are rendered in your browser from the
          same data — no server-side rendering pipeline, and nothing leaves the machine you are on.
          Exports respect the park filter selected at the top of the page.
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {DATASETS.map((dataset) => (
          <Card key={dataset.value}>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">{dataset.label}</CardTitle>
              <CardDescription className="text-xs">{dataset.note}</CardDescription>
            </CardHeader>
            <CardContent className="flex gap-2">
              <Button variant="outline" size="sm" className="flex-1" onClick={() => downloadCsv(dataset.value)}>
                <FileSpreadsheet className="mr-2 h-4 w-4" />
                CSV
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="flex-1"
                disabled={busy === dataset.value}
                onClick={() => downloadPdf(dataset.value, dataset.label)}
              >
                {busy === dataset.value ? (
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
