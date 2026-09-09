// The `?` overlay: every shortcut, rendered from the keymap registry so the
// list can never go stale — a shortcut declared in keymap.ts appears here
// under its area, with whatever keys the user has bound to it. The sidebar
// and data-table keys (local to a focused widget) are listed after.

import { useEffect, useRef } from "react";
import {
  shortcutsByArea, keysFor, formatKeys, isOverridden, shortcutFor, SHORTCUTS, SIDEBAR_KEYS, TABLE_KEYS,
} from "../../lib/keymap";
import { CloseIcon, GearIcon } from "./icons";
import styles from "./ShortcutOverlay.module.css";

interface Props {
  onClose: () => void;
  /** Opens Settings → Keyboard, where bindings are changed. */
  onOpenSettings: () => void;
}

/** "mod+Enter / o" → the platform's modifier spelled out; plain keys as written. */
function showLocal(keys: string): string {
  return keys.split(" / ").map((k) => (k.startsWith("mod+") ? formatKeys(k) : k)).join(" / ");
}

export function ShortcutOverlay({ onClose, onOpenSettings }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  // Take focus so the page behind stops receiving keys and Escape lands here.
  useEffect(() => { ref.current?.focus(); }, []);

  const groups = shortcutsByArea();

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div
        ref={ref}
        className={styles.modal}
        role="dialog"
        aria-label="Keyboard shortcuts"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } }}
      >
        <div className={styles.head}>
          <h2 className={styles.title}>Keyboard shortcuts</h2>
          <span className={styles.subtitle}>
            <kbd className={styles.kbd}>?</kbd> or <kbd className={styles.kbd}>{shortcutFor("shortcut-help")}</kbd> toggles this
          </span>
          <button className={styles.close} onClick={onClose} title="Close (Esc)"><CloseIcon size={14} /></button>
        </div>

        <div className={styles.columns}>
          {groups.map(({ area, ids }) => ids.length > 0 && (
            <section key={area} className={styles.group} aria-label={area}>
              <h3 className={styles.groupTitle}>{area}</h3>
              {ids.map((id) => (
                <div key={id} className={styles.row}>
                  <span className={styles.label}>{SHORTCUTS[id].label}</span>
                  <kbd className={styles.kbd} title={isOverridden(id) ? `Rebound in settings (default ${formatKeys(SHORTCUTS[id].keys)})` : undefined}>
                    {formatKeys(keysFor(id))}{isOverridden(id) && <span className={styles.overridden} aria-label="rebound">•</span>}
                  </kbd>
                </div>
              ))}
            </section>
          ))}
          <section className={styles.group} aria-label="Sidebar">
            <h3 className={styles.groupTitle}>Sidebar <span className={styles.groupHint}>while the tree has focus</span></h3>
            {SIDEBAR_KEYS.map((k) => (
              <div key={k.keys} className={styles.row}>
                <span className={styles.label}>{k.label}</span>
                <kbd className={styles.kbd}>{showLocal(k.keys)}</kbd>
              </div>
            ))}
          </section>
          <section className={styles.group} aria-label="Data table">
            <h3 className={styles.groupTitle}>Data table <span className={styles.groupHint}>while a cell has focus</span></h3>
            {TABLE_KEYS.map((k) => (
              <div key={k.keys} className={styles.row}>
                <span className={styles.label}>{k.label}</span>
                <kbd className={styles.kbd}>{showLocal(k.keys)}</kbd>
              </div>
            ))}
          </section>
        </div>

        <div className={styles.foot}>
          <span>A dot marks a shortcut you rebound.</span>
          <button className={styles.settingsBtn} onClick={() => { onClose(); onOpenSettings(); }}>
            <GearIcon size={12} /> Change bindings in Settings ({shortcutFor("settings")})
          </button>
        </div>
      </div>
    </div>
  );
}
