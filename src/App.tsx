import { useMemo, useState, type FormEvent } from 'react';
import MapView from './components/MapView';
import { airports, datasetDate, destinationsFrom, findAirport, type Airport } from './data/airports';

/** Airport named in the URL (?airport=OTP), so a view can be linked. */
const linked = findAirport(new URLSearchParams(window.location.search).get('airport') ?? '') ?? null;

export default function App() {
  const [query, setQuery] = useState(linked?.code ?? '');
  const [origin, setOrigin] = useState<Airport | null>(linked);
  const [error, setError] = useState<string | null>(null);

  const destinations = useMemo(() => (origin ? destinationsFrom(origin) : []), [origin]);

  const show = (airport: Airport) => {
    setOrigin(airport);
    setQuery(airport.code);
    setError(null);
    const url = new URL(window.location.href);
    url.searchParams.set('airport', airport.code);
    window.history.replaceState(null, '', url);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const code = query.trim().toUpperCase();
    if (!code) return;
    const airport = findAirport(code);
    if (airport) show(airport);
    else setError(`No airport with code ${code}`);
  };

  return (
    <div className="app">
      <MapView origin={origin} destinations={destinations} onAirportClick={show} />

      <form className="card search" onSubmit={submit}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value.toUpperCase())}
          placeholder="Airport code, e.g. OTP"
          maxLength={3}
          list="airport-codes"
          autoFocus
          spellCheck={false}
          aria-label="Airport code"
        />
        <button className="primary" type="submit">Show</button>
        <datalist id="airport-codes">
          {airports.map((a) => (
            <option key={a.code} value={a.code}>{a.city ? `${a.city} — ${a.name}` : a.name}</option>
          ))}
        </datalist>
        <div className="status">
          {error ? (
            <span className="bad">{error}</span>
          ) : origin ? (
            <>
              <strong>{origin.code}</strong> {origin.name}
              {origin.city && `, ${origin.city}`} · {destinations.length} direct{' '}
              {destinations.length === 1 ? 'destination' : 'destinations'}
            </>
          ) : (
            <>Enter an airport code to see its direct flights. Routes as of {datasetDate}.</>
          )}
        </div>
      </form>
    </div>
  );
}
