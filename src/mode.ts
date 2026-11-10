/**
 * Dev mode: the local Vite dev server (`npm run dev`). Builds (`npm run build`,
 * hence the deploy) are prod. Dev mode has no secret daily list and shows a
 * reveal button for testing.
 */
export const DEV_MODE: boolean = import.meta.env.DEV;
