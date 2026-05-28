import { useState, useEffect, useCallback } from "react";
import { commands, NoteEntry, Note } from "../lib/commands";

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

  return { notes, loading, refresh };
}

export function useNote(path: string | null) {
  const [note, setNote] = useState<Note | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!path) {
      setNote(null);
      return;
    }
    commands.readNote(path).then(setNote);
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
