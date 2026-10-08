'use client';

/**
 * A small info icon that lists, on hover, the public APIs a card's data
 * comes from. Every entry is an endpoint the backend really calls.
 */

import { Info } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

export const DATA_SOURCES = {
  openMeteoWeather: { name: 'Open-Meteo Forecast API', endpoint: 'api.open-meteo.com/v1/forecast' },
  openMeteoAir: { name: 'Open-Meteo Air Quality API (Copernicus CAMS)', endpoint: 'air-quality-api.open-meteo.com/v1/air-quality' },
  gbif: { name: 'GBIF Occurrence API', endpoint: 'api.gbif.org/v1/occurrence/search' },
  gbifSpecies: { name: 'GBIF Species API', endpoint: 'api.gbif.org/v1/species/match' },
  osm: { name: 'OpenStreetMap Overpass API', endpoint: 'overpass-api.de/api/interpreter' },
} as const;

export type DataSourceKey = keyof typeof DATA_SOURCES;

export function SourceInfo({
  sources,
  note,
  className,
}: {
  sources: DataSourceKey[];
  /** Optional one-line explanation of how the figure is derived. */
  note?: string;
  className?: string;
}) {
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger
          type="button"
          aria-label="Data sources"
          className={cn('inline-flex text-muted-foreground transition-colors hover:text-foreground', className)}
        >
          <Info className="h-3.5 w-3.5" />
        </TooltipTrigger>
        <TooltipContent className="max-w-sm space-y-1.5 p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Public API</p>
          {sources.map((key) => (
            <div key={key}>
              <p className="text-xs font-medium">{DATA_SOURCES[key].name}</p>
              <p className="font-mono text-[11px] text-muted-foreground">{DATA_SOURCES[key].endpoint}</p>
            </div>
          ))}
          {note && <p className="border-t pt-1.5 text-[11px] text-muted-foreground">{note}</p>}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
