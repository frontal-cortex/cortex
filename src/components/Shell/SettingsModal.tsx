import { useEffect, useState } from "react";
import { commands, Settings, VaultInfo, Member, CurrentUser } from "../../lib/commands";
import { TAG_COLORS, swatchStyle, autoColor } from "../../lib/colors";
import { syncTheme } from "../../lib/theme";
import { PROSE_FONTS, PROSE_SLANTS, DEFAULT_PROSE_FONT, isPreset } from "../../lib/fonts";
import { Dropdown } from "./Dropdown";
import { CloseIcon } from "./icons";
import styles from "./SettingsModal.module.css";

interface Props {
  vault: VaultInfo;
  onClose: () => void;
  onLeaveVault: () => void;
}

export function SettingsModal({ vault, onClose, onLeaveVault }: Props) {
  const [settings, setSettings] = useState<Settings | null>(null);
  // The desktop's palette file, when this machine has one (Omarchy).
  const [desktopTheme, setDesktopTheme] = useState<string | null>(null);

  useEffect(() => {
    commands.getSettings().then(setSettings).catch(() => {});
    commands.detectDesktopTheme().then(setDesktopTheme).catch(() => {});
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const update = (patch: Partial<Settings>) => {
    setSettings((s) => {
      if (!s) return s;
      const next = { ...s, ...patch };
      commands.setSettings(next).catch(() => {});
      if (patch.theme !== undefined || patch.theme_file !== undefined || patch.prose_font !== undefined || patch.prose_slant !== undefined) syncTheme(next);
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
                <Dropdown
                  value={settings.theme_file ? "desktop" : settings.theme}
                  options={[
                    { value: "system", label: "System" },
                    { value: "light", label: "Light" },
                    { value: "dark", label: "Dark" },
                    // Offered when the desktop publishes a palette, or one is already set.
                    ...(desktopTheme || settings.theme_file
                      ? [{ value: "desktop", label: desktopTheme ? "Desktop (Omarchy)" : "Palette file" }]
                      : []),
                  ]}
                  onChange={(v) =>
                    v === "desktop"
                      ? update({ theme_file: settings.theme_file || desktopTheme || "" })
                      : update({ theme: v as Settings["theme"], theme_file: "" })
                  }
                />
              </label>

              {settings.theme_file && (
                <label className={styles.row}>
                  <span className={styles.label}>Palette file</span>
                  <input
                    className={styles.input}
                    value={settings.theme_file}
                    spellCheck={false}
                    title="A colors.toml in Omarchy's shape. The app retints live when it changes."
                    onChange={(e) => update({ theme_file: e.target.value })}
                  />
                </label>
              )}

              <label className={styles.row}>
                <span className={styles.label}>Page font</span>
                <Dropdown
                  value={!settings.prose_font ? DEFAULT_PROSE_FONT : isPreset(settings.prose_font) ? settings.prose_font : "custom"}
                  options={[
                    ...PROSE_FONTS.map((f) => ({ value: f.id, label: f.label })),
                    { value: "custom", label: "Custom — any installed font…" },
                  ]}
                  onChange={(v) => update({ prose_font: v === "custom" ? (isPreset(settings.prose_font) || !settings.prose_font ? "Literata" : settings.prose_font) : v })}
                />
              </label>

              {settings.prose_font && !isPreset(settings.prose_font) && (
                <label className={styles.row}>
                  <span className={styles.label}>Font family</span>
                  <input
                    className={styles.input}
                    value={settings.prose_font}
                    spellCheck={false}
                    placeholder="e.g. Literata, or Atkinson Hyperlegible Next"
                    title="A font installed on this machine. Applies as you type."
                    onChange={(e) => update({ prose_font: e.target.value })}
                  />
                </label>
              )}

              <label className={styles.row}>
                <span className={styles.label}>Page tilt</span>
                <Dropdown
                  value={PROSE_SLANTS.some((s) => s.id === settings.prose_slant) ? settings.prose_slant : ""}
                  options={PROSE_SLANTS.map((s) => ({ value: s.id, label: s.label }))}
                  onChange={(v) => update({ prose_slant: v })}
                />
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
                <Dropdown
                  value={String(settings.auto_sync_minutes)}
                  options={[
                    { value: "0", label: "Off" },
                    { value: "1", label: "Every minute" },
                    { value: "5", label: "Every 5 minutes" },
                    { value: "15", label: "Every 15 minutes" },
                  ]}
                  onChange={(v) => update({ auto_sync_minutes: Number(v) })}
                />
              </label>

              <label className={styles.row}>
                <span className={styles.label}>Collaboration server</span>
                <input
                  className={styles.input}
                  value={settings.collab_url}
                  placeholder="ws://host:1234 (empty = off)"
                  spellCheck={false}
                  onChange={(e) => update({ collab_url: e.target.value.trim() })}
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
