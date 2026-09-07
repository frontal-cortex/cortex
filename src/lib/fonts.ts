// ── Page typefaces ───────────────────────────────────────────────────────────
//
// The page (editor and viewer) has its own voice, separate from the chrome.
// A preset names a curated face; anything else is taken as a CSS font-family
// for a font the user has installed. Applied by setting `--font-prose` on
// <html>, which tokens.css defaults to Quattro.

export interface ProseFont {
  id: string;
  label: string;
  /** CSS font-family list. */
  family: string;
}

export const PROSE_FONTS: ProseFont[] = [
  { id: "quattro", label: "iA Writer Quattro — even, quiet (bundled)", family: '"iA Writer Quattro S", "Inter", "Noto Sans", system-ui, sans-serif' },
  { id: "duo",     label: "iA Writer Duo — more typewriter (bundled)", family: '"iA Writer Duo S", "iA Writer Quattro S", system-ui, sans-serif' },
  { id: "serif",   label: "Serif — book-like (Literata if installed)", family: '"Literata", "Source Serif 4", "Charter", "Noto Serif", Georgia, serif' },
  { id: "system",  label: "System sans", family: 'system-ui, -apple-system, "Segoe UI", "Noto Sans", sans-serif' },
  { id: "mono",    label: "Monospace — the desktop font", family: "var(--font-mono)" },
];

export const DEFAULT_PROSE_FONT = "quattro";

/** True when `value` names a preset rather than a custom family. */
export function isPreset(value: string): boolean {
  return PROSE_FONTS.some((f) => f.id === value);
}

/** Resolve a setting value to a font-family list; empty → default. */
export function resolveProseFont(value: string): string {
  const v = value.trim();
  if (!v) return PROSE_FONTS[0].family;
  const preset = PROSE_FONTS.find((f) => f.id === v);
  if (preset) return preset.family;
  // A custom family: quote it if it has spaces and isn't already quoted.
  const name = /^[\'"]/.test(v) || !/\s/.test(v) ? v : `"${v}"`;
  return `${name}, ${PROSE_FONTS[0].family}`;
}

export function applyProseFont(value: string) {
  document.documentElement.style.setProperty("--font-prose", resolveProseFont(value));
}
