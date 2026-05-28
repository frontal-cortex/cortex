import "@blocknote/mantine/style.css";
import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/mantine";
import { useEffect, useRef, useCallback } from "react";
import { Note } from "../../lib/commands";
import { wikiLinkExtension } from "../../lib/wikiLinkExtension";
import { PropertiesPanel } from "./PropertiesPanel";
import styles from "./Editor.module.css";

interface Props {
  note: Note | null;
  saving: boolean;
  onSave: (note: Note) => void;
  onDelete: (path: string) => void;
  onNavigate: (target: string) => void;
}

export function Editor({ note, saving, onSave, onDelete, onNavigate }: Props) {
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
      onSave={onSave}
      onDelete={onDelete}
      onNavigate={onNavigate}
    />
  );
}

function NoteEditor({
  note,
  saving,
  onSave,
  onDelete,
  onNavigate,
}: {
  note: Note;
  saving: boolean;
  onSave: (n: Note) => void;
  onDelete: (path: string) => void;
  onNavigate: (target: string) => void;
}) {
  const noteRef = useRef(note);
  noteRef.current = note;

  // Keep navigate ref so the extension doesn't close over stale state
  const navigateRef = useRef(onNavigate);
  navigateRef.current = onNavigate;

  const bodyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const titleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const editor = useCreateBlockNote({
    // _tiptapOptions is BlockNote's escape hatch for custom TipTap extensions
    _tiptapOptions: {
      extensions: [wikiLinkExtension((t) => navigateRef.current(t))],
    },
  });

  // Populate editor from markdown body on mount
  useEffect(() => {
    if (note.body.trim()) {
      const blocks = editor.tryParseMarkdownToBlocks(note.body);
      editor.replaceBlocks(editor.document, blocks);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-save body 1s after last keystroke
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

  const handleTitleChange = useCallback(
    (value: string) => {
      if (titleTimer.current) clearTimeout(titleTimer.current);
      titleTimer.current = setTimeout(() => {
        onSave({
          ...noteRef.current,
          frontmatter: { ...noteRef.current.frontmatter, title: value },
        });
      }, 500);
    },
    [onSave],
  );

  const handleFrontmatterChange = useCallback(
    (updated: Record<string, unknown>) => {
      onSave({ ...noteRef.current, frontmatter: updated });
    },
    [onSave],
  );

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
          <button
            className={styles.deleteBtn}
            onClick={() => onDelete(note.path)}
            title="Delete note"
          >
            <TrashIcon />
          </button>
        </div>
      </div>

      <PropertiesPanel
        frontmatter={note.frontmatter}
        onChange={handleFrontmatterChange}
      />

      <div className={styles.editorWrap}>
        <BlockNoteView editor={editor} />
      </div>
    </div>
  );
}

function pathToTitle(path: string): string {
  return (
    path
      .split("/")
      .pop()
      ?.replace(/\.md$/, "")
      .replace(/-/g, " ") ?? "Untitled"
  );
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
