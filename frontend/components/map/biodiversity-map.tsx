'use client';

/**
 * Module 2 — the Leaflet map.
 *
 * Renders GeoJSON FeatureCollections straight from `/api/gis/layers`. Nothing
 * on this map is stored for the map's benefit: a tree marker is the asset
 * register's record of that tree, a pollution circle is an open incident. That
 * is why the map cannot go stale relative to the modules it draws.
 *
 * Coordinate order is the one real hazard here. GeoJSON is [lng, lat] and
 * Leaflet is [lat, lng]; the conversion happens only through the helpers in
 * `lib/api/geo.ts`, never inline.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  MapContainer, TileLayer, Marker, Popup, CircleMarker,
  Polyline, Polygon, LayersControl, LayerGroup, useMap,
} from 'react-leaflet';
import L from 'leaflet';
import { lineToLatLngs, polygonToLatLngs, toLatLng, boundsOf, DEFAULT_CENTRE, DEFAULT_ZOOM } from '@/lib/api/geo';
import { LAYER_BY_KEY, LAYERS } from './layer-config';
import type { Feature, LatLng, MapFeatureProperties, MapLayerKey, MapLayers, GeoPolygon } from '@/lib/types';

const { BaseLayer, Overlay } = LayersControl;

interface BiodiversityMapProps {
  layers: MapLayers | undefined;
  filters: Record<MapLayerKey, boolean>;
  search: string;
  /** Fly the map to this point when it changes. */
  focus?: LatLng | null;
  onSelect?: (feature: Feature<MapFeatureProperties>) => void;
}

/**
 * Circular marker built as a DivIcon.
 *
 * Cached by colour+emoji: Leaflet creates a DOM node per icon instance, and a
 * park with 100 trees would otherwise build 100 identical icons.
 */
const iconCache = new Map<string, L.DivIcon>();

