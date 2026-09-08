// Settings — a full-window page with a section nav, search, and one row per
// key of `.cortex/settings.yaml`. The file is the source of truth: every row
// names its key, edits are written straight to it, and edits made elsewhere
// (a terminal, an agent, `cortex settings set`) show up here live because the
// vault watcher reports `.cortex/` changes. Nothing on this page is only
// reachable from the UI.

import { useCallback, useEffect, useMemo, useRef, useState, ReactNode, KeyboardEvent as ReactKeyboardEvent } from "react";
import { listen } from "@tauri-apps/api/event";
import { commands, Settings, VaultInfo, Member, CurrentUser, AgentCli, VaultChanged } from "../../lib/commands";
import { TAG_COLORS, swatchStyle, autoColor } from "../../lib/colors";
import { syncTheme } from "../../lib/theme";
import { PROSE_FONTS, PROSE_SLANTS, DEFAULT_PROSE_FONT, isPreset } from "../../lib/fonts";
import {
  SHORTCUTS, ShortcutId, keysFor, formatKeys, isOverridden, comboFromEvent, conflictFor, shortcutFor, isMac,
} from "../../lib/keymap";
import { Dropdown } from "./Dropdown";
import { AgentIcon } from "./agentIcons";
import {
  CloseIcon, SearchIcon, FolderIcon, ThemeIcon, TextLinesIcon, FileIcon, SyncIcon, TerminalIcon,
  PersonIcon, LinkIcon, OpenIcon, GlobeIcon, TemplateIcon, SparkleIcon,
} from "./icons";
import styles from "./SettingsView.module.css";

interface Props {
  vault: VaultInfo;
  onClose: () => void;
  onLeaveVault: () => void;
}

// ── Row model ─────────────────────────────────────────────────────────────────
//
// Sections and rows are data so search can see every row, whichever section
// is open. `key` is the YAML key (or `keybindings.<id>`, or a file for things
// that live elsewhere in .cortex/); it is shown on the row and searchable.

interface Ctx {
  vault: VaultInfo;
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
  desktopTheme: string | null;
  agents: AgentCli[];
  customCommand: boolean;
  setCustomCommand: (on: boolean) => void;
  onLeaveVault: () => void;
  onClose: () => void;
}

interface RowDef {
  /** Key in settings.yaml (`keybindings.<id>` for shortcuts), or a path under
   *  .cortex/ for things that live in another file. Omitted on info rows. */
  key?: string;
  label: string;
  hint?: ReactNode;
  /** Extra words search should match (synonyms, values). */
  keywords?: string;
  /** Control spans the full width (lists, rosters). */
  wide?: boolean;
  render: (ctx: Ctx) => ReactNode;
}

interface SectionDef {
  id: string;
  title: string;
  blurb?: string;
  icon: ReactNode;
  rows: RowDef[];
}

const SETTINGS_FILE = ".cortex/settings.yaml";

