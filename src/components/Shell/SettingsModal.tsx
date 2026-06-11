import { useEffect, useState } from "react";
import { commands, Settings, VaultInfo, Member, CurrentUser } from "../../lib/commands";
import { TAG_COLORS, swatchStyle, autoColor } from "../../lib/colors";
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
                <span className={styles.label}>Auto-sync</span>
                <select
                  className={styles.select}
                  value={settings.auto_sync_minutes}
                  onChange={(e) => update({ auto_sync_minutes: Number(e.target.value) })}
                >
                  <option value={0}>Off</option>
                  <option value={1}>Every minute</option>
                  <option value={5}>Every 5 minutes</option>
                  <option value={15}>Every 15 minutes</option>
                </select>
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

          <MembersSection />
        </div>
      </div>
    </div>
  );
}

/** Team roster — people who can be assigned to `person` properties. Identity
 *  ("you") comes from git config, the same name that authors commits. */
function MembersSection() {
  const [members, setMembers] = useState<Member[]>([]);
  const [me, setMe] = useState<CurrentUser | null>(null);

  useEffect(() => {
    commands.getMembers().then(setMembers).catch(() => {});
    commands.currentUser().then(setMe).catch(() => {});
  }, []);

  const persist = (next: Member[]) => { setMembers(next); commands.setMembers(next).catch(() => {}); };
  const editLocal = (i: number, patch: Partial<Member>) =>
    setMembers((ms) => ms.map((m, j) => (j === i ? { ...m, ...patch } : m)));
  const commit = () => commands.setMembers(members).catch(() => {});

  const cycleColor = (i: number) => {
    const idx = TAG_COLORS.indexOf(members[i].color as (typeof TAG_COLORS)[number]);
    const next = TAG_COLORS[(idx + 1) % TAG_COLORS.length];
    persist(members.map((m, j) => (j === i ? { ...m, color: next } : m)));
  };
  const add = () => persist([...members, { name: "", email: "", color: autoColor(String(members.length)) }]);
  const remove = (i: number) => persist(members.filter((_, j) => j !== i));
  const isMe = (m: Member) => !!me && ((!!m.email && m.email === me.email) || m.name === me.name);

  return (
    <section className={styles.section}>
      <h3 className={styles.sectionTitle}>Members</h3>
      {me?.name && (
        <div className={styles.infoRow}>
          <span className={styles.label}>You</span>
          <span className={styles.value}>{me.name}{me.email ? ` · ${me.email}` : ""}</span>
        </div>
      )}
      {members.length === 0 && (
        <p className={styles.memberHint}>Add teammates so you can assign tasks with a Person property.</p>
      )}
      {members.map((m, i) => (
        <div key={i} className={styles.memberRow}>
          <button className={styles.swatch} style={swatchStyle(m.color)} onClick={() => cycleColor(i)} title="Color" />
          <input
            className={styles.memberInput}
            value={m.name}
            placeholder="Name"
            onChange={(e) => editLocal(i, { name: e.target.value })}
            onBlur={commit}
          />
          <input
            className={styles.memberInput}
            value={m.email}
            placeholder="email (optional)"
            onChange={(e) => editLocal(i, { email: e.target.value })}
            onBlur={commit}
          />
          {isMe(m) && <span className={styles.youTag}>you</span>}
          <button className={styles.removeBtn} onClick={() => remove(i)} title="Remove member">
            <CloseIcon size={12} />
          </button>
        </div>
      ))}
      <button className={styles.addMember} onClick={add}>+ Add member</button>
    </section>
  );
}
