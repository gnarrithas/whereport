import { useEffect, useRef } from 'react';
import * as maplibregl from 'maplibre-gl';
import type { GeoJSONSource, LngLatBoundsLike, Map as MlMap } from 'maplibre-gl';
import type { FeatureCollection, Point } from 'geojson';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { airports, destinationsFrom, type Airport, type Destination } from '../data/airports';

// Vite pre-bundling breaks MapLibre's import.meta.url worker lookup; point it at the worker explicitly.
maplibregl.setWorkerUrl(workerUrl);

interface Props {
  /** The puzzle's answer: hidden (null) while the player is guessing. */
  origin: Airport | null;
  /** The puzzle's answer, always known to the map so a diff never draws it. */
  answer: Airport;
  destinations: Destination[];
  /** Wrong guesses whose combined routes are diffed against the answer's; empty for no diff. */
  compare: Airport[];
}

/** How a dot relates to the diff: flown by both sides, only by the answer, or only by the guesses. */
export type DotKind = 'shared' | 'partial' | 'missing' | 'extra';

interface DotProps {
  index: number;
  /** Base radius in px, scaled by route traffic. */
  r: number;
  kind: DotKind;
}

export const DOT_COLORS: Record<DotKind, string> = {
  shared: '#16a34a',
  partial: '#38bdf8',
  missing: '#2563eb',
  extra: '#9ca3af',
};

const EXTRA_OPACITY = 0.55;

const dotColor: maplibregl.ExpressionSpecification = [
  'match', ['get', 'kind'],
  'shared', DOT_COLORS.shared,
  'partial', DOT_COLORS.partial,
  'extra', DOT_COLORS.extra,
  DOT_COLORS.missing,
];

const DESTS = 'destinations';
const ORIGIN = 'origin';
const GUESS = 'guess';
const BASEMAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';
const PULSE_MS = 1600;
const PULSE_GROW = 14;

const empty: FeatureCollection<Point, DotProps> = { type: 'FeatureCollection', features: [] };

function dots(items: { airport: Airport; r: number; kind?: DotKind }[]): FeatureCollection<Point, DotProps> {
  return {
    type: 'FeatureCollection',
    features: items.map(({ airport, r, kind = 'shared' }) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: airport.lngLat },
      properties: { index: airport.index, r, kind },
    })),
  };
}

/**
 * Dots for the answer's destinations, diffed against the ticked guesses: the answer's routes every guess
 * also flies turn green, those only some fly turn light blue, the rest stay blue, and routes any guess
 * flies but the answer lacks are added in faded grey. Routes between the guesses themselves are dropped, and the answer is
 * never drawn, even when a guess flies there, so the diff cannot give it away.
 */
