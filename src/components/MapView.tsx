import { useEffect, useRef } from 'react';
import * as maplibregl from 'maplibre-gl';
import type { LngLatBoundsLike, Map as MlMap } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { countries, countryFeatures, type CountryId } from '../data/countries';

// Vite pre-bundling breaks MapLibre's import.meta.url worker lookup; point it at the worker explicitly.
maplibregl.setWorkerUrl(workerUrl);

export type Highlight = 'pending' | 'correct' | 'wrong' | 'target';

interface Props {
  interactive: boolean;
  highlights: Partial<Record<CountryId, Highlight>>;
  /** Countries to frame when this changes; empty leaves the camera alone. */
  focus: CountryId[];
  /** Country to pin with a marker (helps spot tiny countries); null for none. */
  marker: CountryId | null;
  onCountryClick: (id: CountryId) => void;
}

const SOURCE = 'countries';
const HIGHLIGHT_KEYS: Highlight[] = ['pending', 'correct', 'wrong', 'target'];

const BASEMAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';
/** Basemap label layers that would give the answer away. */
const HIDDEN_LAYER = /^label_country_/;

const fillColor = [
  'case',
  ['boolean', ['feature-state', 'correct'], false], '#2e9e4f',
  ['boolean', ['feature-state', 'wrong'], false], '#d64545',
  ['boolean', ['feature-state', 'target'], false], '#2e9e4f',
  ['boolean', ['feature-state', 'pending'], false], '#f0b429',
  '#3b6fd8',
] as unknown as maplibregl.ExpressionSpecification;

// Unhighlighted countries stay fully transparent (still clickable) so the basemap shows through.
const fillOpacity = [
  'case',
  ['any',
    ['boolean', ['feature-state', 'correct'], false],
    ['boolean', ['feature-state', 'wrong'], false],
    ['boolean', ['feature-state', 'target'], false],
    ['boolean', ['feature-state', 'pending'], false]], 0.5,
  ['boolean', ['feature-state', 'hover'], false], 0.2,
  0,
] as unknown as maplibregl.ExpressionSpecification;

/** Basemap plus the game's country layer, inserted below the labels. */
const withCountryLayer: maplibregl.TransformStyleFunction = (_previous, next) => {
  const layers = next.layers.filter((l) => !HIDDEN_LAYER.test(l.id));
  const firstSymbol = layers.findIndex((l) => l.type === 'symbol');
  const at = firstSymbol === -1 ? layers.length : firstSymbol;
  layers.splice(at, 0, {
    id: 'country-fill', type: 'fill', source: SOURCE,
    paint: { 'fill-color': fillColor, 'fill-opacity': fillOpacity },
  });
  return {
    ...next,
    sources: { ...next.sources, [SOURCE]: { type: 'geojson', data: countryFeatures } },
    layers,
  };
};

export default function MapView({ interactive, highlights, focus, marker, onCountryClick }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const loadedRef = useRef(false);
  const interactiveRef = useRef(interactive);
  const clickRef = useRef(onCountryClick);
  const appliedRef = useRef<Partial<Record<CountryId, Highlight>>>({});

  interactiveRef.current = interactive;
  clickRef.current = onCountryClick;

  useEffect(() => {
    const map = new maplibregl.Map({
      container: containerRef.current!,
      center: [15, 30],
      zoom: 1.6,
      renderWorldCopies: false,
    });
    map.setStyle(BASEMAP_STYLE, { transformStyle: withCountryLayer });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }));
    mapRef.current = map;

    let hovered: CountryId | null = null;
    const setHover = (id: CountryId | null) => {
      if (hovered !== null) map.setFeatureState({ source: SOURCE, id: hovered }, { hover: false });
      hovered = id;
      if (id !== null) map.setFeatureState({ source: SOURCE, id }, { hover: true });
      map.getCanvas().style.cursor = id !== null ? 'pointer' : '';
    };

    map.on('mousemove', 'country-fill', (e) => {
      if (!interactiveRef.current) return setHover(null);
      const id = e.features?.[0]?.id;
      setHover(typeof id === 'number' ? id : null);
    });
    map.on('mouseleave', 'country-fill', () => setHover(null));
    map.on('click', 'country-fill', (e) => {
      const id = e.features?.[0]?.id;
      if (interactiveRef.current && typeof id === 'number') clickRef.current(id);
    });
    map.on('load', () => {
      loadedRef.current = true;
      applyHighlights(map, appliedRef, latestHighlights.current);
    });

    return () => {
      loadedRef.current = false;
      appliedRef.current = {};
      map.remove();
      mapRef.current = null;
    };
  }, []);

  const latestHighlights = useRef(highlights);
  latestHighlights.current = highlights;

  useEffect(() => {
    const map = mapRef.current;
    if (map && loadedRef.current) applyHighlights(map, appliedRef, highlights);
    if (!interactive && map && loadedRef.current) {
      map.getCanvas().style.cursor = '';
    }
  }, [highlights, interactive]);

  const focusKey = focus.join(',');
  useEffect(() => {
    const map = mapRef.current;
    if (!map || focus.length === 0) return;
    const [w, s, e, n] = focus
      .map((id) => countries[id].bbox)
      .reduce((a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])]);
    const bounds: LngLatBoundsLike = [[w, Math.max(s, -80)], [e, Math.min(n, 85)]];
    map.fitBounds(bounds, { padding: 120, maxZoom: 5, duration: 1200 });
  }, [focusKey]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || marker === null) return;
    const m = new maplibregl.Marker({ color: '#2e9e4f' }).setLngLat(countries[marker].anchor).addTo(map);
    return () => {
      m.remove();
    };
  }, [marker]);

  return <div ref={containerRef} className="map" />;
}

function applyHighlights(
  map: MlMap,
  appliedRef: React.MutableRefObject<Partial<Record<CountryId, Highlight>>>,
  next: Partial<Record<CountryId, Highlight>>,
) {
  const cleared = Object.fromEntries(HIGHLIGHT_KEYS.map((k) => [k, false]));
  for (const id of Object.keys(appliedRef.current)) {
    map.setFeatureState({ source: SOURCE, id: Number(id) }, cleared);
  }
  for (const [id, kind] of Object.entries(next)) {
    if (kind) map.setFeatureState({ source: SOURCE, id: Number(id) }, { [kind]: true });
  }
  appliedRef.current = { ...next };
}
