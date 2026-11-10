import { useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type Ref } from 'react';
import '@fontsource/fredoka/700.css';
import MapView, { DOT_COLORS } from './components/MapView';
import {
  countryName,
  datasetDate,
  destinationsFrom,
  playableIn,
  randomAirport,
  searchAirports,
  searchCountries,
  type Airport,
  type Country,
} from './data/airports';

type Feedback =
  | { kind: 'wrong'; guess: Airport }
  | { kind: 'wrong-country'; guess: Country }
  | { kind: 'right-country' }
  | { kind: 'correct' }
  | { kind: 'revealed' }
  | null;

type Mode = 'airport' | 'country';

const label = (a: Airport) => `${a.city || a.name} — ${a.name} (${a.code})`;

interface ComboProps<T> {
  matches: T[];
  query: string;
  onQuery: (q: string) => void;
  onPick: (item: T) => void;
  keyOf: (item: T) => string;
  render: (item: T) => ReactNode;
  placeholder: string;
  ariaLabel: string;
  /** Enter with no dropdown choice to make, e.g. to send an airport filled in from the map. */
  onSubmit?: () => void;
  inputRef?: Ref<HTMLInputElement>;
}

function Combo<T>({
  matches, query, onQuery, onPick, keyOf, render, placeholder, ariaLabel, onSubmit, inputRef,
}: ComboProps<T>) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const pick = (item: T) => {
    setOpen(false);
    onPick(item);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !(open && matches.length) && onSubmit) {
      e.preventDefault();
      onSubmit();
      return;
    }
    if (!matches.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((i) => (i + 1) % matches.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (i - 1 + matches.length) % matches.length);
    } else if (e.key === 'Enter' && open) {
      e.preventDefault();
      pick(matches[Math.min(active, matches.length - 1)]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div className="combo">
      <input
        ref={inputRef}
        value={query}
        onChange={(e) => { onQuery(e.target.value); setActive(0); setOpen(true); }}
        onKeyDown={onKeyDown}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        placeholder={placeholder}
        autoFocus
        spellCheck={false}
        role="combobox"
        aria-expanded={open && matches.length > 0}
        aria-controls="guess-options"
        aria-label={ariaLabel}
      />
      {open && matches.length > 0 && (
        <ul id="guess-options" className="options" role="listbox">
          {matches.map((item, i) => (
            <li
              key={keyOf(item)}
              role="option"
              aria-selected={i === active}
              className={i === active ? 'active' : undefined}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => { e.preventDefault(); pick(item); }}
            >
              {render(item)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function App() {
  const [target, setTarget] = useState(() => randomAirport());
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [attempts, setAttempts] = useState(0);
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<Mode>('airport');
  const [countryKnown, setCountryKnown] = useState(false);
  const [wrongGuesses, setWrongGuesses] = useState<Airport[]>([]);
  const [wrongCountries, setWrongCountries] = useState<string[]>([]);
  const [diff, setDiff] = useState<Airport[]>([]);
  /** An airport clicked on the map, filled into the answer bar and waiting for Enter or Guess. */
  const [pending, setPending] = useState<Airport | null>(null);
  const answerRef = useRef<HTMLInputElement>(null);

  const destinations = useMemo(() => destinationsFrom(target), [target]);
  // Once the country is known, the map marks and the dropdown offers only the airports that could be the answer.
  const candidates = useMemo(
    () => (countryKnown ? playableIn(target.country) : []),
    [countryKnown, target],
  );
  const airportMatches = useMemo(
    () => searchAirports(query, countryKnown ? candidates : undefined),
    [query, countryKnown, candidates],
  );
  const countryMatches = useMemo(() => searchCountries(query), [query]);
  const done = feedback?.kind === 'correct' || feedback?.kind === 'revealed';
  const targetCountry = countryName(target.country);

  const switchMode = (m: Mode) => {
    setMode(m);
    setQuery('');
  };

  const guessAirport = (airport: Airport) => {
    setQuery('');
    setPending(null);
    setAttempts((n) => n + 1);
    if (airport === target) {
      setFeedback({ kind: 'correct' });
      setDiff([]);
      return;
    }
    setFeedback({ kind: 'wrong', guess: airport });
    setWrongGuesses((list) => (list.includes(airport) ? list : [...list, airport]));
    setDiff([airport]);
  };

  const fillFromMap = (airport: Airport) => {
    if (done) return;
    setMode('airport');
    setQuery(label(airport));
    setPending(airport);
    answerRef.current?.focus();
  };

  const typeAirport = (q: string) => {
    setQuery(q);
    setPending(null);
  };

  const toggleDiff = (airport: Airport) =>
    setDiff((list) => (list.includes(airport) ? list.filter((a) => a !== airport) : [...list, airport]));

  const guessCountry = (country: Country) => {
    setQuery('');
    setAttempts((n) => n + 1);
    if (country.code === target.country) {
      setCountryKnown(true);
      setMode('airport');
      setFeedback({ kind: 'right-country' });
    } else {
      setFeedback({ kind: 'wrong-country', guess: country });
      setWrongCountries((list) => (list.includes(country.code) ? list : [...list, country.code]));
    }
  };

  const next = () => {
    setTarget((t) => randomAirport(t));
    setFeedback(null);
    setAttempts(0);
    setQuery('');
    setMode('airport');
    setCountryKnown(false);
    setWrongGuesses([]);
    setPending(null);
    setWrongCountries([]);
    setDiff([]);
  };

  return (
    <div className="app">
      <h1 className="brand">Whereport</h1>
      <MapView
        origin={done ? target : null}
        answer={target}
        destinations={destinations}
        compare={diff}
        wrongCountries={wrongCountries}
        candidates={candidates}
        ruledOut={wrongGuesses}
        won={feedback?.kind === 'correct'}
        onCandidateClick={fillFromMap}
      />

      {wrongGuesses.length > 0 && (
        <div className="card diff-panel">
          <div className="diff-heading">Compare with your guesses</div>
          <ul className="diff-list">
            {wrongGuesses.map((a) => (
              <li key={a.code}>
                <label>
                  <input type="checkbox" checked={diff.includes(a)} onChange={() => toggleDiff(a)} />
                  <strong>{a.code}</strong> {a.city || a.name}
                </label>
              </li>
            ))}
          </ul>
          <button className="clear" onClick={() => setDiff([])} disabled={!diff.length}>Clear all</button>

          {(() => {
            const them = diff.map((a) => a.code).join(' + ');
            const answer = done ? 'answer' : 'mystery airport';
            const one = diff.length <= 1;
            // Always rendered, just hidden when nothing is ticked, so the panel keeps its height.
            return (
              <div className={diff.length ? 'legend' : 'legend empty'} aria-label="Map legend" aria-hidden={!diff.length}>
                <div><span className="swatch" style={{ background: DOT_COLORS.shared }} /> {one ? 'They both' : 'They all'} fly here</div>
                <div><span className="swatch" style={{ background: DOT_COLORS.missing }} /> Only the {answer} flies here</div>
                {/* Impossible with one guess: hidden rather than removed so the legend keeps its height. */}
                <div style={one ? { visibility: 'hidden' } : undefined}>
                  <span className="swatch" style={{ background: DOT_COLORS.partial }} /> Some guesses also fly here
                </div>
                <div><span className="swatch faded" style={{ background: DOT_COLORS.extra }} /> Only {one ? them : 'the guesses'} {one ? 'flies' : 'fly'} here</div>
                <div><span className="swatch ring" /> {one ? 'Your guess' : 'Your guesses'}</div>
              </div>
            );
          })()}
        </div>
      )}

      <div className="card game">
        <div className="prompt">
          Which airport has direct international flights to these {destinations.length} destinations?
        </div>

        {countryKnown && !done && (
          <div className="hint">Country: <strong>{targetCountry}</strong> ✓</div>
        )}

        {done ? (
          <div className="actions">
            <button className="primary" onClick={next} autoFocus>Next airport</button>
          </div>
        ) : (
          <div className="guess">
            {mode === 'country' ? (
              <Combo
                key="country"
                matches={countryMatches}
                query={query}
                onQuery={setQuery}
                onPick={guessCountry}
                keyOf={(c) => c.code}
                render={(c) => <><strong>{c.name}</strong> <span className="code">{c.code}</span></>}
                placeholder="Type a country"
                ariaLabel="Your country guess"
              />
            ) : (
              <Combo
                key="airport"
                matches={airportMatches}
                query={query}
                onQuery={typeAirport}
                onPick={guessAirport}
                onSubmit={() => pending && guessAirport(pending)}
                inputRef={answerRef}
                keyOf={(a) => a.code}
                render={(a) => <><strong>{a.city || a.name}</strong> {a.name} <span className="code">{a.code}</span></>}
                placeholder={countryKnown ? `Type an airport in ${targetCountry}` : 'Type a city, airport name or code'}
                ariaLabel="Your airport guess"
              />
            )}
            {countryKnown && (
              <button className="primary" disabled={!pending} onClick={() => pending && guessAirport(pending)}>
                Guess
              </button>
            )}
            {!countryKnown && (
              mode === 'country'
                ? <button onClick={() => switchMode('airport')}>Guess airport</button>
                : <button onClick={() => switchMode('country')}>Guess country</button>
            )}
            <button onClick={() => setFeedback({ kind: 'revealed' })}>Give up</button>
          </div>
        )}

        <div className="status">
          {feedback?.kind === 'correct' ? (
            <span className="good">
              Correct! It's {label(target)}
              {attempts > 1 && ` — found in ${attempts} guesses`}.
            </span>
          ) : feedback?.kind === 'revealed' ? (
            <span>The answer was {label(target)}.</span>
          ) : feedback?.kind === 'wrong' ? (
            <span className="bad">It's not {feedback.guess.name} (<strong>{feedback.guess.code}</strong>).</span>
          ) : feedback?.kind === 'wrong-country' ? (
            <span className="bad">It's not in <strong>{feedback.guess.name}</strong>.</span>
          ) : feedback?.kind === 'right-country' ? (
            <span className="good">Correct, it's in {targetCountry}! Now pick the airport.</span>
          ) : mode === 'country' ? (
            <>Pick the country the airport is in.</>
          ) : (
            <>Pick an airport from the list, or guess the country first. Routes as of {datasetDate}.</>
          )}
        </div>
      </div>
    </div>
  );
}
