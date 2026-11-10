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

const domestic: Destination[][] = (data.domestic as DestinationRow[][]).map((rows) =>
  rows.map(([index, passengers]) => ({ airport: airports[index], passengers })),
);

/** Same-country airports reachable by a direct flight that could themselves be an answer, busiest first. */
export function domesticFrom(airport: Airport): Destination[] {
  return domestic[airport.index];
}

/** Airports whose destinations identify them unambiguously, chosen offline by scripts/build_airports.py. */
const unique: Airport[] = (data.unique as number[]).map((index) => airports[index]);

/** Fewest destinations an airport needs to make a fair puzzle. Must match scripts/shuffle_airports.py. */
const MIN_DESTINATIONS = 4;
export const playable = unique.filter((a) => destinations[a.index].length >= MIN_DESTINATIONS);
const playableSet = new Set(playable);

/** Whether the airport could be a puzzle's answer. */
export function isPlayable(airport: Airport): boolean {
  return playableSet.has(airport);
}

/** Airports in a country that could be a puzzle's answer. */
export function playableIn(country: string): Airport[] {
  return playable.filter((a) => a.country === country);
}

export function randomAirport(exclude?: Airport): Airport {
  const pool = exclude ? playable.filter((a) => a !== exclude) : playable;
  return pool[Math.floor(Math.random() * pool.length)];
}

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const searchText = airports.map((a) => ({ code: a.code.toLowerCase(), city: fold(a.city), name: fold(a.name) }));

/** Airports matching free text by code, city or name; best matches first. Optionally limited to one country. */
/** Best matches for a typed query among the given airports (all of them by default). */
export function searchAirports(query: string, pool: Airport[] = airports, limit = 8): Airport[] {
  const q = fold(query.trim());
  if (!q) return [];
  const scored: { airport: Airport; score: number }[] = [];
  for (const a of pool) {
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

export interface Country {
  code: string;
  name: string;
}

const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });

export function countryName(code: string): string {
  try {
    return regionNames.of(code) ?? code;
  } catch {
    return code;
  }
}

/** Countries that have at least one airport in the dataset, alphabetically. */
export const countries: Country[] = [...new Set(airports.map((a) => a.country).filter(Boolean))]
  .map((code) => ({ code, name: countryName(code) }))
  .sort((x, y) => x.name.localeCompare(y.name));

const countryText = countries.map((c) => ({ code: c.code.toLowerCase(), name: fold(c.name) }));

/** Countries matching free text by ISO code or name; best matches first. */
export function searchCountries(query: string, limit = 8): Country[] {
  const q = fold(query.trim());
  if (!q) return [];
  const scored: { country: Country; score: number }[] = [];
  countries.forEach((c, i) => {
    const t = countryText[i];
    const score = t.code === q ? 0 : t.name.startsWith(q) ? 1 : t.name.includes(q) ? 2 : -1;
    if (score >= 0) scored.push({ country: c, score });
  });
  scored.sort((x, y) => x.score - y.score || x.country.name.localeCompare(y.country.name));
  return scored.slice(0, limit).map((s) => s.country);
}
