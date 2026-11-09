import data from './airports.json';

export interface Airport {
  index: number;
  code: string;
  name: string;
  city: string;
  country: string;
  lngLat: [number, number];
}

export interface Destination {
  airport: Airport;
  /** Passengers per year flown from the origin to this destination. */
  passengers: number;
}

type AirportRow = [string, string, string, string, number, number];
type DestinationRow = [number, number];

export const datasetDate: string = data.routes_as_of || data.built;

export const airports: Airport[] = (data.airports as AirportRow[]).map(
  ([code, name, city, country, lon, lat], index) => ({ index, code, name, city, country, lngLat: [lon, lat] }),
);

const byCode = new Map(airports.map((a) => [a.code, a]));

// Built offline by scripts/build_airports.py: foreign destinations flown to directly, busiest first.
const destinations: Destination[][] = (data.destinations as DestinationRow[][]).map((rows) =>
  rows.map(([index, passengers]) => ({ airport: airports[index], passengers })),
);

export function findAirport(code: string): Airport | undefined {
  return byCode.get(code.trim().toUpperCase());
}

/** Foreign airports reachable by a direct flight, busiest route first. */
export function destinationsFrom(airport: Airport): Destination[] {
  return destinations[airport.index];
}

/** Airports whose destinations identify them unambiguously, chosen offline by scripts/build_airports.py. */
const unique: Airport[] = (data.unique as number[]).map((index) => airports[index]);

/** Fewest destinations an airport needs to make a fair puzzle. */
const MIN_DESTINATIONS = 4;
const playable = unique.filter((a) => destinations[a.index].length >= MIN_DESTINATIONS);

export function randomAirport(exclude?: Airport): Airport {
  const pool = exclude ? playable.filter((a) => a !== exclude) : playable;
  return pool[Math.floor(Math.random() * pool.length)];
}

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const searchText = airports.map((a) => ({ code: a.code.toLowerCase(), city: fold(a.city), name: fold(a.name) }));

/** Airports matching free text by code, city or name; best matches first. */
export function searchAirports(query: string, limit = 8): Airport[] {
  const q = fold(query.trim());
  if (!q) return [];
  const scored: { airport: Airport; score: number }[] = [];
  for (const a of airports) {
    const t = searchText[a.index];
    const score =
      t.code === q ? 0
      : t.city.startsWith(q) ? 1
      : t.name.startsWith(q) ? 2
      : t.city.includes(q) || t.name.includes(q) ? 3
      : -1;
    if (score >= 0) scored.push({ airport: a, score });
  }
  scored.sort(
    (x, y) => x.score - y.score
      || destinations[y.airport.index].length - destinations[x.airport.index].length,
  );
  return scored.slice(0, limit).map((s) => s.airport);
}
