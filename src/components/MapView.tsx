import { useEffect, useRef } from 'react';
import * as maplibregl from 'maplibre-gl';
import type { GeoJSONSource, LngLatBoundsLike, Map as MlMap } from 'maplibre-gl';
import type { FeatureCollection, Point } from 'geojson';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { launchFireworks } from './fireworks';
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
  /** Codes of countries guessed wrong, hatched in red. */
  wrongCountries: string[];
  /** Airports guessed wrong: always a red dot (in place of a possible-answer icon), never clickable. */
  ruledOut: Airport[];
  /** A possible-answer icon was clicked. */
  onCandidateClick: (airport: Airport) => void;
  /** The answer's domestic flights to other possible answers, once the player reveals them; else empty. */
  domestic: Destination[];
  /** The player found the answer: its dot turns gold and fireworks go off above it. */
  won: boolean;
  /** Airports that could be the answer, marked with an airport icon once its country is known; else empty. */
  candidates: Airport[];
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
const COUNTRIES = 'countries';
const HATCH = 'hatch';
const CANDIDATES = 'candidates';
const RULED_OUT = 'ruled-out';
const DOMESTIC = 'domestic';
const DOMESTIC_COLOR = '#9333ea';
/** Wrong guesses are drawn mid-sized among the destination dots (3–7px). */
const GUESS_RADIUS = 5;
// Not plain 'airport': the basemap's sprite already has an image by that name.
const AIRPORT = 'daily-map-airport';
const WRONG_RED = '#dc2626';
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

/** Only the given countries' shapes, as a layer filter. */
function countryFilter(codes: string[]): maplibregl.FilterSpecification {
  return ['in', ['get', 'code'], ['literal', codes]];
}

/** A tile of red oblique lines, seamless when repeated, for hatching wrong countries. */
function hatchImage(): ImageData {
  const ratio = 2;
  const size = 8 * ratio;
  const ctx = document.createElement('canvas').getContext('2d')!;
  ctx.canvas.width = ctx.canvas.height = size;
  ctx.strokeStyle = WRONG_RED;
  ctx.globalAlpha = 0.7;
  ctx.lineWidth = 1.5 * ratio;
  ctx.beginPath();
  // The main diagonal plus the two corner stubs that continue it into the neighbouring tiles.
  for (const off of [-size, 0, size]) {
    ctx.moveTo(off, size);
    ctx.lineTo(off + size, 0);
  }
  ctx.stroke();
  return ctx.getImageData(0, 0, size, size);
}

/** Images the style asks for by name, drawn on first use. */
const IMAGES: Record<string, () => ImageData> = { [HATCH]: hatchImage };

/** Image files the style asks for by name, served from public/; all drawn at half their pixel size. */
const IMAGE_FILES: Record<string, string> = { [AIRPORT]: `${import.meta.env.BASE_URL}icons/airport.png` };

const withRouteLayers: maplibregl.TransformStyleFunction = (_previous, next) => ({
  ...next,
  sources: {
    ...next.sources,
    // Built offline by scripts/build_countries.py from Natural Earth; loaded on its own to keep the bundle small.
    [COUNTRIES]: { type: 'geojson', data: `${import.meta.env.BASE_URL}countries.geojson` },
    [DESTS]: { type: 'geojson', data: empty },
    [ORIGIN]: { type: 'geojson', data: empty },
    [GUESS]: { type: 'geojson', data: empty },
    [CANDIDATES]: { type: 'geojson', data: empty },
    [RULED_OUT]: { type: 'geojson', data: empty },
    [DOMESTIC]: { type: 'geojson', data: empty },
  },
  layers: [
    ...next.layers,
    {
      id: 'wrong-country-hatch', type: 'fill', source: COUNTRIES, filter: countryFilter([]),
      paint: { 'fill-pattern': HATCH },
    },
    {
      id: 'wrong-country-border', type: 'line', source: COUNTRIES, filter: countryFilter([]),
      paint: { 'line-color': WRONG_RED, 'line-width': 2 },
    },
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
      id: 'candidate-icon', type: 'symbol', source: CANDIDATES,
      layout: {
        'icon-image': AIRPORT, 'icon-allow-overlap': true, 'icon-ignore-placement': true,
        // Image is 96px: 14px on the world view so a country's icons don't merge, growing as you zoom in.
        'icon-size': ['interpolate', ['exponential', 1.5], ['zoom'], 1, 0.15, 4, 0.3, 7, 0.6, 10, 1],
      },
    },
    {
      id: 'domestic-dot', type: 'circle', source: DOMESTIC,
      paint: {
        'circle-color': DOMESTIC_COLOR, 'circle-radius': ['get', 'r'],
        'circle-stroke-color': '#fff', 'circle-stroke-width': 1,
      },
    },
    {
      id: 'ruled-out-dot', type: 'circle', source: RULED_OUT,
      paint: {
        'circle-color': WRONG_RED, 'circle-radius': GUESS_RADIUS,
        'circle-stroke-color': '#fff', 'circle-stroke-width': 1,
      },
    },
    {
      id: 'guess-dot', type: 'circle', source: GUESS,
      paint: {
        // A ticked wrong guess: the same red dot, its edge dark instead of white to show it's being compared.
        'circle-color': WRONG_RED, 'circle-radius': GUESS_RADIUS,
        'circle-stroke-color': '#111827', 'circle-stroke-width': 1.5,
      },
    },
    {
      id: 'origin-dot', type: 'circle', source: ORIGIN,
      paint: {
        // Gold when won, red when given up.
        'circle-color': ['case', ['get', 'won'], '#f5b301', '#dc2626'],
        'circle-radius': ['case', ['get', 'won'], 10, 8],
        'circle-stroke-color': '#fff', 'circle-stroke-width': 2,
      },
    },
  ],
});

