import { useEffect, useState } from "react";
import { commands, Settings, VaultInfo } from "../../lib/commands";
import { CloseIcon } from "./icons";
import styles from "./SettingsModal.module.css";

/** Apply a theme preference to the document. "system" defers to the OS. */
export function applyTheme(theme: Settings["theme"]) {
  const root = document.documentElement;
  if (theme === "dark" || theme === "light") root.dataset.theme = theme;
  else delete root.dataset.theme;
}

interface Props {
  vault: VaultInfo;
  onClose: () => void;
  onLeaveVault: () => void;
}

export function SettingsModal({ vault, onClose, onLeaveVault }: Props) {
  const [settings, setSettings] = useState<Settings | null>(null);

  useEffect(() => {
    commands.getSettings().then(setSettings).catch(() => {});
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const update = (patch: Partial<Settings>) => {
    setSettings((s) => {
      if (!s) return s;
      const next = { ...s, ...patch };
      commands.setSettings(next).catch(() => {});
      if (patch.theme) applyTheme(patch.theme);
      return next;
    });
  };

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <span className={styles.title}>Settings</span>
          <button className={styles.closeBtn} onClick={onClose} title="Close"><CloseIcon size={16} /></button>
        </div>

        <div className={styles.body}>
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>Vault</h3>
            <div className={styles.infoRow}>
              <span className={styles.label}>Name</span>
              <span className={styles.value}>{vault.name}</span>
            </div>
            <div className={styles.infoRow}>
              <span className={styles.label}>Location</span>
              <span className={styles.path} title={vault.path}>{vault.path}</span>
            </div>
            <button className={styles.leaveBtn} onClick={() => { onClose(); onLeaveVault(); }}>
              Leave vault
            </button>
          </section>

          {settings && (
            <section className={styles.section}>
              <h3 className={styles.sectionTitle}>Preferences</h3>

              <label className={styles.row}>
                <span className={styles.label}>Theme</span>
                <select
                  className={styles.select}
                  value={settings.theme}
                  onChange={(e) => update({ theme: e.target.value as Settings["theme"] })}
                >
                  <option value="system">System</option>
                  <option value="light">Light</option>
                  <option value="dark">Dark</option>
                </select>
              </label>

              <label className={styles.row}>
                <span className={styles.label}>Auto-commit on save</span>
                <input
                  type="checkbox"
                  checked={settings.auto_commit}
                  onChange={(e) => update({ auto_commit: e.target.checked })}
                />
              </label>

              <label className={styles.row}>
                <span className={styles.label}>Default note type</span>
                <input
                  className={styles.input}
                  value={settings.default_note_type}
                  onChange={(e) => update({ default_note_type: e.target.value })}
                />
              </label>

              <label className={styles.row}>
                <span className={styles.label}>Journal template</span>
                <input
                  className={styles.input}
                  value={settings.journal_template}
                  onChange={(e) => update({ journal_template: e.target.value })}
                />
              </label>

              <label className={styles.row}>
                <span className={styles.label}>Trash retention (days)</span>
                <input
                  className={styles.input}
                  type="number"
                  min={1}
                  value={settings.trash_retention_days}
                  onChange={(e) => update({ trash_retention_days: Number(e.target.value) || 1 })}
                />
              </label>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
