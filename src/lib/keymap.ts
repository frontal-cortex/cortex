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
  | "monk-mode";

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
};

export const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

interface Combo {
  mod: boolean;
  shift: boolean;
  alt: boolean;
  key: string;
}

function parse(keys: string): Combo {
  const parts = keys.toLowerCase().split("+");
  const key = parts.pop() ?? "";
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

/** The shortcut this key event triggers, if any. */
export function findShortcut(e: KeyboardEvent): ShortcutId | null {
  for (const id of Object.keys(SHORTCUTS) as ShortcutId[]) {
    if (matches(e, SHORTCUTS[id].keys)) return id;
  }
  return null;
}

/** Human-readable keys for the current platform: "⌘⇧K" on macOS, "Ctrl+Shift+K" elsewhere. */
export function formatKeys(keys: string): string {
  const c = parse(keys);
  const key = c.key.length === 1 ? c.key.toUpperCase() : c.key;
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
  return formatKeys(SHORTCUTS[id].keys);
}
