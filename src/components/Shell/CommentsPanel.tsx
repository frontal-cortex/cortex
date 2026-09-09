// ── Comments ─────────────────────────────────────────────────────────────────
// Margin notes beside the page: every thread on the note, open ones first.
// Selecting a thread highlights the passage it quotes; a thread whose quote
// has since been edited away reads as a comment on the whole note. The
// threads themselves live in `<note>.comments.yaml` (never in the note) and
// come in through the `useComments` hook; this is only their face.

import { useEffect, useRef, useState, KeyboardEvent } from "react";
import { CommentAnchor, CommentThread } from "../../lib/commands";
import { shortcutFor } from "../../lib/keymap";
import { CloseIcon, PlusIcon } from "./icons";
import styles from "./CommentsPanel.module.css";

export interface CommentDraft {
  /** Where the new thread will point; null = the whole note. */
  anchor: CommentAnchor | null;
}

interface Props {
  threads: CommentThread[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Ids of threads whose quoted passage is no longer in the note. */
  detached: Set<string>;
  draft: CommentDraft | null;
  /** Bumped to (re)focus the draft box. */
  draftFocusToken: number;
  onDraftSubmit: (text: string) => Promise<void>;
  onDraftCancel: () => void;
  onNewComment: () => void;
  onReply: (id: string, text: string) => Promise<void>;
  onResolve: (id: string, resolved: boolean) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onClose: () => void;
}

/** "just now", "5m", "3h", "2d", else the date. */
function ago(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d`;
  return iso.slice(0, 10);
}

export function CommentsPanel({
  threads, selectedId, onSelect, detached, draft, draftFocusToken,
  onDraftSubmit, onDraftCancel, onNewComment, onReply, onResolve, onDelete, onClose,
}: Props) {
  const [showResolved, setShowResolved] = useState(false);
  const open = threads.filter((t) => !t.resolved);
  const resolved = threads.filter((t) => t.resolved);
  const shown = showResolved ? [...open, ...resolved] : open;

  return (
    <aside className={styles.root} aria-label="Comments">
      <div className={styles.head}>
        <span className={styles.label}>
          Comments{open.length > 0 && <span className={styles.count}>{open.length}</span>}
        </span>
        <div className={styles.headActions}>
          <button className={styles.iconBtn} onClick={onNewComment} title={`Comment on the selection, or the whole note (${shortcutFor("comment")})`}>
            <PlusIcon size={13} />
          </button>
          <button className={styles.iconBtn} onClick={onClose} title={`Hide comments (${shortcutFor("toggle-comments")})`}>
            <CloseIcon size={12} />
          </button>
        </div>
      </div>

      <div className={styles.list}>
        {draft && (
          <Composer
            key="draft"
            anchor={draft.anchor}
            focusToken={draftFocusToken}
            placeholder={draft.anchor ? "Comment on this passage…" : "Comment on this note…"}
            onSubmit={onDraftSubmit}
            onCancel={onDraftCancel}
          />
        )}

        {shown.length === 0 && !draft && (
          <p className={styles.empty}>
            {threads.length === 0
              ? "No comments yet. Select some text and press the comment button, or add one for the whole note."
              : "Everything is resolved."}
          </p>
        )}

        {shown.map((t) => (
          <ThreadCard
            key={t.id}
            thread={t}
            selected={t.id === selectedId}
            detached={detached.has(t.id)}
            onSelect={() => onSelect(t.id === selectedId ? null : t.id)}
            onReply={(text) => onReply(t.id, text)}
            onResolve={() => onResolve(t.id, !t.resolved)}
            onDelete={() => onDelete(t.id)}
          />
        ))}

        {resolved.length > 0 && (
          <button className={styles.showResolved} onClick={() => setShowResolved((v) => !v)}>
            {showResolved ? "Hide resolved" : `Show ${resolved.length} resolved`}
          </button>
        )}
      </div>
    </aside>
  );
}

function ThreadCard({
  thread, selected, detached, onSelect, onReply, onResolve, onDelete,
}: {
  thread: CommentThread;
  selected: boolean;
  detached: boolean;
  onSelect: () => void;
  onReply: (text: string) => Promise<void>;
  onResolve: () => void;
  onDelete: () => void;
}) {
  const [replying, setReplying] = useState(false);
  const [replyFocus, setReplyFocus] = useState(0);
  const anchor = thread.anchor;

  return (
    <div
      className={`${styles.thread} ${selected ? styles.threadSelected : ""} ${thread.resolved ? styles.threadResolved : ""}`}
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter" && e.target === e.currentTarget) { e.preventDefault(); onSelect(); } }}
    >
      {anchor && (
        <blockquote className={`${styles.quote} ${detached ? styles.quoteDetached : ""}`} title={detached ? "This passage is no longer in the note" : anchor.quote}>
          {anchor.quote}
        </blockquote>
      )}
      <Message author={thread.author} created={thread.created} text={thread.text} />
      {thread.replies.map((r, i) => (
        <Message key={i} author={r.author} created={r.created} text={r.text} reply />
      ))}

      {replying ? (
        <Composer
          focusToken={replyFocus}
          placeholder="Reply…"
          onSubmit={async (text) => { await onReply(text); setReplying(false); }}
          onCancel={() => setReplying(false)}
        />
      ) : (
        <div className={styles.actions} onClick={(e) => e.stopPropagation()}>
          <button className={styles.action} onClick={() => { setReplying(true); setReplyFocus((n) => n + 1); }}>Reply</button>
          <button className={styles.action} onClick={onResolve}>{thread.resolved ? "Reopen" : "Resolve"}</button>
          <button className={`${styles.action} ${styles.actionDanger}`} onClick={() => { if (window.confirm("Delete this thread?")) onDelete(); }}>Delete</button>
        </div>
      )}
    </div>
  );
}

function Message({ author, created, text, reply = false }: { author: string; created: string; text: string; reply?: boolean }) {
  return (
    <div className={`${styles.message} ${reply ? styles.messageReply : ""}`}>
      <div className={styles.meta}>
        <span className={styles.author}>{author || "someone"}</span>
        <span className={styles.time} title={created}>{ago(created)}</span>
      </div>
      <p className={styles.text}>{text}</p>
    </div>
  );
}

/** A small box to write in: Enter sends, Shift+Enter breaks a line, Escape cancels. */
function Composer({
  anchor, focusToken, placeholder, onSubmit, onCancel,
}: {
  anchor?: CommentAnchor | null;
  focusToken: number;
  placeholder: string;
  onSubmit: (text: string) => Promise<void>;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { ref.current?.focus(); }, [focusToken]);

  const submit = async () => {
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true);
    try { await onSubmit(t); setText(""); }
    catch (e) { window.alert(String(e)); }
    finally { setBusy(false); }
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
    else if (e.key === "Escape") { e.preventDefault(); onCancel(); }
  };

  return (
    <div className={styles.composer} onClick={(e) => e.stopPropagation()}>
      {anchor && <blockquote className={styles.quote}>{anchor.quote}</blockquote>}
      <textarea
        ref={ref}
        className={styles.input}
        value={text}
        placeholder={placeholder}
        rows={2}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
      />
      <div className={styles.actions}>
        <button className={`${styles.action} ${styles.actionPrimary}`} onClick={submit} disabled={!text.trim() || busy}>Send</button>
        <button className={styles.action} onClick={onCancel}>Cancel</button>
        <span className={styles.hint}>Enter to send</span>
      </div>
    </div>
  );
}
