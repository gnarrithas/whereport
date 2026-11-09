import { areNeighbors, type CountryId } from '../data/countries';

export type GameState =
  | { phase: 'menu' }
  | { phase: 'playing'; target: CountryId }
  | { phase: 'confirming'; target: CountryId; pending: CountryId }
  | { phase: 'result'; target: CountryId; guess: CountryId; correct: boolean; neighbor: boolean };

export type GameAction =
  | { type: 'newGame'; target: CountryId }
  | { type: 'select'; country: CountryId }
  | { type: 'cancel' }
  | { type: 'lockIn' }
  | { type: 'menu' };

export const initialState: GameState = { phase: 'menu' };

export function gameReducer(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case 'newGame':
      return { phase: 'playing', target: action.target };
    case 'select':
      if (state.phase !== 'playing' && state.phase !== 'confirming') return state;
      return { phase: 'confirming', target: state.target, pending: action.country };
    case 'cancel':
      if (state.phase !== 'confirming') return state;
      return { phase: 'playing', target: state.target };
    case 'lockIn': {
      if (state.phase !== 'confirming') return state;
      const { target, pending: guess } = state;
      return {
        phase: 'result',
        target,
        guess,
        correct: guess === target,
        neighbor: areNeighbors(guess, target),
      };
    }
    case 'menu':
      return initialState;
  }
}
