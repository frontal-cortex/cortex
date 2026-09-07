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
import { applyProseFont } from "./fonts";

let lastPref: Settings["theme"] = "system";
let paletteKeys: string[] = [];

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
  if (!palette) {
    delete root.dataset.palette;
    applyTheme(lastPref);
    return;
  }
  for (const [key, hex] of Object.entries(palette.colors)) {
    const name = key.replace(/_/g, "-");
    root.style.setProperty(`--palette-${name}`, hex);
    paletteKeys.push(name);
  }
  root.dataset.palette = "on";
  // The palette decides light vs dark — tag pills and BlockNote follow it.
  root.dataset.theme = palette.mode === "light" ? "light" : "dark";
}

/** Apply a settings object: follow the palette file when set and readable,
 *  otherwise the light/dark preference. A missing file is silent — a vault
 *  whose settings name an Omarchy path still looks right on a Mac. */
export async function syncTheme(settings: Pick<Settings, "theme" | "theme_file" | "prose_font">) {
  lastPref = settings.theme;
  applyProseFont(settings.prose_font ?? "");
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
