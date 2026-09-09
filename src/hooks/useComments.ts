// ── Comments on the open note ────────────────────────────────────────────────
// The threads live in `<note>.comments.yaml` beside the note; every write
// goes through the Rust side and hands back the whole list, so this hook
// never merges. A `cortex:comments-changed` event (the watcher saw the
// sidecar change on disk — an agent or a teammate commented) reloads it.

import { useCallback, useEffect, useState } from "react";
import { commands, CommentAnchor, CommentThread } from "../lib/commands";

export function useComments(path: string) {
  const [threads, setThreads] = useState<CommentThread[]>([]);

  const reload = useCallback(async () => {
    if (!path) { setThreads([]); return; }
    try { setThreads(await commands.listComments(path)); } catch { setThreads([]); }
  }, [path]);
  useEffect(() => { reload(); }, [reload]);

  useEffect(() => {
    function onChanged(e: Event) {
      const changed = (e as CustomEvent<{ path?: string }>).detail?.path;
      if (changed === path) reload();
    }
    window.addEventListener("cortex:comments-changed", onChanged);
    return () => window.removeEventListener("cortex:comments-changed", onChanged);
  }, [path, reload]);

  const add = useCallback(async (text: string, anchor: CommentAnchor | null) => {
    setThreads(await commands.addComment(path, text, anchor));
  }, [path]);
  const reply = useCallback(async (id: string, text: string) => {
    setThreads(await commands.replyComment(path, id, text));
  }, [path]);
  const resolve = useCallback(async (id: string, resolved: boolean) => {
    setThreads(await commands.resolveComment(path, id, resolved));
  }, [path]);
  const remove = useCallback(async (id: string) => {
    setThreads(await commands.deleteComment(path, id));
  }, [path]);

  return {
    threads,
    unresolved: threads.filter((t) => !t.resolved).length,
    reload,
    add,
    reply,
    resolve,
    remove,
  };
}
