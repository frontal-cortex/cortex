import { useEffect, useMemo, useRef, useState, KeyboardEvent as ReactKeyboardEvent } from "react";
import { NoteEntry, TagNode } from "../../lib/commands";
import { displayTitle } from "../../lib/fileTree";
import { findTag, hasTag } from "../../lib/tags";
import { CloseIcon, FileIcon, TagIcon, ChevronRightIcon } from "./icons";
import styles from "./TagView.module.css";

// ── Tag page ──────────────────────────────────────────────────────────────────
// A saved-filter view: every note carrying the tag (or one of its children),
// newest first, with the child tags to narrow by. Nothing is written — the
// filter is the tag itself, and the list is the note index the shell already
// holds. Keyboard: ↑↓ / j k move, Enter opens, Escape closes.

interface Props {
  tag: string;
  tags: TagNode[];
  notes: NoteEntry[];
  onOpenTag: (tag: string) => void;
  onNavigate: (path: string) => void;
  onClose: () => void;
}

export function TagView({ tag, tags, notes, onOpenTag, onNavigate, onClose }: Props) {
  const node = useMemo(() => findTag(tags, tag), [tags, tag]);
  const display = node?.path ?? tag;
  const segments = display.split("/");
  const matching = useMemo(
    () => notes.filter((n) => !n.path.startsWith("templates/") && hasTag(n.tags, tag)),
    [notes, tag],
  );

  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => { setActive(0); }, [tag]);
  useEffect(() => { listRef.current?.focus(); }, [tag]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    switch (e.key) {
      case "ArrowDown": case "j": setActive((i) => Math.min(i + 1, matching.length - 1)); break;
      case "ArrowUp":   case "k": setActive((i) => Math.max(i - 1, 0)); break;
      case "Home": setActive(0); break;
      case "End":  setActive(Math.max(0, matching.length - 1)); break;
      case "Enter": if (matching[active]) onNavigate(matching[active].path); break;
      case "Backspace": case "h":
        if (segments.length > 1) onOpenTag(segments.slice(0, -1).join("/"));
        break;
      default: return;
    }
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <div className={styles.overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className={styles.modal} role="dialog" aria-label={`Notes tagged ${display}`}>
        <div className={styles.toolbar}>
          <span className={styles.toolbarIcon}><TagIcon size={14} /></span>
          <span className={styles.crumbs}>
            {segments.map((seg, i) => {
              const path = segments.slice(0, i + 1).join("/");
              const last = i === segments.length - 1;
              return (
                <span key={path} className={styles.crumb}>
                  {i > 0 && <span className={styles.crumbSep} aria-hidden><ChevronRightIcon size={11} /></span>}
                  {last
                    ? <span className={styles.crumbCurrent}>{i === 0 ? "#" : ""}{seg}</span>
                    : <button className={styles.crumbBtn} onClick={() => onOpenTag(path)} title={`#${path}`}>{i === 0 ? "#" : ""}{seg}</button>}
                </span>
              );
            })}
          </span>
          <span className={styles.toolbarHint}>{matching.length} note{matching.length === 1 ? "" : "s"}</span>
          <button className={styles.closeBtn} onClick={onClose} title="Close (Esc)"><CloseIcon size={15} /></button>
        </div>

        {node && node.children.length > 0 && (
          <div className={styles.children}>
            {node.children.map((c) => (
              <button key={c.path} className={styles.chip} onClick={() => onOpenTag(c.path)} title={`#${c.path}`}>
                {c.name}<span className={styles.chipCount}>{c.count}</span>
              </button>
            ))}
          </div>
        )}

        <div ref={listRef} className={styles.list} tabIndex={0} onKeyDown={onKeyDown} role="listbox" aria-activedescendant={matching[active] ? `tag-note-${active}` : undefined}>
          {matching.length === 0 && (
            <p className={styles.empty}>No notes carry <code>#{display}</code>. Type it in a note's body, or add it to <code>tags:</code>.</p>
          )}
          {matching.map((n, i) => {
            const folder = n.path.slice(0, n.path.lastIndexOf("/"));
            const others = n.tags.filter((t) => t.toLowerCase() !== display.toLowerCase());
            return (
              <div
                key={n.path}
                id={`tag-note-${i}`}
                data-idx={i}
                role="option"
                aria-selected={i === active}
                className={`${styles.row} ${i === active ? styles.rowActive : ""}`}
                onMouseEnter={() => setActive(i)}
                onClick={() => onNavigate(n.path)}
                title={n.path}
              >
                <span className={styles.rowIcon}>{n.icon ? <span className={styles.emoji}>{n.icon}</span> : <FileIcon />}</span>
                <span className={styles.rowTitle}>{displayTitle(n)}</span>
                <span className={styles.rowFolder}>{folder}</span>
                {others.length > 0 && (
                  <span className={styles.rowTags}>
                    {others.slice(0, 4).map((t) => (
                      <button
                        key={t}
                        className={styles.rowTag}
                        tabIndex={-1}
                        onClick={(e) => { e.stopPropagation(); onOpenTag(t); }}
                        title={`Open #${t}`}
                      >#{t}</button>
                    ))}
                  </span>
                )}
              </div>
            );
          })}
        </div>

        <div className={styles.hint}>
          <kbd>↑↓</kbd> move · <kbd>Enter</kbd> open · {segments.length > 1 && <><kbd>h</kbd> parent tag · </>}<kbd>Esc</kbd> close
        </div>
      </div>
    </div>
  );
}
