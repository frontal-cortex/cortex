import "@blocknote/mantine/style.css";
import {
  useCreateBlockNote, SuggestionMenuController, getDefaultReactSlashMenuItems,
  FormattingToolbar, FormattingToolbarController, getFormattingToolbarItems, useComponentsContext,
} from "@blocknote/react";
import { filterSuggestionItems } from "@blocknote/core/extensions";
import { BlockNoteView } from "@blocknote/mantine";
import { useEffect, useRef, useCallback, useMemo, useState } from "react";
import Picker from "@emoji-mart/react";
import data from "@emoji-mart/data";
import { Extension } from "@tiptap/core";
import { Plugin } from "prosemirror-state";
import { useColorScheme } from "../../hooks/useColorScheme";
import { Note, NoteEntry, CommitEntry, Member, commands } from "../../lib/commands";
import { CollabConfig, CollabSession, createNoteSession } from "../../lib/collab";
import { wikiLinkExtension } from "../../lib/wikiLinkExtension";
import { wikiLinkSuggestionExtension, SuggestionCoords, SuggestionHandle, SuggestionTrigger } from "../../lib/wikiLinkSuggestion";
import { PropertiesPanel } from "./PropertiesPanel";
import { BacklinksPanel } from "./BacklinksPanel";
import { WikiLinkDropdown, SuggestItem } from "./WikiLinkDropdown";
import { NoteHistoryModal } from "./NoteHistoryModal";
import { PlusIcon, HistoryIcon, TrashIcon, TableIcon } from "./icons";
import { cortexSchema, inflateViewBlocks, flattenViewBlocks, cortexSlashItems } from "./CortexViewBlock";
import { inflateEmbeds, flattenEmbeds, noteEmbedSlashItem } from "./NoteEmbedBlock";
import { inflateCallouts, flattenCallouts, calloutSlashItem } from "./CalloutBlock";
import { shortcutFor } from "../../lib/keymap";
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
  /** Bumped by the shell when the note's file changed on disk (e.g. a sync
   *  pulled teammate edits) — remounts the editor so it re-parses content. */
  reloadToken?: number;
  /** Relay config for live co-editing + presence; null = solo mode. */
  collab?: CollabConfig | null;
  /** Monk mode: just the page — no properties, backlinks, or action buttons. */
  monk?: boolean;
  onSave: (note: Note) => void;
  onDelete: (path: string) => void;
  onNavigate: (target: string) => void;
  onApplyNote: (note: Note) => void;
}

export function Editor({
  note, saving, allNotes, reloadToken = 0, collab = null, monk = false, onSave, onDelete, onNavigate, onApplyNote,
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
          <kbd className={styles.emptyKbd}>{shortcutFor("new-note")}</kbd> to create one.
        </p>
      </div>
    );
  }

  return (
    <>
      <NoteEditor
        // `collab` in the key: the config loads async, so a session arriving
        // after first mount remounts the editor into collaborative mode.
        key={`${note.path}:${rev}:${reloadToken}:${collab ? "c" : "s"}`}
        note={note}
        saving={saving}
        allNotes={allNotes}
        collab={collab}
        monk={monk}
        onSave={onSave}
        onDelete={onDelete}
        onNavigate={onNavigate}
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
  trigger: SuggestionTrigger;
}

/** An item offered in the suggestion dropdown: a note to wiki-link, or (for `@`)
 *  a date to insert as plain text. `display` is what the dropdown renders. */
type MentionItem =
  | { kind: "note"; note: NoteEntry; display: SuggestItem }
  | { kind: "date"; value: string; display: SuggestItem }
  | { kind: "person"; name: string; display: SuggestItem };

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Relative-date shortcuts offered after `@`, filtered by the typed query. */
function dateSuggestions(query: string): MentionItem[] {
  const now = new Date();
  const mk = (label: string, d: Date): MentionItem => {
    const value = isoDate(d);
    return { kind: "date", value, display: { key: `date:${label}`, title: label, badge: "Date", subtitle: value } };
  };
  const all = [
    mk("Today", now),
    mk("Tomorrow", new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)),
    mk("Yesterday", new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)),
  ];
  const q = query.toLowerCase();
  if (!q) return all;
  return all.filter((it) => it.display.title.toLowerCase().includes(q) || it.display.subtitle?.includes(q));
}

