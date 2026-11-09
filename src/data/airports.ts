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
for (const [a, b, passengers] of data.routes as RouteRow[]) {
  destinations[a].push({ airport: airports[b], passengers });
  destinations[b].push({ airport: airports[a], passengers });
}
for (const list of destinations) list.sort((x, y) => y.passengers - x.passengers);

export function findAirport(code: string): Airport | undefined {
  return byCode.get(code.trim().toUpperCase());
}

/** Airports reachable by a direct flight, busiest route first. */
export function destinationsFrom(airport: Airport): Destination[] {
  return destinations[airport.index];
}
