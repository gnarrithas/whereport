import { DEV_MODE } from '../mode';
import { findAirport, isPlayable, playable, type Airport } from './airports';

const MS_IN_DAY = 86400000;
// Day 0 of the daily sequence: 10 November 2026 (months count from 0). Must
// match FIRST_DAY in scripts/shuffle_airports.py.
const FIRST_DAY_UTC = Date.UTC(2026, 10, 10);

/**
 * Today's day number, from the earlier of the local and UTC dates: the deploy
 * publishes a day only once it has started in UTC. Clamped to the published days.
 */
export function dayIndex(published: number, now = new Date()): number {
  const local = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const utc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const day = Math.round((Math.min(local, utc) - FIRST_DAY_UTC) / MS_IN_DAY);
  return Math.min(Math.max(0, day), published - 1);
}

/** Line N is day N's airport code; deploys publish it daily, up to today (UTC) only. */
function parseDaily(text: string): Airport[] {
  const daily = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((code) => findAirport(code));
  // Also rejects an HTML page served in place of a missing file.
  if (daily.length === 0 || !daily.every((a): a is Airport => a !== undefined && isPlayable(a))) {
    throw new Error('The daily list is empty or not made of playable airports');
  }
  return daily as Airport[];
}

export interface Daily {
  airport: Airport;
  /** Day index, 0 on FIRST_DAY_UTC. */
  day: number;
}

/**
 * Today's airport. Production fetches the list the deploy wrote with the secret
 * seed; development, which has none, walks the playable airports in order.
 */
export async function loadDailyAirport(): Promise<Daily> {
  if (DEV_MODE) {
    const day = dayIndex(Infinity);
    return { airport: playable[day % playable.length], day };
  }
  const response = await fetch(`${import.meta.env.BASE_URL}daily.txt`, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`GET daily.txt failed: ${response.status}`);
  const daily = parseDaily(await response.text());
  const day = dayIndex(daily.length);
  return { airport: daily[day], day };
}
