// ── Log habit ─────────────────────────────────────────────────────────────────
// The fastest way to tick today's habits: `mod+shift+h` or "Log habit…" in the
// palette opens every tracker in the vault as a Today checklist. Press 1–9 to
// tick, Escape to leave. Same data as the Marketplace's habit tracker; the
// modal is only a window onto the tracker view in its compact form.

import { useEffect, useState } from "react";
import { commands, TrackerRef } from "../../lib/commands";
import { TrackerView } from "./TrackerView";
import { CloseIcon, TrackerIcon } from "./icons";
import styles from "./LogHabitModal.module.css";

export function LogHabitModal({ onClose, onChanged }: { onClose: () => void; onChanged?: () => void }) {
  const [trackers, setTrackers] = useState<TrackerRef[] | null>(null);
  useEffect(() => {
    commands.listTrackers().then(setTrackers).catch(() => setTrackers([]));
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  // One entry per collection (its first tracker view), forced to today's range.
  const byCollection = new Map<string, TrackerRef>();
  for (const t of trackers ?? []) if (!byCollection.has(t.collection)) byCollection.set(t.collection, t);
  const todaySpec = (spec: string) => spec.split("\n").filter((l) => !/^range:/.test(l) && l.trim()).concat("range: today").join("\n") + "\n";

  return (
    <div className={styles.backdrop} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={styles.modal} role="dialog" aria-label="Log habit">
        <div className={styles.head}>
          <TrackerIcon size={15} />
          <span className={styles.title}>Today</span>
          <span className={styles.hint}>1–9 tick · Esc close</span>
          <button className={styles.close} onClick={onClose} title="Close (Esc)"><CloseIcon size={15} /></button>
        </div>
        {trackers === null ? (
          <div className={styles.stub}>Loading…</div>
        ) : byCollection.size === 0 ? (
          <div className={styles.stub}>
            No tracker yet. Install the Habit Tracker from the marketplace, or add a Tracker view to a database.
          </div>
        ) : (
          [...byCollection.values()].map((t) => (
            <section key={t.collection} className={styles.section}>
              {byCollection.size > 1 && <div className={styles.sectionTitle}>{t.collection}</div>}
              <TrackerAuto spec={todaySpec(t.spec)} source={`collections/${t.collection}`} onChanged={onChanged} />
            </section>
          ))
        )}
      </div>
    </div>
  );
}

/** A compact tracker that takes keyboard focus as soon as it mounts. */
function TrackerAuto({ spec, source, onChanged }: { spec: string; source: string; onChanged?: () => void }) {
  return (
    <div ref={(el) => { el?.querySelector<HTMLElement>("[tabindex='0']")?.focus(); }}>
      <TrackerView spec={spec} source={source} onChanged={onChanged} compact />
    </div>
  );
}
