// What greets you when no note is open.
//
// It used to say "No note open — select a note from the sidebar, or press
// Ctrl+N", which on a phone is a blank page, an invisible sidebar and a key
// that isn't there. This is the same moment answered with somewhere to go:
// today, the things you pinned, your databases, and what you were last reading.
import { useMemo } from "react";
import { NoteEntry } from "../../lib/commands";
import { TodayIcon, PlusIcon, DatabaseIcon, StarFilledIcon, FileIcon, SparkleIcon } from "./icons";
import styles from "./HomeScreen.module.css";

interface Props {
  vaultName: string;
  notes: NoteEntry[];
  favorites: string[];
  recent: string[];
  onOpen: (path: string) => void;
  onToday: () => void;
  onNew: () => void;
  onCapture: () => void;
}

/** The handful of rows under a heading, or nothing at all when there are none. */
function Section({ label, children }: { label: string; children: React.ReactNode[] }) {
  if (!children.length) return null;
  return (
    <section className={styles.section}>
      <h2 className={styles.sectionLabel}>{label}</h2>
      <div className={styles.rows}>{children}</div>
    </section>
  );
}

export function HomeScreen({ vaultName, notes, favorites, recent, onOpen, onToday, onNew, onCapture }: Props) {
  const byPath = useMemo(() => new Map(notes.map((n) => [n.path, n])), [notes]);

  // A pack's dashboard is a database page with nothing above it: Budget,
  // Habits, Nutrition. The collections underneath them carry a `parent:` and
  // stay where they are, in the tree.
  const dashboards = useMemo(
    () => notes
      .filter((n) => n.note_type === "database" && n.path.endsWith("/_index.md") && !n.parent)
      .sort((a, b) => a.title.localeCompare(b.title))
      .slice(0, 8),
    [notes],
  );

  const row = (path: string, fallbackIcon: React.ReactNode) => {
    const note = byPath.get(path);
    if (!note) return null;
    return (
      <button key={path} className={styles.row} onClick={() => onOpen(path)}>
        <span className={styles.rowIcon}>{note.icon ? <span className={styles.emoji}>{note.icon}</span> : fallbackIcon}</span>
        <span className={styles.rowTitle}>{note.title || path}</span>
      </button>
    );
  };

  return (
    <div className={styles.home}>
      <div className={styles.inner}>
        <h1 className={styles.title}>{vaultName}</h1>

        <div className={styles.actions}>
          <button className={styles.action} onClick={onToday}>
            <TodayIcon size={18} /> Today
          </button>
          <button className={styles.action} onClick={onCapture}>
            <SparkleIcon size={18} /> Capture
          </button>
          <button className={styles.action} onClick={onNew}>
            <PlusIcon size={18} /> New note
          </button>
        </div>

        <Section label="Pinned">
          {favorites.map((p) => row(p, <StarFilledIcon size={15} />)).filter(Boolean)}
        </Section>

        <Section label="Databases">
          {dashboards.map((d) => row(d.path, <DatabaseIcon size={15} />)).filter(Boolean)}
        </Section>

        <Section label="Recent">
          {recent.filter((p) => !favorites.includes(p)).slice(0, 6).map((p) => row(p, <FileIcon size={15} />)).filter(Boolean)}
        </Section>
      </div>
    </div>
  );
}
