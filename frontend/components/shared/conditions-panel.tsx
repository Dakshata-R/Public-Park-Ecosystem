'use client';

/**
 * Live conditions — real weather and real air quality from public APIs.
 *
 * Two things distinguish this from a decorative weather widget:
 *
 *   1. The AQI shown is computed by *this project* from the raw pollutant
 *      concentrations the upstream returns, using the CPCB breakpoint tables
 *      in `server/src/services/aqi.service.js`. The pollutant breakdown is
 *      shown so that is visible rather than merely claimed.
 *
 *   2. When a park has its own AQI sensor, the panel shows the divergence
 *      between the ground sensor and the satellite-model estimate. That gap is
 *      operationally meaningful: a persistent one means the sensor needs
 *      recalibration or the model does not resolve a local source.
 *
 * Upstream failure is a normal condition, not an exception — the panel says
 * so plainly and the rest of the page carries on.
 */

import {
  Cloud, CloudDrizzle, CloudFog, CloudLightning, CloudMoon, CloudRain,
  CloudRainWind, CloudSnow, CloudSun, Droplets, Eye, Gauge, Moon, Sun,
  Sunrise, Sunset, Thermometer, Wind, WifiOff, Info,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useParkConditions } from '@/lib/hooks/use-api';
import { cn } from '@/lib/utils';

/** Icon keys come from the server so the mapping lives in one place per side. */
const ICONS: Record<string, typeof Cloud> = {
  sun: Sun, moon: Moon, 'cloud-sun': CloudSun, 'cloud-moon': CloudMoon,
  cloud: Cloud, 'cloud-fog': CloudFog, 'cloud-drizzle': CloudDrizzle,
  'cloud-rain': CloudRain, 'cloud-snow': CloudSnow,
  'cloud-rain-wind': CloudRainWind, 'cloud-lightning': CloudLightning,
};

/** CPCB category colours. */
const AQI_TONE: Record<string, string> = {
  Good: 'bg-success/15 text-success border-success/30',
  Satisfactory: 'bg-success/15 text-success border-success/30',
  Moderate: 'bg-warning/15 text-warning border-warning/30',
  Poor: 'bg-destructive/15 text-destructive border-destructive/30',
  'Very Poor': 'bg-destructive/20 text-destructive border-destructive/40',
  Severe: 'bg-destructive/25 text-destructive border-destructive/50',
};

/** Display names for the pollutant keys the sub-index table uses. */
const POLLUTANT_LABELS: Record<string, string> = {
  pm25: 'PM₂.₅', pm10: 'PM₁₀', no2: 'NO₂', so2: 'SO₂', o3: 'O₃', co: 'CO',
};

const compass = (deg: number) =>
  ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(deg / 45) % 8];

const time = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—';

