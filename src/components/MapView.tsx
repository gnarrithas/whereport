import { useEffect, useRef } from 'react';
import * as maplibregl from 'maplibre-gl';
import type { GeoJSONSource, LngLatBoundsLike, Map as MlMap } from 'maplibre-gl';
import type { FeatureCollection, LineString, Point } from 'geojson';
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
  /** Dev mode only: the answer, peeked at mid-game as a faint airport icon; else null. */
  peek: Airport | null;
  /** Tint each destination's country with its dots' colour, much fainter. */
  highlightCountries: boolean;
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
/** Destination countries' tint, fainter than the dots. Grey shows less on the land colour, so it isn't scaled down as much as its dots. */
const COUNTRY_OPACITY = 0.35;
const EXTRA_COUNTRY_OPACITY = 0.3;
/** A country with dots of several kinds takes the first: what sets the answer apart from the guesses wins. */
const COUNTRY_KIND_ORDER: DotKind[] = ['missing', 'partial', 'shared', 'extra'];

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
const ROUTES = 'routes';
const PEEK = 'peek';
const ARC_STEPS = 48;
const DOMESTIC_COLOR = '#9333ea';
/** Wrong guesses are drawn mid-sized among the destination dots (3–7px). */
const GUESS_RADIUS = 5;
// Not plain 'airport': the basemap's sprite already has an image by that name.
const AIRPORT = 'daily-map-airport';
/** Airport icons (96px image at pixel ratio 2): on the world view just a bit larger than a destination dot, growing as you zoom in. */
const AIRPORT_ICON_SIZE: maplibregl.ExpressionSpecification =
  ['interpolate', ['exponential', 1.5], ['zoom'], 1, 0.2, 4, 0.35, 7, 0.6, 10, 1];
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

/**
 * The great-circle path from a to b as [lng, lat] points. Longitudes are unwrapped (they may pass ±180) so a
 * route across the antimeridian is drawn the short way rather than across the whole map.
 */
function arc(a: [number, number], b: [number, number]): [number, number][] {
  const rad = Math.PI / 180;
  const toVec = ([lng, lat]: [number, number]) =>
    [Math.cos(lat * rad) * Math.cos(lng * rad), Math.cos(lat * rad) * Math.sin(lng * rad), Math.sin(lat * rad)];
  const p = toVec(a);
  const q = toVec(b);
  const angle = Math.acos(Math.min(1, Math.max(-1, p[0] * q[0] + p[1] * q[1] + p[2] * q[2])));
  if (angle < 1e-9) return [a, b];
  const points: [number, number][] = [];
  let prevLng = a[0];
  for (let i = 0; i <= ARC_STEPS; i++) {
    const t = i / ARC_STEPS;
    const ka = Math.sin((1 - t) * angle) / Math.sin(angle);
    const kb = Math.sin(t * angle) / Math.sin(angle);
    const [x, y, z] = [0, 1, 2].map((k) => ka * p[k] + kb * q[k]);
    let lng = Math.atan2(y, x) / rad;
    // Keep each step within 180° of the last, so the line never jumps across the map.
    lng += Math.round((prevLng - lng) / 360) * 360;
    prevLng = lng;
    points.push([lng, Math.atan2(z, Math.hypot(x, y)) / rad]);
  }
  return points;
}

/** Lines from the revealed answer to each of its destinations, marked domestic or not for their colour. */
function routeLines(origin: Airport, destinations: Destination[], domestic: Destination[]) {
  const lines: FeatureCollection<LineString, { domestic: boolean }> = {
    type: 'FeatureCollection',
    features: [...destinations.map((d) => [d, false] as const), ...domestic.map((d) => [d, true] as const)]
      .map(([d, isDomestic]) => ({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: arc(origin.lngLat, d.airport.lngLat) },
        properties: { domestic: isDomestic },
      })),
  };
  return lines;
}

/** Busier routes get bigger dots: 3px for the quietest up to 7px. */
function radius(passengers: number): number {
  return 3 + Math.min(4, Math.log10(Math.max(passengers, 1)) * 0.6);
}

