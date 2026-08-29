'use client';

/**
 * Module 2 — GIS & Urban Biodiversity Mapping.
 *
 * The map has no collection of its own: every layer is a live projection of
 * another module's data, fetched as GeoJSON from `/api/gis/layers`. A tree
 * pin *is* the asset register's record of that tree.
 */

import dynamic from 'next/dynamic';
import { useMemo, useState } from 'react';
import { Layers, MapPin, Search, Crosshair, Info } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/shared/page-header';
import { ParkFilter, ALL_PARKS, parkParam } from '@/components/shared/park-filter';
import { ErrorState, LoadingState } from '@/components/shared/query-state';
import { ScoreBar } from '@/components/shared/score-badge';
import { MapLayerToggle } from '@/components/map/map-layer-toggle';
import { defaultLayerState, LAYER_BY_KEY } from '@/components/map/layer-config';
import { useMapLayers } from '@/lib/hooks/use-api';
import { toLatLng } from '@/lib/api/geo';
import type { Feature, LatLng, MapFeatureProperties, MapLayerKey } from '@/lib/types';

/**
 * Leaflet touches `window` at import time, so the map must be client-only.
 * `ssr: false` keeps it out of the server bundle entirely.
 */
const BiodiversityMap = dynamic(() => import('@/components/map/biodiversity-map'), {
  ssr: false,
  loading: () => (
    <div className="flex h-[600px] items-center justify-center rounded-lg bg-muted">
      <p className="text-sm text-muted-foreground">Loading map…</p>
    </div>
  ),
});

/** Property keys that are internal plumbing rather than information. */
const HIDDEN_PROPS = new Set(['id', 'layer', 'name', 'boundary', 'intensity']);

const prettyKey = (key: string) =>
  key.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()).trim();

