import { useMemo, useState, type KeyboardEvent } from 'react';
import MapView from './components/MapView';
import { datasetDate, destinationsFrom, randomAirport, searchAirports, type Airport } from './data/airports';

type Feedback =
  | { kind: 'wrong'; guess: Airport }
  | { kind: 'correct' }
  | { kind: 'revealed' }
  | null;

const label = (a: Airport) => `${a.city || a.name} — ${a.name} (${a.code})`;

export default function App() {
  const [target, setTarget] = useState(() => randomAirport());
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [attempts, setAttempts] = useState(0);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const destinations = useMemo(() => destinationsFrom(target), [target]);
  const matches = useMemo(() => searchAirports(query), [query]);
  const done = feedback?.kind === 'correct' || feedback?.kind === 'revealed';

  const guess = (airport: Airport) => {
    setQuery('');
    setOpen(false);
    setAttempts((n) => n + 1);
    setFeedback(airport === target ? { kind: 'correct' } : { kind: 'wrong', guess: airport });
  };

  const next = () => {
    setTarget((t) => randomAirport(t));
    setFeedback(null);
    setAttempts(0);
    setQuery('');
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
      guess(matches[active]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div className="app">
      <MapView origin={done ? target : null} destinations={destinations} />

      <div className="card game">
        <div className="prompt">
          Which airport has direct international flights to all {destinations.length} blinking destinations?
        </div>

        {done ? (
          <div className="actions">
            <button className="primary" onClick={next} autoFocus>Next airport</button>
          </div>
        ) : (
          <div className="guess">
            <div className="combo">
              <input
                value={query}
                onChange={(e) => { setQuery(e.target.value); setActive(0); setOpen(true); }}
                onKeyDown={onKeyDown}
                onFocus={() => setOpen(true)}
                onBlur={() => setOpen(false)}
                placeholder="Type a city, airport name or code"
                autoFocus
                spellCheck={false}
                role="combobox"
                aria-expanded={open && matches.length > 0}
                aria-controls="airport-options"
                aria-label="Your guess"
              />
              {open && matches.length > 0 && (
                <ul id="airport-options" className="options" role="listbox">
                  {matches.map((a, i) => (
                    <li
                      key={a.code}
                      role="option"
                      aria-selected={i === active}
                      className={i === active ? 'active' : undefined}
                      onMouseEnter={() => setActive(i)}
                      onMouseDown={(e) => { e.preventDefault(); guess(a); }}
                    >
                      <strong>{a.city || a.name}</strong> {a.name} <span className="code">{a.code}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
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
          ) : (
            <>Pick an airport from the list. Routes as of {datasetDate}.</>
          )}
        </div>
      </div>
    </div>
  );
}