/** Only the given countries' shapes, as a layer filter. */
/** Each destination country's colour and opacity, from the kinds of dots in it. */
function countryTint(features: FeatureCollection<Point, DotProps>['features']) {
  const kinds = new Map<string, DotKind>();
  for (const { properties: { index, kind } } of features) {
    const code = airports[index].country;
    const seen = kinds.get(code);
    if (!seen || COUNTRY_KIND_ORDER.indexOf(kind) < COUNTRY_KIND_ORDER.indexOf(seen)) kinds.set(code, kind);
  }
  // A match expression needs at least one case; with none, the filter hides every country anyway.
  if (!kinds.size) return { codes: [], color: DOT_COLORS.missing, opacity: 0 };
  const cases = <T,>(value: (kind: DotKind) => T) => [...kinds].flatMap(([code, kind]) => [code, value(kind)]);
  return {
    codes: [...kinds.keys()],
    color: ['match', ['get', 'code'], ...cases((k) => DOT_COLORS[k]), DOT_COLORS.missing] as unknown as maplibregl.ExpressionSpecification,
    opacity: ['match', ['get', 'code'],
      ...cases((k) => (k === 'extra' ? EXTRA_COUNTRY_OPACITY : COUNTRY_OPACITY)), COUNTRY_OPACITY,
    ] as unknown as maplibregl.ExpressionSpecification,
  };
}

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
    [ROUTES]: { type: 'geojson', data: empty },
    [PEEK]: { type: 'geojson', data: empty },
  },
  layers: [
    ...next.layers,
    {
      // Under the wrong-country hatching, so a ruled-out country still reads as ruled out.
      id: 'dest-country', type: 'fill', source: COUNTRIES, filter: countryFilter([]),
      paint: { 'fill-opacity': 0 },
    },
    {
      id: 'wrong-country-hatch', type: 'fill', source: COUNTRIES, filter: countryFilter([]),
      paint: { 'fill-pattern': HATCH },
    },
    {
      id: 'wrong-country-border', type: 'line', source: COUNTRIES, filter: countryFilter([]),
      paint: { 'line-color': WRONG_RED, 'line-width': 2 },
    },
    {
      // Under all the dots, so lines end at their edges.
      id: 'route-line', type: 'line', source: ROUTES,
      layout: { 'line-cap': 'round' },
      paint: {
        'line-color': ['case', ['get', 'domestic'], DOMESTIC_COLOR, DOT_COLORS.missing],
        'line-width': 1.4, 'line-opacity': 0.55,
      },
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
        'icon-size': AIRPORT_ICON_SIZE,
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
      // Dev mode's peek at the answer: 60% transparent, above everything but the revealed answer.
      id: 'peek-icon', type: 'symbol', source: PEEK,
      layout: {
        'icon-image': AIRPORT, 'icon-allow-overlap': true, 'icon-ignore-placement': true,
        'icon-size': AIRPORT_ICON_SIZE,
      },
      paint: { 'icon-opacity': 0.4 },
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
    props.ruledOut, props.domestic, props.won, props.peek, props.highlightCountries,
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
  map: MlMap, { origin, answer, destinations, compare, wrongCountries, candidates, ruledOut, domestic, won, peek, highlightCountries }: Props,
) {
  const routes = routeDots(answer, destinations, compare);
  (map.getSource(DESTS) as GeoJSONSource).setData(routes);
  const tint = countryTint(highlightCountries ? routes.features : []);
  map.setFilter('dest-country', countryFilter(tint.codes));
  map.setPaintProperty('dest-country', 'fill-color', tint.color);
  map.setPaintProperty('dest-country', 'fill-opacity', tint.opacity);
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
  // Once the answer is revealed its own dot takes over.
  (map.getSource(PEEK) as GeoJSONSource).setData(peek && !origin ? dots([{ airport: peek, r: 0 }]) : empty);
  (map.getSource(ROUTES) as GeoJSONSource).setData(origin ? routeLines(origin, destinations, domestic) : empty);
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
