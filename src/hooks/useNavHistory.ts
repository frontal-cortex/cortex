/**
 * Manages an in-session navigation history stack (back/forward) and a tab bar,
 * all purely in memory. Nothing is persisted during this session since the vault
 * hasn't been opened yet when state initialises — persistence to
 * `.brain/ui-state.json` is a future enhancement.
 */
import { useState, useCallback } from "react";

export interface Tab {
  path: string;
  /** Tab label resolved from the notes list at call time. */
  title: string;
}

const MAX_HISTORY = 50;

export function useNavHistory() {
  // history[cursor] is the current note
  const [history, setHistory] = useState<string[]>([]);
  const [cursor, setCursor] = useState(-1);
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTab, setActiveTab] = useState<number>(-1);

  const currentPath: string | null = history[cursor] || null;

  /** Navigate to a path, pushing it onto the history stack. Pass "" to deselect. */
  const navigate = useCallback((path: string, title = "") => {
    setHistory((h) => {
      const base = h.slice(0, cursor + 1);
      const next = path ? [...base, path].slice(-MAX_HISTORY) : base;
      return next;
    });
    if (path) setCursor((c) => Math.min(c + 1, MAX_HISTORY - 1));

    // Open in current tab if one is active; otherwise add a new tab.
    setTabs((prev) => {
      if (activeTab >= 0 && activeTab < prev.length) {
        return prev.map((t, i) => i === activeTab ? { path, title } : t);
      }
      const newTab = { path, title };
      setActiveTab(prev.length);
      return [...prev, newTab];
    });
  }, [cursor, activeTab]);

  const back = useCallback(() => {
    setCursor((c) => {
      const next = Math.max(c - 1, 0);
      const path = history[next];
      if (path && activeTab >= 0) {
        setTabs((prev) => prev.map((t, i) => i === activeTab ? { ...t, path } : t));
      }
      return next;
    });
  }, [history, activeTab]);

  const forward = useCallback(() => {
    setCursor((c) => {
      const next = Math.min(c + 1, history.length - 1);
      const path = history[next];
      if (path && activeTab >= 0) {
        setTabs((prev) => prev.map((t, i) => i === activeTab ? { ...t, path } : t));
      }
      return next;
    });
  }, [history, activeTab]);

  const canBack = cursor > 0;
  const canForward = cursor < history.length - 1;

  /** Open a note in a new tab. */
  const openInNewTab = useCallback((path: string, title = "") => {
    setTabs((prev) => {
      // Avoid duplicate tabs for the same path.
      const existing = prev.findIndex((t) => t.path === path);
      if (existing >= 0) { setActiveTab(existing); return prev; }
      setActiveTab(prev.length);
      return [...prev, { path, title }];
    });
    setHistory((h) => [...h.slice(0, cursor + 1), path].slice(-MAX_HISTORY));
    setCursor((c) => Math.min(c + 1, MAX_HISTORY - 1));
  }, [cursor]);

  const closeTab = useCallback((index: number) => {
    setTabs((prev) => {
      const next = prev.filter((_, i) => i !== index);
      setActiveTab((a) => {
        if (next.length === 0) return -1;
        return Math.min(a, next.length - 1);
      });
      return next;
    });
  }, []);

  const switchTab = useCallback((index: number) => {
    setActiveTab(index);
    const path = tabs[index]?.path;
    if (path) {
      setHistory((h) => [...h.slice(0, cursor + 1), path].slice(-MAX_HISTORY));
      setCursor((c) => Math.min(c + 1, MAX_HISTORY - 1));
    }
  }, [tabs, cursor]);

  return {
    currentPath,
    tabs, activeTab,
    canBack, canForward,
    navigate, back, forward,
    openInNewTab, closeTab, switchTab,
  };
}
