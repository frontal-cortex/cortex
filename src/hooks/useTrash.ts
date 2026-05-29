import { useState, useEffect, useCallback } from "react";
import { commands, TrashEntry } from "../lib/commands";

export function useTrash(vaultOpen: boolean) {
  const [trash, setTrash] = useState<TrashEntry[]>([]);

  const refreshTrash = useCallback(async () => {
    if (!vaultOpen) return;
    try {
      setTrash(await commands.listTrash());
    } catch {
      setTrash([]);
    }
  }, [vaultOpen]);

  useEffect(() => {
    refreshTrash();
  }, [refreshTrash]);

  const restore = useCallback(async (id: string): Promise<string> => {
    const path = await commands.restoreTrashed(id);
    await refreshTrash();
    return path;
  }, [refreshTrash]);

  const deleteForever = useCallback(async (id: string) => {
    await commands.deleteTrashed(id);
    await refreshTrash();
  }, [refreshTrash]);

  const emptyTrash = useCallback(async () => {
    await commands.emptyTrash();
    await refreshTrash();
  }, [refreshTrash]);

  return { trash, refreshTrash, restore, deleteForever, emptyTrash };
}
