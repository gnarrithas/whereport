import { useCallback, useMemo, useReducer } from 'react';
import MapView, { type Highlight } from './components/MapView';
import Menu from './components/Menu';
import ConfirmDialog from './components/ConfirmDialog';
import ResultPanel from './components/ResultPanel';
import { countries, randomTarget, type CountryId } from './data/countries';
import { gameReducer, initialState } from './game/state';

export default function App() {
  const [state, dispatch] = useReducer(gameReducer, initialState);

  const newGame = useCallback(() => dispatch({ type: 'newGame', target: randomTarget() }), []);
  const select = useCallback((country: CountryId) => dispatch({ type: 'select', country }), []);

  const highlights = useMemo((): Partial<Record<CountryId, Highlight>> => {
    switch (state.phase) {
      case 'confirming':
        return { [state.pending]: 'pending' };
      case 'result':
        return state.correct
          ? { [state.guess]: 'correct' }
          : { [state.target]: 'target', [state.guess]: 'wrong' };
      default:
        return {};
    }
  }, [state]);

  const focus = useMemo(
    () => (state.phase === 'result' ? [state.guess, state.target] : []),
    [state],
  );

  const interactive = state.phase === 'playing' || state.phase === 'confirming';

  return (
    <div className="app">
      <MapView
        interactive={interactive} highlights={highlights} focus={focus}
        marker={state.phase === 'result' && !state.correct ? state.target : null}
        onCountryClick={select}
      />

      {state.phase !== 'menu' && (
        <div className="card hud">
          Find: <strong>{countries[state.target].name}</strong>
        </div>
      )}

      {state.phase === 'menu' && <Menu onNewGame={newGame} />}

      {state.phase === 'confirming' && (
        <ConfirmDialog
          countryName={countries[state.pending].name}
          onConfirm={() => dispatch({ type: 'lockIn' })}
          onCancel={() => dispatch({ type: 'cancel' })}
        />
      )}

      {state.phase === 'result' && (
        <ResultPanel
          correct={state.correct}
          neighbor={state.neighbor}
          guessName={countries[state.guess].name}
          targetName={countries[state.target].name}
          onNewGame={newGame}
          onMenu={() => dispatch({ type: 'menu' })}
        />
      )}
    </div>
  );
}
