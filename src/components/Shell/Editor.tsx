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
import { NoteHistoryModal } from "./NoteHistoryModal";
import { PlusIcon, HistoryIcon, TrashIcon } from "./icons";
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
  onApplyNote: (note: Note) => void;
}

export function Editor({
  note, saving, allNotes, onSave, onDelete, onNavigate, onRename, onApplyNote,
}: Props) {
  const [showHistory, setShowHistory] = useState(false);
  // Bumping `rev` forces NoteEditor to remount so it re-parses restored content.
  const [rev, setRev] = useState(0);

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
    <>
      <NoteEditor
        key={`${note.path}:${rev}`}
        note={note}
        saving={saving}
        allNotes={allNotes}
        onSave={onSave}
        onDelete={onDelete}
        onNavigate={onNavigate}
        onRename={onRename}
        onShowHistory={() => setShowHistory(true)}
      />
      {showHistory && (
        <NoteHistoryModal
          path={note.path}
          current={note}
          onClose={() => setShowHistory(false)}
          onRestored={(restored) => { onApplyNote(restored); setRev((r) => r + 1); }}
        />
      )}
    </>
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
  note, saving, allNotes, onSave, onDelete, onNavigate, onRename, onShowHistory,
}: {
  note: Note;
  saving: boolean;
  allNotes: NoteEntry[];
  onSave: (n: Note) => void;
  onDelete: (path: string) => void;
  onNavigate: (target: string) => void;
  onRename: (oldPath: string, newPath: string) => void;
  onShowHistory: () => void;
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
          {/* Cover image */}
          <CoverImage
            cover={typeof note.frontmatter["cover"] === "string" ? note.frontmatter["cover"] : null}
            onChange={(dataUri, relPath) => {
              if (relPath) dataUriToRelPath.set(dataUri, relPath);
              handleFrontmatterChange({ ...noteRef.current.frontmatter, cover: relPath ?? dataUri });
            }}
            onRemove={() => {
              const fm = { ...noteRef.current.frontmatter };
              delete fm["cover"];
              handleFrontmatterChange(fm);
            }}
          />

          {/* Breadcrumb */}
          <Breadcrumb path={note.path} />

          <div className={styles.header}>
            <NoteIconButton
              icon={icon}
              onEmojiClick={() => setShowEmojiPicker((x) => !x)}
              onImageUpload={async (file) => {
                const dataUri = await saveFileAsAsset(file);
                const relPath = dataUriToRelPath.get(dataUri);
                handleFrontmatterChange({ ...noteRef.current.frontmatter, icon: relPath ?? dataUri });
              }}
            />
            <input
              key={note.path}
              className={styles.titleInput}
              defaultValue={title}
              placeholder="Untitled"
              onChange={(e) => handleTitleChange(e.target.value)}
            />
            <div className={styles.headerActions}>
              {saving && <span className={styles.saving}>Saving…</span>}
              <button className={styles.deleteBtn} onClick={onShowHistory} title="Version history">
                <HistoryIcon />
              </button>
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

// ── Cover image banner ────────────────────────────────────────────────────────

function CoverImage({
  cover, onChange, onRemove,
}: {
  cover: string | null;
  onChange: (dataUri: string, relPath: string | undefined) => void;
  onRemove: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    if (!file.type.startsWith("image/")) return;
    const dataUri = await saveFileAsAsset(file);
    const relPath = dataUriToRelPath.get(dataUri);
    onChange(dataUri, relPath);
  };

  const [dragOver, setDragOver] = useState(false);

  // Resolve display URL: asset paths need to be converted to data URIs.
  const [displayUrl, setDisplayUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!cover) { setDisplayUrl(null); return; }
    if (cover.startsWith("data:") || cover.startsWith("http")) {
      setDisplayUrl(cover); return;
    }
    // It's a vault-relative path — read it as a data URI.
    import("../../lib/commands").then(({ commands }) =>
      commands.readAsset(cover).then(setDisplayUrl).catch(() => setDisplayUrl(null))
    );
  }, [cover]);

  if (!cover && !dragOver) {
    return (
      <div
        className={styles.coverEmpty}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      >
        <button
          className={styles.coverAddBtn}
          onClick={() => fileInputRef.current?.click()}
          title="Add cover image"
        >
          + Add cover
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
        />
      </div>
    );
  }

  return (
    <div
      className={`${styles.cover} ${dragOver ? styles.coverDragOver : ""}`}
      style={displayUrl ? { backgroundImage: `url(${displayUrl})` } : undefined}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault(); setDragOver(false);
        const file = e.dataTransfer.files[0];
        if (file) handleFile(file);
      }}
    >
      <div className={styles.coverActions}>
        <button className={styles.coverBtn} onClick={() => fileInputRef.current?.click()}>
          Change cover
        </button>
        <button className={styles.coverBtn} onClick={onRemove}>Remove</button>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
      />
    </div>
  );
}

// ── Note icon button (emoji + image upload) ───────────────────────────────────

function NoteIconButton({
  icon, onEmojiClick, onImageUpload,
}: {
  icon: string | null;
  onEmojiClick: () => void;
  onImageUpload: (file: File) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const isImage = icon && !icon.match(/\p{Emoji}/u) && (icon.startsWith("assets/") || icon.startsWith("data:"));
  const [imgSrc, setImgSrc] = useState<string | null>(null);

  useEffect(() => {
    if (!isImage || !icon) { setImgSrc(null); return; }
    if (icon.startsWith("data:")) { setImgSrc(icon); return; }
    import("../../lib/commands").then(({ commands }) =>
      commands.readAsset(icon).then(setImgSrc).catch(() => setImgSrc(null))
    );
  }, [icon, isImage]);

  return (
    <div className={styles.iconBtnGroup}>
      <button
        className={`${styles.iconBtn} ${!icon ? styles.iconBtnEmpty : ""}`}
        onClick={onEmojiClick}
        title={icon ? "Change icon" : "Add icon"}
      >
        {isImage && imgSrc
          ? <img src={imgSrc} alt="icon" className={styles.iconImage} />
          : icon
            ? <span className={styles.iconEmoji}>{icon}</span>
            : <span className={styles.iconPlaceholder}><PlusIcon size={20} /></span>}
      </button>
      <button
        className={styles.iconUploadBtn}
        onClick={() => fileRef.current?.click()}
        title="Use image as icon"
      >
        🖼
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onImageUpload(f); }}
      />
    </div>
  );
}
