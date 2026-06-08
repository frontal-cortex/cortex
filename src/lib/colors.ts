// Tag/select color palette. Names are stored in schema YAML; the actual swatch
// values live as CSS custom properties (see tokens.css) so they adapt to the
// light/dark theme. An unknown name falls back to gray, so stored data is never
// "invalid" — it just renders neutral.

export const TAG_COLORS = [
  "gray",
  "brown",
  "orange",
  "yellow",
  "green",
  "blue",
  "purple",
  "pink",
  "red",
] as const;

export type TagColor = (typeof TAG_COLORS)[number];

function normalize(color: string | undefined): TagColor {
  return (TAG_COLORS as readonly string[]).includes(color ?? "")
    ? (color as TagColor)
    : "gray";
}

/** Inline style for a colored pill, resolving to theme-aware CSS variables. */
export function tagStyle(color: string | undefined): React.CSSProperties {
  const c = normalize(color);
  return {
    backgroundColor: `var(--tag-${c}-bg)`,
    color: `var(--tag-${c}-fg)`,
  };
}

/** Just the swatch background — for color-picker dots. */
export function swatchStyle(color: string): React.CSSProperties {
  const c = normalize(color);
  return { backgroundColor: `var(--tag-${c}-bg)` };
}

/** Deterministically assign a color to a never-seen-before option value, so
 *  auto-created options aren't all gray. */
export function autoColor(seed: string): TagColor {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  // Skip gray (index 0) so auto colors are visibly distinct from the fallback.
  return TAG_COLORS[1 + (h % (TAG_COLORS.length - 1))];
}
