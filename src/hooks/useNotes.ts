import { useState, useEffect, useCallback } from "react";
import { commands, NoteEntry, Note } from "../lib/commands";

function today(): string {
  return new Date().toISOString().split("T")[0];
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

  return { notes, dirs, loading, refresh, createNote, deleteNote };
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
