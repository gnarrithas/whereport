/** How a destination dot relates to the diff: flown by both sides, only by the answer, or only by the guesses. */
export type DotKind = 'shared' | 'partial' | 'missing' | 'extra';

export interface Palette {
  dots: Record<DotKind, string>;
  /** Wrong guesses: their dots and the hatching of wrong countries. */
  wrong: string;
  /** Domestic flights, once revealed. */
  domestic: string;
  /** The answer's dot when found. */
  won: string;
}

export type PaletteName = 'standard' | 'colorblind';

export const PALETTES: Record<PaletteName, Palette> = {
  standard: {
    dots: { shared: '#16a34a', partial: '#f59e0b', missing: '#2563eb', extra: '#9ca3af' },
    wrong: '#dc2626',
    domestic: '#9333ea',
    won: '#f5b301',
  },
  // Okabe–Ito: told apart with the common colour-vision deficiencies (protan, deutan, tritan).
  colorblind: {
    dots: { shared: '#009e73', partial: '#e69f00', missing: '#0072b2', extra: '#9ca3af' },
    wrong: '#d55e00',
    domestic: '#cc79a7',
    won: '#f0e442',
  },
};
