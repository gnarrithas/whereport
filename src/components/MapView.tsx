import { useEffect, useRef } from 'react';
import * as maplibregl from 'maplibre-gl';
import type { GeoJSONSource, Map as MlMap } from 'maplibre-gl';
import type { FeatureCollection, Point } from 'geojson';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { airports, type Airport, type Destination } from '../data/airports';

// Vite pre-bundling breaks MapLibre's import.meta.url worker lookup; point it at the worker explicitly.
maplibregl.setWorkerUrl(workerUrl);

interface Props {
  origin: Airport | null;
  destinations: Destination[];
  onAirportClick: (airport: Airport) => void;
}

interface DotProps {
  index: number;
  /** Base radius in px, scaled by route traffic. */
  r: number;
}

const DESTS = 'destinations';
const ORIGIN = 'origin';
const BASEMAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';
const PULSE_MS = 1600;
const PULSE_GROW = 14;

const empty: FeatureCollection<Point, DotProps> = { type: 'FeatureCollection', features: [] };

function dots(items: { airport: Airport; r: number }[]): FeatureCollection<Point, DotProps> {
  return {
    type: 'FeatureCollection',
    features: items.map(({ airport, r }) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: airport.lngLat },
      properties: { index: airport.index, r },
    })),
  };
}

/** Busier routes get bigger dots: 3px for the quietest up to 7px. */
function radius(passengers: number): number {
  return 3 + Math.min(4, Math.log10(Math.max(passengers, 1)) * 0.6);
}

const withRouteLayers: maplibregl.TransformStyleFunction = (_previous, next) => ({
  ...next,
  sources: {
    ...next.sources,
    [DESTS]: { type: 'geojson', data: empty },
    [ORIGIN]: { type: 'geojson', data: empty },
  },
  layers: [
    ...next.layers,
    {
      id: 'dest-pulse', type: 'circle', source: DESTS,
      paint: { 'circle-color': '#f97316', 'circle-radius': ['get', 'r'], 'circle-opacity': 0 },
    },
    {
      id: 'dest-dot', type: 'circle', source: DESTS,
      paint: {
        'circle-color': '#f97316', 'circle-radius': ['get', 'r'],
        'circle-stroke-color': '#fff', 'circle-stroke-width': 1,
      },
    },
    {
      id: 'origin-dot', type: 'circle', source: ORIGIN,
      paint: {
        'circle-color': '#2563eb', 'circle-radius': 8,
        'circle-stroke-color': '#fff', 'circle-stroke-width': 2,
      },
    },
  ],
});

export default function MapView({ origin, destinations, onAirportClick }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const loadedRef = useRef(false);
  const clickRef = useRef(onAirportClick);
  const latest = useRef({ origin, destinations });

  clickRef.current = onAirportClick;
  latest.current = { origin, destinations };

  useEffect(() => {
    const map = new maplibregl.Map({
      container: containerRef.current!,
      center: [15, 30],
      zoom: 1.6,
    });
    map.setStyle(BASEMAP_STYLE, { transformStyle: withRouteLayers });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }));
    mapRef.current = map;

    const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 10 });
    map.on('mousemove', 'dest-dot', (e) => {
      const index = e.features?.[0]?.properties?.index;
      if (typeof index !== 'number') return;
      const a = airports[index];
      map.getCanvas().style.cursor = 'pointer';
      popup.setLngLat(a.lngLat).setText(`${a.code} · ${a.city || a.name}`).addTo(map);
    });
    map.on('mouseleave', 'dest-dot', () => {
      map.getCanvas().style.cursor = '';
      popup.remove();
    });
    map.on('click', 'dest-dot', (e) => {
      const index = e.features?.[0]?.properties?.index;
      if (typeof index === 'number') {
        popup.remove();
        clickRef.current(airports[index]);
      }
    });

    let frame = 0;
    const pulse = (now: number) => {
      const t = (now % PULSE_MS) / PULSE_MS;
      if (map.getLayer('dest-pulse')) {
        map.setPaintProperty('dest-pulse', 'circle-radius', ['+', ['get', 'r'], t * PULSE_GROW]);
        map.setPaintProperty('dest-pulse', 'circle-opacity', 0.5 * (1 - t));
      }
      frame = requestAnimationFrame(pulse);
    };

    map.on('load', () => {
      loadedRef.current = true;
      render(map, latest.current.origin, latest.current.destinations);
      frame = requestAnimationFrame(pulse);
    });

    return () => {
      cancelAnimationFrame(frame);
      loadedRef.current = false;
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    render(map, origin, destinations);
  }, [origin, destinations]);

  return <div ref={containerRef} className="map" />;
}

function render(map: MlMap, origin: Airport | null, destinations: Destination[]) {
  (map.getSource(DESTS) as GeoJSONSource).setData(
    dots(destinations.map((d) => ({ airport: d.airport, r: radius(d.passengers) }))),
  );
  (map.getSource(ORIGIN) as GeoJSONSource).setData(origin ? dots([{ airport: origin, r: 8 }]) : empty);
  if (origin) frame(map, origin, destinations);
}

/** Fit the origin and its destinations, taking the short way across the antimeridian. */
function frame(map: MlMap, origin: Airport, destinations: Destination[]) {
  const [ox, oy] = origin.lngLat;
  let w = ox, e = ox, s = oy, n = oy;
  for (const { airport } of destinations) {
    const [x, y] = airport.lngLat;
    const ux = ox + ((((x - ox) % 360) + 540) % 360) - 180;
    w = Math.min(w, ux); e = Math.max(e, ux);
    s = Math.min(s, y); n = Math.max(n, y);
  }
  map.fitBounds([[w, Math.max(s, -80)], [e, Math.min(n, 85)]], { padding: 80, maxZoom: 7, duration: 1200 });
}
