'use client';

import { cn } from '@/lib/utils';
import { LAYERS } from './layer-config';
import type { MapLayerKey } from '@/lib/types';

/**
 * Layer chips above the map.
 *
 * Each chip shows the live feature count for its layer, so a reader can tell
 * "this layer is off" from "this layer is on but empty" — a distinction the
 * map alone cannot make.
 */
export function MapLayerToggle({
  filters,
  counts,
  onToggle,
}: {
  filters: Record<MapLayerKey, boolean>;
  counts?: Partial<Record<MapLayerKey, number>>;
  onToggle: (key: MapLayerKey) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {LAYERS.map((layer) => {
        const active = filters[layer.key];
        const count = counts?.[layer.key];

        return (
          <button
            key={layer.key}
            onClick={() => onToggle(layer.key)}
            title={layer.description}
            aria-pressed={active}
            className={cn(
              'flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-all',
              active
                ? 'border-transparent bg-primary text-primary-foreground shadow-sm'
                : 'bg-card text-muted-foreground hover:bg-muted'
            )}
          >
            <span aria-hidden>{layer.emoji}</span>
            {layer.label}
            {count !== undefined && (
              <span
                className={cn(
                  'ml-0.5 rounded-full px-1.5 py-px text-[10px] tabular-nums',
                  active ? 'bg-primary-foreground/20' : 'bg-muted'
                )}
              >
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
