import { CloseIcon, SparkleIcon } from "./icons";
import { LeafRow, A11yFor } from "./FileTree";
import styles from "./GettingStarted.module.css";

// ── First-run card ────────────────────────────────────────────────────────────
//
// Shown at the top of the notes section while the vault has at most one note.
// Each line is a real tree row: arrow keys reach it and Enter runs it, so the
// first thing a new user learns is that the sidebar answers to the keyboard.

export interface GettingStartedStep {
  id: string;
  label: string;
  /** Shortcut or short aside shown as the row's hint. */
  hint?: string;
  run: () => void;
}

export const GETTING_STARTED_KEY = "cortex.gettingStarted";

export function loadGettingStartedDismissed(): boolean {
  try {
    return localStorage.getItem(GETTING_STARTED_KEY) === "dismissed";
  } catch {
    return false;
  }
}

export function saveGettingStartedDismissed() {
  try {
    localStorage.setItem(GETTING_STARTED_KEY, "dismissed");
  } catch { /* private mode, blocked storage — the card just comes back next launch */ }
}

export function GettingStarted({
  steps, a11y, onDismiss,
}: {
  steps: GettingStartedStep[];
  a11y: A11yFor;
  onDismiss: () => void;
}) {
  return (
    <div className={styles.card} role="group" aria-label="Getting started">
      <div className={styles.head}>
        <span className={styles.headIcon}><SparkleIcon size={12} /></span>
        <span className={styles.title}>Getting started</span>
        <button
          className={styles.dismiss}
          tabIndex={-1}
          onClick={onDismiss}
          title="Dismiss (or press Delete on a step)"
        >
          <CloseIcon size={12} />
        </button>
      </div>
      {steps.map((step, i) => (
        <LeafRow
          key={step.id}
          id={step.id}
          a11y={a11y}
          depth={-1}
          icon={<span className={styles.step}>{i + 1}</span>}
          label={step.label}
          hint={step.hint}
          onClick={step.run}
          className={styles.stepRow}
        />
      ))}
    </div>
  );
}
