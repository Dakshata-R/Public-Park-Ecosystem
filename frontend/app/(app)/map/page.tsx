'use client';

/**
 * Module 2 — GIS & Urban Biodiversity Mapping.
 *
 * The map has no collection of its own: every layer is a live projection of
 * another module's data, fetched as GeoJSON from `/api/gis/layers`. A tree
 * pin *is* the asset register's record of that tree.
 */

import dynamic from 'next/dynamic';
import { useMemo, useRef, useState } from 'react';
import { Layers, MapPin, Search, Crosshair, Info } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/shared/page-header';
import { ParkFilter, ALL_PARKS, parkParam } from '@/components/shared/park-filter';
import { ErrorState, LoadingState } from '@/components/shared/query-state';
import { ScoreBar } from '@/components/shared/score-badge';
import { SourceBadge } from '@/components/shared/data-source';
import { MapLayerToggle } from '@/components/map/map-layer-toggle';
import {
  defaultLayerState, featureProvenance, featureRows, LAYER_BY_KEY, type MapFocus,
} from '@/components/map/layer-config';
import { useMapLayers } from '@/lib/hooks/use-api';
import { lineToLatLngs, toLatLng } from '@/lib/api/geo';
import type { Feature, MapFeatureProperties, MapLayerKey } from '@/lib/types';

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

/** Properties drawn as score bars in the selection panel, per layer. */
const SCORE_BARS: Partial<Record<MapLayerKey, { key: string; label: string }[]>> = {
  parks: [
    { key: 'ecosystemHealth', label: 'Ecosystem health' },
    { key: 'biodiversity', label: 'Biodiversity' },
  ],
  trees: [{ key: 'condition', label: 'Condition' }],
  water: [{ key: 'condition', label: 'Condition' }],
  trails: [{ key: 'condition', label: 'Condition' }],
};

export default function MapPage() {
  const [filters, setFilters] = useState<Record<MapLayerKey, boolean>>(defaultLayerState);
  const [search, setSearch] = useState('');
  const [park, setPark] = useState(ALL_PARKS);
  const [selected, setSelected] = useState<Feature<MapFeatureProperties> | null>(null);
  const [focus, setFocus] = useState<MapFocus | null>(null);
  const focusRequests = useRef(0);

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

  /** Move the map to a search hit — a point is flown to, a trail is fitted — and select it. */
  const focusFeature = (feature: Feature<MapFeatureProperties>) => {
    setSelected(feature);
    const points =
      feature.geometry.type === 'Point' ? [toLatLng(feature.geometry.coordinates)]
      : feature.geometry.type === 'LineString' ? lineToLatLngs(feature.geometry)
      : [];
    if (points.length) {
      focusRequests.current += 1;
      setFocus({ points, requestId: focusRequests.current });
    }
  };

  const selectedRows = selected ? featureRows(selected.properties) : [];
  const selectedProvenance = selected ? featureProvenance(selected.properties) : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="GIS & Urban Biodiversity Mapping"
        description="Parks, vegetation, water bodies, wildlife records, pollution hotspots, trails and sensors — every layer drawn live from the module that owns it."
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
                Counts show what each layer currently holds. The map&apos;s own control switches the base map only.
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
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <Badge variant="outline" className="text-[10px]">
                      {LAYER_BY_KEY[selected.properties.layer]?.label}
                    </Badge>
                    {selectedProvenance && <SourceBadge source={selectedProvenance.source} className="text-[10px]" />}
                  </div>
                </div>

                {/* Scores get a bar, not just a number; a missing score says "No data". */}
                {(SCORE_BARS[selected.properties.layer] ?? [])
                  .filter(({ key }) => key in selected.properties)
                  .map(({ key, label }) => (
                    <div key={key} className="pt-1">
                      <p className="mb-1 text-xs text-muted-foreground">{label}</p>
                      <ScoreBar score={selected.properties[key] as number | null} />
                    </div>
                  ))}

                <div className="space-y-0.5 border-t pt-2">
                  {selectedRows.map(([label, value]) => (
                    <p key={label} className="text-xs">
                      <span className="font-medium">{label}:</span> {value}
                    </p>
                  ))}
                </div>

                {selectedProvenance?.note && (
                  <p className="border-t pt-2 text-[11px] text-muted-foreground">{selectedProvenance.note}</p>
                )}

                {selected.geometry.type === 'Point' && (
                  <p className="border-t pt-2 font-mono text-[11px] text-muted-foreground">
                    {selected.geometry.coordinates[1].toFixed(5)},{' '}
                    {selected.geometry.coordinates[0].toFixed(5)}
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
                  Click any marker for its full record. Pollution circles are
                  sized by the incident&apos;s computed priority score, so the biggest circle is the one to
                  deal with first.
                </p>
              </CardContent>
            </Card>
          )}
        </div>

        {/* --- Map --- */}
        <div className="lg:col-span-3">
          {/* `isolate` keeps Leaflet's high z-index panes from covering dropdowns and tooltips. */}
          <Card className="isolate overflow-hidden p-0">
            {query.isError ? (
              <div className="p-4">
                <ErrorState error={query.error} onRetry={() => void query.refetch()} />
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
            Map data &copy; OpenStreetMap contributors (ODbL) · species records via GBIF.org · weather and
            air quality by Open-Meteo.com (CAMS).
          </p>
        </div>
      </div>
    </div>
  );
}
