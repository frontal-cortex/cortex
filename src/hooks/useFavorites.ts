import { useState, useEffect, useCallback } from "react";
import { commands } from "../lib/commands";

export function useFavorites(vaultOpen: boolean) {
  const [favorites, setFavorites] = useState<string[]>([]);

  useEffect(() => {
    if (!vaultOpen) return;
    commands.getFavorites().then(setFavorites).catch(() => setFavorites([]));
  }, [vaultOpen]);

  const toggleFavorite = useCallback(async (path: string) => {
    setFavorites((prev) => {
      const next = prev.includes(path) ? prev.filter((p) => p !== path) : [...prev, path];
      commands.setFavorites(next).catch(() => {});
      return next;
    });
  }, []);

  const isFavorite = useCallback((path: string) => favorites.includes(path), [favorites]);

  return { favorites, toggleFavorite, isFavorite };
}
