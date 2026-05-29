import "@blocknote/mantine/style.css";
import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/mantine";
import { useEffect, useRef, useCallback, useMemo, useState } from "react";
import Picker from "@emoji-mart/react";
import data from "@emoji-mart/data";
import { Extension } from "@tiptap/core";
import { Plugin } from "prosemirror-state";
import { Note, NoteEntry, commands } from "../../lib/commands";
import { wikiLinkExtension } from "../../lib/wikiLinkExtension";
import { wikiLinkSuggestionExtension, SuggestionCoords, SuggestionHandle } from "../../lib/wikiLinkSuggestion";
import { PropertiesPanel } from "./PropertiesPanel";
import { BacklinksPanel } from "./BacklinksPanel";
import { WikiLinkDropdown } from "./WikiLinkDropdown";
import styles from "./Editor.module.css";

// Maps data URIs → vault-relative paths (e.g. "assets/image-123.png")
// so that on save we can write the clean path instead of the data URI.
const dataUriToRelPath = new Map<string, string>();

function uint8ToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

/** Save file to vault/assets/, return a data URI for BlockNote to display. */
async function saveFileAsAsset(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const relPath = await commands.saveAsset(file.name, uint8ToBase64(bytes));
  // Read it back as a data URI so BlockNote can render it without asset:// scope issues
  const dataUri = await commands.readAsset(relPath);
  dataUriToRelPath.set(dataUri, relPath);
  return dataUri;
}

/** Replace `assets/X` paths with data URIs so BlockNote can display them. */
async function assetsToDisplayUrls(body: string): Promise<string> {
  const matches = [...body.matchAll(/!\[([^\]]*)\]\(assets\/([^)\s]+)\)/g)];
  let result = body;
  for (const [full, alt, filename] of matches) {
    const relPath = `assets/${filename}`;
    try {
      let dataUri = [...dataUriToRelPath.entries()].find(([, p]) => p === relPath)?.[0];
      if (!dataUri) {
        dataUri = await commands.readAsset(relPath);
        dataUriToRelPath.set(dataUri, relPath);
      }
      result = result.replace(full, `![${alt}](${dataUri})`);
    } catch {
      // Asset missing on disk — leave reference as-is
    }
  }
  return result;
}

/** Replace data URI display URLs back to vault-relative `assets/X` paths for storage. */
function displayUrlsToAssets(body: string): string {
  // data URIs are very long — replace each known mapping
  let result = body;
  for (const [dataUri, relPath] of dataUriToRelPath.entries()) {
    // Escape for regex
    const escaped = dataUri.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    result = result.replace(new RegExp(escaped, "g"), relPath);
  }
  return result;
}

interface Props {
  note: Note | null;
  saving: boolean;
  allNotes: NoteEntry[];
  vaultPath?: string;
  onSave: (note: Note) => void;
  onDelete: (path: string) => void;
  onNavigate: (target: string) => void;
  onRename: (oldPath: string, newPath: string) => void;
}

export function Editor({ note, saving, allNotes, onSave, onDelete, onNavigate, onRename }: Props) {
  if (!note) {
    return (
      <div className={styles.empty}>
        <p className={styles.emptyTitle}>No note open</p>
        <p className={styles.emptyHint}>
          Select a note from the sidebar, or press{" "}
          <kbd className={styles.emptyKbd}>⌘N</kbd> to create one.
        </p>
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
      onRename={onRename}
    />
  );
}

interface SuggestionState {
  query: string;
  coords: SuggestionCoords;
  from: number;
}

function titleToSlug(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "") || "untitled";
}

