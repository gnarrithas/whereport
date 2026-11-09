import { useMemo, useState, type KeyboardEvent, type ReactNode } from 'react';
import MapView from './components/MapView';
import {
  countryName,
  datasetDate,
  destinationsFrom,
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
}

function Combo<T>({ matches, query, onQuery, onPick, keyOf, render, placeholder, ariaLabel }: ComboProps<T>) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const pick = (item: T) => {
    setOpen(false);
    onPick(item);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
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

  const destinations = useMemo(() => destinationsFrom(target), [target]);
  const airportMatches = useMemo(
    () => searchAirports(query, countryKnown ? target.country : undefined),
    [query, countryKnown, target],
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
    setAttempts((n) => n + 1);
    setFeedback(airport === target ? { kind: 'correct' } : { kind: 'wrong', guess: airport });
  };

  const guessCountry = (country: Country) => {
    setQuery('');
    setAttempts((n) => n + 1);
    if (country.code === target.country) {
      setCountryKnown(true);
      setMode('airport');
      setFeedback({ kind: 'right-country' });
    } else {
      setFeedback({ kind: 'wrong-country', guess: country });
    }
  };

  const next = () => {
    setTarget((t) => randomAirport(t));
    setFeedback(null);
    setAttempts(0);
    setQuery('');
    setMode('airport');
    setCountryKnown(false);
  };

  return (
    <div className="app">
      <MapView origin={done ? target : null} destinations={destinations} />

      <div className="card game">
        <div className="prompt">
          Which airport has direct international flights to all {destinations.length} blinking destinations?
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
                onQuery={setQuery}
                onPick={guessAirport}
                keyOf={(a) => a.code}
                render={(a) => <><strong>{a.city || a.name}</strong> {a.name} <span className="code">{a.code}</span></>}
                placeholder={countryKnown ? `Type an airport in ${targetCountry}` : 'Type a city, airport name or code'}
                ariaLabel="Your airport guess"
              />
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
            <span className="bad">Wrong — it's not {label(feedback.guess)}. Try again.</span>
          ) : feedback?.kind === 'wrong-country' ? (
            <span className="bad">Wrong — it's not in {feedback.guess.name}. Try again.</span>
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
