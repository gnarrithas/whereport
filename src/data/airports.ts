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
  /** Passengers per year on the route, both directions combined (0 when unknown). */
  passengers: number;
}

type AirportRow = [string, string, string, string, number, number];
type RouteRow = [number, number, number];

export const datasetDate: string = data.routes_as_of || data.built;

export const airports: Airport[] = (data.airports as AirportRow[]).map(
  ([code, name, city, country, lon, lat], index) => ({ index, code, name, city, country, lngLat: [lon, lat] }),
);

const byCode = new Map(airports.map((a) => [a.code, a]));

const destinations: Destination[][] = airports.map(() => []);
// Only international routes: domestic flights (both ends in one country) are left out.
for (const [a, b, passengers] of data.routes as RouteRow[]) {
  if (airports[a].country === airports[b].country) continue;
  destinations[a].push({ airport: airports[b], passengers });
  destinations[b].push({ airport: airports[a], passengers });
}
for (const list of destinations) list.sort((x, y) => y.passengers - x.passengers);

export function findAirport(code: string): Airport | undefined {
  return byCode.get(code.trim().toUpperCase());
}

/** Foreign airports reachable by a direct flight, busiest route first. */
export function destinationsFrom(airport: Airport): Destination[] {
  return destinations[airport.index];
}

/** Airports with enough international routes to make a fair puzzle. */
const MIN_DESTINATIONS = 10;
const playable = airports.filter((a) => destinations[a.index].length >= MIN_DESTINATIONS);

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
