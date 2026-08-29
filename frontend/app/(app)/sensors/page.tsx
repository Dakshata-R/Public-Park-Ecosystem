'use client';

/**
 * Module 6 — Environmental Sensor Monitoring.
 *
 * Two things worth noticing on this page.
 *
 * First, every reading carries both a raw value and a normalised 0–100 score.
 * Sensors report in incompatible units and directions — a *low* AQI is good, a
 * *high* soil-moisture reading is good — so the normalisation is what lets
 * them share an axis and feed one composite index.
 *
 * Second, the anomaly detector is shown working rather than merely claimed:
 * the chart marks flagged points, and the detail view reports the z-score and
 * the ensemble's reasoning for each one.
 */

import { useState } from 'react';
import {
  Area, AreaChart, CartesianGrid, Line, ReferenceLine, ResponsiveContainer,
  Scatter, ComposedChart, Tooltip, XAxis, YAxis, Legend,
} from 'recharts';
import {
  Activity, BatteryLow, Gauge, RefreshCw, Signal, TriangleAlert,
  WifiOff, Info, Sigma,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { PageHeader } from '@/components/shared/page-header';
import { MetricTile, ScoreBar, scoreText } from '@/components/shared/score-badge';
import { StatusBadge } from '@/components/shared/status-badges';
import { ParkFilter, ALL_PARKS, parkParam } from '@/components/shared/park-filter';
import { QueryState, SkeletonCards, LoadingState, EmptyState } from '@/components/shared/query-state';
import { useAuth } from '@/components/providers/auth-provider';
import {
  useLiveSensors, useSensorReadings, useSensorAnomalies, useSimulateSensors,
} from '@/lib/hooks/use-api';
import { cn } from '@/lib/utils';
import type { LiveSensor, SensorType } from '@/lib/types';

const TYPE_META: Record<SensorType, { label: string; icon: typeof Gauge; note: string }> = {
  aqi: { label: 'Air Quality', icon: Activity, note: 'Lower is better — inverted through the CPCB category map' },
  temperature: { label: 'Temperature', icon: Gauge, note: 'Scored against a comfortable band centred on 24 °C' },
  humidity: { label: 'Humidity', icon: Gauge, note: 'Scored against a band centred on 55 %' },
  noise: { label: 'Noise', icon: Signal, note: 'Lower is better — 35 dB scores 100, 85 dB scores 0' },
  water: { label: 'Water Quality', icon: Gauge, note: 'Already a 0–100 index where higher is better' },
  soil: { label: 'Soil Moisture', icon: Gauge, note: 'Higher is better up to the calibrated maximum' },
};

const TOOLTIP_STYLE = {
  background: 'hsl(var(--popover))',
  border: '1px solid hsl(var(--border))',
  borderRadius: 'var(--radius)',
  fontSize: 12,
};

export default function SensorsPage() {
  const { can } = useAuth();
  const [park, setPark] = useState(ALL_PARKS);
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [selected, setSelected] = useState<LiveSensor | null>(null);

  const live = useLiveSensors(parkParam(park));
  const simulate = useSimulateSensors();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Environmental Sensor Monitoring"
        description="Live readings from the monitoring network, normalised onto a common 0–100 scale and screened by a three-detector anomaly ensemble."
        icon="Gauge"
        action={
          <div className="flex flex-wrap items-center gap-2">
            <ParkFilter value={park} onChange={setPark} />
            {can('officer') && (
              <Button variant="outline" onClick={() => simulate.mutate()} disabled={simulate.isPending}>
                <RefreshCw className={cn('mr-2 h-4 w-4', simulate.isPending && 'animate-spin')} />
                Advance simulation
              </Button>
            )}
          </div>
        }
      />

      <Alert className="border-info/20 bg-info/5">
        <Info className="h-4 w-4 text-info" />
        <AlertDescription className="text-xs leading-relaxed">
          A physical sensor deployment was out of scope for this project, so readings are generated
          — but the ingestion path is the real one. Values follow an AR(1) process with a diurnal
          cycle and Gaussian noise, and while the machine is online the baseline is{' '}
          <strong>anchored every 15 minutes to live weather and CAMS air-quality data</strong> for
          each park&apos;s actual coordinates. A real gateway would POST to the same endpoint the
          simulator calls internally.
        </AlertDescription>
      </Alert>

      <QueryState query={live} skeleton={<SkeletonCards count={4} />}>
        {(data) => {
          const sensors = typeFilter === 'all'
            ? data.sensors
            : data.sensors.filter((s) => s.type === typeFilter);

          const types = Array.from(new Set(data.sensors.map((s) => s.type)));

          return (
            <div className="space-y-6">
              {/* --- Network health --- */}
              <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                <MetricTile label="Deployed" value={data.summary.total} hint="Active devices" />
                <MetricTile label="Online" value={data.summary.online} tone="success" hint="Reporting normally" />
                <MetricTile
                  label="Warning"
                  value={data.summary.warning}
                  tone={data.summary.warning > 0 ? 'warning' : undefined}
                  hint="Reading outside threshold"
                />
                <MetricTile
                  label="Offline"
                  value={data.summary.offline}
                  tone={data.summary.offline > 0 ? 'destructive' : 'success'}
                  hint="Excluded from scoring"
                />
              </div>

              {data.summary.offline > 0 && (
                <Alert className="border-destructive/20 bg-destructive/5">
                  <WifiOff className="h-4 w-4 text-destructive" />
                  <AlertDescription className="text-xs">
                    {data.summary.offline} device{data.summary.offline === 1 ? ' is' : 's are'} offline.
                    Offline sensors are excluded from the Ecosystem Health Index rather than counted
                    as zero — a park with a broken probe is scored on the indicators it does have.
                  </AlertDescription>
                </Alert>
              )}

              {/* --- Mean score per sensor type --- */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Normalised Scores by Sensor Type</CardTitle>
                  <CardDescription>
                    Raw readings mapped onto 0–100 where higher is always better — the step that
                    makes incompatible units comparable
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {Object.entries(data.summary.averageScoreByType).map(([type, score]) => (
                    <div key={type} className="flex items-center gap-3">
                      <span className="w-28 shrink-0 text-sm">
                        {TYPE_META[type as SensorType]?.label ?? type}
                      </span>
                      <ScoreBar score={score} className="flex-1" />
                      <span className="hidden w-64 shrink-0 text-[11px] text-muted-foreground sm:block">
                        {TYPE_META[type as SensorType]?.note}
                      </span>
                    </div>
                  ))}
                </CardContent>
              </Card>

              {/* --- Device grid --- */}
              <div className="flex flex-wrap items-center gap-2">
                <Tabs value={typeFilter} onValueChange={setTypeFilter}>
                  <TabsList>
                    <TabsTrigger value="all">All</TabsTrigger>
                    {types.map((type) => (
                      <TabsTrigger key={type} value={type}>
                        {TYPE_META[type]?.label ?? type}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </Tabs>
              </div>

              {sensors.length === 0 ? (
                <Card><CardContent><EmptyState title="No sensors match that filter" icon="Gauge" /></CardContent></Card>
              ) : (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {sensors.map((sensor) => {
                    const Icon = TYPE_META[sensor.type]?.icon ?? Gauge;
                    const offline = sensor.status === 'offline';

                    return (
                      <Card
                        key={sensor.id}
                        onClick={() => setSelected(sensor)}
                        className={cn(
                          'cursor-pointer transition-shadow hover:shadow-md',
                          sensor.breached && 'border-warning/40',
                          offline && 'opacity-60'
                        )}
                      >
                        <CardContent className="space-y-3 p-4">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium">{sensor.name}</p>
                              <p className="font-mono text-[11px] text-muted-foreground">{sensor.sensorCode}</p>
                            </div>
                            <div className={cn(
                              'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
                              offline ? 'bg-muted text-muted-foreground' : 'bg-primary/10 text-primary'
                            )}>
                              <Icon className="h-4 w-4" />
                            </div>
                          </div>

                          <div className="flex items-baseline gap-1.5">
                            <span className={cn('text-3xl font-bold tabular-nums', !offline && scoreText(sensor.score))}>
                              {offline ? '—' : sensor.currentValue}
                            </span>
                            <span className="text-sm text-muted-foreground">{sensor.unit}</span>
                          </div>

                          {!offline && (
                            <div>
                              <div className="mb-1 flex justify-between text-[11px] text-muted-foreground">
                                <span>Normalised score</span>
                                <span>{sensor.score}/100</span>
                              </div>
                              <ScoreBar score={sensor.score} showValue={false} />
                            </div>
                          )}

                          <div className="flex flex-wrap items-center gap-1.5 border-t pt-2.5">
                            <StatusBadge status={sensor.status} />
                            {sensor.breached && (
                              <Badge variant="outline" className="gap-1 border-warning/30 bg-warning/10 text-[10px] text-warning">
                                <TriangleAlert className="h-3 w-3" />Threshold
                              </Badge>
                            )}
                            {sensor.batteryLevel < 20 && (
                              <Badge variant="outline" className="gap-1 border-destructive/30 bg-destructive/10 text-[10px] text-destructive">
                                <BatteryLow className="h-3 w-3" />{Math.round(sensor.batteryLevel)}%
                              </Badge>
                            )}
                            {sensor.stale && !offline && (
                              <Badge variant="outline" className="text-[10px]">Stale</Badge>
                            )}
                          </div>

                          <p className="truncate text-[11px] text-muted-foreground">
                            {typeof sensor.park === 'object' ? sensor.park.name : ''}
                          </p>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}
            </div>
          );
        }}
      </QueryState>

      <SensorDetailSheet sensor={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

/**
 * Time series and anomaly report for one sensor.
 *
 * The chart plots the raw value with flagged readings overlaid as points, and
 * draws the configured warning thresholds — so "why is this in warning" is
 * answerable by looking rather than by reading documentation.
 */
function SensorDetailSheet({ sensor, onClose }: { sensor: LiveSensor | null; onClose: () => void }) {
  const [hours, setHours] = useState(24);
  const readings = useSensorReadings(sensor?.id ?? '', hours);
  const anomalies = useSensorAnomalies(sensor?.id ?? '');

  const series = readings.data?.readings.map((point) => ({
    time: new Date(point.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    value: point.value,
    score: point.score,
    // Only anomalous points get a y-value, so the scatter draws just those.
    anomaly: point.isAnomaly ? point.value : null,
    zScore: point.zScore,
  })) ?? [];

  return (
    <Sheet open={Boolean(sensor)} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
        {sensor && (
          <>
            <SheetHeader>
              <SheetTitle>{sensor.name}</SheetTitle>
              <SheetDescription className="font-mono text-xs">
                {sensor.sensorCode} · {typeof sensor.park === 'object' ? sensor.park.name : ''}
              </SheetDescription>
            </SheetHeader>

            <div className="mt-6 space-y-6">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <MetricTile label="Current" value={`${sensor.currentValue}`} hint={sensor.unit} />
                <MetricTile
                  label="Score"
                  value={sensor.score}
                  hint="Normalised 0–100"
                  tone={sensor.score >= 70 ? 'success' : sensor.score >= 45 ? 'warning' : 'destructive'}
                />
                <MetricTile label="Battery" value={`${Math.round(sensor.batteryLevel)}%`} hint={sensor.firmware} />
                <MetricTile label="Status" value={sensor.status} hint={sensor.stale ? 'Reading is stale' : 'Reporting'} />
              </div>

              <div>
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium">Reading history</p>
                  <Tabs value={String(hours)} onValueChange={(v) => setHours(Number(v))}>
                    <TabsList className="h-8">
                      {[6, 24, 72, 168].map((h) => (
                        <TabsTrigger key={h} value={String(h)} className="h-6 px-2 text-xs">
                          {h < 24 ? `${h}h` : `${h / 24}d`}
                        </TabsTrigger>
                      ))}
                    </TabsList>
                  </Tabs>
                </div>

                {readings.isPending ? (
                  <LoadingState label="Loading readings…" />
                ) : !series.length ? (
                  <EmptyState title="No readings in this window" icon="Gauge" />
                ) : (
                  <>
                    <ResponsiveContainer width="100%" height={260}>
                      <ComposedChart data={series}>
                        <defs>
                          <linearGradient id="sensor-fill" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="hsl(var(--chart-1))" stopOpacity={0.3} />
                            <stop offset="95%" stopColor="hsl(var(--chart-1))" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis dataKey="time" stroke="hsl(var(--muted-foreground))" fontSize={10} minTickGap={40} />
                        <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} />
                        <Tooltip contentStyle={TOOLTIP_STYLE} />
                        <Legend wrapperStyle={{ fontSize: 11 }} />

                        {/* Thresholds, so a warning state is visually explicable. */}
                        {sensor.warnAbove !== null && (
                          <ReferenceLine
                            y={sensor.warnAbove}
                            stroke="hsl(var(--warning))"
                            strokeDasharray="4 4"
                            label={{ value: `warn > ${sensor.warnAbove}`, fontSize: 10, fill: 'hsl(var(--warning))', position: 'insideTopRight' }}
                          />
                        )}
                        {sensor.warnBelow !== null && (
                          <ReferenceLine
                            y={sensor.warnBelow}
                            stroke="hsl(var(--warning))"
                            strokeDasharray="4 4"
                            label={{ value: `warn < ${sensor.warnBelow}`, fontSize: 10, fill: 'hsl(var(--warning))', position: 'insideBottomRight' }}
                          />
                        )}

                        <Area type="monotone" dataKey="value" name={`Reading (${sensor.unit})`} stroke="hsl(var(--chart-1))" fill="url(#sensor-fill)" strokeWidth={2} />
                        <Scatter dataKey="anomaly" name="Flagged anomaly" fill="hsl(var(--destructive))" />
                      </ComposedChart>
                    </ResponsiveContainer>

                    {readings.data?.stats && (
                      <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-6">
                        {[
                          ['Min', readings.data.stats.min],
                          ['Max', readings.data.stats.max],
                          ['Mean', readings.data.stats.mean],
                          ['Median', readings.data.stats.median],
                          ['σ', readings.data.stats.stdDev],
                          ['Anomalies', readings.data.stats.anomalies],
                        ].map(([label, value]) => (
                          <div key={String(label)} className="rounded-lg bg-muted/50 p-2 text-center">
                            <p className="text-sm font-bold tabular-nums">{value}</p>
                            <p className="text-[10px] text-muted-foreground">{label}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* --- Anomaly detector output --- */}
              <div>
                <p className="mb-2 flex items-center gap-1.5 text-sm font-medium">
                  <Sigma className="h-4 w-4" />
                  Anomaly detection
                </p>

                <div className="mb-3 rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
                  Three detectors vote: the z-score test (|z| &gt; 3), the modified z-score using
                  median absolute deviation (|M| &gt; 3.5, robust to the very outliers it looks for),
                  and Tukey&apos;s IQR fence. A reading is flagged when at least two agree — majority
                  voting cuts the false positives any single detector produces on noisy field data.
                </div>

                {anomalies.isPending ? (
                  <LoadingState label="Scanning history…" className="py-6" />
                ) : !anomalies.data?.anomalies.length ? (
                  <div className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
                    No anomalies detected in the scanned history.
                  </div>
                ) : (
                  <div className="max-h-64 space-y-2 overflow-y-auto scrollbar-thin">
                    {anomalies.data.anomalies.slice().reverse().map((anomaly, index) => (
                      <div key={index} className="rounded-lg border border-destructive/20 bg-destructive/5 p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-sm font-medium">
                              {anomaly.value} {sensor.unit}
                            </p>
                            <p className="text-[11px] text-muted-foreground">
                              {new Date(anomaly.recordedAt).toLocaleString()}
                            </p>
                          </div>
                          <Badge variant="outline" className="shrink-0 border-destructive/30 text-[10px] text-destructive">
                            z = {anomaly.zScore.toFixed(2)}
                          </Badge>
                        </div>
                        <p className="mt-1.5 text-xs text-muted-foreground">{anomaly.reason}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
                <p className="font-medium text-foreground">Calibration</p>
                <p className="mt-1">
                  Operating range {sensor.minValue}–{sensor.maxValue} {sensor.unit}
                  {sensor.warnAbove !== null && ` · warns above ${sensor.warnAbove}`}
                  {sensor.warnBelow !== null && ` · warns below ${sensor.warnBelow}`}
                </p>
                <p className="mt-1">{TYPE_META[sensor.type]?.note}</p>
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
