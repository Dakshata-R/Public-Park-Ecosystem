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
 *
 * Every sensor says where its numbers come from: `open-meteo` sensors are
 * virtual and read real observations; `simulated` sensors are generated.
 */

import { useState } from 'react';
import {
  Area, CartesianGrid, ReferenceLine, ResponsiveContainer,
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
import { MetricTile, NO_DATA, ScoreBar, fmt, scoreText } from '@/components/shared/score-badge';
import { StatusBadge } from '@/components/shared/status-badges';
import { ParkFilter, ALL_PARKS, parkParam } from '@/components/shared/park-filter';
import { QueryState, SkeletonCards, LoadingState, EmptyState, ErrorState } from '@/components/shared/query-state';
import { SourceBadge } from '@/components/shared/data-source';
import { useAuth } from '@/components/providers/auth-provider';
import {
  useLiveSensors, useSensorReadings, useSensorAnomalies, useRefreshSensors,
} from '@/lib/hooks/use-api';
import { cn } from '@/lib/utils';
import type { LiveSensor, SensorSource, SensorType } from '@/lib/types';

const TYPE_META: Record<SensorType, { label: string; icon: typeof Gauge; note: string }> = {
  aqi: { label: 'Air Quality', icon: Activity, note: 'Lower is better — inverted through the CPCB category map' },
  temperature: { label: 'Temperature', icon: Gauge, note: 'Scored against a comfortable band centred on 24 °C' },
  humidity: { label: 'Humidity', icon: Gauge, note: 'Scored against a band centred on 55 %' },
  noise: { label: 'Noise', icon: Signal, note: 'Lower is better — 35 dB scores 100, 85 dB scores 0' },
  water: { label: 'Water Quality', icon: Gauge, note: 'Already a 0–100 index where higher is better' },
  soil: { label: 'Soil Moisture', icon: Gauge, note: 'Higher is better up to the calibrated maximum' },
};

const SOURCE_LABELS: Record<SensorSource, string> = {
  'open-meteo': 'Open-Meteo',
  simulated: 'modelled',
  device: 'device',
};

const TOOLTIP_STYLE = {
  background: 'hsl(var(--popover))',
  border: '1px solid hsl(var(--border))',
  borderRadius: 'var(--radius)',
  fontSize: 12,
};

const parkName = (sensor: LiveSensor) => (typeof sensor.park === 'object' ? sensor.park.name : '');

const readingTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : null;

export default function SensorsPage() {
  const { can } = useAuth();
  const [park, setPark] = useState(ALL_PARKS);
  const [typeFilter, setTypeFilter] = useState<string>('all');
  // Only the id is held: the sheet reads the sensor from the live query, so polling updates it.
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const live = useLiveSensors(parkParam(park));
  const refresh = useRefreshSensors();

  const selected = live.data?.sensors.find((s) => s.id === selectedId) ?? null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Environmental Sensor Monitoring"
        description="Live readings from every park sensor, with unusual readings flagged automatically."
        icon="Gauge"
        action={
          <div className="flex flex-wrap items-center gap-2">
            <ParkFilter value={park} onChange={setPark} />
            {can('officer') && (
              <Button variant="outline" onClick={() => refresh.mutate()} disabled={refresh.isPending}>
                <RefreshCw className={cn('mr-2 h-4 w-4', refresh.isPending && 'animate-spin')} />
                Refresh readings
              </Button>
            )}
          </div>
        }
      />

      <Alert className="border-info/20 bg-info/5">
        <Info className="h-4 w-4 text-info" />
        <AlertDescription className="text-xs leading-relaxed">
          Air quality, temperature and humidity are live readings from Open-Meteo for each park.
          Noise, soil moisture and water quality are modelled readings.
        </AlertDescription>
      </Alert>

      <QueryState query={live} skeleton={<SkeletonCards count={4} />}>
        {(data) => {
          const sensors = typeFilter === 'all'
            ? data.sensors
            : data.sensors.filter((s) => s.type === typeFilter);

          const types = Array.from(new Set(data.sensors.map((s) => s.type)));

          /** Which source(s) feed each sensor type, for the score rows. */
          const sourcesByType = data.sensors.reduce<Record<string, Set<SensorSource>>>((acc, s) => {
            (acc[s.type] ??= new Set()).add(s.source);
            return acc;
          }, {});

          const bySource = (Object.entries(data.summary.bySource) as [SensorSource, number][])
            .filter(([, count]) => count > 0)
            .map(([source, count]) => `${count} ${SOURCE_LABELS[source] ?? source}`)
            .join(' · ');

          return (
            <div className="space-y-6">
              {/* --- Network health (the four states add up to the total) --- */}
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
                <MetricTile label="Deployed" value={data.summary.total} hint={bySource || 'Active sensors'} />
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
                <MetricTile
                  label="Maintenance"
                  value={data.summary.maintenance}
                  hint="Paused, not refreshed"
                />
              </div>

              {data.summary.offline > 0 && (
                <Alert className="border-destructive/20 bg-destructive/5">
                  <WifiOff className="h-4 w-4 text-destructive" />
                  <AlertDescription className="text-xs">
                    {data.summary.offline} sensor{data.summary.offline === 1 ? ' is' : 's are'} offline.
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
                  {!Object.keys(data.summary.averageScoreByType).length ? (
                    <p className="py-4 text-center text-sm text-muted-foreground">
                      No scored readings yet.
                    </p>
                  ) : (
                    Object.entries(data.summary.averageScoreByType).map(([type, score]) => (
                      <div key={type} className="flex flex-wrap items-center gap-3 sm:flex-nowrap">
                        <span className="w-28 shrink-0 text-sm">
                          {TYPE_META[type as SensorType]?.label ?? type}
                        </span>
                        <ScoreBar score={score} className="min-w-[8rem] flex-1" />
                        <span className="flex shrink-0 gap-1">
                          {Array.from(sourcesByType[type] ?? []).map((source) => (
                            <SourceBadge key={source} source={source} compact />
                          ))}
                        </span>
                        <span className="hidden w-64 shrink-0 text-[11px] text-muted-foreground lg:block">
                          {TYPE_META[type as SensorType]?.note}
                        </span>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>

              {/* --- Sensor grid --- */}
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
                <Card>
                  <CardContent>
                    <EmptyState
                      title={data.sensors.length ? 'No sensors match that filter' : 'No sensors in this park'}
                      icon="Gauge"
                    />
                  </CardContent>
                </Card>
              ) : (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {sensors.map((sensor) => {
                    const Icon = TYPE_META[sensor.type]?.icon ?? Gauge;
                    const offline = sensor.status === 'offline';
                    const awaiting = sensor.currentValue == null;
                    const lastReading = readingTime(sensor.lastReadingAt);

                    return (
                      <Card
                        key={sensor.id}
                        onClick={() => setSelectedId(sensor.id)}
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
                              offline || awaiting ? 'bg-muted text-muted-foreground' : 'bg-primary/10 text-primary'
                            )}>
                              <Icon className="h-4 w-4" />
                            </div>
                          </div>

                          {offline ? (
                            <div className="flex items-baseline gap-1.5">
                              <span className="text-3xl font-bold tabular-nums text-muted-foreground">—</span>
                              <span className="text-sm text-muted-foreground">offline</span>
                            </div>
                          ) : awaiting ? (
                            <div>
                              <p className="text-lg font-medium text-muted-foreground">{NO_DATA}</p>
                              <p className="text-[11px] text-muted-foreground">Awaiting first reading</p>
                            </div>
                          ) : (
                            <div className="flex items-baseline gap-1.5">
                              <span className={cn('text-3xl font-bold tabular-nums', scoreText(sensor.score))}>
                                {sensor.currentValue}
                              </span>
                              <span className="text-sm text-muted-foreground">{sensor.unit}</span>
                            </div>
                          )}

                          {!offline && !awaiting && (
                            <div>
                              <div className="mb-1 flex justify-between text-[11px] text-muted-foreground">
                                <span>Normalised score</span>
                                <span>{sensor.score == null ? NO_DATA : `${fmt(sensor.score, 1)}/100`}</span>
                              </div>
                              <ScoreBar score={sensor.score} showValue={false} />
                            </div>
                          )}

                          <div className="flex flex-wrap items-center gap-1.5 border-t pt-2.5">
                            <StatusBadge status={sensor.status} />
                            <SourceBadge source={sensor.source} className="text-[10px]" />
                            {sensor.breached && (
                              <Badge variant="outline" className="gap-1 border-warning/30 bg-warning/10 text-[10px] text-warning">
                                <TriangleAlert className="h-3 w-3" />Threshold
                              </Badge>
                            )}
                            {sensor.batteryLevel != null && sensor.batteryLevel < 20 && (
                              <Badge variant="outline" className="gap-1 border-destructive/30 bg-destructive/10 text-[10px] text-destructive">
                                <BatteryLow className="h-3 w-3" />{Math.round(sensor.batteryLevel)}%
                              </Badge>
                            )}
                            {sensor.stale && !offline && (
                              <Badge variant="outline" className="text-[10px]">Stale</Badge>
                            )}
                          </div>

                          <p className="truncate text-[11px] text-muted-foreground">
                            {parkName(sensor)}
                            {lastReading && ` · last reading ${lastReading}`}
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

      <SensorDetailSheet sensor={selected} onClose={() => setSelectedId(null)} />
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

  // Windows longer than a day span several dates, so ticks must carry the date too.
  const multiDay = hours > 24;
  const tickFormat = (ms: number) =>
    new Date(ms).toLocaleString(
      [],
      multiDay ? { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' } : { hour: '2-digit', minute: '2-digit' }
    );

  const series = readings.data?.readings.map((point) => ({
    t: new Date(point.time).getTime(),
    value: point.value,
    // Only anomalous points get a y-value, so the scatter draws just those.
    anomaly: point.isAnomaly ? point.value : null,
  })) ?? [];

  const virtual = sensor?.batteryLevel == null;

  return (
    <Sheet open={Boolean(sensor)} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
        {sensor && (
          <>
            <SheetHeader>
              <SheetTitle>{sensor.name}</SheetTitle>
              <SheetDescription className="font-mono text-xs">
                {sensor.sensorCode} · {parkName(sensor)}
              </SheetDescription>
              <div>
                <SourceBadge source={sensor.source} className="text-[10px]" />
              </div>
            </SheetHeader>

            <div className="mt-6 space-y-6">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <MetricTile
                  label="Current"
                  value={fmt(sensor.currentValue, 2)}
                  hint={sensor.currentValue == null ? 'Awaiting first reading' : sensor.unit}
                />
                <MetricTile
                  label="Score"
                  value={fmt(sensor.score, 1)}
                  hint="Normalised 0–100"
                  tone={
                    sensor.score == null ? undefined
                    : sensor.score >= 70 ? 'success'
                    : sensor.score >= 45 ? 'warning'
                    : 'destructive'
                  }
                />
                {virtual ? (
                  <MetricTile
                    label="Last reading"
                    value={sensor.lastReadingAt ? new Date(sensor.lastReadingAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}
                    hint={sensor.lastReadingAt ? new Date(sensor.lastReadingAt).toLocaleDateString() : 'None yet'}
                  />
                ) : (
                  <MetricTile
                    label="Battery"
                    value={`${Math.round(sensor.batteryLevel as number)}%`}
                    hint={sensor.firmware || undefined}
                  />
                )}
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
                ) : readings.isError ? (
                  <ErrorState error={readings.error} onRetry={() => void readings.refetch()} />
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
                        <XAxis
                          dataKey="t"
                          type="number"
                          scale="time"
                          domain={['dataMin', 'dataMax']}
                          tickFormatter={tickFormat}
                          stroke="hsl(var(--muted-foreground))"
                          fontSize={10}
                          minTickGap={multiDay ? 60 : 40}
                        />
                        <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} />
                        <Tooltip
                          contentStyle={TOOLTIP_STYLE}
                          labelFormatter={(ms: number) => new Date(ms).toLocaleString()}
                        />
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
                          ['Min', fmt(readings.data.stats.min, 2)],
                          ['Max', fmt(readings.data.stats.max, 2)],
                          ['Mean', fmt(readings.data.stats.mean, 2)],
                          ['Median', fmt(readings.data.stats.median, 2)],
                          ['Std. dev.', fmt(readings.data.stats.stdDev, 2)],
                          ['Anomalies', fmt(readings.data.stats.anomalies)],
                        ].map(([label, value]) => (
                          <div key={label} className="rounded-lg bg-muted/50 p-2 text-center">
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
                  A reading is flagged when it falls well outside the sensor&apos;s usual range.
                </div>

                {anomalies.isPending ? (
                  <LoadingState label="Scanning history…" className="py-6" />
                ) : anomalies.isError ? (
                  <ErrorState error={anomalies.error} onRetry={() => void anomalies.refetch()} />
                ) : !anomalies.data.anomalies.length ? (
                  <div className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
                    No anomalies detected in the scanned history.
                  </div>
                ) : (
                  <div className="max-h-64 space-y-2 overflow-y-auto scrollbar-thin">
                    {anomalies.data.anomalies.slice().reverse().map((anomaly, index) => (
                      <div key={`${anomaly.recordedAt}-${index}`}className="rounded-lg border border-destructive/20 bg-destructive/5 p-3">
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
                            z = {fmt(anomaly.zScore, 2)}
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
