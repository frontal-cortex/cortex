import "@blocknote/mantine/style.css";
import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/mantine";
import { useEffect, useRef } from "react";
import { Note } from "../../lib/commands";
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
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const editor = useCreateBlockNote();

  // Populate editor from markdown when note loads (key prop resets on path change)
  useEffect(() => {
    if (note.body.trim()) {
      const blocks = editor.tryParseMarkdownToBlocks(note.body);
      editor.replaceBlocks(editor.document, blocks);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-save 1s after the last change
  useEffect(() => {
    const unsub = editor.onChange(async () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(async () => {
        const md = await editor.blocksToMarkdownLossy(editor.document);
        onSave({ ...note, body: md });
      }, 1000);
    });
    return () => {
      unsub();
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [editor, note, onSave]);

  const title = typeof note.frontmatter["title"] === "string"
    ? note.frontmatter["title"]
    : pathToTitle(note.path);

  const noteType = typeof note.frontmatter["type"] === "string"
    ? note.frontmatter["type"]
    : null;

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <h1 className={styles.title}>{title}</h1>
        <div className={styles.meta}>
          {noteType && <span className={styles.type}>{noteType}</span>}
          {saving && <span className={styles.saving}>Saving…</span>}
        </div>
      </div>
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
