import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type Ref } from 'react';
import '@fontsource/fredoka/700.css';
import MapView, { DOT_COLORS } from './components/MapView';
import {
  countryName,
  datasetDate,
  destinationsFrom,
  domesticFrom,
  playableIn,
  randomAirport,
  searchAirports,
  searchCountries,
  type Airport,
  type Country,
} from './data/airports';
import type { Daily } from './data/daily';
import { DEV_MODE } from './mode';
import { MARKS, copyText, shareText, siteUrl, type Mark } from './share';

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

/** The "?" button in the question card's corner and the how-to-play panel it opens. */
function Help() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="help" ref={ref}>
      <button
        className="help-toggle"
        aria-label="How to play"
        aria-expanded={open}
        aria-controls="how-to-play"
        onClick={() => setOpen((o) => !o)}
      >
        ?
      </button>
      {open && (
        <div id="how-to-play" className="help-panel" role="dialog" aria-label="How to play">
          <button className="help-close" aria-label="Close" onClick={() => setOpen(false)}>×</button>
          <h2>How to play</h2>
          <p>
            You must guess the mystery airport. Each dot represents a non-domestic destination of a direct flight from the mystery airport.
          </p>
          <ul>
            <li>Type a city, airport name or code and pick it from the list to guess.</li>
            <li>
              Stuck? <strong>Guess the country</strong> first. Get it right and the candidate airports
              appear on the map: you can then click on those.
              You can also <strong>reveal domestic flights</strong> for a further hint.
            </li>
            <li>
              Tick wrong guesses in the bottom-left panel to compare routes with the mystery airport.
            </li>
          </ul>
        </div>
      )}
    </div>
  );
}

/** Starts on today's airport; "Next airport" then moves on to random ones. */
export default function App({ daily }: { daily: Daily }) {
  const [target, setTarget] = useState(daily.airport);
  /** Still on today's puzzle, the only one that can be shared. */
  const [isDaily, setIsDaily] = useState(true);
  const [marks, setMarks] = useState<Mark[]>([]);
  /** Dev mode: the answer shown on the map mid-game. */
  const [peeking, setPeeking] = useState(false);
  const [copied, setCopied] = useState<'yes' | 'failed' | null>(null);
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
  const [domesticShown, setDomesticShown] = useState(false);
  const answerRef = useRef<HTMLInputElement>(null);
  // The logo is vertically centred on the answer row (or the Next button), which moves as hints appear.
  const rowRef = useRef<HTMLDivElement>(null);
  const [logoY, setLogoY] = useState<number | null>(null);
  const [, setResized] = useState(0);
  useLayoutEffect(() => {
    const row = rowRef.current?.getBoundingClientRect();
    const y = row ? Math.round(row.top + row.height / 2) : null;
    if (y !== logoY) setLogoY(y);
  });
  useEffect(() => {
    const onResize = () => setResized((n) => n + 1);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const destinations = useMemo(() => destinationsFrom(target), [target]);
  const domestic = useMemo(() => domesticFrom(target), [target]);
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
    setCopied(null);
    setMarks((list) => [...list, airport === target ? MARKS.rightAirport : MARKS.wrongAirport]);
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
    setCopied(null);
    setMarks((list) => [...list, country.code === target.country ? MARKS.rightCountry : MARKS.wrongCountry]);
    if (country.code === target.country) {
      setCountryKnown(true);
      setMode('airport');
      setFeedback({ kind: 'right-country' });
    } else {
      setFeedback({ kind: 'wrong-country', guess: country });
      setWrongCountries((list) => (list.includes(country.code) ? list : [...list, country.code]));
    }
  };

  /** Today's puzzle can be shared; in dev mode, any game at any point. */
  const shareable = isDaily || DEV_MODE;
  const shareLabel = copied === 'yes' ? 'Copied!' : copied === 'failed' ? "Couldn't copy" : 'Share';

  const share = () => {
    copyText(shareText(daily.day, marks, siteUrl())).then(
      () => setCopied('yes'),
      (err) => {
        console.error(err);
        setCopied('failed');
      },
    );
  };

  const next = () => {
    setTarget((t) => randomAirport(t));
    setIsDaily(false);
    setMarks([]);
    setCopied(null);
    setPeeking(false);
    setFeedback(null);
    setAttempts(0);
    setQuery('');
    setMode('airport');
    setCountryKnown(false);
    setWrongGuesses([]);
    setPending(null);
    setDomesticShown(false);
    setWrongCountries([]);
    setDiff([]);
  };

  return (
    <div className="app">
      <h1 className="brand" style={logoY === null ? undefined : { top: logoY }}>Whereport</h1>
      <MapView
        origin={done ? target : null}
        answer={target}
        destinations={destinations}
        compare={diff}
        wrongCountries={wrongCountries}
        candidates={candidates}
        ruledOut={wrongGuesses}
        domestic={domesticShown ? domestic : []}
        won={feedback?.kind === 'correct'}
        peek={DEV_MODE && peeking ? target : null}
        onCandidateClick={fillFromMap}
      />

      {DEV_MODE && !done && (
        <div className="dev-tools">
          <button onClick={share}>{shareLabel}</button>
          <button onClick={() => setPeeking((p) => !p)} aria-pressed={peeking}>
            {peeking ? `Hide ${target.code}` : 'Reveal'}
          </button>
        </div>
      )}

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
        <Help />
        <div className="prompt">
          Which airport has direct international flights to these {destinations.length} destinations?
        </div>

        {countryKnown && !done && (
          <div className="hint">Country: <strong>{targetCountry}</strong> ✓</div>
        )}

        {done ? (
          <div className="actions" ref={rowRef}>
            {shareable && <button className="primary" onClick={share} autoFocus>{shareLabel}</button>}
            <button className={shareable ? undefined : 'primary'} onClick={next} autoFocus={!shareable}>Next airport</button>
          </div>
        ) : (
          <div className="guess" ref={rowRef}>
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

        {countryKnown && !done && !domesticShown && (
          <button className="link" onClick={() => setDomesticShown(true)}>Reveal domestic flights</button>
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
