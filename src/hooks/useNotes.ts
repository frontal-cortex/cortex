import { useState, useEffect, useCallback } from "react";
import { commands, NoteEntry, Note } from "../lib/commands";

function dateStamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return [
    d.getFullYear(),
    pad(d.getMonth() + 1),
    pad(d.getDate()),
    pad(d.getHours()),
    pad(d.getMinutes()),
    pad(d.getSeconds()),
  ].join("-");
}

export function useNotes(vaultOpen: boolean) {
  const [notes, setNotes] = useState<NoteEntry[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!vaultOpen) return;
    setLoading(true);
    try {
      const list = await commands.listNotes();
      setNotes(list);
    } finally {
      setLoading(false);
    }
  }, [vaultOpen]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const createNote = useCallback(
    async (title: string): Promise<Note> => {
      const slug = title.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "") || "untitled";
      const created = new Date().toISOString().split("T")[0];
      const ts = dateStamp();
      const path = `notes/${slug}-${ts}.md`;
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

  return { notes, loading, refresh, createNote, deleteNote };
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

  return { note, saving, save };
}