export default function MapPage() {
  const [filters, setFilters] = useState<Record<MapLayerKey, boolean>>(defaultLayerState);
  const [search, setSearch] = useState('');
  const [park, setPark] = useState(ALL_PARKS);
  const [selected, setSelected] = useState<Feature<MapFeatureProperties> | null>(null);
  const [focus, setFocus] = useState<LatLng | null>(null);

  // Every layer is requested in one call; toggling only changes what is drawn,
  // so a chip flip is instant rather than a round trip.
  const query = useMapLayers(undefined, parkParam(park));

  const toggle = (key: MapLayerKey) => setFilters((f) => ({ ...f, [key]: !f[key] }));

  /** Feature count per layer, for the chips. */
  const counts = useMemo(() => {
    if (!query.data) return undefined;
    return Object.fromEntries(
      Object.entries(query.data).map(([key, collection]) => [key, collection.features.length])
    ) as Partial<Record<MapLayerKey, number>>;
  }, [query.data]);

  /** Features matching the search box, across every visible layer. */
  const searchResults = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term || !query.data) return [];

    const hits: Feature<MapFeatureProperties>[] = [];
    for (const [key, collection] of Object.entries(query.data)) {
      if (!filters[key as MapLayerKey]) continue;
      for (const feature of collection.features) {
        const matched = Object.values(feature.properties).some(
          (value) => typeof value === 'string' && value.toLowerCase().includes(term)
        );
        if (matched) hits.push(feature);
        if (hits.length >= 40) break;
      }
    }
    return hits;
  }, [search, query.data, filters]);

  const visibleTotal = useMemo(() => {
    if (!query.data) return 0;
    return Object.entries(query.data).reduce(
      (sum, [key, collection]) => sum + (filters[key as MapLayerKey] ? collection.features.length : 0),
      0
    );
  }, [query.data, filters]);

  /** Centre the map on a search hit and select it. */
  const focusFeature = (feature: Feature<MapFeatureProperties>) => {
    setSelected(feature);
    if (feature.geometry.type === 'Point') {
      setFocus(toLatLng(feature.geometry.coordinates as [number, number]));
    }
  };

  const selectedRows = selected
    ? Object.entries(selected.properties).filter(
        ([key, value]) =>
          !HIDDEN_PROPS.has(key) && value !== null && value !== undefined && value !== '' && typeof value !== 'object'
      )
    : [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="GIS & Urban Biodiversity Mapping"
        description="Parks, vegetation, water bodies, wildlife sightings, pollution hotspots, trails and sensors — every layer drawn live from the module that owns it."
        icon="Map"
        action={<ParkFilter value={park} onChange={setPark} allLabel="All parks" />}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
        {/* --- Controls --- */}
        <div className="space-y-4 lg:col-span-1">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Search className="h-4 w-4" /> Search
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Find a park, species, asset…"
                  className="pl-9"
                />
              </div>

              <p className="text-xs text-muted-foreground">
                {search.trim()
                  ? `${searchResults.length} match${searchResults.length === 1 ? '' : 'es'} — non-matching features are dimmed, not hidden`
                  : `${visibleTotal} features on the map`}
              </p>

              {searchResults.length > 0 && (
                <div className="max-h-56 space-y-1 overflow-y-auto scrollbar-thin">
                  {searchResults.map((feature) => (
                    <button
                      key={`${feature.properties.layer}-${feature.properties.id}`}
                      onClick={() => focusFeature(feature)}
                      className="flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-xs transition-colors hover:border-primary/40 hover:bg-primary/5"
                    >
                      <span aria-hidden>{LAYER_BY_KEY[feature.properties.layer]?.emoji}</span>
                      <span className="min-w-0 flex-1 truncate">{feature.properties.name}</span>
                      <Crosshair className="h-3 w-3 shrink-0 text-muted-foreground" />
                    </button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Layers className="h-4 w-4" /> Layers
              </CardTitle>
              <CardDescription className="text-xs">
                Counts show what each layer currently holds
              </CardDescription>
            </CardHeader>
            <CardContent>
              <MapLayerToggle filters={filters} counts={counts} onToggle={toggle} />
            </CardContent>
          </Card>

          {selected ? (
            <Card className="border-primary/30">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <MapPin className="h-4 w-4 text-primary" /> Selected
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div>
                  <p className="text-sm font-medium">{selected.properties.name}</p>
                  <Badge variant="outline" className="mt-1 text-[10px]">
                    {LAYER_BY_KEY[selected.properties.layer]?.label}
                  </Badge>
                </div>

                {/* Condition and health scores get a bar, not just a number. */}
                {typeof selected.properties.condition === 'number' && (
                  <div className="pt-1">
                    <p className="mb-1 text-xs text-muted-foreground">Condition</p>
                    <ScoreBar score={selected.properties.condition as number} />
                  </div>
                )}
                {typeof selected.properties.ecosystemHealth === 'number' && (
                  <div className="pt-1">
                    <p className="mb-1 text-xs text-muted-foreground">Ecosystem health</p>
                    <ScoreBar score={selected.properties.ecosystemHealth as number} />
                  </div>
                )}

                <div className="space-y-0.5 border-t pt-2">
                  {selectedRows.map(([key, value]) => (
                    <p key={key} className="text-xs">
                      <span className="font-medium">{prettyKey(key)}:</span>{' '}
                      {typeof value === 'number' ? Math.round(value * 100) / 100 : String(value)}
                    </p>
                  ))}
                </div>

                {selected.geometry.type === 'Point' && (
                  <p className="border-t pt-2 font-mono text-[11px] text-muted-foreground">
                    {(selected.geometry.coordinates as number[])[1].toFixed(5)},{' '}
                    {(selected.geometry.coordinates as number[])[0].toFixed(5)}
                  </p>
                )}

                <Button variant="ghost" size="sm" className="w-full" onClick={() => setSelected(null)}>
                  Clear selection
                </Button>
              </CardContent>
            </Card>
          ) : (
            <Card className="border-dashed">
              <CardContent className="flex items-start gap-2.5 p-4 text-xs text-muted-foreground">
                <Info className="mt-0.5 h-4 w-4 shrink-0" />
                <p>
                  Click any marker for its full record. Pollution circles are sized by the
                  incident&apos;s computed priority score, so the biggest circle is the one to deal
                  with first.
                </p>
              </CardContent>
            </Card>
          )}
        </div>

        {/* --- Map --- */}
        <div className="lg:col-span-3">
          <Card className="overflow-hidden p-0">
            {query.isError ? (
              <div className="p-4">
                <ErrorState error={query.error} onRetry={query.refetch} />
              </div>
            ) : query.isPending ? (
              <LoadingState label="Loading map layers…" className="h-[600px]" />
            ) : (
              <BiodiversityMap
                layers={query.data}
                filters={filters}
                search={search}
                focus={focus}
                onSelect={setSelected}
              />
            )}
          </Card>

          <p className="mt-2 text-xs text-muted-foreground">
            Geometry is stored as GeoJSON in MongoDB with a 2dsphere index, which is what makes
            the &ldquo;what is within 500&nbsp;m&rdquo; queries on the citizen portal possible.
          </p>
        </div>
      </div>
    </div>
  );
}