function routeDots(target: Airport, destinations: Destination[], compare: Airport[]) {
  // With nothing to compare, every route is the answer's alone.
  if (!compare.length) {
    return dots(destinations.map((d) => ({ airport: d.airport, r: radius(d.passengers), kind: 'missing' as DotKind })));
  }
  const guesses = new Set(compare);
  // Per destination: combined passengers and how many of the guesses fly there.
  const theirs = new Map<Airport, { passengers: number; guesses: number }>();
  for (const g of compare) {
    for (const d of destinationsFrom(g)) {
      if (guesses.has(d.airport)) continue;
      const seen = theirs.get(d.airport) ?? { passengers: 0, guesses: 0 };
      theirs.set(d.airport, { passengers: seen.passengers + d.passengers, guesses: seen.guesses + 1 });
    }
  }
  const kindOf = (a: Airport): DotKind => {
    const n = theirs.get(a)?.guesses ?? 0;
    return n === compare.length ? 'shared' : n > 0 ? 'partial' : 'missing';
  };
  const ours = new Set(destinations.map((d) => d.airport));
  // Grey dots come first so they are drawn underneath: a busy guess has hundreds that would bury the answer's.
  return dots([
    ...[...theirs]
      .filter(([a]) => !ours.has(a) && a !== target)
      .map(([airport, { passengers }]) => ({ airport, r: radius(passengers), kind: 'extra' as DotKind })),
    ...destinations.map((d) => ({
      airport: d.airport, r: radius(d.passengers), kind: kindOf(d.airport),
    })),
  ]);
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
    [GUESS]: { type: 'geojson', data: empty },
  },
  layers: [
    ...next.layers,
    {
      id: 'dest-pulse', type: 'circle', source: DESTS,
      filter: ['!=', ['get', 'kind'], 'extra'],
      paint: { 'circle-color': dotColor, 'circle-radius': ['get', 'r'], 'circle-opacity': 0 },
    },
    {
      id: 'dest-dot', type: 'circle', source: DESTS,
      paint: {
        'circle-color': dotColor, 'circle-radius': ['get', 'r'],
        'circle-opacity': ['match', ['get', 'kind'], 'extra', EXTRA_OPACITY, 1],
        'circle-stroke-color': '#fff', 'circle-stroke-width': 1,
        'circle-stroke-opacity': ['match', ['get', 'kind'], 'extra', EXTRA_OPACITY, 1],
      },
    },
    {
      id: 'guess-dot', type: 'circle', source: GUESS,
      paint: {
        'circle-color': '#fff', 'circle-radius': 7,
        'circle-stroke-color': '#111827', 'circle-stroke-width': 3,
      },
    },
    {
      id: 'origin-dot', type: 'circle', source: ORIGIN,
      paint: {
        'circle-color': '#dc2626', 'circle-radius': 8,
        'circle-stroke-color': '#fff', 'circle-stroke-width': 2,
      },
    },
  ],
});

const WORLD: LngLatBoundsLike = [[-180, -60], [180, 80]];

export default function MapView({ origin, answer, destinations, compare }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const loadedRef = useRef(false);
  const latest = useRef({ origin, answer, destinations, compare });

  latest.current = { origin, answer, destinations, compare };

  useEffect(() => {
    const map = new maplibregl.Map({
      container: containerRef.current!,
      bounds: WORLD,
      fitBoundsOptions: { padding: 20 },
    });
    map.setStyle(BASEMAP_STYLE, { transformStyle: withRouteLayers });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }));
    mapRef.current = map;

    const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 10 });
    for (const layer of ['dest-dot', 'guess-dot']) {
      map.on('mousemove', layer, (e) => {
        const index = e.features?.[0]?.properties?.index;
        if (typeof index !== 'number') return;
        const a = airports[index];
        const suffix = layer === 'guess-dot' ? ' (your guess)' : '';
        popup.setLngLat(a.lngLat).setText(`${a.code} · ${a.city || a.name}${suffix}`).addTo(map);
      });
      map.on('mouseleave', layer, () => popup.remove());
    }

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
      const { origin, answer, destinations, compare } = latest.current;
      render(map, origin, answer, destinations, compare);
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
    render(map, origin, answer, destinations, compare);
  }, [origin, answer, destinations, compare]);

  useEffect(() => {
    const map = mapRef.current;
    if (map && loadedRef.current) showWorld(map);
  }, [destinations]);

  return <div ref={containerRef} className="map" />;
}

function render(
  map: MlMap, origin: Airport | null, answer: Airport, destinations: Destination[], compare: Airport[],
) {
  (map.getSource(DESTS) as GeoJSONSource).setData(routeDots(answer, destinations, compare));
  (map.getSource(ORIGIN) as GeoJSONSource).setData(origin ? dots([{ airport: origin, r: 8 }]) : empty);
  (map.getSource(GUESS) as GeoJSONSource).setData(dots(compare.map((airport) => ({ airport, r: 7 }))));
}

/** Show the whole world, whatever the airport. */
function showWorld(map: MlMap) {
  map.fitBounds(WORLD, { padding: 20, duration: 1200 });
}
