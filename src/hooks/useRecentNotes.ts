// ── Recently opened notes ─────────────────────────────────────────────────────
//
// Kept in memory for the session and mirrored to `.brain/ui-state.json` by
// cortex-core (`ui_state`), so the list survives a restart but never a
// commit — `.brain/` is the gitignored cache. The write is fire-and-forget:
// remembering a note must never slow down opening it.

import { useCallback, useEffect, useState } from "react";
import { commands } from "../lib/commands";

export const MAX_RECENT_NOTES = 10;

export function useRecentNotes(vaultOpen: boolean) {
  const [recent, setRecent] = useState<string[]>([]);

  useEffect(() => {
    if (!vaultOpen) return;
    commands.getRecentNotes().then(setRecent).catch(() => setRecent([]));
  }, [vaultOpen]);

  /** Move `path` to the front of the list. */
  const record = useCallback((path: string) => {
    setRecent((prev) => (prev[0] === path ? prev : [path, ...prev.filter((p) => p !== path)].slice(0, MAX_RECENT_NOTES)));
    commands.recordRecentNote(path).catch(() => {});
  }, []);

  return { recent, record };
}
