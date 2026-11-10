/**
 * One mark per move, in the order they were made. Circles are airport guesses and squares country
 * guesses; orange is wrong and blue right, a pair colour-blind players can tell apart.
 */
export const MARKS = {
  wrongAirport: '🟠',
  rightAirport: '🔵',
  wrongCountry: '🟧',
  rightCountry: '🟦',
  domesticHint: '💡',
  gaveUp: '🏳️',
} as const;

export type Mark = (typeof MARKS)[keyof typeof MARKS];

/** "Whereport <n>", the guesses on one line, then a blank line and the link. Numbers start at 1 for day index 0. */
export function shareText(day: number, marks: Mark[], url: string): string {
  return [`Whereport ${(day + 1).toLocaleString('en-US')}`, marks.join(''), '', url].join('\n');
}

/** The site root as served (e.g. https://user.github.io/whereport/), so the link follows the deployment. */
export const siteUrl = () => new URL(import.meta.env.BASE_URL, window.location.origin).href;

/** Copies through a temporary textarea: the only option outside secure contexts, where navigator.clipboard is missing. */
function copyWithTextarea(text: string) {
  const previousFocus = document.activeElement;
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.top = '0';
  textarea.style.left = '-9999px';
  document.body.appendChild(textarea);
  try {
    textarea.select();
    if (!document.execCommand('copy')) throw new Error("execCommand('copy') was refused");
  } finally {
    document.body.removeChild(textarea);
    if (previousFocus instanceof HTMLElement) previousFocus.focus();
  }
}

/** Always the clipboard, never the system share sheet, as in Wordle. */
export async function copyText(text: string) {
  if (window.isSecureContext && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch (err) {
      console.warn('Clipboard API refused, copying another way', err);
    }
  }
  copyWithTextarea(text);
}
