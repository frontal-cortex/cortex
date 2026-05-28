import "@blocknote/mantine/style.css";
import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/mantine";
import { useEffect, useRef, useCallback, useMemo, useState } from "react";
import { Note, NoteEntry } from "../../lib/commands";
import { wikiLinkExtension } from "../../lib/wikiLinkExtension";
import { wikiLinkSuggestionExtension, SuggestionCoords, SuggestionHandle } from "../../lib/wikiLinkSuggestion";
import { PropertiesPanel } from "./PropertiesPanel";
import { BacklinksPanel } from "./BacklinksPanel";
import { WikiLinkDropdown } from "./WikiLinkDropdown";
import styles from "./Editor.module.css";

interface Props {
  note: Note | null;
  saving: boolean;
  allNotes: NoteEntry[];
  onSave: (note: Note) => void;
  onDelete: (path: string) => void;
  onNavigate: (target: string) => void;
}

export function Editor({ note, saving, allNotes, onSave, onDelete, onNavigate }: Props) {
  if (!note) {
    return (
      <div className={styles.empty}>
        <p>Select a note or create a new one</p>
      </div>
    );
  }

  return (
    <NoteEditor
      key={note.path}
      note={note}
      saving={saving}
      allNotes={allNotes}
      onSave={onSave}
      onDelete={onDelete}
      onNavigate={onNavigate}
    />
  );
}

interface SuggestionState {
  query: string;
  coords: SuggestionCoords;
  from: number;
}

