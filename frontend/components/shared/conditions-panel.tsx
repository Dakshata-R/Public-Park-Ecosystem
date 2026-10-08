'use client';

/**
 * Live conditions — real weather and real air quality from public APIs.
 *
 * What distinguishes this from a decorative weather widget: the AQI shown is
 * computed by *this project* from the pollutant concentrations Open-Meteo
 * returns (CAMS model), using the CPCB breakpoint tables in
 * `backend/src/services/aqi.service.js`. The pollutant breakdown and the
 * averaging method are shown so that is visible rather than merely claimed.
 *
 * Upstream failure is a normal condition, not an exception — the panel says
 * so plainly (including when only one of the two sources failed) and the rest
 * of the page carries on.
 */

import {
  Cloud, CloudDrizzle, CloudFog, CloudLightning, CloudMoon, CloudRain,
  CloudRainWind, CloudSnow, CloudSun, Droplets, Gauge, Moon, Sun,
  Wind, WifiOff, Info, TriangleAlert,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { SourceInfo } from './source-info';
import { useParkConditions } from '@/lib/hooks/use-api';
import { cn } from '@/lib/utils';
import type { LiveAirQuality } from '@/lib/types';

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

/** The parks are in Bengaluru; every time on the panel is shown in park-local time. */
const PARK_TIME_ZONE = 'Asia/Kolkata';

/**
 * The air-quality response carries more than `LiveAirQuality` declares: the
 * averaging method and when the upstream was fetched.
 */
type AirQualityDetail = LiveAirQuality & { method?: string; fetchedAt?: string };

const compass = (deg: number) =>
  ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(deg / 45) % 8];

/** An ISO instant (UTC) as HH:MM in park-local time. */
const clock = (iso: string | null | undefined) => {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: PARK_TIME_ZONE });
};

export function ConditionsPanel({ park, className }: { park?: string; className?: string }) {
  const { data, isPending, isError, error } = useParkConditions(park);

  if (isPending) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle className="text-lg">Live Conditions</CardTitle>
          <CardDescription>Fetching weather and air quality…</CardDescription>
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
    const reasons = data
      ? [data.weather.reason && `Weather: ${data.weather.reason}`, data.airQuality.reason && `Air quality: ${data.airQuality.reason}`]
          .filter(Boolean)
          .join(' · ')
      : error?.message;
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle className="text-lg">Live Conditions</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-2 py-8 text-center text-muted-foreground">
          <WifiOff className="h-6 w-6" />
          <p className="text-sm font-medium">Live data unavailable</p>
          <p className="max-w-xs text-xs">
            {reasons || 'The weather and air-quality services could not be reached.'} The rest of the page is unaffected.
          </p>
        </CardContent>
      </Card>
    );
  }

  const weather = data.weather.ok ? data.weather.current : undefined;
  const air = data.airQuality as AirQualityDetail;
  const Icon = weather ? ICONS[weather.icon] ?? Cloud : Cloud;

  // Freshness: the most recent upstream observation, not the time of the request.
  const observedTimes = [weather?.observedAt, air.ok ? air.observedAt : undefined]
    .filter((t): t is string => Boolean(t))
    .map((t) => new Date(t).getTime())
    .filter((t) => Number.isFinite(t));
  const latestObserved = observedTimes.length ? new Date(Math.max(...observedTimes)).toISOString() : null;
  const partial = !data.weather.ok || !air.ok;

  return (
    <Card className={cn('overflow-hidden', className)}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="flex items-center gap-1.5">
              <CardTitle className="text-lg">Live Conditions</CardTitle>
              <SourceInfo sources={['openMeteoWeather', 'openMeteoAir']} note="Fetched live for the park's coordinates. AQI scored on the CPCB National AQI scale." />
            </div>
            <CardDescription>{data.location.park || data.location.label}</CardDescription>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            {latestObserved && (
              <Badge variant="outline" className="gap-1 text-[10px] font-normal" title="Time of the most recent upstream observation">
                Updated {clock(latestObserved)} IST
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Partial data: one source answered, the other did not. */}
        {partial && (
          <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 p-2.5 text-xs text-warning">
            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <p>
              {!data.weather.ok
                ? `Weather unavailable${data.weather.reason ? `: ${data.weather.reason}` : ''}. Air quality below is current.`
                : `Air quality unavailable${air.reason ? `: ${air.reason}` : ''}. Weather below is current.`}
            </p>
          </div>
        )}

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
                { icon: Sun, label: 'UV index', value: weather.uvIndexMax != null ? String(weather.uvIndexMax) : '—' },
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
                        Computed from Open-Meteo CAMS pollutant concentrations using CPCB breakpoint
                        tables. The AQI is the highest pollutant sub-index.
                      </p>
                      {air.subIndices && (
                        <p className="mt-1.5 text-xs tabular-nums">
                          {Object.entries(air.subIndices)
                            .sort((a, b) => b[1] - a[1])
                            .map(([pollutant, index]) => `${POLLUTANT_LABELS[pollutant] ?? pollutant} ${index}`)
                            .join(' · ')}
                        </p>
                      )}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              {air.label && (
                <Badge variant="outline" className={AQI_TONE[air.label] ?? ''}>
                  {air.label}
                </Badge>
              )}
            </div>

            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-3xl font-bold tabular-nums">{air.aqi ?? '—'}</span>
              <span className="text-xs text-muted-foreground">
                AQI
                {air.dominantPollutant && ` · driven by ${POLLUTANT_LABELS[air.dominantPollutant] ?? air.dominantPollutant}`}
                {clock(air.observedAt) && ` · ${clock(air.observedAt)} IST`}
              </span>
            </div>
          </div>
        )}

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
                  {/* A bare "YYYY-MM-DD" parses as UTC midnight; pin the zone so the weekday cannot shift. */}
                  {new Date(`${day.date}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' })}
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