function NoteEditor({
  note, saving, allNotes, onSave, onDelete, onNavigate, onRename,
}: {
  note: Note;
  saving: boolean;
  allNotes: NoteEntry[];
  onSave: (n: Note) => void;
  onDelete: (path: string) => void;
  onNavigate: (target: string) => void;
  onRename: (oldPath: string, newPath: string) => void;
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

  // Ref so the paste/drop plugin can access the editor after creation
  const editorRef = useRef<ReturnType<typeof useCreateBlockNote> | null>(null);

  const imagePasteDropExtension = useMemo(() => Extension.create({
    name: "imagePasteDrop",
    addProseMirrorPlugins() {
      return [new Plugin({
        props: {
          handlePaste(_view, event) {
            const items = event.clipboardData?.items;
            if (!items) return false;
            for (const item of Array.from(items)) {
              if (!item.type.startsWith("image/")) continue;
              const file = item.getAsFile();
              if (!file) continue;
              event.preventDefault();
              saveFileAsAsset(file).then((url) => {
                const ed = editorRef.current;
                if (!ed) return;
                const pos = ed.getTextCursorPosition();
                if (pos) ed.insertBlocks([{ type: "image", props: { url } }], pos.block, "after");
              });
              return true;
            }
            return false;
          },
          handleDrop(_view, event) {
            const files = event.dataTransfer?.files;
            if (!files?.length) return false;
            for (const file of Array.from(files)) {
              if (!file.type.startsWith("image/")) continue;
              event.preventDefault();
              saveFileAsAsset(file).then((url) => {
                const ed = editorRef.current;
                if (!ed) return;
                const pos = ed.getTextCursorPosition();
                if (pos) ed.insertBlocks([{ type: "image", props: { url } }], pos.block, "after");
              });
              return true;
            }
            return false;
          },
        },
      })];
    },
  }), []);

  const editor = useCreateBlockNote({
    uploadFile: (file) => saveFileAsAsset(file),
    _tiptapOptions: {
      extensions: [
        wikiLinkExtension((t) => navigateRef.current(t)),
        wikiLinkSuggestionExtension(handle),
        imagePasteDropExtension,
      ],
    },
  });

  editorRef.current = editor;

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
      assetsToDisplayUrls(note.body).then((displayBody) => {
        const blocks = editor.tryParseMarkdownToBlocks(displayBody);
        editor.replaceBlocks(editor.document, blocks);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const unsub = editor.onChange(async () => {
      if (bodyTimer.current) clearTimeout(bodyTimer.current);
      bodyTimer.current = setTimeout(async () => {
        const md = await editor.blocksToMarkdownLossy(editor.document);
        const cleanMd = displayUrlsToAssets(md);
        onSave({ ...noteRef.current, body: cleanMd });
      }, 1000);
    });
    return () => {
      unsub();
      if (bodyTimer.current) clearTimeout(bodyTimer.current);
    };
  }, [editor, onSave]);

  const onRenameRef = useRef(onRename);
  onRenameRef.current = onRename;

  const handleTitleChange = useCallback((value: string) => {
    if (titleTimer.current) clearTimeout(titleTimer.current);
    titleTimer.current = setTimeout(() => {
      onSave({ ...noteRef.current, frontmatter: { ...noteRef.current.frontmatter, title: value } });

      const slug = titleToSlug(value);
      const created = (noteRef.current.frontmatter["created"] as string) ?? new Date().toISOString().split("T")[0];
      const parts = noteRef.current.path.split("/");
      const dir = parts.slice(0, -1).join("/");
      const newPath = `${dir}/${slug}-${created}.md`;
      if (newPath !== noteRef.current.path) {
        onRenameRef.current(noteRef.current.path, newPath);
      }
    }, 600);
  }, [onSave]);

  const handleFrontmatterChange = useCallback((updated: Record<string, unknown>) => {
    onSave({ ...noteRef.current, frontmatter: updated });
  }, [onSave]);

  const title =
    typeof note.frontmatter["title"] === "string"
      ? note.frontmatter["title"]
      : pathToTitle(note.path);

  const icon = typeof note.frontmatter["icon"] === "string" ? note.frontmatter["icon"] : null;
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);

  const handleIconSelect = useCallback((emoji: { native: string }) => {
    setShowEmojiPicker(false);
    handleFrontmatterChange({ ...noteRef.current.frontmatter, icon: emoji.native });
  }, [handleFrontmatterChange]);

  return (
    <div className={styles.root}>
      <div className={styles.docWrap}>
        <div className={styles.docInner}>
          {/* Breadcrumb */}
          <Breadcrumb path={note.path} />

          <div className={styles.header}>
            <button
              className={`${styles.iconBtn} ${!icon ? styles.iconBtnEmpty : ""}`}
              onClick={() => setShowEmojiPicker((x) => !x)}
              title={icon ? "Change icon" : "Add icon"}
            >
              {icon
                ? <span className={styles.iconEmoji}>{icon}</span>
                : <span className={styles.iconPlaceholder}>＋</span>}
            </button>
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
          {showEmojiPicker && (
            <div className={styles.emojiPickerWrap}>
              <Picker data={data} onEmojiSelect={handleIconSelect} theme="auto" previewPosition="none" skinTonePosition="none" />
            </div>
          )}

          <PropertiesPanel frontmatter={note.frontmatter} onChange={handleFrontmatterChange} />

          <div className={styles.editorWrap}>
            <BlockNoteView editor={editor} />
          </div>

          <BacklinksPanel path={note.path} onNavigate={onNavigate} />
        </div>
      </div>

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

function Breadcrumb({ path }: { path: string }) {
  const parts = path.split("/");
  const dirs = parts.slice(0, -1);
  if (dirs.length === 0) return null;
  return (
    <div className={styles.breadcrumb}>
      {dirs.map((seg, i) => (
        <span key={i}>
          {i > 0 && <span className={styles.breadcrumbSep}>›</span>}
          <span className={styles.breadcrumbSeg}>{seg}</span>
        </span>
      ))}
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
