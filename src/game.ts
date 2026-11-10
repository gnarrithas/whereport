import { countries, findAirport, type Airport, type Country } from './data/airports';
import { MARKS, type Mark } from './share';

/** A player's move: what gets saved, replayed and shared. Airports and countries by code. */
export type Move =
  | { kind: 'airport'; code: string }
  | { kind: 'country'; code: string }
  | { kind: 'hint' }
  | { kind: 'give-up' };

export type Feedback =
  | { kind: 'wrong'; guess: Airport }
  | { kind: 'wrong-country'; guess: Country }
  | { kind: 'right-country' }
  | { kind: 'correct' }
  | { kind: 'revealed' }
  | null;

/** Everything the moves decide; the answer bar, dropdowns and diff ticks are the UI's own. */
export interface Game {
  moves: Move[];
  feedback: Feedback;
  countryKnown: boolean;
  wrongGuesses: Airport[];
  wrongCountries: string[];
  domesticShown: boolean;
}

export const newGame = (): Game => ({
  moves: [],
  feedback: null,
  countryKnown: false,
  wrongGuesses: [],
  wrongCountries: [],
  domesticShown: false,
});

export const isOver = (game: Game) => game.feedback?.kind === 'correct' || game.feedback?.kind === 'revealed';

/** Airport and country guesses made, hints and giving up aside. */
export const guessCount = (game: Game) =>
  game.moves.filter((m) => m.kind === 'airport' || m.kind === 'country').length;

const countryByCode = new Map(countries.map((c) => [c.code, c]));

/** The game after one more move; null for a move that can't be made (unknown code, or the game is over). */
export function play(game: Game, move: Move, target: Airport): Game | null {
  if (isOver(game)) return null;
  const moves = [...game.moves, move];
  switch (move.kind) {
    case 'airport': {
      const airport = findAirport(move.code);
      if (!airport) return null;
      if (airport === target) return { ...game, moves, feedback: { kind: 'correct' } };
      const wrongGuesses = game.wrongGuesses.includes(airport) ? game.wrongGuesses : [...game.wrongGuesses, airport];
      return { ...game, moves, wrongGuesses, feedback: { kind: 'wrong', guess: airport } };
    }
    case 'country': {
      const country = countryByCode.get(move.code);
      if (!country) return null;
      if (country.code === target.country) {
        return { ...game, moves, countryKnown: true, feedback: { kind: 'right-country' } };
      }
      const wrongCountries = game.wrongCountries.includes(country.code)
        ? game.wrongCountries
        : [...game.wrongCountries, country.code];
      return { ...game, moves, wrongCountries, feedback: { kind: 'wrong-country', guess: country } };
    }
    case 'hint':
      return game.countryKnown && !game.domesticShown ? { ...game, moves, domesticShown: true } : null;
    case 'give-up':
      return { ...game, moves, feedback: { kind: 'revealed' } };
  }
}

/** One emoji per move, for sharing. */
export function markOf(move: Move, target: Airport): Mark {
  switch (move.kind) {
    case 'airport':
      return move.code === target.code ? MARKS.rightAirport : MARKS.wrongAirport;
    case 'country':
      return move.code === target.country ? MARKS.rightCountry : MARKS.wrongCountry;
    case 'hint':
      return MARKS.domesticHint;
    case 'give-up':
      return MARKS.gaveUp;
  }
}

// One saved game at a time: today's. Another day's or another airport's (a new deploy) is ignored.
const STORAGE_KEY = 'whereport:daily';

interface Saved {
  day: number;
  airport: string;
  moves: Move[];
}

const isMove = (m: unknown): m is Move => {
  if (typeof m !== 'object' || m === null) return false;
  const { kind, code } = m as { kind?: unknown; code?: unknown };
  if (kind === 'airport' || kind === 'country') return typeof code === 'string';
  return kind === 'hint' || kind === 'give-up';
};

/** Today's game as saved, replayed from its moves; a new game when there is none or it can't be read. */
export function loadDailyGame(day: number, target: Airport): Game {
  let game = newGame();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return game;
    const saved = JSON.parse(raw) as Partial<Saved>;
    if (saved.day !== day || saved.airport !== target.code || !Array.isArray(saved.moves)) return game;
    for (const move of saved.moves) {
      // Stops at the first move that no longer fits, keeping the game up to there.
      const next = isMove(move) ? play(game, move, target) : null;
      if (!next) break;
      game = next;
    }
  } catch (err) {
    console.warn('Ignoring the saved game', err);
  }
  return game;
}

export function saveDailyGame(day: number, target: Airport, game: Game) {
  const saved: Saved = { day, airport: target.code, moves: game.moves };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
  } catch (err) {
    // Private browsing or a full quota: the game goes on, unsaved.
    console.warn('Could not save the game', err);
  }
}
