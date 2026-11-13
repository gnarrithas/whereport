import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type Ref } from 'react';
import { createPortal } from 'react-dom';
import '@fontsource/fredoka/700.css';
import MapView from './components/MapView';
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
import { PALETTES } from './palette';
import { isBoolean, isTheme, useDark, useSetting, type Theme } from './settings';
import { copyText, shareText, siteUrl } from './share';
import {
  guessCount, isOver, loadDailyGame, markOf, newGame, play, saveDailyGame, type Game, type Move,
} from './game';

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
  disabled?: boolean;
}

function Combo<T>({
  matches, query, onQuery, onPick, keyOf, render, placeholder, ariaLabel, onSubmit, inputRef, disabled,
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
        disabled={disabled}
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
/**
 * A round button in the question card's corner, opening a panel in the middle of the screen over a dimmed
 * backdrop. The panel is rendered into <body>: the card is transformed, which would pin it to the card instead.
 * Clicking the backdrop, the close button or pressing Escape closes it.
 */
function Popover({ id, label, icon, children }: { id: string; label: string; icon: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      <button
        className="corner-toggle"
        aria-label={label}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
      >
        {icon}
      </button>
      {open && createPortal(
        <div className="backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
          <div id={id} className="popover-panel" role="dialog" aria-modal="true" aria-label={label}>
            <button className="popover-close" aria-label="Close" onClick={() => setOpen(false)} autoFocus>×</button>
            {children}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

function Help() {
  return (
    <Popover id="how-to-play" label="How to play" icon="?">
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
    </Popover>
  );
}

const bulb = (
  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 18h6M10 22h4" />
    <path d="M12 2a7 7 0 0 0-4 12.74V16h8v-1.26A7 7 0 0 0 12 2z" />
  </svg>
);

const send = (
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 2 11 13" />
    <path d="M22 2 15 22l-4-9-9-4 20-7z" />
  </svg>
);

const cog = (
  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

/** An on/off switch: on to the right. The whole row toggles it. */
function Switch({ label, sub, on, onChange }: { label: string; sub?: string; on: boolean; onChange: (on: boolean) => void }) {
  return (
    <button className="setting switch-row" role="switch" aria-checked={on} onClick={() => onChange(!on)}>
      <span className="setting-text">
        {label}
        {sub && <span className="setting-sub">{sub}</span>}
      </span>
      <span className="switch" aria-hidden="true" />
    </button>
  );
}

interface SettingsProps {
  dark: boolean;
  onDark: (on: boolean) => void;
  colorblind: boolean;
  onColorblind: (on: boolean) => void;
}

function Settings({ dark, onDark, colorblind, onColorblind }: SettingsProps) {
  return (
    <Popover id="settings" label="Settings" icon={cog}>
      <h2>Settings</h2>
      <Switch label="Dark mode" on={dark} onChange={onDark} />
      <Switch
        label="Colour-blind friendly colours"
        sub="Map colours that stay apart with any colour-vision deficiency."
        on={colorblind}
        onChange={onColorblind}
      />
    </Popover>
  );
}

/** The options box's width, its gap from the question card, and the room kept clear for the map's zoom buttons. */
const OPTIONS_WIDTH = 250;
const OPTIONS_GAP = 16;
const ZOOM_STRIP = 56;

/** Starts on today's airport, as far as it was played before; "Play another round!" then moves on to random ones. */
export default function App({ daily }: { daily: Daily }) {
  const [target, setTarget] = useState(daily.airport);
  /** Still on today's puzzle, the only one that is saved and, outside dev mode, shared. */
  const [isDaily, setIsDaily] = useState(true);
  const [game, setGame] = useState<Game>(() => loadDailyGame(daily.day, daily.airport));
  const { feedback, countryKnown, wrongGuesses, wrongCountries, domesticShown } = game;
  const [highlightCountries, setHighlightCountries] = useSetting('highlight-countries', false, isBoolean);
  const [theme, setTheme] = useSetting<Theme>('theme', 'auto', isTheme);
  const [colorblind, setColorblind] = useSetting('colorblind', false, isBoolean);
  /** Lines from the mouse pointer to every destination, to judge how plausible a spot is. */
  const [followPointer, setFollowPointer] = useState(false);
  /** Hovering a country marks the airports in it that could be the answer. */
  const [hoverAirports, setHoverAirports] = useState(false);
  const dark = useDark(theme);
  const palette = PALETTES[colorblind ? 'colorblind' : 'standard'];
  /** Dev mode: the answer shown on the map mid-game. */
  const [peeking, setPeeking] = useState(false);
  const [copied, setCopied] = useState<'yes' | 'failed' | null>(null);
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<Mode>('airport');
  // A restored game compares with its last guess, as it did when that guess was made.
  const [diff, setDiff] = useState<Airport[]>(() => (feedback?.kind === 'wrong' ? [feedback.guess] : []));
  /** An airport clicked on the map, filled into the answer bar and waiting for Enter or Guess. */
  const [pending, setPending] = useState<Airport | null>(null);
  /** A country clicked on the map, filled into the answer bar and waiting for Enter or send. */
  const [pendingCountry, setPendingCountry] = useState<Country | null>(null);
  const countryRef = useRef<HTMLInputElement>(null);
  const answerRef = useRef<HTMLInputElement>(null);
  // The options box sits right of the question card, whose width follows the question.
  const gameRef = useRef<HTMLDivElement>(null);
  /** Where the options box goes: beside the card ("left:<px>") or, when there's no room, below it ("top:<px>"). */
  const [optionsAt, setOptionsAt] = useState<string | null>(null);
  const [, setResized] = useState(0);
  useLayoutEffect(() => {
    const card = gameRef.current?.getBoundingClientRect();
    // Below the card when it doesn't fit between the card and the map's zoom buttons.
    const at = !card ? null
      : card.right + OPTIONS_GAP + OPTIONS_WIDTH + ZOOM_STRIP <= window.innerWidth
        ? `left:${Math.round(card.right + OPTIONS_GAP)}` : `top:${Math.round(card.bottom + 12)}`;
    if (at !== optionsAt) setOptionsAt(at);
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
  const done = isOver(game);
  const attempts = guessCount(game);

  // The answer bar stays mounted across games, so its autofocus doesn't fire again for the next one.
  useEffect(() => {
    if (!done) answerRef.current?.focus();
  }, [done]);

  useEffect(() => {
    if (isDaily) saveDailyGame(daily.day, daily.airport, game);
  }, [isDaily, daily, game]);

  /** Plays a move; returns the game after it, or null if it couldn't be made. */
  const move = (m: Move) => {
    const next = play(game, m, target);
    if (next) {
      setGame(next);
      setCopied(null);
    }
    return next;
  };
  const targetCountry = countryName(target.country);

  const switchMode = (m: Mode) => {
    setMode(m);
    setQuery('');
    setPending(null);
    setPendingCountry(null);
  };

  const guessAirport = (airport: Airport) => {
    setQuery('');
    setPending(null);
    if (!move({ kind: 'airport', code: airport.code })) return;
    setDiff(airport === target ? [] : [airport]);
  };

  const fillFromMap = (airport: Airport) => {
    if (done) return;
    setMode('airport');
    setPendingCountry(null);
    setQuery(label(airport));
    setPending(airport);
    answerRef.current?.focus();
  };

  const fillCountryFromMap = (code: string) => {
    setQuery(countryName(code));
    setPendingCountry({ code, name: countryName(code) });
    countryRef.current?.focus();
  };

  const typeCountry = (q: string) => {
    setQuery(q);
    setPendingCountry(null);
  };

  const typeAirport = (q: string) => {
    setQuery(q);
    setPending(null);
  };

  const toggleDiff = (airport: Airport) =>
    setDiff((list) => (list.includes(airport) ? list.filter((a) => a !== airport) : [...list, airport]));

  const guessCountry = (country: Country) => {
    setQuery('');
    setPendingCountry(null);
    if (move({ kind: 'country', code: country.code })?.countryKnown) setMode('airport');
  };

  /** The send button: the airport filled in from the map, else the top match for what's typed. */
  const sendGuess = () => {
    if (mode === 'country') {
      const country = pendingCountry ?? (query.trim() ? countryMatches[0] : undefined);
      if (country) guessCountry(country);
    } else if (!query.trim() && !pending) {
      return;
    } else {
      const airport = pending ?? airportMatches[0];
      if (airport) guessAirport(airport);
    }
  };
  const canSend = mode === 'country'
    ? !!pendingCountry || (!!query.trim() && countryMatches.length > 0)
    : !!pending || (!!query.trim() && airportMatches.length > 0);

  const giveUp = () => move({ kind: 'give-up' });

  const revealDomestic = () => move({ kind: 'hint' });

  /** Today's puzzle can be shared; in dev mode, any game at any point. */
  const shareable = isDaily || DEV_MODE;
  const shareLabel = copied === 'yes' ? 'Copied!' : copied === 'failed' ? "Couldn't copy" : 'Share';

  const share = () => {
    copyText(shareText(daily.day, game.moves.map((m) => markOf(m, target)), siteUrl())).then(
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
    setGame(newGame());
    setCopied(null);
    setPeeking(false);
    setQuery('');
    setMode('airport');
    setPending(null);
    setPendingCountry(null);
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
        domestic={domesticShown ? domestic : []}
        won={feedback?.kind === 'correct'}
        peek={DEV_MODE && peeking ? target : null}
        highlightCountries={highlightCountries}
        followPointer={followPointer && !done}
        hoverAirports={hoverAirports && !done}
        palette={palette}
        onCandidateClick={fillFromMap}
        pickCountry={mode === 'country' && !countryKnown && !done}
        onCountryClick={fillCountryFromMap}
      />

      <div
        className={optionsAt?.startsWith('top:') ? 'card options-box below' : 'card options-box'}
        style={optionsAt ? { [optionsAt.split(':')[0]]: Number(optionsAt.split(':')[1]) } : { visibility: 'hidden' }}
      >
        <label>
          <input type="checkbox" checked={highlightCountries} onChange={(e) => setHighlightCountries(e.target.checked)} />
          Destination countries
        </label>
        <label title="Hover a country to see its airports that could be the answer" className={done ? 'disabled' : undefined}>
          <input type="checkbox" checked={hoverAirports} disabled={done} onChange={(e) => setHoverAirports(e.target.checked)} />
          Airports on hover
        </label>
        <label title="Draw lines from the mouse pointer to every destination" className={done ? 'disabled' : undefined}>
          <input type="checkbox" checked={followPointer} disabled={done} onChange={(e) => setFollowPointer(e.target.checked)} />
          Follow pointer
        </label>
        {DEV_MODE && (
          <label className={done ? 'disabled' : undefined}>
            <input type="checkbox" checked={peeking && !done} disabled={done} onChange={(e) => setPeeking(e.target.checked)} />
            Reveal {peeking && !done ? target.code : ''}
          </label>
        )}
        {countryKnown && !done && !domesticShown && (
          <button className="domestic-hint" title="Get a hint" onClick={revealDomestic}>{bulb} Reveal domestic flights</button>
        )}
      </div>

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
                <div><span className="swatch" style={{ background: palette.dots.shared }} /> {one ? 'They both' : 'They all'} fly here</div>
                <div><span className="swatch" style={{ background: palette.dots.missing }} /> Only the {answer} flies here</div>
                {/* Impossible with one guess: hidden rather than removed so the legend keeps its height. */}
                <div style={one ? { visibility: 'hidden' } : undefined}>
                  <span className="swatch" style={{ background: palette.dots.partial }} /> Some guesses also fly here
                </div>
                <div><span className="swatch faded" style={{ background: palette.dots.extra }} /> Only {one ? them : 'the guesses'} {one ? 'flies' : 'fly'} here</div>
                <div><span className="swatch ring" style={{ background: palette.wrong }} /> {one ? 'Your guess' : 'Your guesses'}</div>
              </div>
            );
          })()}
        </div>
      )}

      <div className="card game" ref={gameRef}>
        <div className="corner">
          {DEV_MODE && <button className="dev-share" onClick={share}>{shareLabel}</button>}
          <Settings dark={dark} onDark={(on) => setTheme(on ? 'dark' : 'light')} colorblind={colorblind} onColorblind={setColorblind} />
          <Help />
        </div>
        <div className={DEV_MODE ? 'prompt dev' : 'prompt'}>
          Which airport has direct international flights to these {destinations.length} destinations?
        </div>

        {/* The answer bar stays after the game, greyed out, so the card keeps its layout. */}
        <div className="answer">
          <div className="mode-row">
            <div className={`mode-toggle ${mode}${done ? ' off' : ''}`} role="radiogroup" aria-label="Guess a country or an airport">
              {(['country', 'airport'] as const).map((m) => (
                <button
                  key={m}
                  role="radio"
                  aria-checked={mode === m}
                  className={mode === m ? 'on' : undefined}
                  // Once the country is found, only airports are left to guess.
                  disabled={done || (countryKnown && m === 'country')}
                  onClick={() => mode !== m && switchMode(m)}
                >
                  {m === 'country' ? 'Country' : 'Airport'}
                </button>
              ))}
            </div>
            {countryKnown && <div className="hint">Country: <strong>{targetCountry}</strong> ✓</div>}
          </div>
          <div className="guess">
            {mode === 'country' ? (
              <Combo
                key="country"
                matches={countryMatches}
                query={query}
                onQuery={typeCountry}
                onPick={guessCountry}
                onSubmit={() => pendingCountry && guessCountry(pendingCountry)}
                inputRef={countryRef}
                keyOf={(c) => c.code}
                render={(c) => <><strong>{c.name}</strong> <span className="code">{c.code}</span></>}
                placeholder="Type a country"
                ariaLabel="Your country guess"
                disabled={done}
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
                disabled={done}
              />
            )}
            <button className="primary send" title="Send guess" aria-label="Send guess" disabled={done || !canSend} onClick={sendGuess}>
              {send}
            </button>
            {!done ? <button onClick={giveUp}>Give up</button> : (
              <>
                {shareable && <button className="primary" onClick={share} autoFocus>{shareLabel}</button>}
                <button className={shareable ? undefined : 'primary'} onClick={next} autoFocus={!shareable}>Play another round!</button>
              </>
            )}
          </div>
        </div>

        <div className="footer">
          <div className="status">
            {feedback?.kind === 'correct' ? (
              <span className="good">
                Correct! It's {label(target)}
                {attempts > 1 && ` — found in ${attempts} guesses`}.
              </span>
            ) : feedback?.kind === 'revealed' ? (
              <span className="good">The answer was {label(target)}.</span>
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
    </div>
  );
}
