import { feature, neighbors } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';
import type { Feature, FeatureCollection, MultiPolygon, Polygon, Position } from 'geojson';
import world from 'world-atlas/countries-50m.json';
import { splitAntimeridian } from './antimeridian';

export type CountryId = number;

export interface CountryProps {
  id: CountryId;
  name: string;
}

export type CountryFeature = Feature<Polygon | MultiPolygon, CountryProps>;

export interface Country {
  id: CountryId;
  name: string;
  /** Countries sharing a land border (computed from shared TopoJSON arcs). */
  neighbors: Set<CountryId>;
  /** [west, south, east, north] */
  bbox: [number, number, number, number];
  /** Center of the country's largest polygon; a marker spot that avoids antimeridian/overseas skew. */
  anchor: [number, number];
}

/** Features that exist in the dataset but make poor guessing targets. */
const NON_TARGETS = new Set(['Siachen Glacier', 'Indian Ocean Ter.', 'Ashmore and Cartier Is.']);

const topology = world as unknown as Topology<{ countries: GeometryCollection<{ name: string }> }>;
const geometries = topology.objects.countries.geometries;

function computeBbox(f: Feature<Polygon | MultiPolygon>): Country['bbox'] {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  const polys: Position[][][] = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  for (const poly of polys) {
    for (const [x, y] of poly[0]) {
      if (x < w) w = x;
      if (x > e) e = x;
      if (y < s) s = y;
      if (y > n) n = y;
    }
  }
  return [w, s, e, n];
}

function ringArea(ring: Position[]): number {
  let a = 0;
  for (let i = 1; i < ring.length; i++) a += ring[i - 1][0] * ring[i][1] - ring[i][0] * ring[i - 1][1];
  return Math.abs(a / 2);
}

function computeAnchor(f: Feature<Polygon | MultiPolygon>): Country['anchor'] {
  const polys: Position[][][] = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  const largest = polys.reduce((a, b) => (ringArea(b[0]) > ringArea(a[0]) ? b : a));
  const [w, s, e, n] = computeBbox({ ...f, geometry: { type: 'Polygon', coordinates: largest } });
  return [(w + e) / 2, (s + n) / 2];
}

// Ids are array indices: world-atlas lacks ISO codes for some features (e.g. Kosovo).
export const countryFeatures: FeatureCollection<Polygon | MultiPolygon, CountryProps> = {
  type: 'FeatureCollection',
  features: geometries.map((g, i) => {
    const f = feature(topology, g) as Feature<Polygon | MultiPolygon, { name: string }>;
    return { ...f, geometry: splitAntimeridian(f.geometry), id: i, properties: { id: i, name: (g.properties as { name: string }).name } };
  }),
};

const neighborIndex = neighbors(geometries);

export const countries: Country[] = countryFeatures.features.map((f, i) => ({
  id: i,
  name: f.properties.name,
  neighbors: new Set(neighborIndex[i]),
  bbox: computeBbox(f),
  anchor: computeAnchor(f),
}));

export const targetPool: CountryId[] = countries
  .filter((c) => !NON_TARGETS.has(c.name))
  .map((c) => c.id);

export function randomTarget(): CountryId {
  return targetPool[Math.floor(Math.random() * targetPool.length)];
}

export function areNeighbors(a: CountryId, b: CountryId): boolean {
  return countries[a].neighbors.has(b);
}
