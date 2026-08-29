import type { MapLayerKey } from '@/lib/types';

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
}

export const LAYERS: LayerDefinition[] = [
  {
    key: 'parks',
    label: 'Parks',
    color: 'hsl(var(--chart-1))',
    emoji: '🌳',
    geometry: 'marker',
    description: 'Park centres and boundaries',
    defaultOn: true,
  },
  {
    key: 'trees',
    label: 'Trees & Plants',
    color: 'hsl(var(--chart-6))',
    emoji: '🌲',
    geometry: 'marker',
    description: 'Individual vegetation assets and their condition',
    defaultOn: true,
  },
  {
    key: 'water',
    label: 'Water Bodies',
    color: 'hsl(var(--chart-2))',
    emoji: '💧',
    geometry: 'marker',
    description: 'Lakes and ponds',
    defaultOn: true,
  },
  {
    key: 'wildlife',
    label: 'Wildlife Sightings',
    color: 'hsl(var(--chart-3))',
    emoji: '🦜',
    geometry: 'marker',
    description: 'Verified species observations',
    defaultOn: true,
  },
  {
    key: 'pollution',
    label: 'Pollution Hotspots',
    color: 'hsl(var(--destructive))',
    emoji: '⚠️',
    geometry: 'circle',
    description: 'Open pollution and dumping incidents, sized by priority',
    defaultOn: true,
  },
  {
    key: 'trails',
    label: 'Walking Trails',
    color: 'hsl(var(--chart-4))',
    emoji: '🥾',
    geometry: 'line',
    description: 'Paths and trails',
    defaultOn: false,
  },
  {
    key: 'sensors',
    label: 'Sensors',
    color: 'hsl(var(--chart-5))',
    emoji: '📡',
    geometry: 'marker',
    description: 'Environmental monitoring devices and their live readings',
    defaultOn: false,
  },
  {
    key: 'reports',
    label: 'Citizen Reports',
    color: 'hsl(var(--warning))',
    emoji: '📣',
    geometry: 'marker',
    description: 'Issues and sightings submitted by the public',
    defaultOn: false,
  },
];

export const LAYER_BY_KEY = Object.fromEntries(
  LAYERS.map((layer) => [layer.key, layer])
) as Record<MapLayerKey, LayerDefinition>;

/** Initial visibility state for the toggle control. */
export const defaultLayerState = () =>
  Object.fromEntries(LAYERS.map((l) => [l.key, l.defaultOn])) as Record<MapLayerKey, boolean>;