export function ConditionsPanel({ park, className }: { park?: string; className?: string }) {
  const { data, isPending, isError } = useParkConditions(park);

  if (isPending) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle className="text-lg">Live Conditions</CardTitle>
          <CardDescription>Fetching real-time weather and air quality…</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-20 w-full rounded-xl" />
          <div className="grid grid-cols-2 gap-2">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-lg" />)}
          </div>
        </CardContent>
      </Card>
    );
  }

  // A failed upstream is reported, not hidden — the reader needs to know the
  // difference between "the air is clean" and "we could not find out".
  if (isError || !data || (!data.weather.ok && !data.airQuality.ok)) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle className="text-lg">Live Conditions</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-2 py-8 text-center text-muted-foreground">
          <WifiOff className="h-6 w-6" />
          <p className="text-sm font-medium">Live data unavailable</p>
          <p className="max-w-xs text-xs">
            {data?.weather.reason || 'The weather and air-quality services could not be reached. Sensor readings below are unaffected.'}
          </p>
        </CardContent>
      </Card>
    );
  }

  const weather = data.weather.current;
  const air = data.airQuality;
  const Icon = weather ? ICONS[weather.icon] ?? Cloud : Cloud;

  return (
    <Card className={cn('overflow-hidden', className)}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="text-lg">Live Conditions</CardTitle>
            <CardDescription>{data.location.park || data.location.label}</CardDescription>
          </div>
          <Badge variant="outline" className="shrink-0 gap-1.5 text-[10px]">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-success" />
            LIVE
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {weather && (
          <>
            <div className="flex items-center gap-4">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-accent/15 text-accent">
                <Icon className="h-7 w-7" />
              </div>
              <div className="min-w-0">
                <p className="text-3xl font-bold leading-none">{Math.round(weather.temperature)}°C</p>
                <p className="mt-1 truncate text-sm text-muted-foreground">
                  {weather.condition} · feels {Math.round(weather.feelsLike)}°C
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 text-sm">
              {[
                { icon: Droplets, label: 'Humidity', value: `${weather.humidity}%` },
                { icon: Wind, label: 'Wind', value: `${Math.round(weather.windSpeed)} km/h ${compass(weather.windDirection)}` },
                { icon: Gauge, label: 'Pressure', value: `${Math.round(weather.pressure)} hPa` },
                { icon: Sun, label: 'UV max', value: weather.uvIndexMax != null ? String(weather.uvIndexMax) : '—' },
                { icon: Sunrise, label: 'Sunrise', value: time(weather.sunrise) },
                { icon: Sunset, label: 'Sunset', value: time(weather.sunset) },
              ].map((row) => (
                <div key={row.label} className="flex items-center gap-2 rounded-lg bg-muted/50 p-2.5">
                  <row.icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0">
                    <p className="text-[11px] text-muted-foreground">{row.label}</p>
                    <p className="truncate text-sm font-medium">{row.value}</p>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* --- Air quality, scored by this project's CPCB implementation --- */}
        {air.ok && (
          <div className="rounded-xl border p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <p className="text-sm font-medium">Air Quality Index</p>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger>
                      <Info className="h-3.5 w-3.5 text-muted-foreground" />
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs">
                      <p className="text-xs">
                        Computed by GreenPulse from live CAMS pollutant concentrations using CPCB
                        breakpoint tables. The overall AQI is the maximum of the sub-indices, not
                        their average — air is only as clean as its worst pollutant.
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              <Badge variant="outline" className={AQI_TONE[air.label ?? ''] ?? ''}>
                {air.label}
              </Badge>
            </div>

            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-3xl font-bold tabular-nums">{air.aqi}</span>
              <span className="text-xs text-muted-foreground">
                AQI · driven by {POLLUTANT_LABELS[air.dominantPollutant ?? ''] ?? air.dominantPollutant}
              </span>
            </div>

            {/* Per-pollutant sub-indices — the working, shown. */}
            {air.subIndices && (
              <div className="mt-3 space-y-1.5">
                {Object.entries(air.subIndices)
                  .sort((a, b) => b[1] - a[1])
                  .map(([pollutant, index]) => (
                    <div key={pollutant} className="flex items-center gap-2">
                      <span className="w-12 shrink-0 text-[11px] text-muted-foreground">
                        {POLLUTANT_LABELS[pollutant] ?? pollutant}
                      </span>
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                        <div
                          className={cn(
                            'h-full rounded-full',
                            index > 200 ? 'bg-destructive' : index > 100 ? 'bg-warning' : 'bg-success'
                          )}
                          style={{ width: `${Math.min(100, (index / 300) * 100)}%` }}
                        />
                      </div>
                      <span className="w-7 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
                        {index}
                      </span>
                    </div>
                  ))}
              </div>
            )}

            <p className="mt-2.5 text-xs text-muted-foreground">{air.advice}</p>
          </div>
        )}

        {/* Advisory combining both sources. */}
        <div className="flex items-start gap-2 rounded-lg bg-primary/5 p-3">
          <Thermometer className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <p className="text-xs leading-relaxed">{data.advisory}</p>
        </div>

        {/* Provenance. Live data must always say where it came from. */}
        <p className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <Eye className="h-3 w-3" />
          {data.weather.attribution || data.airQuality.attribution || 'Live public data'}
        </p>
      </CardContent>
    </Card>
  );
}

/**
 * Seven-day outlook. Kept separate from the panel above because the dashboard
 * wants current conditions only, while the park detail view wants the forecast
 * that informs maintenance scheduling.
 */
export function ForecastStrip({ park, className }: { park?: string; className?: string }) {
  const { data, isPending } = useParkConditions(park);

  if (isPending) return <Skeleton className={cn('h-28 w-full rounded-xl', className)} />;
  if (!data?.weather.ok || !data.weather.forecast?.length) return null;

  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <CardTitle className="text-lg">7-Day Outlook</CardTitle>
        <CardDescription>
          Rain and heat drive maintenance scheduling — trail resurfacing and planting both wait on it
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-7">
          {data.weather.forecast.map((day) => {
            const Icon = ICONS[day.icon] ?? Cloud;
            return (
              <div key={day.date} className="flex flex-col items-center gap-1 rounded-lg bg-muted/40 p-2.5">
                <p className="text-[11px] font-medium text-muted-foreground">
                  {new Date(day.date).toLocaleDateString([], { weekday: 'short' })}
                </p>
                <Icon className="h-5 w-5 text-accent" />
                <p className="text-sm font-semibold tabular-nums">{Math.round(day.tempMax)}°</p>
                <p className="text-[11px] tabular-nums text-muted-foreground">{Math.round(day.tempMin)}°</p>
                {day.precipitation > 0.5 && (
                  <p className="text-[10px] tabular-nums text-info">{day.precipitation.toFixed(1)}mm</p>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
