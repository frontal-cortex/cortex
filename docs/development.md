# Development Guide

## Prerequisites

- **Rust** (1.70+) — [rustup.rs](https://rustup.rs)
- **Node.js** (18+) — via [nvm](https://github.com/nvm-sh/nvm) or direct install
- **Tauri system dependencies** — platform-specific:
  - macOS: Xcode Command Line Tools (`xcode-select --install`)
  - Windows: see [Tauri prerequisites](https://tauri.app/start/prerequisites/)
  - Linux: `webkit2gtk`, `libssl-dev`, etc.

## Running locally

```bash
# Install JS dependencies
npm install

# Start dev mode (hot reload for both frontend and Rust)
npm run tauri dev

# The CLI / MCP server (same core crate)
cargo run -p cortex-cli -- --vault ../test-vault/cortex-vault ls
cargo install --path crates/cortex-cli
```

The first run compiles the Rust backend (~2 min). Subsequent runs are fast.

## Project structure

```
cortex/                       # Cargo workspace root (Cargo.toml, Cargo.lock, target/)
├── crates/
│   ├── cortex-core/          # The vault model, no UI: notes, index, collections, schema, git, settings
│   │   ├── vault-template/   # The starter vault, compiled in (template.rs) — no network clone
│   │   ├── src/settings.rs   # `.cortex/settings.yaml`: every key described, typed `set_field`, `ensure_complete`
│   │   ├── src/vault.rs      # Vault discovery + the VAULT.md / AGENTS.md text written on first open
│   │   ├── src/publish.rs    # Static site from notes marked publish: true — build, gh-pages push, Action template
│   │   └── src/agents.rs     # Which agent CLIs (claude, hermes, …) are on $PATH, for `terminal_command`
│   └── cortex-cli/           # `cortex` binary: CLI (main.rs) + MCP server (mcp.rs) over shared ops.rs
├── src/                      # React + TypeScript frontend
│   ├── components/Shell/     # Main UI components
│   │   ├── LeftPanel.tsx     # Sidebar: sections, tree, trash — one flat keyboard row list (treeRows.ts)
│   │   ├── treeRows.ts       # Roving tabindex + type-ahead over the sidebar's row model
│   │   ├── GettingStarted.tsx # First-run steps, rendered as tree rows so the keyboard reaches them
│   │   ├── CortexViewBlock.tsx # Data views in a note; the table is a roving keyboard grid (TABLE_KEYS in keymap.ts)
│   │   ├── DatePicker.tsx    # The one date field: typed input validated to a real day, calendar popover
│   │   ├── SettingsView.tsx  # Full-window settings page: section nav, search, one row per settings.yaml key
│   │   ├── PublishModal.tsx  # The only path to a published site: shows what goes, where, and the result
│   │   └── TerminalPane.tsx  # xterm.js over a real PTY; opens into `terminal_command` (an agent CLI)
│   ├── hooks/                # React hooks (useVault, useNotes, useViewport)
│   ├── lib/                  # Shared utilities (commands.ts, fileTree.ts)
│   │   ├── keymap.ts         # Keyboard shortcuts — the single source of truth for bindings + hints
│   │   ├── breakpoints.ts    # Viewport breakpoints (phone / compact / wide) — the single source for responsive CSS
│   │   └── theme.ts          # Light/dark preference + desktop palette → CSS custom properties
│   └── styles/tokens.css     # Design tokens (CSS variables)
├── src-tauri/                # Rust backend
│   └── src/
│       ├── commands/         # Tauri IPC command handlers (thin wrappers over cortex-core)
│       │   ├── vault.rs      # Vault open/info, DbState, VAULT.md + AGENTS.md
│       │   ├── notes.rs      # CRUD + search + backlinks + folders
│       │   └── git.rs        # Status, commit, sync, log, proposals (agent branches)
│       ├── watcher.rs        # Filesystem watcher: external edits → index + `vault://changed` event
│       ├── theme.rs          # Follows a palette file (Omarchy colors.toml) → `theme://changed` event
│       ├── terminal.rs       # PTY sessions for the terminal pane
│       ├── agents.rs         # `detect_agents` command (thin wrapper over cortex_core::agents)
│       └── lib.rs            # App entry, command registration
├── docs/                     # Project documentation (this directory)
├── ARCHITECTURE.md           # System design overview
└── README.md                 # Getting started
```

## Key design decisions

**Frontmatter uses BTreeMap**: keys are always serialized alphabetically
(`created`, `tags`, `title`, `type`) so every save of the same note produces
identical YAML output — critical for clean git diffs.

**SQLite index is a cache**: deleting `.brain/index.db` and restarting
rebuilds it. The `.md` files are always the source of truth.

**Sync shells out to git**: push/pull use the system `git` binary so SSH
agents and OS credential helpers work. Internal ops (status, commit,
branch management) use `git2` (libgit2) for cross-platform reliability.
Commits use the configured git identity; on a machine without one,
`git::signature()` falls back to `<login> <login@hostname>` so auto-commit
(on by default) and the initial commit of a new vault still happen.

**The app follows the filesystem**: `watcher.rs` watches the vault and emits
one debounced `vault://changed` event per burst of external changes (an agent
writing on a branch, an editor, a git checkout), re-indexing notes first so the
UI's refresh sees current data. The app's own writes are recognised by content
hash and dropped, so the editor never remounts because the user typed.

**Shortcuts live in one table**: `src/lib/keymap.ts` declares every app-level
shortcut; `Shell` dispatches from it and all hints render from it via
`shortcutFor(id)`, platform-aware (⌘ on macOS, Ctrl elsewhere). Never hard-code
a key label in a component.

**Settings are one file, fully spelled out**: `.cortex/settings.yaml` is the
only configuration surface, for people and agents alike. `settings::describe()`
documents every key, `set_field()` applies a typed `key=value` edit, and
`ensure_complete()` writes every key (defaults filled in) on vault open so the
whole schema is visible. `cortex settings`, the MCP `get_settings` /
`set_settings` tools and the Settings modal all go through the same code, and
the watcher reloads the file live. A new field must be added to `describe()` —
a test fails otherwise.

**New vaults are scaffolded, not cloned**: `crates/cortex-core/vault-template/`
is compiled into the binary (`template::FILES`) and written by
`template::scaffold()`, so "New vault" and `cortex init` work offline and
produce the same vault. `VAULT.md`, `AGENTS.md` and `.cortex/settings.yaml`
are not in the template: the app writes the current versions on first open,
so their text lives in code (`vault::VAULT_MD`, `vault::AGENTS_MD`,
`settings::describe()`) and is versioned with it. To change the starter
notes, edit the files under `vault-template/`.

**Settings is a page, and the file is the truth**: `SettingsView` renders one
row per key of `.cortex/settings.yaml` from a data table (`SECTIONS`), so
search sees every row and each row shows its key. Edits are written to the
file; edits made elsewhere arrive through the watcher's config event and the
page reloads. A setting that only the UI could change would be a bug — add
the field to `describe()` in core first, then a row here.

**Publishing is never automatic**: `publish::build` runs only from
`cortex publish` or the app's Publish dialog. `publish: true` (or the `public`
tag) marks a note as eligible and nothing more. Links to unpublished notes
degrade to text so a site cannot leak what stayed private; the output folder
carries a manifest so a rebuild deletes only what it wrote. MCP exposes a
read-only `list_published` and no build/push tool on purpose. Full user docs:
`docs/publishing.md`.

**The sidebar is one flat row list**: `LeftPanel` derives a `TreeRow[]` (in
render order, from the same open/closed state the renderer reads) and
`treeRows.ts` moves focus over it with a roving tabindex, so ArrowDown / `j`
always lands on the next thing the eye sees, across sections. Anything rendered
as a row must also be pushed into that list under the same id. Vim keys,
type-ahead, `n` for a new note in the focused folder, `/` for search, and
Escape back to the editor all live in `handleTreeKeyDown`.

**The data table speaks the same keys**: `DataTable` in `CortexViewBlock.tsx`
keeps one active cell (a roving tabindex over `<td>`s) and moves it with
arrows or `j k h l`, Tab / Shift+Tab, Home / End; Enter opens the cell's
editor (`forceOpen` on `EditableCell`, `DateCell`, `SelectCell`) and Escape
hands focus back; Ctrl+Enter or `o` opens the row, `n` adds one, Delete
trashes it. Widget-local keys like these are listed in `keymap.ts`
(`TABLE_KEYS`) so hints read from one place, but they are not rebindable
app shortcuts. Dates go through `DatePicker` everywhere — a typed value is
written only when it names a real calendar day.

**One breakpoint system, no per-file `@media`**: `lib/breakpoints.ts` holds
the two widths (phone < 600px, compact < 820px). `useViewport` watches them
with `matchMedia`, and `App` stamps the result on `<html>` as
`data-viewport="phone|compact|wide"` (plus `--bp-phone` / `--bp-compact`
custom properties, for reference). Stylesheets select on the attribute —
`:root[data-viewport="phone"] .row { … }` — so a breakpoint changes in one
place. Below the phone breakpoint the sidebar is an overlay drawer
(`useLayout(drawer)`: session-only, never persisted, closes on Escape, on a
backdrop tap and once you pick something), the terminal a bottom sheet, the
top bar compact, and the page full-bleed via the `--page-inset` token that
title, properties, backlinks and the BlockNote body all align on;
`--tap-target` sizes rows and toolbar buttons for a thumb.

**The app can wear the desktop's palette**: `settings.theme_file` names a flat
TOML of colour names → hex (Omarchy's `colors.toml`; `~` expands per machine).
`theme.rs` reads it, watches its directory *and* parent (Omarchy swaps a
symlink), and emits `theme://changed`; `lib/theme.ts` puts each colour on
`<html>` as `--palette-<name>` and sets `data-palette`, under which
`tokens.css` re-derives every design token with `color-mix`. Components never
read palette names directly — only tokens — so any palette-shaped file works.
On tiling compositors (Hyprland, sway, …) the window is undecorated; the
`TopBar` is the title bar.

**Wiki links are decorations**: `[[...]]` text is stored as plain markdown.
The ProseMirror plugin applies visual decorations at render time without
modifying the document structure.

## Building for production

```bash
# Build frontend + Rust native binary
npm run tauri build
```

Output is in `src-tauri/target/release/bundle/`.

## Running tests

```bash
# TypeScript type check
npx tsc --noEmit

# Pure TypeScript helpers (node's built-in runner, no bundler)
npm run test:lib

# Rust tests (all crates)
cargo test --workspace

# Editor round-trip: canonical Markdown must survive open → save byte-for-byte
# (toggles, highlight, underline, sized images, callouts). Needs `chromium`.
tools/roundtrip/run.sh
```

## Adding a feature

Logic goes in `crates/cortex-core` (pure functions over a vault root), so the
app, CLI and MCP server all get it:

1. Implement it in the right core module (`note`, `data`, `git`, …) with a test
2. App: a `#[tauri::command]` wrapper in `src-tauri/src/commands/*.rs`, registered in
   `src-tauri/src/lib.rs`, plus a typed wrapper in `src/lib/commands.ts`
3. CLI / MCP: an op in `crates/cortex-cli/src/ops.rs`, then a `Cmd` arm in `main.rs`
   and a `#[tool]` in `mcp.rs`
