// ── Typing focus ─────────────────────────────────────────────────────────────
// Once you have been writing for a few seconds the sidebar steps out of the
// way, and it comes back the moment you reach for it.
//
// The rule is "after N seconds of typing", not "N seconds after a keystroke".
// A run of typing starts at the first key and survives the pauses inside a
// sentence, so thinking mid-paragraph does not reset it; two words typed and
// then abandoned never hide anything, because the run has to still be going
// when the time is up.
//
// Everything here is a pure decision over timestamps — the hook that owns the
// timers and the DOM is hooks/useTypingFocus.ts.

/** A run of typing: when it began, and when the last key landed. */
export interface TypingRun {
  startedAt: number;
  lastAt: number;
}

/** A pause longer than this ends a run; the next key starts a fresh one. */
export const IDLE_MS = 2500;

/** How far from the window's left edge counts as reaching for the sidebar. */
export const EDGE_PX = 16;

/** Fold a keystroke into the current run, starting one when the last is
 *  stale. */
export function noteKey(run: TypingRun | null, at: number, idleMs = IDLE_MS): TypingRun {
  if (!run || at - run.lastAt > idleMs) return { startedAt: at, lastAt: at };
  return { startedAt: run.startedAt, lastAt: at };
}

/** Whether a run has lasted `afterMs` and is still going. `afterMs <= 0` is
 *  the setting turned off. */
export function shouldHide(run: TypingRun | null, now: number, afterMs: number, idleMs = IDLE_MS): boolean {
  if (!run || afterMs <= 0) return false;
  return now - run.startedAt >= afterMs && now - run.lastAt <= idleMs;
}

/** When to look again: the moment the run comes of age, never in the past. */
export function nextCheckIn(run: TypingRun, now: number, afterMs: number): number {
  return Math.max(0, run.startedAt + afterMs - now);
}

/** Keys that are writing, as opposed to commands, navigation or shortcuts.
 *  Arrows and function keys spell their names, so a length of one is a
 *  character; Enter, Backspace and Delete are writing too. */
export function isTypingKey(e: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean }): boolean {
  if (e.ctrlKey || e.metaKey || e.altKey) return false;
  return e.key.length === 1 || e.key === "Enter" || e.key === "Backspace" || e.key === "Delete";
}
