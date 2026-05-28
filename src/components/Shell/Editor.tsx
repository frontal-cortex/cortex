import "@blocknote/mantine/style.css";
import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/mantine";
import { useEffect, useRef, useCallback } from "react";
import { Note } from "../../lib/commands";
import { PropertiesPanel } from "./PropertiesPanel";
import styles from "./Editor.module.css";

interface Props {
  note: Note | null;
  saving: boolean;
  onSave: (note: Note) => void;
}

export function Editor({ note, saving, onSave }: Props) {
  if (!note) {
    return (
      <div className={styles.empty}>
        <p>Select a note or create a new one</p>
      </div>
    );
  }

  return <NoteEditor key={note.path} note={note} saving={saving} onSave={onSave} />;
}

function NoteEditor({
  note,
  saving,
  onSave,
}: {
  note: Note;
  saving: boolean;
  onSave: (n: Note) => void;
}) {
  // Ref so callbacks always close over latest note without re-subscribing
  const noteRef = useRef(note);
  noteRef.current = note;

  const bodyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const titleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const editor = useCreateBlockNote();

  // Populate editor from markdown body on mount (key prop resets per note)
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

  // Debounced title save
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

  // Immediate frontmatter save (properties panel changes)
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
        {saving && <span className={styles.saving}>Saving…</span>}
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