function markerIcon(color: string, emoji: string, dimmed = false) {
  const key = `${color}|${emoji}|${dimmed}`;
  const cached = iconCache.get(key);
  if (cached) return cached;

  const icon = L.divIcon({
    className: 'greenpulse-marker',
    html:
      `<div style="width:26px;height:26px;background:${color};border:2px solid white;` +
      `border-radius:50%;display:flex;align-items:center;justify-content:center;` +
      `font-size:12px;box-shadow:0 2px 6px rgba(0,0,0,0.3);opacity:${dimmed ? 0.35 : 1}">${emoji}</div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });

  iconCache.set(key, icon);
  return icon;
}

/** Imperatively fly the map when the parent asks for a new focus point. */
function FlyTo({ target }: { target: LatLng | null | undefined }) {
  const map = useMap();
  useEffect(() => {
    if (target) map.flyTo(target, 16, { duration: 1.1 });
  }, [target, map]);
  return null;
}

/**
 * Fit the viewport to the loaded data once.
 *
 * Only on the first non-empty load — refitting on every data refresh would
 * yank the map out from under someone who had panned somewhere deliberately.
 */
function FitToData({ points }: { points: LatLng[] }) {
  const map = useMap();
  const [fitted, setFitted] = useState(false);

  useEffect(() => {
    if (fitted || !points.length) return;
    const bounds = boundsOf(points);
    if (bounds) {
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
      setFitted(true);
    }
  }, [points, map, fitted]);

  return null;
}

/** Human-readable key for a property name in the popup table. */
const prettyKey = (key: string) =>
  key.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()).trim();

/** Properties that are plumbing rather than information. */
const HIDDEN_PROPS = new Set(['id', 'layer', 'name', 'boundary', 'intensity']);

function FeaturePopup({ properties }: { properties: MapFeatureProperties }) {
  const rows = Object.entries(properties).filter(
    ([key, value]) =>
      !HIDDEN_PROPS.has(key) &&
      value !== null &&
      value !== undefined &&
      value !== '' &&
      typeof value !== 'object'
  );

  return (
    <div style={{ minWidth: 200 }} className="space-y-1">
      <p className="text-sm font-semibold">{properties.name}</p>
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {LAYER_BY_KEY[properties.layer]?.label ?? properties.layer}
      </p>
      {rows.length > 0 && (
        <div className="mt-2 space-y-0.5 border-t pt-2">
          {rows.map(([key, value]) => (
            <p key={key} className="text-xs">
              <span className="font-medium">{prettyKey(key)}:</span>{' '}
              {typeof value === 'number' ? Math.round(value * 100) / 100 : String(value)}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

export default function BiodiversityMap({
  layers,
  filters,
  search,
  focus,
  onSelect,
}: BiodiversityMapProps) {
  const query = search.trim().toLowerCase();

  /**
   * Search dims rather than removes. Hiding non-matching features would make
   * the map look empty and destroy the spatial context that makes a match
   * meaningful — "this hawk sighting, relative to those trees".
   */
  const matches = (properties: MapFeatureProperties) => {
    if (!query) return true;
    return Object.values(properties).some(
      (value) => typeof value === 'string' && value.toLowerCase().includes(query)
    );
  };

  /** Every point on the map, used once to fit the initial viewport. */
  const allPoints = useMemo<LatLng[]>(() => {
    if (!layers) return [];
    const points: LatLng[] = [];
    for (const layer of LAYERS) {
      const collection = layers[layer.key];
      if (!collection || !filters[layer.key]) continue;
      for (const feature of collection.features) {
        if (feature.geometry.type === 'Point') {
          points.push(toLatLng(feature.geometry.coordinates as [number, number]));
        }
      }
    }
    return points;
  }, [layers, filters]);

  return (
    <MapContainer
      center={DEFAULT_CENTRE}
      zoom={DEFAULT_ZOOM}
      scrollWheelZoom
      className="h-[600px] w-full rounded-lg"
    >
      <FlyTo target={focus} />
      <FitToData points={allPoints} />

      <LayersControl position="topright">
        <BaseLayer checked name="Streets">
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
        </BaseLayer>
        <BaseLayer name="Satellite">
          <TileLayer
            attribution="Imagery &copy; Esri"
            url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
          />
        </BaseLayer>
        <BaseLayer name="Terrain">
          <TileLayer
            attribution="&copy; OpenTopoMap contributors"
            url="https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png"
          />
        </BaseLayer>

        {LAYERS.map((layer) => {
          const collection = layers?.[layer.key];
          if (!collection) return null;

          return (
            <Overlay key={layer.key} checked={filters[layer.key]} name={layer.label}>
              <LayerGroup>
                {/* Park boundaries are drawn beneath their marker. */}
                {layer.key === 'parks' &&
                  collection.features.map((feature) => {
                    const boundary = feature.properties.boundary as GeoPolygon | null;
                    if (!boundary) return null;
                    return (
                      <Polygon
                        key={`boundary-${feature.properties.id}`}
                        positions={polygonToLatLngs(boundary)}
                        pathOptions={{
                          color: layer.color,
                          fillColor: layer.color,
                          fillOpacity: 0.08,
                          weight: 1.5,
                          dashArray: '4 4',
                        }}
                      />
                    );
                  })}

                {collection.features.map((feature) => {
                  const dimmed = !matches(feature.properties);
                  const key = `${layer.key}-${feature.properties.id}`;

                  // --- Trails: polylines when the geometry allows --------
                  if (layer.geometry === 'line' && feature.geometry.type === 'LineString') {
                    return (
                      <Polyline
                        key={key}
                        positions={lineToLatLngs(feature.geometry as never)}
                        pathOptions={{ color: layer.color, weight: 4, opacity: dimmed ? 0.25 : 0.8 }}
                        eventHandlers={{ click: () => onSelect?.(feature) }}
                      >
                        <Popup><FeaturePopup properties={feature.properties} /></Popup>
                      </Polyline>
                    );
                  }

                  if (feature.geometry.type !== 'Point') return null;
                  const position = toLatLng(feature.geometry.coordinates as [number, number]);

                  // --- Pollution: radius carries the priority score ------
                  if (layer.geometry === 'circle') {
                    const intensity = Number(feature.properties.intensity ?? 0.5);
                    return (
                      <CircleMarker
                        key={key}
                        center={position}
                        radius={12 + intensity * 22}
                        pathOptions={{
                          color: layer.color,
                          fillColor: layer.color,
                          fillOpacity: dimmed ? 0.06 : 0.18,
                          weight: 2,
                          opacity: dimmed ? 0.3 : 1,
                        }}
                        eventHandlers={{ click: () => onSelect?.(feature) }}
                      >
                        <Popup><FeaturePopup properties={feature.properties} /></Popup>
                      </CircleMarker>
                    );
                  }

                  return (
                    <Marker
                      key={key}
                      position={position}
                      icon={markerIcon(layer.color, layer.emoji, dimmed)}
                      eventHandlers={{ click: () => onSelect?.(feature) }}
                    >
                      <Popup><FeaturePopup properties={feature.properties} /></Popup>
                    </Marker>
                  );
                })}
              </LayerGroup>
            </Overlay>
          );
        })}
      </LayersControl>
    </MapContainer>
  );
}