function NoteEditor({
  note, saving, allNotes, onSave, onDelete, onNavigate,
}: {
  note: Note;
  saving: boolean;
  allNotes: NoteEntry[];
  onSave: (n: Note) => void;
  onDelete: (path: string) => void;
  onNavigate: (target: string) => void;
}) {
  const noteRef = useRef(note);
  noteRef.current = note;

  const navigateRef = useRef(onNavigate);
  navigateRef.current = onNavigate;

  const bodyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const titleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Suggestion state ───────────────────────────────────────────────────────
  const [suggestion, setSuggestion] = useState<SuggestionState | null>(null);
  const [suggActiveIdx, setSuggActiveIdx] = useState(0);

  // Refs so the ProseMirror plugin always calls the latest versions
  const keyHandlerRef = useRef<((key: string) => boolean) | null>(null);
  const callbacksRef = useRef({
    onOpen: (_q: string, _c: SuggestionCoords, _f: number) => {},
    onUpdate: (_q: string, _c: SuggestionCoords, _f: number) => {},
    onClose: () => {},
  });

  // Filtered note list for the suggestion dropdown
  const filteredSuggestions = useMemo(() => {
    if (!suggestion) return [];
    const q = suggestion.query.toLowerCase();
    if (!q) return allNotes.slice(0, 8);
    return allNotes
      .filter((n) =>
        n.title.toLowerCase().includes(q) ||
        n.path.split("/").pop()?.replace(/\.md$/, "").toLowerCase().includes(q),
      )
      .slice(0, 8);
  }, [suggestion, allNotes]);

  // Keep filteredSuggestions accessible in the key handler without stale closure
  const filteredRef = useRef(filteredSuggestions);
  filteredRef.current = filteredSuggestions;

  const suggActiveIdxRef = useRef(suggActiveIdx);
  suggActiveIdxRef.current = suggActiveIdx;

  // ── Editor ─────────────────────────────────────────────────────────────────
  const handle: SuggestionHandle = useMemo(() => ({
    keyHandler: keyHandlerRef,
    callbacks: callbacksRef,
  }), []);

  const editor = useCreateBlockNote({
    _tiptapOptions: {
      extensions: [
        wikiLinkExtension((t) => navigateRef.current(t)),
        wikiLinkSuggestionExtension(handle),
      ],
    },
  });

  // Wire suggestion callbacks (updated every render via ref)
  callbacksRef.current = {
    onOpen: (query, coords, from) => {
      setSuggestion({ query, coords, from });
      setSuggActiveIdx(0);
    },
    onUpdate: (query, coords, from) => {
      setSuggestion({ query, coords, from });
      setSuggActiveIdx(0);
    },
    onClose: () => setSuggestion(null),
  };

  // ── Suggestion insertion ───────────────────────────────────────────────────
  const insertSuggestion = useCallback((title: string) => {
    if (!suggestion) return;
    const { from } = suggestion;
    const to = editor._tiptapEditor.state.selection.from;

    editor._tiptapEditor.commands.command(({ tr, dispatch }) => {
      if (dispatch) {
        tr.replaceWith(from, to, editor._tiptapEditor.schema.text(`[[${title}]]`));
      }
      return true;
    });

    setSuggestion(null);
  }, [editor, suggestion]);

  // Wire key handler (updated every render via ref)
  keyHandlerRef.current = (key: string) => {
    if (!suggestion) return false;
    const items = filteredRef.current;
    const idx = suggActiveIdxRef.current;

    if (key === "ArrowDown") { setSuggActiveIdx((i) => Math.min(i + 1, items.length - 1)); return true; }
    if (key === "ArrowUp")   { setSuggActiveIdx((i) => Math.max(i - 1, 0)); return true; }
    if (key === "Enter" || key === "Tab") {
      if (items[idx]) insertSuggestion(items[idx].title || pathToTitle(items[idx].path));
      return true;
    }
    if (key === "Escape") { setSuggestion(null); return true; }
    return false;
  };

  // ── Editor population & auto-save ─────────────────────────────────────────
  useEffect(() => {
    if (note.body.trim()) {
      const blocks = editor.tryParseMarkdownToBlocks(note.body);
      editor.replaceBlocks(editor.document, blocks);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const unsub = editor.onChange(async () => {
      if (bodyTimer.current) clearTimeout(bodyTimer.current);
      bodyTimer.current = setTimeout(async () => {
        const md = await editor.blocksToMarkdownLossy(editor.document);
        onSave({ ...noteRef.current, body: md });
      }, 1000);
    });
    return () => {
      unsub();
      if (bodyTimer.current) clearTimeout(bodyTimer.current);
    };
  }, [editor, onSave]);

  const handleTitleChange = useCallback((value: string) => {
    if (titleTimer.current) clearTimeout(titleTimer.current);
    titleTimer.current = setTimeout(() => {
      onSave({ ...noteRef.current, frontmatter: { ...noteRef.current.frontmatter, title: value } });
    }, 500);
  }, [onSave]);

  const handleFrontmatterChange = useCallback((updated: Record<string, unknown>) => {
    onSave({ ...noteRef.current, frontmatter: updated });
  }, [onSave]);

  const title =
    typeof note.frontmatter["title"] === "string"
      ? note.frontmatter["title"]
      : pathToTitle(note.path);

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <input
          key={note.path}
          className={styles.titleInput}
          defaultValue={title}
          placeholder="Untitled"
          onChange={(e) => handleTitleChange(e.target.value)}
        />
        <div className={styles.headerActions}>
          {saving && <span className={styles.saving}>Saving…</span>}
          <button className={styles.deleteBtn} onClick={() => onDelete(note.path)} title="Delete note">
            <TrashIcon />
          </button>
        </div>
      </div>

      <PropertiesPanel frontmatter={note.frontmatter} onChange={handleFrontmatterChange} />

      <div className={styles.editorWrap}>
        <BlockNoteView editor={editor} />
      </div>

      <BacklinksPanel path={note.path} onNavigate={onNavigate} />

      {suggestion && (
        <WikiLinkDropdown
          query={suggestion.query}
          notes={filteredSuggestions}
          coords={suggestion.coords}
          activeIndex={suggActiveIdx}
          onSelect={insertSuggestion}
          onClose={() => setSuggestion(null)}
        />
      )}
    </div>
  );
}

function pathToTitle(path: string): string {
  return path.split("/").pop()?.replace(/\.md$/, "").replace(/-/g, " ") ?? "Untitled";
}

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </svg>
  );
}
