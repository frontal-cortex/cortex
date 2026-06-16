// ── DatabaseView ──────────────────────────────────────────────────────────────
// The Notion-style database page: a header (icon, title, options) over the
// shared DataViews tab engine. Views persist to the `_index.md` frontmatter.

import { useState, useEffect, useRef } from "react";
import Picker from "@emoji-mart/react";
import emojiData from "@emoji-mart/data";
import { Note, ViewDef } from "../../lib/commands";
import { parseViews, defaultViews, viewToFrontmatter, viewSource } from "../../lib/database";
import { exportToFile } from "../../lib/export";
import { DataViews } from "./DataViews";
import styles from "./DatabaseView.module.css";

interface Props {
  note: Note;
  collectionName: string;
  onSave: (note: Note) => void;
  onConvertToNote: (name: string) => void;
}

function useOutside(onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [onClose]);
  return ref;
}

export function DatabaseView({ note, collectionName, onSave, onConvertToNote }: Props) {
  const source = viewSource(collectionName);
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useOutside(() => setShowMenu(false));

  const [views, setViews] = useState<ViewDef[]>(() => {
    const v = parseViews(note.frontmatter);
    return v.length ? v : defaultViews();
  });

  // Re-seed when navigating to a different database.
  useEffect(() => {
    const v = parseViews(note.frontmatter);
    setViews(v.length ? v : defaultViews());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note.path]);

  const persistViews = (next: ViewDef[]) => {
    setViews(next);
    onSave({ ...note, frontmatter: { ...note.frontmatter, type: "database", views: next.map(viewToFrontmatter) } });
  };

  const title = typeof note.frontmatter["title"] === "string" ? (note.frontmatter["title"] as string) : collectionName;
  const icon = typeof note.frontmatter["icon"] === "string" ? (note.frontmatter["icon"] as string) : "🗃️";
  const setMeta = (patch: Record<string, unknown>) =>
    onSave({ ...note, frontmatter: { ...note.frontmatter, ...patch } });
  const [showEmoji, setShowEmoji] = useState(false);

  return (
    <div className={styles.root}>
      <div className={styles.inner}>
        <div className={styles.header}>
          <button className={styles.icon} onClick={() => setShowEmoji((s) => !s)} title="Change icon">{icon}</button>
          <input
            className={styles.title}
            defaultValue={title}
            key={note.path}
            placeholder="Untitled database"
            onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== title) setMeta({ title: v }); }}
          />
          <div className={styles.headerMenu} ref={menuRef}>
            <button className={styles.menuBtn} title="Database options" onClick={() => setShowMenu((s) => !s)}>⋯</button>
            {showMenu && (
              <div className={styles.menu}>
                <button
                  className={styles.menuItem}
                  onClick={() => { setShowMenu(false); exportToFile("collection-csv", source, `${collectionName}.csv`); }}
                >
                  Export to CSV
                </button>
                <button
                  className={styles.menuItem}
                  onClick={() => { setShowMenu(false); exportToFile("collection-html", source, `${collectionName}.html`); }}
                >
                  Export to HTML
                </button>
                <button
                  className={styles.menuItem}
                  onClick={() => { setShowMenu(false); onConvertToNote(collectionName); }}
                >
                  Convert to checklist note
                </button>
              </div>
            )}
          </div>
        </div>
        {showEmoji && (
          <div className={styles.emojiWrap}>
            <Picker data={emojiData} theme="auto" previewPosition="none" skinTonePosition="none"
              onEmojiSelect={(e: { native: string }) => { setMeta({ icon: e.native }); setShowEmoji(false); }} />
          </div>
        )}

        <DataViews key={source} source={source} views={views} onViewsChange={persistViews} />
      </div>
    </div>
  );
}
