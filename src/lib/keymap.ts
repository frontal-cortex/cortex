// ── Keyboard shortcuts: the single source of truth ───────────────────────────
//
// Every app-level shortcut is declared here once. Shell dispatches key events
// through this table and every hint in the UI (tooltips, placeholders, the
// command palette) is rendered from it — so a binding and its label can never
// drift apart, and the modifier reads as ⌘ on macOS and Ctrl everywhere else.
//
// App shortcuts are dispatched in the capture phase, so they win over the
// editor's own bindings (Ctrl+B is the sidebar, not bold — the formatting
// toolbar still has bold). Editor-internal keys that don't collide (the
// wiki-link dropdown, slash menu) are untouched.

export type ShortcutId =
  | "quick-switcher"
  | "command-palette"
  | "quick-capture"
  | "new-note"
  | "today"
  | "graph"
  | "back"
  | "forward"
  | "settings"
  | "toggle-sidebar"
  | "toggle-terminal"
  | "monk-mode"
  | "focus-sidebar"
  | "focus-editor"
  | "toggle-properties"
  | "marketplace"
  | "log-today"
  | "find-in-note"
  | "toggle-outline"
  | "toggle-comments"
  | "comment";

export interface Shortcut {
  /** `mod` = ⌘ on macOS, Ctrl elsewhere. Lower-case, `+`-joined, key last. */
  keys: string;
  label: string;
}

export const SHORTCUTS: Record<ShortcutId, Shortcut> = {
  "quick-switcher":  { keys: "mod+k",       label: "Quick switcher" },
  "command-palette": { keys: "mod+shift+p", label: "Command palette" },
  "quick-capture":   { keys: "mod+shift+k", label: "Quick capture" },
  "new-note":        { keys: "mod+n",       label: "New note" },
  "today":           { keys: "mod+shift+t", label: "Today's note" },
  "graph":           { keys: "mod+g",       label: "Graph view" },
  "back":            { keys: "mod+[",       label: "Back" },
  "forward":         { keys: "mod+]",       label: "Forward" },
  "settings":        { keys: "mod+,",       label: "Settings" },
  "toggle-sidebar":  { keys: "mod+b",       label: "Toggle sidebar" },
  "toggle-terminal": { keys: "mod+l",       label: "Toggle terminal" },
  "monk-mode":       { keys: "mod+shift+m", label: "Monk mode" },
  "focus-sidebar":   { keys: "mod+e",       label: "Focus sidebar" },
  "focus-editor":    { keys: "mod+shift+e", label: "Focus editor" },
  "toggle-properties": { keys: "mod+shift+i", label: "Toggle properties" },
  "marketplace":       { keys: "mod+shift+b", label: "Browse templates" },
  "log-today":         { keys: "mod+shift+h", label: "Log today" },
  "find-in-note":      { keys: "mod+f",       label: "Find in note" },
  "toggle-outline":    { keys: "mod+shift+o", label: "Toggle outline" },
  "toggle-comments":   { keys: "mod+shift+c", label: "Toggle comments" },
  "comment":           { keys: "mod+alt+c",   label: "Comment on selection" },
};

// ── Local keys ────────────────────────────────────────────────────────────────
// Keys that only mean something while a particular widget has focus are not
// app shortcuts (they never collide with typing elsewhere) and are not
// rebindable, but they are declared here so every hint reads from one place
// and the vocabulary stays the same across widgets: the sidebar, the timeline
// and the data table all move with arrows or j/k, open with Enter, make with
// n, remove with Delete and leave with Escape.

/** The data table's keys, in the order a hint lists them. */
export const TABLE_KEYS: { keys: string; label: string }[] = [
  { keys: "↑ ↓ ← → / j k h l", label: "move between cells" },
  { keys: "Tab / Shift+Tab", label: "next / previous cell" },
  { keys: "Home / End", label: "first / last cell in the row" },
  { keys: "Enter", label: "edit the cell" },
  { keys: "Escape", label: "cancel the edit, then leave the table" },
  { keys: "mod+Enter / o", label: "open the row as a note" },
  { keys: "n", label: "new row" },
  { keys: "Delete", label: "delete the row" },
];

/** One line for a tooltip or aria-label: "↑ ↓ ← → / j k h l move between cells · …". */
export function tableKeysHint(): string {
  const show = (keys: string) => keys.split(" / ").map((k) => (k.startsWith("mod+") ? formatKeys(k) : k)).join(" / ");
  return TABLE_KEYS.map((k) => `${show(k.keys)} ${k.label}`).join(" · ");
}

