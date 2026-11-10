import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Node's process, without pulling in @types/node for one variable.
declare const process: { env: Record<string, string | undefined> };

export default defineConfig({
  // GitHub Pages serves the project under /<repo>/; the deploy workflow sets
  // BASE_PATH. Everywhere else the app lives at the site root.
  base: process.env.BASE_PATH || '/',
  plugins: [react()],
  server: { port: 3100, strictPort: true },
});
