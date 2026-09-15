'use client';

/**
 * Module 2 — the Leaflet map.
 *
 * Renders GeoJSON FeatureCollections straight from `/api/gis/layers`. Nothing
 * on this map is stored for the map's benefit: a tree marker is the asset
 * register's record of that tree (positioned from OpenStreetMap), a wildlife
 * point is a GBIF record, a pollution circle is an open incident. That is why
 * the map cannot go stale relative to the modules it draws.
 *
 * Layer visibility has one source of truth — the `filters` prop driven by the
 * page's chips. Leaflet's own control only switches the base map.
 *
 * Coordinate order is the one real hazard here. GeoJSON is [lng, lat] and
 * Leaflet is [lat, lng]; the conversion happens only through the helpers in
 * `lib/api/geo.ts`, never inline.
 *
 * Markers are DivIcons and circle markers only, so Leaflet's default marker
 * images (which the bundled CSS would have to resolve) are never requested.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  MapContainer, TileLayer, Marker, Popup, CircleMarker,
  Polyline, Polygon, LayersControl, LayerGroup, useMap,
} from 'react-leaflet';
import L from 'leaflet';
import { lineToLatLngs, polygonToLatLngs, toLatLng, boundsOf, DEFAULT_CENTRE, DEFAULT_ZOOM } from '@/lib/api/geo';
import { SourceBadge } from '@/components/shared/data-source';
import { LAYER_BY_KEY, LAYERS, featureProvenance, featureRows, type MapFocus } from './layer-config';
import type { Feature, LatLng, MapFeatureProperties, MapLayerKey, MapLayers, GeoPolygon } from '@/lib/types';

const { BaseLayer } = LayersControl;

/** Required for the tiles and for every OSM-derived feature, whichever base map is showing. */
const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const DATA_ATTRIBUTIONS = [
  OSM_ATTRIBUTION,
  'Species records: <a href="https://www.gbif.org">GBIF.org</a>',
  'Weather &amp; air quality: <a href="https://open-meteo.com">Open-Meteo.com</a> (CAMS)',
];

interface BiodiversityMapProps {
  layers: MapLayers | undefined;
  filters: Record<MapLayerKey, boolean>;
  search: string;
  /** Move the map to these points (fly to one, fit several) when the request changes. */
  focus?: MapFocus | null;
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

/** Imperatively move the map when the parent asks: fly to a point, or fit a line's extent. */
function FlyTo({ target }: { target: MapFocus | null | undefined }) {
  const map = useMap();
  useEffect(() => {
    if (!target?.points.length) return;
    if (target.points.length === 1) {
      map.flyTo(target.points[0], 16, { duration: 1.1 });
      return;
    }
    const bounds = boundsOf(target.points);
    if (bounds) map.flyToBounds(bounds, { padding: [40, 40], maxZoom: 17, duration: 1.1 });
  }, [target, map]);
  return null;
}

/** Data credits that apply whichever base map is selected. */
function DataAttribution() {
  const map = useMap();
  useEffect(() => {
    const control = map.attributionControl;
    if (!control) return;
    DATA_ATTRIBUTIONS.forEach((text) => control.addAttribution(text));
    return () => {
      DATA_ATTRIBUTIONS.forEach((text) => control.removeAttribution(text));
    };
  }, [map]);
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

function FeaturePopup({ properties }: { properties: MapFeatureProperties }) {
  const rows = featureRows(properties);
  const { source, note } = featureProvenance(properties);

  return (
    <div style={{ minWidth: 200, maxWidth: 280 }} className="space-y-1">
      <p className="text-sm font-semibold">{properties.name}</p>
      <div className="flex flex-wrap items-center gap-1.5">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
          {LAYER_BY_KEY[properties.layer]?.label ?? properties.layer}
        </p>
        <SourceBadge source={source} className="text-[10px]" />
      </div>
      {rows.length > 0 && (
        <div className="mt-2 space-y-0.5 border-t pt-2">
          {rows.map(([label, value]) => (
            <p key={label} className="text-xs">
              <span className="font-medium">{label}:</span> {value}
            </p>
          ))}
        </div>
      )}
      {note && <p className="border-t pt-1.5 text-[11px] text-muted-foreground">{note}</p>}
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
   * meaningful — "this hawk record, relative to those trees".
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
          points.push(toLatLng(feature.geometry.coordinates));
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
      <DataAttribution />

      {/* Base maps only. Overlay visibility is controlled by the page's layer chips. */}
      <LayersControl position="topright">
        <BaseLayer checked name="Streets">
          <TileLayer attribution={OSM_ATTRIBUTION} url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        </BaseLayer>
        <BaseLayer name="Satellite">
          <TileLayer
            attribution="Imagery &copy; Esri"
            url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
          />
        </BaseLayer>
        <BaseLayer name="Terrain">
          <TileLayer
            attribution='SRTM | Map style &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)'
            url="https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png"
          />
        </BaseLayer>
      </LayersControl>

      {LAYERS.map((layer) => {
        const collection = layers?.[layer.key];
        if (!collection || !filters[layer.key]) return null;

        return (
          <LayerGroup key={layer.key}>
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
                    positions={lineToLatLngs(feature.geometry)}
                    pathOptions={{ color: layer.color, weight: 4, opacity: dimmed ? 0.25 : 0.8 }}
                    eventHandlers={{ click: () => onSelect?.(feature) }}
                  >
                    <Popup><FeaturePopup properties={feature.properties} /></Popup>
                  </Polyline>
                );
              }

              if (feature.geometry.type !== 'Point') return null;
              const position = toLatLng(feature.geometry.coordinates);

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
        );
      })}
    </MapContainer>
  );
}
