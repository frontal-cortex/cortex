// ── Breakpoints: the one place the app's widths are decided ─────────────────
//
// Three viewport sizes, by width:
//
//   phone    < 600px   the sidebar is an overlay drawer, the terminal a bottom
//                      sheet, the page full-bleed, hit targets grow to a thumb
//   compact  < 820px   everything stays in flow but narrower (sidebar 220px,
//                      Settings rows stack their controls)
//   wide     otherwise the desktop layout
//
// `useViewport` (hooks/useViewport.ts) watches these with matchMedia and the
// app stamps the result on <html> as `data-viewport`, plus `--bp-phone` /
// `--bp-compact` custom properties, so CSS selects on
// `:root[data-viewport="phone"] …` instead of repeating a number in each
// module. `@media` cannot read a custom property, which is why the attribute —
// not a media query — is the CSS-side hook.

export type ViewportSize = "phone" | "compact" | "wide";

/** Upper bounds, exclusive: a width below `phone` is a phone, and so on. */
export const BREAKPOINTS = {
  phone: 600,
  compact: 820,
} as const;

/** Which layout a viewport of `width` CSS pixels gets. */
export function viewportSize(width: number, bp: typeof BREAKPOINTS = BREAKPOINTS): ViewportSize {
  if (width < bp.phone) return "phone";
  if (width < bp.compact) return "compact";
  return "wide";
}

/** The `matchMedia` query that is true while the viewport is exactly `size`. */
export function viewportQuery(size: ViewportSize, bp: typeof BREAKPOINTS = BREAKPOINTS): string {
  switch (size) {
    case "phone": return `(max-width: ${bp.phone - 1}px)`;
    case "compact": return `(min-width: ${bp.phone}px) and (max-width: ${bp.compact - 1}px)`;
    case "wide": return `(min-width: ${bp.compact}px)`;
  }
}

/** The custom properties that mirror the breakpoints into CSS. */
export function breakpointProperties(bp: typeof BREAKPOINTS = BREAKPOINTS): Record<string, string> {
  return {
    "--bp-phone": `${bp.phone}px`,
    "--bp-compact": `${bp.compact}px`,
  };
}
