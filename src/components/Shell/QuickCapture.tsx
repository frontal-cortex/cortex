// Quick capture — jot a thought straight into today's daily note without
// leaving the current one. Opens on ⌘⇧K or the command palette. (A true global
// hotkey that fires while the app is unfocused would additionally need the
// tauri-plugin-global-shortcut plugin; this is the in-app core.)

import { useState, useRef, useEffect, KeyboardEvent } from "react";
import styles from "./QuickCapture.module.css";

interface Props {
  onCapture: (text: string) => Promise<void>;
  onClose: () => void;
}

export function QuickCapture({ onCapture, onClose }: Props) {
  const [text, setText] = useState("");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { ref.current?.focus(); }, []);

  const submit = async () => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      await onCapture(trimmed);
      setSaved(true);
      // Brief confirmation, then close (the user stays on their current note).
      setTimeout(onClose, 750);
    } catch {
      setBusy(false);
    }
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); onClose(); }
    // Enter submits; Shift+Enter inserts a newline.
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
  };

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.head}>
          <span className={styles.title}>Quick capture</span>
          <span className={styles.hint}>→ today's note</span>
        </div>
        {saved ? (
          <div className={styles.saved}>Captured ✓ — added to today's note</div>
        ) : (
          <>
            <textarea
              ref={ref}
              className={styles.input}
              value={text}
              placeholder="Capture a thought…"
              rows={3}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={onKeyDown}
            />
            <div className={styles.foot}>
              <span className={styles.kbd}><kbd>Enter</kbd> save · <kbd>Esc</kbd> cancel</span>
              <button className={styles.saveBtn} disabled={!text.trim() || busy} onClick={submit}>
                Capture
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
