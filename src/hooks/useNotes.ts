import { useState, useEffect, useCallback } from "react";
import { commands, NoteEntry, Note } from "../lib/commands";

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
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!vaultOpen) return;
    setLoading(true);
    try {
      const [list, dirList] = await Promise.all([
        commands.listNotes(),
        commands.listVaultDirs(),
      ]);
      setNotes(list);
      setDirs(dirList);
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
      const path = `${folder}/${slug}-${created}.md`;
      const note = await commands.createNote(path, title || "Untitled", created);
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

  /** Open or create today's journal note using the journal template (if any). */
  const openOrCreateDaily = useCallback(
    async (journalTemplate: string): Promise<Note> => {
      const date = today();
      const path = `notes/journal/${date}.md`;
      // Try to open an existing daily note first.
      const existing = notes.find((n) => n.path === path);
      if (existing) {
        return commands.readNote(path);
      }
      // If there's a configured journal template, use it.
      try {
        const templates = await commands.listTemplates();
        if (templates.includes(journalTemplate)) {
          return createNoteFromTemplate(journalTemplate, date, "notes/journal");
        }
      } catch { /* fall through to blank note */ }
      return createNote(date, "notes/journal");
    },
    [notes, createNote, createNoteFromTemplate],
  );

  return { notes, dirs, loading, refresh, createNote, createNoteFromTemplate, openOrCreateDaily, deleteNote };
}

export function useNote(path: string | null) {
  const [note, setNote] = useState<Note | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!path) {
      setNote(null);
      return;
    }
    commands.readNote(path).then(setNote).catch(() => setNote(null));
  }, [path]);

  const save = useCallback(
    async (updated: Note) => {
      if (!path) return;
      setSaving(true);
      try {
        await commands.writeNote(path, updated);
        setNote(updated);
      } finally {
        setSaving(false);
      }
    },
    [path],
  );

  // Update editor state from an already-persisted note (e.g. a history
  // restore wrote the file directly) without re-writing it.
  const applyNote = useCallback((n: Note) => setNote(n), []);

  return { note, saving, save, applyNote };
}
