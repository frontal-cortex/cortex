import { useState, useEffect, useCallback, useRef } from "react";
import { commands, NoteEntry, Note, TagNode } from "../lib/commands";

function today(): string {
  return new Date().toISOString().split("T")[0];
}

function nowTime(): string {
  return new Date().toTimeString().slice(0, 5); // HH:MM
}

function uuid(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function titleToSlug(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "") || "untitled";
}

export function useNotes(vaultOpen: boolean) {
  const [notes, setNotes] = useState<NoteEntry[]>([]);
  const [dirs, setDirs] = useState<string[]>([]);
  // The tag tree (frontmatter + inline #tags, nested by `/`), computed by the
  // backend from the same files as `notes` and refreshed with them.
  const [tags, setTags] = useState<TagNode[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!vaultOpen) return;
    setLoading(true);
    try {
      const [list, dirList, tagTree] = await Promise.all([
        commands.listNotes(),
        commands.listVaultDirs(),
        commands.listTags().catch(() => [] as TagNode[]),
      ]);
      setNotes(list);
      setDirs(dirList);
      setTags(tagTree);
    } finally {
      setLoading(false);
    }
  }, [vaultOpen]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const createNote = useCallback(
    async (title: string, parentFolder?: string): Promise<Note> => {
      const created = today();
      const slug = titleToSlug(title);
      const folder = parentFolder?.replace(/\/$/, "") ?? "notes";
      // Find a free filename — untitled notes on the same day would otherwise
      // collide (createNote errors on an existing path).
      let note: Note | null = null;
      for (let n = 0; n < 100; n++) {
        const suffix = n === 0 ? "" : `-${n + 1}`;
        const path = `${folder}/${slug}-${created}${suffix}.md`;
        try {
          note = await commands.createNote(path, title || "Untitled", created);
          break;
        } catch {
          // Path taken — try the next suffix.
        }
      }
      if (!note) throw new Error("Could not create a unique note filename");
      await refresh();
      return note;
    },
    [refresh],
  );

  const deleteNote = useCallback(
    async (path: string) => {
      await commands.deleteNote(path);
      await refresh();
    },
    [refresh],
  );

  /** Create a note from a template, substituting {{date}}, {{time}}, {{title}}, {{uuid}}. */
  const createNoteFromTemplate = useCallback(
    async (templateName: string, title: string, parentFolder?: string): Promise<Note> => {
      const date = today();
      const slug = titleToSlug(title || date);
      const folder = parentFolder?.replace(/\/$/, "") ?? "notes";
      const path = `${folder}/${slug}-${date}.md`;
      const vars: Record<string, string> = {
        date,
        time: nowTime(),
        title: title || date,
        uuid: uuid(),
      };
      const note = await commands.createNoteFromTemplate(templateName, path, vars);
      await refresh();
      return note;
    },
    [refresh],
  );

  /** Open or create today's journal note using the journal template (if any).
   *  `userSlug` nests journals per person (`journal/<user>/…`) so a team doesn't
   *  collide on the same daily file. A template of the form `collections/<name>`
   *  makes Today the day's row in that collection instead. */
  const openOrCreateDaily = useCallback(
    async (journalTemplate: string, userSlug?: string): Promise<Note> => {
      const date = today();

      // `journal_template: collections/journal` — the journal is a collection
      // (one row per day, with properties and views). Today is that day's row,
      // created from the collection's row template on first open.
      if (journalTemplate.startsWith("collections/")) {
        const source = journalTemplate.replace(/\/$/, "");
        const path = `${source}/${date}.md`;
        try {
          return await commands.readNote(path);
        } catch { /* not yet */ }
        const created = await commands.ensureRow(source, date, { title: date, created: date, date });
        const note = await commands.readNote(created);
        await refresh();
        return note;
      }

      // Canonical, stable path — used for BOTH the existence check and creation,
      // so a second click reliably re-opens today's note instead of duplicating.
      const dir = userSlug ? `notes/journal/${userSlug}` : "notes/journal";
      const path = `${dir}/${date}.md`;

      // Open if it already exists (read straight from disk; the notes list may
      // be stale right after creation).
      try {
        return await commands.readNote(path);
      } catch { /* doesn't exist yet — create it below */ }

      let note: Note;
      const templates = await commands.listTemplates().catch(() => [] as string[]);
      if (templates.includes(journalTemplate)) {
        note = await commands.createNoteFromTemplate(journalTemplate, path, {
          date, time: nowTime(), title: date, uuid: uuid(),
        });
      } else {
        note = await commands.createNote(path, date, date);
      }
      await refresh();
      return note;
    },
    [refresh],
  );

  return { notes, dirs, tags, loading, refresh, createNote, createNoteFromTemplate, openOrCreateDaily, deleteNote };
}

// In-flight writes, keyed by note path. A note's loader must wait for a pending
// write to that path before reading from disk — otherwise leaving a note (which
// flushes an async save) and immediately re-entering reads the stale on-disk
// version before the write lands, losing the edit (e.g. a just-ticked checkbox).
const inflightWrites = new Map<string, Promise<unknown>>();

export function useNote(path: string | null) {
  const [note, setNote] = useState<Note | null>(null);
  const [saving, setSaving] = useState(false);
  const pathRef = useRef(path);
  pathRef.current = path;

  useEffect(() => {
    if (!path) {
      setNote(null);
      return;
    }
    let cancelled = false;
    (async () => {
      // Wait out any in-flight write to this note so we read fresh content.
      const pending = inflightWrites.get(path);
      if (pending) { try { await pending; } catch { /* ignore */ } }
      if (cancelled) return;
      try {
        const n = await commands.readNote(path);
        if (!cancelled) setNote(n);
      } catch {
        if (!cancelled) setNote(null);
      }
    })();
    return () => { cancelled = true; };
  }, [path]);

  // Always write to the note's OWN path (not the hook's current path) — a
  // deferred/flushed save from a note we just navigated away from must land in
  // that note, never the one now open. Only refresh view state if it's still current.
  const save = useCallback(
    async (updated: Note) => {
      setSaving(true);
      // Register the write synchronously so a concurrent re-entry awaits it.
      const writePromise = commands.writeNote(updated.path, updated);
      inflightWrites.set(updated.path, writePromise);
      try {
        await writePromise;
        if (updated.path === pathRef.current) setNote(updated);
      } finally {
        if (inflightWrites.get(updated.path) === writePromise) {
          inflightWrites.delete(updated.path);
        }
        setSaving(false);
      }
    },
    [],
  );

  // Update editor state from an already-persisted note (e.g. a history
  // restore wrote the file directly) without re-writing it.
  const applyNote = useCallback((n: Note) => setNote(n), []);

  return { note, saving, save, applyNote };
}
