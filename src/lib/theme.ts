// ── Theme: light/dark preference + an optional desktop palette ───────────────
//
// Two layers. The preference ("light" | "dark" | "system") sets `data-theme`
// on <html>, which tokens.css and BlockNote key off. A palette — a flat map of
// colour names → hex read from `settings.theme_file` (Omarchy's colors.toml
// shape, but any file like it) — goes on top: each colour becomes a
// `--palette-<name>` custom property and `data-palette` switches tokens.css to
// derive every design token from them. Rust follows the file and emits
// `theme://changed`, so a desktop theme switch retints the app live.

import { listen } from "@tauri-apps/api/event";
import { commands, Palette, Settings } from "./commands";
import { applyProseFont, applyProseSlant } from "./fonts";

/** Themes whose published `accent` is a cool alias on a warm palette —
 *  Omarchy's Gruvbox names its teal as the accent, while Gruvbox is orange
 *  everywhere else. With no `accent` chosen in Settings, the colour that
 *  belongs is used instead; a chosen accent still wins. Keyed by the theme
 *  name Omarchy publishes; a prefix match covers light/dark variants. */
const PREFERRED_ACCENT: Record<string, string> = {
  gruvbox: "orange",
};

function preferredAccent(palette: Palette): string | null {
  const name = (palette.name ?? "").toLowerCase();
  const key = Object.keys(PREFERRED_ACCENT).find((k) => name === k || name.startsWith(`${k}-`));
  const hex = key ? palette.colors[PREFERRED_ACCENT[key]] : undefined;
  return hex ?? null;
}

let lastPref: Settings["theme"] = "system";
let paletteKeys: string[] = [];
let lastPalette: Palette | null = null;
let lastAccent = "";

/** The action colour. Empty = whatever the theme gives (`--accent` from
 *  tokens.css or the palette's own accent). A palette colour name picks that
 *  colour from the followed palette — or the matching tag colour when no
 *  palette is followed — and a #hex sets it outright. Lets a desktop whose
 *  published accent fights the rest of its palette (a cold blue on a warm
 *  theme) use a colour that belongs. */
export function applyAccent(choice: string, palette: Palette | null = lastPalette) {
  lastAccent = (choice ?? "").trim().toLowerCase();
  const root = document.documentElement;
  const set = (accent: string, bg: string) => {
    root.style.setProperty("--accent", accent);
    root.style.setProperty("--accent-light", `color-mix(in srgb, ${accent} 18%, ${bg})`);
  };
  if (!lastAccent) {
    root.style.removeProperty("--accent");
    root.style.removeProperty("--accent-light");
    return;
  }
  if (lastAccent.startsWith("#")) { set(lastAccent, "var(--bg-app)"); return; }
  const fromPalette = palette?.colors[lastAccent] ?? palette?.colors[`bright_${lastAccent}`];
  if (fromPalette) { set(fromPalette, palette!.colors.background ?? "var(--bg-app)"); return; }
  // No palette: the tag palette has a readable version of each colour name.
  const tag = lastAccent === "magenta" ? "purple" : lastAccent === "cyan" ? "blue" : lastAccent;
  set(`var(--tag-${tag}-fg)`, "var(--bg-app)");
}

/** Apply the light/dark preference. "system" defers to the OS. */
export function applyTheme(theme: Settings["theme"]) {
  lastPref = theme;
  const root = document.documentElement;
  if (theme === "dark" || theme === "light") root.dataset.theme = theme;
  else delete root.dataset.theme;
}

/** Put a palette on <html>, or clear it (null) and fall back to the preference. */
export function applyPalette(palette: Palette | null) {
  const root = document.documentElement;
  for (const k of paletteKeys) root.style.removeProperty(`--palette-${k}`);
  paletteKeys = [];
  lastPalette = palette;
  if (!palette) {
    delete root.dataset.palette;
    applyTheme(lastPref);
    applyAccent(lastAccent, null);
    return;
  }
  for (const [key, hex] of Object.entries(palette.colors)) {
    const name = key.replace(/_/g, "-");
    root.style.setProperty(`--palette-${name}`, hex);
    paletteKeys.push(name);
  }
  root.dataset.palette = "on";
  // A theme known to publish the wrong accent for itself gets the right one.
  const preferred = preferredAccent(palette);
  if (preferred) {
    root.style.setProperty("--palette-accent", preferred);
    if (!paletteKeys.includes("accent")) paletteKeys.push("accent");
  }
  // The palette decides light vs dark — tag pills and BlockNote follow it.
  root.dataset.theme = palette.mode === "light" ? "light" : "dark";
  applyAccent(lastAccent, palette);
}

/** Motion: `data-animations="off"` zeroes the motion tokens (styles/
 *  tokens.css), which every transition in the app is written in terms of. A
 *  system asking for reduced motion is honoured in CSS regardless. */
export function applyAnimations(on: boolean) {
  const root = document.documentElement;
  if (on) root.removeAttribute("data-animations");
  else root.dataset.animations = "off";
}

/** Apply a settings object: follow the palette file when set and readable,
 *  otherwise the light/dark preference. A missing file is silent — a vault
 *  whose settings name an Omarchy path still looks right on a Mac. */
export async function syncTheme(settings: Pick<Settings, "theme" | "theme_file" | "prose_font" | "prose_slant"> & Partial<Pick<Settings, "accent" | "animations">>) {
  lastPref = settings.theme;
  applyAnimations(settings.animations ?? true);
  lastAccent = (settings.accent ?? "").trim().toLowerCase();
  applyProseFont(settings.prose_font ?? "");
  applyProseSlant(settings.prose_slant ?? "");
  let palette: Palette | null = null;
  try {
    palette = await commands.watchThemeFile(settings.theme_file ?? "");
  } catch {
    palette = null;
  }
  applyPalette(palette);
}

/** Once per app: retint live when the followed palette file changes. */
export function initThemeListener(): () => void {
  const unlisten = listen<Palette | null>("theme://changed", ({ payload }) => applyPalette(payload));
  return () => { unlisten.then((f) => f()); };
}