function noteItem(note: NoteEntry): MentionItem {
  return {
    kind: "note",
    note,
    display: {
      key: note.path,
      title: note.title || pathToTitle(note.path),
      badge: note.note_type ?? undefined,
      subtitle: note.path.split("/").pop()?.replace(/\.md$/, ""),
    },
  };
}

/** Team members offered after `@`, filtered by the typed query. */
function personItems(members: Member[], query: string): MentionItem[] {
  const q = query.toLowerCase();
  return members
    .filter((m) => m.name && (!q || m.name.toLowerCase().includes(q)))
    .map((m) => ({
      kind: "person" as const,
      name: m.name,
      display: { key: `person:${m.name}`, title: m.name, badge: "Person" },
    }));
}

function NoteEditor({
  note, saving, allNotes, collab, monk, onSave, onDelete, onNavigate, onShowHistory,
}: {
  note: Note;
  saving: boolean;
  allNotes: NoteEntry[];
  collab: CollabConfig | null;
  monk: boolean;
  onSave: (n: Note) => void;
  onDelete: (path: string) => void;
  onNavigate: (target: string) => void;
  onShowHistory: () => void;
}) {
  const noteRef = useRef(note);
  noteRef.current = note;

  const navigateRef = useRef(onNavigate);
  navigateRef.current = onNavigate;

  // ── Live co-editing session (one Yjs room per note path) ───────────────────
  // Created synchronously so it exists before useCreateBlockNote runs. The
  // component is keyed by note path + collab mode, so both are fixed per mount.
  const collabSession = useMemo<CollabSession | null>(
    () => (collab ? createNoteSession(collab, note.path) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  useEffect(() => () => { collabSession?.destroy(); }, [collabSession]);

  // Other people in this note right now (from the room's awareness states).
  const [peers, setPeers] = useState<{ name: string; color: string }[]>([]);
  useEffect(() => {
    if (!collabSession) return;
    const aw = collabSession.provider.awareness;
    const update = () => {
      const others: { name: string; color: string }[] = [];
      aw.getStates().forEach((s, id) => {
        if (id !== aw.clientID && s.user) others.push(s.user as { name: string; color: string });
      });
      setPeers(others);
    };
    aw.on("change", update);
    update();
    return () => aw.off("change", update);
  }, [collabSession]);

  const bodyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const titleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Suggestion state ───────────────────────────────────────────────────────
  const [suggestion, setSuggestion] = useState<SuggestionState | null>(null);
  const [suggActiveIdx, setSuggActiveIdx] = useState(0);

  // Refs so the ProseMirror plugin always calls the latest versions
  const keyHandlerRef = useRef<((key: string) => boolean) | null>(null);
  const callbacksRef = useRef({
    onOpen: (_q: string, _c: SuggestionCoords, _f: number, _t: SuggestionTrigger) => {},
    onUpdate: (_q: string, _c: SuggestionCoords, _f: number, _t: SuggestionTrigger) => {},
    onClose: () => {},
  });

  // Team roster, for `@person` mentions.
  const [members, setMembers] = useState<Member[]>([]);
  useEffect(() => {
    let alive = true;
    commands.getMembers().then((m) => { if (alive) setMembers(m); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  // Unified item list for the suggestion dropdown: notes for `[[`; people, dates,
  // and notes for `@`.
  const filteredItems = useMemo<MentionItem[]>(() => {
    if (!suggestion) return [];
    const q = suggestion.query.toLowerCase();
    const matchNote = (n: NoteEntry) =>
      !q ||
      n.title.toLowerCase().includes(q) ||
      (n.path.split("/").pop()?.replace(/\.md$/, "").toLowerCase().includes(q) ?? false);
    const notes = allNotes.filter(matchNote).slice(0, 8).map(noteItem);
    if (suggestion.trigger === "mention") {
      return [...personItems(members, suggestion.query), ...dateSuggestions(suggestion.query), ...notes];
    }
    return notes;
  }, [suggestion, allNotes, members]);

  // Keep items accessible in the key handler without stale closure
  const filteredRef = useRef(filteredItems);
  filteredRef.current = filteredItems;

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
    schema: cortexSchema,
    uploadFile: (file) => saveFileAsAsset(file),
    // Live co-editing: the shared Y.Doc fragment replaces local block state;
    // peers' cursors render with their roster name + color.
    collaboration: collabSession
      ? {
          provider: collabSession.provider,
          fragment: collabSession.doc.getXmlFragment("document-store"),
          user: collab!.user,
        }
      : undefined,
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
    onOpen: (query, coords, from, trigger) => {
      setSuggestion({ query, coords, from, trigger });
      setSuggActiveIdx(0);
    },
    onUpdate: (query, coords, from, trigger) => {
      setSuggestion({ query, coords, from, trigger });
      setSuggActiveIdx(0);
    },
    onClose: () => setSuggestion(null),
  };

  // ── Suggestion insertion ───────────────────────────────────────────────────
  // A note becomes a `[[wiki link]]` (for both `[[` and `@`); a date becomes
  // plain ISO text. The trigger text (`[[query` or `@query`) is replaced wholesale.
  const insertItem = useCallback((item: MentionItem) => {
    if (!suggestion) return;
    const { from } = suggestion;
    const to = editor._tiptapEditor.state.selection.from;
    const text = item.kind === "note"
      ? `[[${item.note.title || pathToTitle(item.note.path)}]]`
      : item.kind === "person"
        ? `@${item.name}`
        : item.value;

    editor._tiptapEditor.commands.command(({ tr, dispatch }) => {
      if (dispatch) {
        tr.replaceWith(from, to, editor._tiptapEditor.schema.text(text));
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
      if (items[idx]) insertItem(items[idx]);
      return true;
    }
    if (key === "Escape") { setSuggestion(null); return true; }
    return false;
  };

  // ── Editor population & auto-save ─────────────────────────────────────────
  // While true, onChange events are ignored. Programmatically loading the note
  // body emits onChange, which would otherwise autosave on open — bumping the
  // file mtime (reordering the sidebar) and dirtying git just from viewing.
  const hydrating = useRef(true);
  // Last serialized body, captured while the editor is alive (see below).
  const pendingMd = useRef<string | null>(null);
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;

  useEffect(() => {
    const finish = () => { hydrating.current = false; };
    const seedFromMarkdown = () => {
      if (!note.body.trim()) { finish(); return; }
      assetsToDisplayUrls(note.body)
        .then((displayBody) => {
          try {
            const blocks = editor.tryParseMarkdownToBlocks(displayBody);
            // Translate `cortex-view` fences, `![[embeds]]`, and `[!callout]`
            // blockquotes into live blocks on load.
            editor.replaceBlocks(editor.document, inflateCallouts(inflateEmbeds(inflateViewBlocks(blocks))) as typeof blocks);
          } finally {
            // Always clear the guard, even if parsing throws — otherwise saves
            // would be suppressed forever for this note.
            finish();
          }
        })
        .catch(finish);
    };

    if (!collabSession) {
      seedFromMarkdown();
      return;
    }

    // Collab mode: the shared doc is the live truth. Seed it from markdown only
    // if it's still empty after the first server sync — i.e. we're the first
    // one here. If the relay is unreachable, the timeout seeds locally so the
    // note never appears blank (the doc merges when the connection returns).
    let decided = false;
    const fragment = collabSession.doc.getXmlFragment("document-store");
    const decide = () => {
      if (decided) return;
      decided = true;
      if (fragment.length === 0) seedFromMarkdown();
      else finish(); // peers already have content — take theirs
    };
    collabSession.provider.once("sync", decide);
    const fallback = setTimeout(decide, 1500);
    return () => clearTimeout(fallback);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Write whatever was last serialized. Uses the stashed markdown (not a fresh
  // editor read) so flushing during unmount/teardown is safe even if BlockNote
  // has already torn the editor down.
  const flush = useCallback(() => {
    if (bodyTimer.current) { clearTimeout(bodyTimer.current); bodyTimer.current = null; }
    if (pendingMd.current === null) return;
    onSaveRef.current({ ...noteRef.current, body: pendingMd.current });
    pendingMd.current = null;
  }, []);

  useEffect(() => {
    const unsub = editor.onChange(() => {
      if (hydrating.current) return;
      // Serialize NOW, while the editor is definitely alive, and stash the
      // result. A checkbox toggle is a single quick action often followed
      // immediately by navigating away — capturing here means the pending
      // write survives the editor being destroyed on unmount.
      void (async () => {
        const doc = flattenCallouts(flattenEmbeds(flattenViewBlocks(editor.document))) as typeof editor.document;
        const md = await editor.blocksToMarkdownLossy(doc);
        pendingMd.current = displayUrlsToAssets(md);
        if (bodyTimer.current) clearTimeout(bodyTimer.current);
        bodyTimer.current = setTimeout(flush, 400);
      })();
    });
    return () => {
      unsub();
      flush(); // persist any pending edit before this editor goes away
    };
  }, [editor, flush]);

  // Title edits only update frontmatter. The filename is fixed at creation —
  // renaming the file on every keystroke caused stale paths (note couldn't open)
  // and rename/save races that duplicated notes.
  const handleTitleChange = useCallback((value: string) => {
    if (titleTimer.current) clearTimeout(titleTimer.current);
    titleTimer.current = setTimeout(() => {
      onSave({ ...noteRef.current, frontmatter: { ...noteRef.current.frontmatter, title: value } });
    }, 400);
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

  // Match BlockNote to the app's theme. Without this it themes off the OS, so
  // forcing light mode under a dark OS left light-gray text on a white page.
  const colorScheme = useColorScheme();

  // Who last committed this note (git author) — surfaces teammates' edits.
  const [lastEdit, setLastEdit] = useState<CommitEntry | null>(null);
  useEffect(() => {
    let alive = true;
    commands.noteHistory(note.path, 1)
      .then((h) => { if (alive) setLastEdit(h[0] ?? null); })
      .catch(() => { if (alive) setLastEdit(null); });
    return () => { alive = false; };
  }, [note.path]);

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

          <div className={styles.header}>
            <NoteIconButton
              icon={icon}
              onEmojiClick={() => setShowEmojiPicker((x) => !x)}
            />
            <input
              key={note.path}
              className={styles.titleInput}
              defaultValue={title}
              placeholder="Untitled"
              onChange={(e) => handleTitleChange(e.target.value)}
            />
            {!monk && <div className={styles.headerActions}>
              {peers.map((p, i) => (
                <span
                  key={`${p.name}-${i}`}
                  className={styles.peerChip}
                  style={{ backgroundColor: p.color }}
                  title={`${p.name} is in this note`}
                >
                  {p.name.slice(0, 1).toUpperCase()}
                </span>
              ))}
              {saving && <span className={styles.saving}>Saving…</span>}
              <button className={styles.deleteBtn} onClick={onShowHistory} title="Version history">
                <HistoryIcon />
              </button>
              <button className={styles.deleteBtn} onClick={() => onDelete(note.path)} title="Delete note">
                <TrashIcon />
              </button>
            </div>}
          </div>
          {showEmojiPicker && (
            <div className={styles.emojiPickerWrap}>
              <Picker data={data} onEmojiSelect={handleIconSelect} theme="auto" previewPosition="none" skinTonePosition="none" />
            </div>
          )}

          {!monk && lastEdit && lastEdit.author && (
            <div className={styles.lastEdit}>Edited by {lastEdit.author} · {relativeTime(lastEdit.timestamp)}</div>
          )}

          {!monk && <PropertiesPanel frontmatter={note.frontmatter} notePath={note.path} onChange={handleFrontmatterChange} />}

          <div className={styles.editorWrap}>
            <BlockNoteView editor={editor} slashMenu={false} formattingToolbar={false} theme={colorScheme}>
              {/* Default formatting toolbar + our "Convert to database" action. */}
              <FormattingToolbarController
                formattingToolbar={() => {
                  // Place our button right after the block-type dropdown (item 0),
                  // before the text-style buttons.
                  const items = getFormattingToolbarItems();
                  return (
                    <FormattingToolbar>
                      {items.slice(0, 1)}
                      <ConvertToDatabaseButton key="convert-db" editor={editor} baseName={title} />
                      {items.slice(1)}
                    </FormattingToolbar>
                  );
                }}
              />
              <SuggestionMenuController
                triggerCharacter="/"
                getItems={async (query) =>
                  filterSuggestionItems(
                    [...getDefaultReactSlashMenuItems(editor), ...cortexSlashItems(editor), noteEmbedSlashItem(editor), calloutSlashItem(editor)],
                    query,
                  )
                }
              />
            </BlockNoteView>
          </div>

          {!monk && <BacklinksPanel path={note.path} onNavigate={onNavigate} />}
        </div>
      </div>

      {suggestion && (
        <WikiLinkDropdown
          query={suggestion.query}
          items={filteredItems.map((it) => it.display)}
          coords={suggestion.coords}
          activeIndex={suggActiveIdx}
          emptyLabel={suggestion.trigger === "mention"
            ? `No matches for "${suggestion.query}"`
            : `No notes match "${suggestion.query}"`}
          onSelectIndex={(i) => { if (filteredItems[i]) insertItem(filteredItems[i]); }}
          onMouseEnterIndex={setSuggActiveIdx}
          onClose={() => setSuggestion(null)}
        />
      )}
    </div>
  );
}


function pathToTitle(path: string): string {
  return path.split("/").pop()?.replace(/\.md$/, "").replace(/-/g, " ") ?? "Untitled";
}

// ── "Convert selection to database" (formatting toolbar) ──────────────────────

const LIST_TYPES = ["checkListItem", "bulletListItem", "numberedListItem"];

function blockPlainText(b: any): string {
  const c = b?.content;
  if (!Array.isArray(c)) return "";
  return c.map((n: any) => (typeof n?.text === "string" ? n.text : "")).join("");
}

/** Take the selected list items, build a database from them, and replace the
 *  selection with an inline data-view block pointing at it. */
async function convertSelectionToDatabase(editor: any, baseName: string) {
  const blocks = editor.getSelection()?.blocks ?? [];
  const items = blocks
    .map((b: any) => ({
      text: blockPlainText(b),
      done: b.type === "checkListItem" ? !!b.props?.checked : false,
    }))
    .filter((i: { text: string }) => i.text.trim());
  if (items.length === 0) return;
  try {
    const date = new Date().toISOString().slice(0, 10);
    const slug = await commands.createDatabaseFromItems(baseName || "Tasks", items, date);
    const spec = `source: collections/${slug}\ntype: table\n`;
    editor.replaceBlocks(blocks, [{ type: "cortexView", props: { spec, lang: "cortex-view" } }]);
  } catch (e) {
    window.alert(String(e));
  }
}

/** Toolbar button shown only when the selection includes list items. */
function ConvertToDatabaseButton({ editor, baseName }: { editor: any; baseName: string }) {
  const Components = useComponentsContext()!;
  const blocks = editor.getSelection?.()?.blocks ?? [];
  if (!blocks.some((b: any) => LIST_TYPES.includes(b.type))) return null;
  return (
    <Components.FormattingToolbar.Button
      mainTooltip="Convert these items to a database"
      label="Convert to database"
      icon={<TableIcon size={17} />}
      onClick={() => convertSelectionToDatabase(editor, baseName)}
    />
  );
}

function relativeTime(secs: number): string {
  const diff = Date.now() / 1000 - secs;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 2592000) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(secs * 1000).toLocaleDateString();
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
  icon, onEmojiClick,
}: {
  icon: string | null;
  onEmojiClick: () => void;
}) {
  const isImage = icon && !icon.match(/\p{Emoji}/u) && (icon.startsWith("assets/") || icon.startsWith("data:"));
  const [imgSrc, setImgSrc] = useState<string | null>(null);

  useEffect(() => {
    if (!isImage || !icon) { setImgSrc(null); return; }
    if (icon.startsWith("data:")) { setImgSrc(icon); return; }
    commands.readAsset(icon).then(setImgSrc).catch(() => setImgSrc(null));
  }, [icon, isImage]);

  return (
    <div className={`${styles.iconBtnGroup} ${!icon ? styles.iconBtnGroupEmpty : ""}`}>
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
    </div>
  );
}
