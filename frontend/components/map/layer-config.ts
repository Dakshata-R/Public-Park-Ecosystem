import type { Provenance } from '@/components/shared/data-source';
import { NO_DATA } from '@/components/shared/score-badge';
import type { LatLng, MapFeatureProperties, MapLayerKey } from '@/lib/types';

/**
 * Presentation for each map layer, shared by the map itself and the layer
 * toggle control so a legend chip can never disagree with the marker it
 * describes.
 *
 * `geometry` tells the renderer which Leaflet primitive the layer needs:
 * markers for points of interest, a translucent circle for a pollution
 * hotspot whose radius carries meaning, and a polyline for a trail.
 */
export interface LayerDefinition {
  key: MapLayerKey;
  label: string;
  /** CSS colour, resolved from the theme so dark mode works without a second table. */
  color: string;
  emoji: string;
  geometry: 'marker' | 'circle' | 'line';
  description: string;
  /** Whether the layer is drawn on first load. */
  defaultOn: boolean;
  /** Where the layer's features come from. Sensors vary per feature — see `featureProvenance`. */
  provenance: Provenance;
  /** One line saying what is real about a feature of this layer. */
  provenanceNote: string;
}

export const LAYERS: LayerDefinition[] = [
  {
    key: 'parks',
    label: 'Parks',
    color: 'hsl(var(--chart-1))',
    emoji: '🌳',
    geometry: 'marker',
    description: 'Park centres and boundaries (OpenStreetMap)',
    defaultOn: true,
    provenance: 'osm',
    provenanceNote: 'Boundary and area from OpenStreetMap. Scores are computed by GreenPulse.',
  },
  {
    key: 'trees',
    label: 'Trees & Plants',
    color: 'hsl(var(--chart-6))',
    emoji: '🌲',
    geometry: 'marker',
    description: 'Trees and plants mapped in OpenStreetMap',
    defaultOn: true,
    provenance: 'osm',
    provenanceNote: 'Position from OpenStreetMap.',
  },
  {
    key: 'water',
    label: 'Water Bodies',
    color: 'hsl(var(--chart-2))',
    emoji: '💧',
    geometry: 'marker',
    description: 'Lakes and ponds mapped in OpenStreetMap',
    defaultOn: true,
    provenance: 'osm',
    provenanceNote: 'Position from OpenStreetMap.',
  },
  {
    key: 'wildlife',
    label: 'Wildlife Records',
    color: 'hsl(var(--chart-3))',
    emoji: '🦜',
    geometry: 'marker',
    description: 'GBIF occurrence records — one point per species, park and month',
    defaultOn: true,
    provenance: 'gbif',
    provenanceNote: 'The count is the number of GBIF occurrence records for this species, park and month — not individuals.',
  },
  {
    key: 'pollution',
    label: 'Pollution Hotspots',
    color: 'hsl(var(--destructive))',
    emoji: '⚠️',
    geometry: 'circle',
    description: 'Open pollution and dumping incidents, sized by priority',
    defaultOn: true,
    provenance: 'demo',
    provenanceNote: 'Incident record from the GreenPulse incident register.',
  },
  {
    key: 'trails',
    label: 'Walking Trails',
    color: 'hsl(var(--chart-4))',
    emoji: '🥾',
    geometry: 'line',
    description: 'Paths and trails mapped in OpenStreetMap',
    defaultOn: false,
    provenance: 'osm',
    provenanceNote: 'Path geometry from OpenStreetMap.',
  },
  {
    key: 'sensors',
    label: 'Sensors',
    color: 'hsl(var(--chart-5))',
    emoji: '📡',
    geometry: 'marker',
    description: 'Park sensors — air, temperature and humidity from Open-Meteo; noise, soil and water channels',
    defaultOn: false,
    provenance: 'simulated',
    provenanceNote: '',
  },
  {
    key: 'reports',
    label: 'Citizen Reports',
    color: 'hsl(var(--warning))',
    emoji: '📣',
    geometry: 'marker',
    description: 'Issues and sightings submitted by the public',
    defaultOn: false,
    provenance: 'demo',
    provenanceNote: 'Submitted through the citizen reporting portal.',
  },
];

export const LAYER_BY_KEY = Object.fromEntries(
  LAYERS.map((layer) => [layer.key, layer])
) as Record<MapLayerKey, LayerDefinition>;

/** Initial visibility state for the toggle control. */
export const defaultLayerState = () =>
  Object.fromEntries(LAYERS.map((l) => [l.key, l.defaultOn])) as Record<MapLayerKey, boolean>;

/** A request to move the map. `requestId` changes on every request, so re-picking the same hit still moves the map. */
export interface MapFocus {
  points: LatLng[];
  requestId: number;
}

// ---------------------------------------------------------------------------
// Feature details — shared by the map popup and the page's "Selected" panel
// ---------------------------------------------------------------------------

/** Sensor types whose readings are Open-Meteo observations; the rest are simulated. */
const OPEN_METEO_SENSOR_TYPES = new Set(['aqi', 'temperature', 'humidity']);

/** Provenance of one feature (sensors differ by type). */
export function featureProvenance(properties: MapFeatureProperties): { source: Provenance; note: string } {
  const layer = LAYER_BY_KEY[properties.layer];
  if (properties.layer === 'sensors') {
    return OPEN_METEO_SENSOR_TYPES.has(String(properties.type))
      ? { source: 'open-meteo', note: 'A real Open-Meteo observation for the park’s coordinates.' }
      : { source: 'simulated', note: 'Modelled sensor channel.' };
  }
  return { source: layer?.provenance ?? 'demo', note: layer?.provenanceNote ?? '' };
}

/** Property keys that are internal plumbing rather than information. */
const HIDDEN_PROPS = new Set(['id', 'layer', 'name', 'boundary', 'intensity']);

/** Indices where null means "not measured" and must say so rather than disappear. */
const NULL_IS_NO_DATA = new Set(['ecosystemHealth', 'biodiversity', 'condition', 'score', 'value']);

/** Labels that differ from the prettified key, per layer. */
const LABELS: Partial<Record<MapLayerKey, Record<string, string>>> = {
  wildlife: { count: 'GBIF records', observedAt: 'Month', observer: 'Source' },
  sensors: { value: 'Reading' },
  parks: { areaAcres: 'Area (acres)', weeklyVisitors: 'Weekly visitors' },
};

const prettyKey = (key: string) =>
  key.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()).trim();

const ISO_DATE = /^\d{4}-\d{2}-\d{2}T/;

function formatValue(layer: MapLayerKey, key: string, value: unknown): string {
  if (value === null || value === undefined) return NO_DATA;
  if (typeof value === 'number') return String(Math.round(value * 100) / 100);
  if (typeof value === 'string' && ISO_DATE.test(value)) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    // A GBIF row aggregates a whole month, so a day would be false precision.
    return layer === 'wildlife' && key === 'observedAt'
      ? date.toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
      : date.toLocaleDateString();
  }
  return String(value);
}

/** Label/value rows for a feature, with missing indices shown as "No data". */
export function featureRows(properties: MapFeatureProperties): [string, string][] {
  const layer = properties.layer;
  return Object.entries(properties)
    .filter(([key, value]) => {
      if (HIDDEN_PROPS.has(key) || (typeof value === 'object' && value !== null)) return false;
      if (value === null || value === undefined) return NULL_IS_NO_DATA.has(key);
      return value !== '';
    })
    .map(([key, value]) => [LABELS[layer]?.[key] ?? prettyKey(key), formatValue(layer, key, value)]);
}