const WORLD: LngLatBoundsLike = [[-180, -60], [180, 80]];

export default function MapView(props: Props) {
  const { destinations } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const loadedRef = useRef(false);
  const latest = useRef(props);

  latest.current = props;

  useEffect(() => {
    const map = new maplibregl.Map({
      container: containerRef.current!,
      bounds: WORLD,
      fitBoundsOptions: { padding: 20 },
    });
    map.setStyle(BASEMAP_STYLE, { transformStyle: withRouteLayers });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }));
    mapRef.current = map;
    map.setMissingStyleImageResolver(async (id) => {
      const draw = IMAGES[id];
      const file = IMAGE_FILES[id];
      if (!draw && !file) return;
      const image = draw ? draw() : (await map.loadImage(file)).data;
      if (!map.hasImage(id)) map.addImage(id, image, { pixelRatio: 2 });
    });

    const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 10 });
    for (const layer of ['dest-dot', 'candidate-icon', 'domestic-dot', 'ruled-out-dot', 'guess-dot']) {
      map.on('mousemove', layer, (e) => {
        const index = e.features?.[0]?.properties?.index;
        if (typeof index !== 'number') return;
        const a = airports[index];
        const suffix = layer === 'guess-dot' ? ' (your guess)' : layer === 'ruled-out-dot' ? ' (wrong)' : '';
        popup.setLngLat(a.lngLat).setText(`${a.code} · ${a.city || a.name}${suffix}`).addTo(map);
      });
      map.on('mouseleave', layer, () => popup.remove());
    }
    map.on('click', 'candidate-icon', (e) => {
      const index = e.features?.[0]?.properties?.index;
      if (typeof index === 'number') latest.current.onCandidateClick(airports[index]);
    });
    map.on('mouseenter', 'candidate-icon', () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', 'candidate-icon', () => { map.getCanvas().style.cursor = ''; });

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
      render(map, latest.current);
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
    render(map, props);
  }, [
    props.origin, props.answer, props.destinations, props.compare, props.wrongCountries, props.candidates,
    props.ruledOut, props.domestic, props.won,
  ]);

  useEffect(() => {
    const map = mapRef.current;
    if (map && loadedRef.current) showWorld(map);
  }, [destinations]);

  // Fireworks once per win, above the answer. Waits for the map, which may still be loading.
  const { won, answer } = props;
  useEffect(() => {
    const map = mapRef.current;
    if (!won || !map) return;
    let stop = () => {};
    const start = () => { stop = launchFireworks(map, answer.lngLat); };
    if (loadedRef.current) start();
    else map.once('load', start);
    return () => {
      map.off('load', start);
      stop();
    };
  }, [won, answer]);

  return <div ref={containerRef} className="map" />;
}

function render(
  map: MlMap, { origin, answer, destinations, compare, wrongCountries, candidates, ruledOut, domestic, won }: Props,
) {
  (map.getSource(DESTS) as GeoJSONSource).setData(routeDots(answer, destinations, compare));
  const originDot = origin ? dots([{ airport: origin, r: 8 }]) : empty;
  for (const f of originDot.features) Object.assign(f.properties, { won });
  (map.getSource(ORIGIN) as GeoJSONSource).setData(originDot);
  (map.getSource(GUESS) as GeoJSONSource).setData(dots(compare.map((airport) => ({ airport, r: GUESS_RADIUS }))));
  // A wrong guess or a domestic destination can't be the answer, and the revealed answer has its own dot:
  // their icons give way to those dots.
  const out = new Set([...ruledOut, ...domestic.map((d) => d.airport), ...(origin ? [origin] : [])]);
  (map.getSource(CANDIDATES) as GeoJSONSource).setData(
    dots(candidates.filter((a) => !out.has(a)).map((airport) => ({ airport, r: 0 }))),
  );
  (map.getSource(DOMESTIC) as GeoJSONSource).setData(
    dots(domestic.map((d) => ({ airport: d.airport, r: radius(d.passengers) }))),
  );
  (map.getSource(RULED_OUT) as GeoJSONSource).setData(dots(ruledOut.map((airport) => ({ airport, r: GUESS_RADIUS }))));
  for (const layer of ['wrong-country-hatch', 'wrong-country-border']) map.setFilter(layer, countryFilter(wrongCountries));
}

/** Show the whole world, whatever the airport. */
function showWorld(map: MlMap) {
  map.fitBounds(WORLD, { padding: 20, duration: 1200 });
}
