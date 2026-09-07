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
│   └── cortex-cli/           # `cortex` binary: CLI (main.rs) + MCP server (mcp.rs) over shared ops.rs
├── src/                      # React + TypeScript frontend
│   ├── components/Shell/     # Main UI components
│   ├── hooks/                # React hooks (useVault, useNotes)
│   ├── lib/                  # Shared utilities (commands.ts, fileTree.ts)
│   │   ├── keymap.ts         # Keyboard shortcuts — the single source of truth for bindings + hints
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

**The app follows the filesystem**: `watcher.rs` watches the vault and emits
one debounced `vault://changed` event per burst of external changes (an agent
writing on a branch, an editor, a git checkout), re-indexing notes first so the
UI's refresh sees current data. The app's own writes are recognised by content
hash and dropped, so the editor never remounts because the user typed.

**Shortcuts live in one table**: `src/lib/keymap.ts` declares every app-level
shortcut; `Shell` dispatches from it and all hints render from it via
`shortcutFor(id)`, platform-aware (⌘ on macOS, Ctrl elsewhere). Never hard-code
a key label in a component.

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

# Rust tests (all crates)
cargo test --workspace
```

## Adding a feature

Logic goes in `crates/cortex-core` (pure functions over a vault root), so the
app, CLI and MCP server all get it:

1. Implement it in the right core module (`note`, `data`, `git`, …) with a test
2. App: a `#[tauri::command]` wrapper in `src-tauri/src/commands/*.rs`, registered in
   `src-tauri/src/lib.rs`, plus a typed wrapper in `src/lib/commands.ts`
3. CLI / MCP: an op in `crates/cortex-cli/src/ops.rs`, then a `Cmd` arm in `main.rs`
   and a `#[tool]` in `mcp.rs`
