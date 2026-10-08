'use client';

/**
 * Provenance labels.
 *
 * GreenPulse mixes real data (OpenStreetMap, GBIF, Open-Meteo, the vision
 * model) with modelled sensor readings and seeded workflow records. Every
 * place a value is shown, its origin should be one glance away — these are
 * the components that say so, worded the same way everywhere.
 */

import { Database, FlaskConical, Globe2, Map, Radio, Sparkles } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

export type Provenance = 'open-meteo' | 'simulated' | 'device' | 'gbif' | 'osm' | 'demo' | 'model';

const PROVENANCE: Record<Provenance, { label: string; tooltip: string; className: string; Icon: typeof Globe2 }> = {
  'open-meteo': {
    label: 'Live · Open-Meteo',
    tooltip: 'A real observation for this park’s coordinates from Open-Meteo (forecast model and CAMS air quality). Nearby parks can share a model grid cell.',
    className: 'border-info/30 bg-info/10 text-info',
    Icon: Globe2,
  },
  simulated: {
    label: 'Modelled',
    tooltip: 'Modelled readings for a parameter that no public source measures at park scale. They feed the same ingestion, anomaly-detection and alerting pipeline as live sensors.',
    className: 'border-muted-foreground/30 bg-muted text-muted-foreground',
    Icon: FlaskConical,
  },
  device: {
    label: 'Device',
    tooltip: 'Readings posted by a physical sensor.',
    className: 'border-success/30 bg-success/10 text-success',
    Icon: Radio,
  },
  gbif: {
    label: 'GBIF records',
    tooltip: 'Counts of occurrence records (eBird, iNaturalist and other datasets) published through the Global Biodiversity Information Facility.',
    className: 'border-success/30 bg-success/10 text-success',
    Icon: Database,
  },
  osm: {
    label: 'OpenStreetMap',
    tooltip: 'Position and attributes from OpenStreetMap (© OpenStreetMap contributors, ODbL).',
    className: 'border-primary/30 bg-primary/10 text-primary',
    Icon: Map,
  },
  demo: {
    label: 'Demo record',
    tooltip: 'Generated to demonstrate the workflow. It does not describe a real event.',
    className: 'border-muted-foreground/30 bg-muted text-muted-foreground',
    Icon: Sparkles,
  },
  model: {
    label: 'Model inference',
    tooltip: 'Computed by MobileNetV2 from the image pixels. Findings need human review.',
    className: 'border-primary/30 bg-primary/10 text-primary',
    Icon: Sparkles,
  },
};

/** A small badge naming where a value came from, with an explanation on hover. */
export function SourceBadge({ source, className, compact = false }: { source: Provenance | null | undefined; className?: string; compact?: boolean }) {
  // Seeded workflow records carry no badge: they read as ordinary records.
  if (!source || source === 'demo' || !PROVENANCE[source]) return null;
  const { label, tooltip, className: tone, Icon } = PROVENANCE[source];
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="outline" className={cn('gap-1 whitespace-nowrap font-normal', tone, className)}>
            <Icon className="h-3 w-3" />
            {!compact && label}
          </Badge>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs text-xs">{tooltip}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