// ── Overrides from .cortex/settings.yaml (`keybindings: { id: keys }`) ───────
// Applied by Shell when settings load; the table above stays the default so a
// bad override can be shrugged off, never crash the keymap.
let overrides: Partial<Record<ShortcutId, string>> = {};

export function applyKeymapOverrides(map: Record<string, string> | undefined) {
  const next: Partial<Record<ShortcutId, string>> = {};
  for (const [id, keys] of Object.entries(map ?? {})) {
    if (!(id in SHORTCUTS)) { console.warn(`keybindings: unknown shortcut id "${id}"`); continue; }
    const k = keys.trim().toLowerCase();
    if (!k || !k.includes("+") && k.length !== 1) { console.warn(`keybindings: bad keys for "${id}": "${keys}"`); continue; }
    next[id as ShortcutId] = k;
  }
  overrides = next;
}

/** The keys currently bound to a shortcut — the override if set, else the default. */
export function keysFor(id: ShortcutId): string {
  return overrides[id] ?? SHORTCUTS[id].keys;
}

export const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

interface Combo {
  mod: boolean;
  shift: boolean;
  alt: boolean;
  key: string;
}

/** Names for keys whose `e.key` is awkward in a `+`-joined string. */
const KEY_ALIASES: Record<string, string> = { space: " " };

function parse(keys: string): Combo {
  const parts = keys.toLowerCase().split("+");
  const raw = parts.pop() ?? "";
  const key = KEY_ALIASES[raw] ?? raw;
  return {
    mod: parts.includes("mod"),
    shift: parts.includes("shift"),
    alt: parts.includes("alt"),
    key,
  };
}

/** Does this key event match the combo? Strict on modifiers: on Linux the
 *  Super key belongs to the window manager, so ⌘ never doubles as Ctrl. */
export function matches(e: KeyboardEvent, keys: string): boolean {
  const c = parse(keys);
  const mod = isMac ? e.metaKey : e.ctrlKey;
  const otherMod = isMac ? e.ctrlKey : e.metaKey;
  return (
    mod === c.mod &&
    !otherMod &&
    e.shiftKey === c.shift &&
    e.altKey === c.alt &&
    e.key.toLowerCase() === c.key
  );
}

/** The combo a key event spells, in the table's notation ("mod+shift+k"),
 *  or null while only modifiers are down. Used by the settings recorder. */
export function comboFromEvent(e: KeyboardEvent): string | null {
  const k = e.key.toLowerCase();
  if (["control", "meta", "shift", "alt", "altgraph", "capslock", "os", "fn", "hyper", "super", "dead"].includes(k)) return null;
  const mod = isMac ? e.metaKey : e.ctrlKey;
  const parts: string[] = [];
  if (mod) parts.push("mod");
  if (e.altKey) parts.push("alt");
  if (e.shiftKey) parts.push("shift");
  parts.push(k === " " ? "space" : k);
  return parts.join("+");
}

/** True when the user has overridden this shortcut in settings. */
export function isOverridden(id: ShortcutId): boolean {
  return overrides[id] !== undefined;
}

/** The shortcut (other than `except`) currently bound to `keys`, if any. */
export function conflictFor(keys: string, except?: ShortcutId): ShortcutId | null {
  const want = JSON.stringify(parse(keys));
  for (const id of Object.keys(SHORTCUTS) as ShortcutId[]) {
    if (id !== except && JSON.stringify(parse(keysFor(id))) === want) return id;
  }
  return null;
}

/** The shortcut this key event triggers, if any. */
export function findShortcut(e: KeyboardEvent): ShortcutId | null {
  for (const id of Object.keys(SHORTCUTS) as ShortcutId[]) {
    if (matches(e, keysFor(id))) return id;
  }
  return null;
}

/** Human-readable keys for the current platform: "⌘⇧K" on macOS, "Ctrl+Shift+K" elsewhere. */
export function formatKeys(keys: string): string {
  const c = parse(keys);
  const key = c.key === " " ? "Space" : c.key.length === 1 ? c.key.toUpperCase() : c.key.charAt(0).toUpperCase() + c.key.slice(1);
  if (isMac) {
    return `${c.mod ? "⌘" : ""}${c.alt ? "⌥" : ""}${c.shift ? "⇧" : ""}${key}`;
  }
  const parts = [];
  if (c.mod) parts.push("Ctrl");
  if (c.alt) parts.push("Alt");
  if (c.shift) parts.push("Shift");
  parts.push(key);
  return parts.join("+");
}

/** Display keys for a registered shortcut — the only way UI should render a hint. */
export function shortcutFor(id: ShortcutId): string {
  return formatKeys(keysFor(id));
}
