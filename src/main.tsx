import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import 'maplibre-gl/dist/maplibre-gl.css';
import './App.css';
import App from './App';
import { loadDailyAirport } from './data/daily';

const root = createRoot(document.getElementById('root')!);

loadDailyAirport().then(
  (daily) =>
    root.render(
      <StrictMode>
        <App daily={daily} />
      </StrictMode>,
    ),
  (err) => {
    console.error(err);
    root.render(<p className="load-error">Couldn't load today's airport. Please reload the page.</p>);
  },
);