const SECTIONS: SectionDef[] = [
  {
    id: "vault",
    title: "Vault",
    blurb: "This vault, and the files its configuration lives in.",
    icon: <FolderIcon size={14} />,
    rows: [
      {
        label: "Name", keywords: "vault title name",
        render: ({ vault }) => <span className={styles.value}>{vault.name}</span>,
      },
      {
        label: "Location", keywords: "folder directory path reveal open finder location",
        hint: "Where the vault lives on disk.",
        render: ({ vault }) => (
          <>
            <span className={`${styles.value} ${styles.valueMono} ${styles.valueWrap}`} title={vault.path}>{vault.path}</span>
            <button className={styles.btn} onClick={() => commands.revealPath(".").catch(() => {})} title="Show in the file manager">
              <OpenIcon size={12} /> Reveal
            </button>
          </>
        ),
      },
      {
        label: "Git remote", keywords: "origin push pull sync remote",
        hint: "Sync pushes to and pulls from origin. Add one with git remote add origin <url>.",
        render: ({ vault }) => <span className={styles.value}>{vault.has_remote ? "origin configured" : "none"}</span>,
      },
      {
        key: ".cortex/", label: "Configuration files", wide: true,
        keywords: "yaml config settings members favorites schemas file edit",
        hint: (
          <>
            Committed with the vault, so config travels with it. Every setting on this page is a key in{" "}
            <code>{SETTINGS_FILE}</code>; the app reloads the file whenever it changes.
          </>
        ),
        render: () => (
          <div className={styles.stack}>
            <ConfigFile path={SETTINGS_FILE} what="every app setting" />
            <ConfigFile path=".cortex/members.yaml" what="the team roster" />
            <ConfigFile path=".cortex/favorites.yaml" what="favourited notes" />
            <ConfigFile path=".cortex/schemas/" what="typed properties per note type" />
            <span className={styles.note}>
              From a terminal: <code>cortex settings</code> prints the file, <code>cortex settings describe</code> explains
              every key, <code>cortex settings set key=value</code> edits it.
            </span>
          </div>
        ),
      },
      {
        label: "Leave vault", keywords: "close switch another sign out leave",
        hint: "Back to the vault picker. Nothing is deleted.",
        render: ({ onClose, onLeaveVault }) => (
          <button className={`${styles.btn} ${styles.btnDanger}`} onClick={() => { onClose(); onLeaveVault(); }}>Leave vault</button>
        ),
      },
    ],
  },
  {
    id: "appearance",
    title: "Appearance",
    blurb: "Colours and the page's typeface.",
    icon: <ThemeIcon size={14} />,
    rows: [
      {
        key: "theme", label: "Theme", keywords: "light dark system colour color scheme desktop omarchy palette",
        hint: "System follows the OS. Desktop follows the palette your desktop publishes and retints live when it changes.",
        render: ({ settings, desktopTheme, update }) => (
          <Dropdown
            fullWidth
            value={settings.theme_file ? "desktop" : settings.theme}
            options={[
              { value: "system", label: "System" },
              { value: "light", label: "Light" },
              { value: "dark", label: "Dark" },
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
        ),
      },
      {
        key: "theme_file", label: "Palette file", keywords: "colors.toml omarchy desktop theme path",
        hint: "A colors.toml in Omarchy's shape (~ expands). Empty = use Theme.",
        render: ({ settings, update }) => (
          <input
            className={`${styles.input} ${styles.inputMono}`}
            value={settings.theme_file}
            spellCheck={false}
            placeholder="~/.local/state/omarchy/current/theme/colors.toml"
            onChange={(e) => update({ theme_file: e.target.value })}
          />
        ),
      },
      {
        key: "prose_font", label: "Page font", keywords: "typeface family serif sans mono ysabeau quattro recursive",
        hint: "The editor's typeface. Pick a bundled face or name any font installed on this machine.",
        render: ({ settings, update }) => {
          const custom = !!settings.prose_font && !isPreset(settings.prose_font);
          return (
            <div className={styles.stack}>
              <Dropdown
                fullWidth
                value={!settings.prose_font ? DEFAULT_PROSE_FONT : custom ? "custom" : settings.prose_font}
                options={[
                  ...PROSE_FONTS.map((f) => ({ value: f.id, label: f.label })),
                  { value: "custom", label: "Custom — any installed font…" },
                ]}
                onChange={(v) => update({ prose_font: v === "custom" ? (custom ? settings.prose_font : "Literata") : v })}
              />
              {custom && (
                <input
                  className={styles.input}
                  value={settings.prose_font}
                  spellCheck={false}
                  placeholder="e.g. Literata, or Atkinson Hyperlegible Next"
                  onChange={(e) => update({ prose_font: e.target.value })}
                />
              )}
            </div>
          );
        },
      },
      {
        key: "prose_slant", label: "Page tilt", keywords: "italic oblique slant upright degrees",
        hint: "Lean the page a little, or set it in italic.",
        render: ({ settings, update }) => (
          <Dropdown
            fullWidth
            value={PROSE_SLANTS.some((s) => s.id === settings.prose_slant) ? settings.prose_slant : ""}
            options={PROSE_SLANTS.map((s) => ({ value: s.id, label: s.label }))}
            onChange={(v) => update({ prose_slant: v })}
          />
        ),
      },
    ],
  },
  {
    id: "notes",
    title: "Notes",
    blurb: "Defaults for new notes, and what happens to deleted ones.",
    icon: <FileIcon size={14} />,
    rows: [
      {
        key: "default_note_type", label: "Default note type", keywords: "frontmatter type new note schema",
        hint: "The frontmatter type pre-filled on a new note. Types with a schema get typed properties.",
        render: ({ settings, update }) => (
          <input className={styles.input} value={settings.default_note_type} spellCheck={false}
            onChange={(e) => update({ default_note_type: e.target.value })} />
        ),
      },
      {
        key: "journal_template", label: "Journal template", keywords: "daily today template journal",
        hint: "The file under templates/ that Today uses.",
        render: ({ settings, update }) => (
          <input className={`${styles.input} ${styles.inputMono}`} value={settings.journal_template} spellCheck={false}
            onChange={(e) => update({ journal_template: e.target.value })} />
        ),
      },
      {
        key: "trash_retention_days", label: "Trash retention", keywords: "delete purge prune days trash forever",
        hint: "Days a trashed note is kept before it is removed for good. 0 keeps trash forever.",
        render: ({ settings, update }) => (
          <NumberField value={settings.trash_retention_days} unit="days" min={0}
            onChange={(n) => update({ trash_retention_days: n })} />
        ),
      },
    ],
  },
  {
    id: "templates",
    title: "Templates",
    blurb: "The template marketplace: note templates and databases installed as plain files. Nothing is fetched or installed until you ask.",
    icon: <TemplateIcon size={14} />,
    rows: [
      {
        label: "Browse", keywords: "marketplace packs install template database browse get more",
        hint: (
          <>
            Official packs are bundled with the app; the online index adds community ones. From a terminal:{" "}
            <code>cortex packs list</code>, <code>cortex packs install tasks</code>.
          </>
        ),
        render: () => (
          <button className={styles.btn} onClick={() => window.dispatchEvent(new CustomEvent("cortex:open-marketplace"))}>
            <SparkleIcon size={12} /> Browse templates
          </button>
        ),
      },
      {
        key: "marketplace_url", label: "Index URL", keywords: "marketplace registry company index url private",
        hint: "Where the catalog comes from. Empty = the official index. A company points this at its own registry (any static host serving an index.json).",
        render: ({ settings, update }) => (
          <input className={`${styles.input} ${styles.inputMono}`} value={settings.marketplace_url} spellCheck={false}
            placeholder="https://frontal-cortex.github.io/marketplace/index.json"
            onChange={(e) => update({ marketplace_url: e.target.value.trim() })} />
        ),
      },
      {
        key: "marketplace_extra", label: "Extra indexes", keywords: "marketplace team registry additional merge urls",
        hint: "More index URLs, comma-separated, merged with the first — a team registry alongside the official one.",
        render: ({ settings, update }) => (
          <input className={`${styles.input} ${styles.inputMono}`} value={settings.marketplace_extra} spellCheck={false}
            placeholder="https://notes.example.com/packs/index.json"
            onChange={(e) => update({ marketplace_extra: e.target.value })} />
        ),
      },
      {
        key: "marketplace_tiers", label: "Tiers shown", keywords: "official verified community trust tier hide",
        hint: "Official packs are the team's; verified ones a maintainer reviewed; community ones only passed lint.",
        render: ({ settings, update }) => {
          const raw = settings.marketplace_tiers.split(/[,\s]+/).filter(Boolean).sort().join(",");
          const value = !raw || raw === "community,official,verified" ? "all" : raw === "official" ? "official" : raw === "official,verified" ? "official,verified" : "custom";
          return (
            <Dropdown
              fullWidth
              value={value}
              options={[
                { value: "all", label: "All three" },
                { value: "official,verified", label: "Official and verified" },
                { value: "official", label: "Official only" },
                ...(value === "custom" ? [{ value: "custom", label: settings.marketplace_tiers }] : []),
              ]}
              onChange={(v) => update({ marketplace_tiers: v === "all" ? "" : v === "custom" ? settings.marketplace_tiers : v })}
            />
          );
        },
      },
      {
        key: ".cortex/packs.yaml", label: "Installed packs", wide: true,
        keywords: "installed record packs.yaml hashes update remove",
        hint: "Which packs are installed, at which version, with a hash per file — so update and remove can tell your edits from the pack's originals. Committed with the vault, so a teammate sees the same Installed state.",
        render: () => (
          <div className={styles.stack}>
            <ConfigFile path=".cortex/packs.yaml" what="the install record (absent until the first install)" />
          </div>
        ),
      },
    ],
  },
  {
    id: "git",
    title: "Git & sync",
    blurb: "Every vault is a git repository. Commits are history; sync is origin.",
    icon: <SyncIcon size={14} />,
    rows: [
      {
        key: "auto_commit", label: "Auto-commit on save", keywords: "git commit history automatic",
        hint: "Commit a little after the last save, so a burst of edits becomes one commit. Off = commit by hand or when syncing.",
        render: ({ settings, update }) => (
          <input type="checkbox" className={styles.toggle} checked={settings.auto_commit}
            onChange={(e) => update({ auto_commit: e.target.checked })} />
        ),
      },
      {
        key: "auto_sync_minutes", label: "Auto-sync", keywords: "push pull interval minutes origin remote background",
        hint: "Pull and push on a timer, plus on launch and when the window regains focus. Needs a remote.",
        render: ({ settings, update }) => {
          const n = settings.auto_sync_minutes;
          const presets = [0, 1, 5, 15, 60];
          return (
            <Dropdown
              fullWidth
              value={String(n)}
              options={[
                { value: "0", label: "Off" },
                { value: "1", label: "Every minute" },
                { value: "5", label: "Every 5 minutes" },
                { value: "15", label: "Every 15 minutes" },
                { value: "60", label: "Every hour" },
                ...(presets.includes(n) ? [] : [{ value: String(n), label: `Every ${n} minutes` }]),
              ]}
              onChange={(v) => update({ auto_sync_minutes: Number(v) })}
            />
          );
        },
      },
    ],
  },
  {
    id: "terminal",
    title: "Terminal & agents",
    blurb: "The terminal pane, and the agent it opens into.",
    icon: <TerminalIcon size={14} />,
    rows: [
      {
        key: "terminal_command", label: "Terminal agent",
        keywords: "claude hermes codex gemini opencode aider goose amp copilot pi shell command cli ai",
        hint: (
          <>
            What the terminal pane ({shortcutFor("toggle-terminal")}) runs when it opens. Only agents found on your PATH are
            listed; the shell stays underneath for when the agent exits.
          </>
        ),
        render: (ctx) => <TerminalAgentControl {...ctx} />,
      },
      {
        label: "Agent conventions", keywords: "agents.md agents mcp cli instructions conventions",
        hint: (
          <>
            Every vault carries an AGENTS.md telling an agent how notes are shaped and how to propose changes for review.
            Give an agent the vault over MCP with <code>claude mcp add cortex -- cortex mcp --vault {"<dir>"}</code>.
          </>
        ),
        render: () => (
          <button className={styles.btn} onClick={() => window.dispatchEvent(new CustomEvent("cortex:open-note", { detail: { path: "AGENTS.md" } }))}>
            <FileIcon size={12} /> Open AGENTS.md
          </button>
        ),
      },
    ],
  },
  {
    id: "keyboard",
    title: "Keyboard",
    blurb: `Click a shortcut and press the new keys. ${isMac ? "⌘" : "Ctrl"} is written as mod in the file, so bindings work on any machine.`,
    icon: <TextLinesIcon size={14} />,
    rows: (Object.keys(SHORTCUTS) as ShortcutId[]).map((id) => ({
      key: `keybindings.${id}`,
      label: SHORTCUTS[id].label,
      keywords: `shortcut hotkey binding ${SHORTCUTS[id].keys} ${formatKeys(SHORTCUTS[id].keys)}`,
      render: (ctx: Ctx) => <ShortcutControl id={id} {...ctx} />,
    })),
  },
  {
    id: "members",
    title: "Members",
    blurb: "People who can be assigned in a Person property. You are whoever git says you are.",
    icon: <PersonIcon size={14} />,
    rows: [
      {
        key: ".cortex/members.yaml", label: "Team roster", wide: true,
        keywords: "team people person assign roster user identity email colour",
        render: () => <MembersEditor />,
      },
    ],
  },
  {
    id: "publishing",
    title: "Publishing",
    blurb: "A static site from the notes you mark public. Nothing is published until you run Publish.",
    icon: <GlobeIcon size={14} />,
    rows: [
      {
        key: "site_title", label: "Site title", keywords: "publish site name website",
        hint: "Shown in the site's header and browser tab. Empty = the vault folder's name.",
        render: ({ settings, vault, update }) => (
          <input className={styles.input} value={settings.site_title} spellCheck={false} placeholder={vault.name}
            onChange={(e) => update({ site_title: e.target.value })} />
        ),
      },
      {
        key: "site_home", label: "Front page note", keywords: "publish home index landing about",
        hint: "A published note shown above the list on the site's front page, e.g. notes/about.md. Empty = the list only.",
        render: ({ settings, update }) => (
          <input className={`${styles.input} ${styles.inputMono}`} value={settings.site_home} spellCheck={false} placeholder="notes/about.md"
            onChange={(e) => update({ site_home: e.target.value })} />
        ),
      },
      {
        label: "How it works", keywords: "publish gh-pages github pages folder static host cortex publish",
        hint: (
          <>
            Mark a note with <code>publish: true</code> (command palette → Make this note public). Then run{" "}
            <strong>Publish site…</strong> from the palette to build into a folder or push a gh-pages branch, or{" "}
            <code>cortex publish --out DIR</code> from a terminal. Links to unpublished notes become plain text.
          </>
        ),
        render: () => (
          <button className={styles.btn} onClick={() => window.dispatchEvent(new CustomEvent("cortex:open-note", { detail: { path: "VAULT.md" } }))}>
            <FileIcon size={12} /> Read VAULT.md
          </button>
        ),
      },
    ],
  },
  {
    id: "collab",
    title: "Collaboration",
    blurb: "Live co-editing and presence over a relay. Git sync works without it.",
    icon: <LinkIcon size={14} />,
    rows: [
      {
        key: "collab_url", label: "Relay server", keywords: "yjs websocket presence realtime live cursors",
        hint: "A Yjs websocket relay, e.g. ws://host:1234. Empty = off.",
        render: ({ settings, update }) => (
          <input className={`${styles.input} ${styles.inputMono}`} value={settings.collab_url} spellCheck={false}
            placeholder="ws://host:1234" onChange={(e) => update({ collab_url: e.target.value.trim() })} />
        ),
      },
    ],
  },
];

function rowMatches(section: SectionDef, row: RowDef, q: string): boolean {
  const hay = `${section.title} ${row.label} ${row.key ?? ""} ${row.keywords ?? ""} ${typeof row.hint === "string" ? row.hint : ""}`.toLowerCase();
  return q.split(/\s+/).filter(Boolean).every((word) => hay.includes(word));
}

// ── The page ──────────────────────────────────────────────────────────────────

export function SettingsView({ vault, onClose, onLeaveVault }: Props) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [desktopTheme, setDesktopTheme] = useState<string | null>(null);
  const [agents, setAgents] = useState<AgentCli[]>([]);
  const [customCommand, setCustomCommand] = useState(false);
  const [active, setActive] = useState(SECTIONS[0].id);
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  // Our own writes come back as watcher events; skip reloading for a moment
  // after each so a fast typist's input is never overwritten mid-word.
  const lastWrite = useRef(0);

  const load = useCallback(() => { commands.getSettings().then(setSettings).catch(() => {}); }, []);

  useEffect(() => {
    load();
    commands.detectDesktopTheme().then(setDesktopTheme).catch(() => {});
    commands.detectAgents().then(setAgents).catch(() => {});
  }, [load]);

  // Edits made outside the app (terminal, agent, editor) appear live.
  useEffect(() => {
    const unlisten = listen<VaultChanged>("vault://changed", ({ payload }) => {
      if (payload.config && Date.now() - lastWrite.current > 800) load();
    });
    return () => { unlisten.then((f) => f()); };
  }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // A recorder in progress owns Escape (it stops propagation first).
        if (query && document.activeElement === searchRef.current) { setQuery(""); return; }
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, query]);

  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((s) => {
      if (!s) return s;
      const next = { ...s, ...patch };
      lastWrite.current = Date.now();
      commands.setSettings(next).catch(() => {});
      if (patch.theme !== undefined || patch.theme_file !== undefined || patch.prose_font !== undefined || patch.prose_slant !== undefined) syncTheme(next);
      return next;
    });
  }, []);

  const q = query.trim().toLowerCase();
  const visible = useMemo(() => {
    if (!q) return SECTIONS.map((s) => ({ section: s, rows: s.rows }));
    return SECTIONS
      .map((s) => ({ section: s, rows: s.rows.filter((r) => rowMatches(s, r, q)) }))
      .filter((s) => s.rows.length > 0);
  }, [q]);
  const shown = q ? visible : visible.filter((v) => v.section.id === active);

  const selectSection = (id: string) => {
    setActive(id);
    setQuery("");
    contentRef.current?.scrollTo({ top: 0 });
  };

  const onNavKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>("button"));
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "ArrowDown" || e.key === "j") { e.preventDefault(); items[Math.min(items.length - 1, i + 1)]?.focus(); }
    else if (e.key === "ArrowUp" || e.key === "k") { e.preventDefault(); items[Math.max(0, i - 1)]?.focus(); }
    else if (e.key === "/") { e.preventDefault(); searchRef.current?.focus(); }
  };

  const ctx: Ctx | null = settings
    ? { vault, settings, update, desktopTheme, agents, customCommand, setCustomCommand, onLeaveVault, onClose }
    : null;

  return (
    <div className={styles.page} role="dialog" aria-label="Settings">
      <nav className={styles.nav}>
        <div className={styles.navHead}>
          <span className={styles.navTitle}>Settings</span>
          <button className={styles.closeBtn} onClick={onClose} title="Close (Esc)"><CloseIcon size={16} /></button>
        </div>
        <label className={styles.search}>
          <SearchIcon size={13} />
          <input
            ref={searchRef}
            className={styles.searchInput}
            value={query}
            autoFocus
            placeholder="Search settings"
            spellCheck={false}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                (e.currentTarget.closest("nav")?.querySelector(`.${styles.navList} button`) as HTMLButtonElement | null)?.focus();
              }
            }}
          />
          {!query && <span className={styles.searchKey}>/</span>}
        </label>
        <div className={styles.navList} role="list" onKeyDown={onNavKey}>
          {SECTIONS.map((s) => {
            const hits = q ? visible.find((v) => v.section.id === s.id)?.rows.length ?? 0 : null;
            const isActive = q ? hits! > 0 : s.id === active;
            return (
              <button
                key={s.id}
                className={`${styles.navItem} ${isActive ? styles.navItemActive : ""} ${q && !hits ? styles.navItemMuted : ""}`}
                onClick={() => selectSection(s.id)}
              >
                <span className={styles.navIcon}>{s.icon}</span>
                <span className={styles.navLabel}>{s.title}</span>
                {hits !== null && hits > 0 && <span className={styles.navCount}>{hits}</span>}
              </button>
            );
          })}
        </div>
        <div className={styles.navFoot}>
          <button className={styles.fileLink} onClick={() => commands.revealPath(SETTINGS_FILE).catch(() => {})} title="Reveal in the file manager">
            <OpenIcon size={11} /> {SETTINGS_FILE}
          </button>
          <span>Every setting is a key in this file. Edit it anywhere; the app follows.</span>
        </div>
      </nav>

      <div className={styles.content} ref={contentRef}>
        <div className={styles.inner}>
          {!ctx ? null : shown.length === 0 ? (
            <div className={styles.empty}>No settings match “{query}”.</div>
          ) : shown.map(({ section, rows }) => (
            <section key={section.id} className={styles.section} aria-label={section.title}>
              <div className={styles.sectionHead}>
                <h2 className={styles.sectionTitle}>{section.title}</h2>
                {section.blurb && <p className={styles.sectionBlurb}>{section.blurb}</p>}
              </div>
              {rows.map((row) => (
                <Row key={row.key ?? row.label} row={row} ctx={ctx} />
              ))}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

function Row({ row, ctx }: { row: RowDef; ctx: Ctx }) {
  const key = row.key;
  const overridden = !!key && key.startsWith("keybindings.") && isOverridden(key.slice("keybindings.".length) as ShortcutId);
  const isFile = !!key && (key.includes("/") || key.endsWith(".md"));
  return (
    <div className={`${styles.row} ${row.wide ? styles.rowWide : ""}`}>
      <div className={styles.labelCol}>
        <span className={styles.label}>{row.label}</span>
        {row.hint && <span className={styles.hint}>{row.hint}</span>}
        {key && (
          <code
            className={`${styles.key} ${overridden ? styles.keyOverridden : ""}`}
            title={isFile ? "Where this lives in the vault" : overridden ? `Overridden in ${SETTINGS_FILE}` : `Key in ${SETTINGS_FILE}`}
          >
            {key}
          </code>
        )}
      </div>
      <div className={styles.control}>{row.render(ctx)}</div>
    </div>
  );
}

function ConfigFile({ path, what }: { path: string; what: string }) {
  return (
    <span className={styles.note}>
      <button className={styles.fileLink} onClick={() => commands.revealPath(path).catch(() => {})} title="Reveal in the file manager">
        <OpenIcon size={11} /> {path}
      </button>
      {" — "}{what}
    </span>
  );
}

function NumberField({ value, unit, min, onChange }: { value: number; unit: string; min: number; onChange: (n: number) => void }) {
  return (
    <>
      <input
        className={`${styles.input} ${styles.inputNarrow}`}
        type="number"
        min={min}
        value={value}
        onChange={(e) => onChange(Math.max(min, Number(e.target.value) || 0))}
      />
      <span className={styles.note}>{unit}</span>
    </>
  );
}

/** Which command the terminal pane opens with: a plain shell, one of the
 *  agent CLIs, or anything the user types. Installed agents come first with
 *  a "detected" badge; the rest are listed, dimmed, so the user can see what
 *  the app knows about — picking one would only print "command not found",
 *  so they are not selectable. Custom command is the escape hatch. */
function TerminalAgentControl({ agents, settings, update, customCommand, setCustomCommand }: Ctx) {
  const value = settings.terminal_command;
  const found = agents.filter((a) => a.found);
  const missing = agents.filter((a) => !a.found);
  const match = found.find((a) => a.command === value.trim());
  const selected = customCommand ? "custom" : !value.trim() ? "shell" : match ? match.id : "custom";
  return (
    <div className={styles.stack}>
      <Dropdown
        fullWidth
        value={selected}
        options={[
          { value: "shell", label: "Shell only", icon: <TerminalIcon size={14} /> },
          ...found.map((a) => ({
            value: a.id, label: a.label, badge: "detected", hint: a.path ?? undefined,
            icon: <AgentIcon id={a.id} label={a.label} />,
          })),
          ...missing.map((a, i) => ({
            value: a.id, label: a.label, disabled: true, separator: i === 0,
            hint: `not installed (${a.command})`, icon: <AgentIcon id={a.id} label={a.label} />,
          })),
          { value: "custom", label: "Custom command…", separator: true },
        ]}
        onChange={(v) => {
          if (v === "custom") { setCustomCommand(true); return; }
          setCustomCommand(false);
          update({ terminal_command: v === "shell" ? "" : found.find((a) => a.id === v)?.command ?? "" });
        }}
      />
      {selected === "custom" && (
        <input
          className={`${styles.input} ${styles.inputMono}`}
          value={value}
          spellCheck={false}
          placeholder="e.g. claude --continue (empty = shell)"
          onChange={(e) => update({ terminal_command: e.target.value })}
        />
      )}
      {match?.path && <span className={`${styles.note} ${styles.valueMono}`} title={match.path}>{match.path}</span>}
      {agents.length > 0 && found.length === 0 && (
        <span className={styles.note}>No agent CLIs found on PATH. Install one (claude, codex, gemini, …) and reopen Settings.</span>
      )}
    </div>
  );
}

/** One shortcut: click, press the new keys, done. Delete clears the override;
 *  Escape cancels. Writes `keybindings.<id>` in the settings file. */
function ShortcutControl({ id, settings, update }: { id: ShortcutId } & Ctx) {
  const [recording, setRecording] = useState(false);
  const current = keysFor(id);
  const overridden = isOverridden(id);
  const clash = conflictFor(current, id);

  useEffect(() => {
    if (!recording) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") { setRecording(false); return; }
      if (e.key === "Backspace" || e.key === "Delete") {
        const next = { ...settings.keybindings };
        delete next[id];
        update({ keybindings: next });
        setRecording(false);
        return;
      }
      const combo = comboFromEvent(e);
      if (!combo) return;
      const next = { ...settings.keybindings };
      if (combo === SHORTCUTS[id].keys) delete next[id]; else next[id] = combo;
      update({ keybindings: next });
      setRecording(false);
    };
    // Capture phase, before Shell's global shortcut handler sees the keys.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [recording, id, settings.keybindings, update]);

  return (
    <>
      {clash && !recording && (
        <span className={`${styles.note} ${styles.warn}`} title={`Both run on ${formatKeys(current)}; the first in the table wins.`}>
          also {SHORTCUTS[clash].label}
        </span>
      )}
      {overridden && !recording && (
        <button className={`${styles.btn} ${styles.btnQuiet}`} title={`Back to ${formatKeys(SHORTCUTS[id].keys)}`}
          onClick={() => { const next = { ...settings.keybindings }; delete next[id]; update({ keybindings: next }); }}>
          Reset
        </button>
      )}
      <button
        className={`${styles.keys} ${recording ? styles.keysRecording : ""}`}
        onClick={() => setRecording(true)}
        title={recording ? "Press the new keys · Esc cancels · Delete clears" : "Click to change"}
      >
        {recording ? "Press keys…" : formatKeys(current)}
      </button>
    </>
  );
}

/** Team roster — people who can be assigned to `person` properties. Identity
 *  ("you") comes from git config, the same name that authors commits. */
function MembersEditor() {
  const [members, setMembers] = useState<Member[]>([]);
  const [me, setMe] = useState<CurrentUser | null>(null);
  const lastWrite = useRef(0);

  const load = useCallback(() => {
    commands.getMembers().then(setMembers).catch(() => {});
    commands.currentUser().then(setMe).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const unlisten = listen<VaultChanged>("vault://changed", ({ payload }) => {
      if (payload.config && Date.now() - lastWrite.current > 800) load();
    });
    return () => { unlisten.then((f) => f()); };
  }, [load]);

  const write = (next: Member[]) => { lastWrite.current = Date.now(); commands.setMembers(next).catch(() => {}); };
  const persist = (next: Member[]) => { setMembers(next); write(next); };
  const editLocal = (i: number, patch: Partial<Member>) =>
    setMembers((ms) => ms.map((m, j) => (j === i ? { ...m, ...patch } : m)));
  const commit = () => write(members);

  const cycleColor = (i: number) => {
    const idx = TAG_COLORS.indexOf(members[i].color as (typeof TAG_COLORS)[number]);
    const next = TAG_COLORS[(idx + 1) % TAG_COLORS.length];
    persist(members.map((m, j) => (j === i ? { ...m, color: next } : m)));
  };
  const add = () => persist([...members, { name: "", email: "", color: autoColor(String(members.length)) }]);
  const remove = (i: number) => persist(members.filter((_, j) => j !== i));
  const isMe = (m: Member) =>
    !!me && ((!!m.email && m.email === me.email) || (!!m.name && m.name === me.name));

  return (
    <div className={styles.members}>
      {me?.name ? (
        <span className={styles.note}>You: {me.name}{me.email ? ` · ${me.email}` : ""} (from git config user.name / user.email)</span>
      ) : (
        <span className={`${styles.note} ${styles.warn}`}>
          Git has no identity on this machine, so commits are signed with your login and hostname. Set one with{" "}
          <code>git config --global user.name "Your Name"</code> and <code>user.email</code>.
        </span>
      )}
      {members.length === 0 && (
        <span className={styles.note}>No members yet. Add teammates so you can assign them with a Person property.</span>
      )}
      {members.map((m, i) => (
        <div key={i} className={styles.memberRow}>
          <button className={styles.swatch} style={swatchStyle(m.color)} onClick={() => cycleColor(i)} title="Colour — click to cycle" />
          <input className={styles.memberInput} value={m.name} placeholder="Name"
            onChange={(e) => editLocal(i, { name: e.target.value })} onBlur={commit} />
          <input className={styles.memberInput} value={m.email} placeholder="email (optional)" spellCheck={false}
            onChange={(e) => editLocal(i, { email: e.target.value })} onBlur={commit} />
          {isMe(m) && <span className={styles.youTag}>you</span>}
          <button className={styles.removeBtn} onClick={() => remove(i)} title="Remove member"><CloseIcon size={12} /></button>
        </div>
      ))}
      <button className={styles.addMember} onClick={add}>+ Add member</button>
    </div>
  );
}
