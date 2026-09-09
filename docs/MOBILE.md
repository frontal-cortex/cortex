# Mobile mode (iOS and Android)

Plan for shipping Cortex on Tauri 2.0's mobile targets. Written for iOS
first; the Android addendum at the end records what differs and what the
2026-09-09 feasibility spike (`docs/parity/mobile-spike.md`) found. The
Rust phases below are shared by both platforms.

## Guiding principle

Desktop behavior stays **byte-for-byte unchanged**. It keeps shelling out to
system `git` for remote operations, which preserves SSH agents and credential
helpers — the reason `git.rs` shells out in the first place (see the comment at
`git.rs:308-309`). Mobile gets a **parallel, in-process path** selected at compile
time with `#[cfg(mobile)]`.

On mobile there is no system `git` binary and no ability to spawn subprocesses,
and there is no arbitrary-folder picker. So:

- The vault lives in the app's **sandbox container** (`app_data_dir/vaults/<slug>`).
- It is **cloned over HTTPS with a token**, and all git remote/merge operations
  run **in-process via libgit2** (`git2`).

### Why "download the repo into the container" isn't the whole story

Putting the working tree in the app container cleanly solves *storage* (no
document picker, no security-scoped bookmarks). But it does **not** avoid the
in-process git work: clone, fetch, pull, push, and the merge/conflict flow are
all remote/transport operations that today go through system `git`. "Download
the repo" just adds `clone` to the list of operations the in-process path must
cover. The transport refactor (Phase 1) is the actual mobile project.

## Current shell-out surface (what must gain an in-process path)

| Operation | Location | Today |
|---|---|---|
| pull (fetch + merge) | `git.rs:377` | `git pull --no-rebase --no-edit` |
| push | `git.rs:394`, `git.rs:437` | `git push -u origin <branch>` |
| merge abort | `git.rs:387`, `git.rs:447` | `git merge --abort` |
| conflict resolve (ours/theirs) | `git.rs:408`, `git.rs:416` | `git checkout --ours/--theirs` + `add` |
| complete merge | `git.rs:431` | `git commit --no-edit` |
| branch/state | `git.rs:336`–`351` | `symbolic-ref`, `rev-parse`, `diff --diff-filter=U` |
| discard a pushed agent branch | `git.rs:497` | `git push origin --delete` |
| user identity | `members.rs:64` | `git config user.name/email` |
| gh-pages publish | `publish.rs:589`–`625` | `init`, `add`, `commit`, `push --force` (desktop only) |
| reveal in OS | `commands/notes.rs:376`–`381` | `open -R` / `explorer` / `xdg-open` (desktop only) |
| embedded terminal | `src-tauri/src/terminal.rs` | PTY + `$SHELL` (desktop only) |

Internal git2 operations (status, commit, log, diff, agent-branch merge) already
work cross-platform and are untouched.

## Auth scope (v1)

**HTTPS + personal access token only.** Token stored in the iOS Keychain (never
in the committed `.cortex/settings.yaml`). SSH (libssh2 + on-device key
management) is explicitly out of scope for v1 — same call already made for
Android in `ARCHITECTURE.md`.

---

## Phase 0 — Build spike (de-risk first)

The top unknown is whether the native dependencies cross-compile to iOS. Prove
it before building features.

- `npm run tauri ios init` → generates the Xcode project under `src-tauri/gen/apple`.
- `rustup target add aarch64-apple-ios aarch64-apple-ios-sim`.
- `npm run tauri ios dev`; confirm the app boots in the simulator with the
  current deps linked: `git2` (vendored-openssl), `rusqlite` (bundled),
  `serde_yaml`.
- **OpenSSL-for-iOS is the likely friction point.** If `vendored-openssl` won't
  cross-compile, fall back to libgit2 with rustls TLS, or build without SSH.
- **Enable git2's `https` feature first.** Both manifests declare
  `default-features = false, features = ["vendored-openssl"]`, which builds
  OpenSSL but leaves libgit2 without an HTTPS transport (`libgit2-sys` only
  defines `GIT_OPENSSL` under its `https` feature). Every in-process remote
  operation on either platform depends on this one-line fix.

**Exit criterion:** a blank-ish app runs on the iOS simulator with git2/rusqlite
linked.

## Phase 1 — Remote-ops abstraction (load-bearing refactor)

Introduce a trait that owns every remote + merge operation:

```rust
trait RemoteOps {
    fn clone_to(&self, url: &str, dest: &Path) -> Result<()>;
    fn sync(&self, repo: &Path, branch: &str) -> Result<SyncOutcome>; // fetch + merge + push
    fn resolve_conflict(&self, repo: &Path, file: &str, side: &str) -> Result<()>;
    fn complete_merge(&self, repo: &Path) -> Result<SyncOutcome>;
    fn abort_merge(&self, repo: &Path) -> Result<()>;
}
```

- **`ShellRemote`** (`#[cfg(desktop)]`): the existing `git.rs` code lifted
  verbatim. Zero behavior change.
- **`Git2Remote`** (`#[cfg(mobile)]`): libgit2 implementations:
  - *clone / fetch / push* via `RemoteCallbacks` + `Cred` (HTTPS + token).
  - *merge* — `repo.merge()` of the fetched annotated commit; it writes the same
    `<<<<<<<` markers into the working tree, so the existing conflict UX is
    preserved. Capture the pre-merge OID for abort.
  - *list conflicts* — iterate `repo.index().conflicts()` / `Status::CONFLICTED`
    (replaces `diff --diff-filter=U`).
  - *resolve ours/theirs* — write the chosen side's blob from the conflict index
    entry to the working tree and stage it.
  - *abort* — `reset --hard` to the saved pre-merge OID + `repo.cleanup_state()`.
  - *complete* — `write_tree` → two-parent commit (HEAD + MERGE_HEAD) →
    `cleanup_state` → push.
- `members.rs` identity: on mobile read `repo.config()` instead of the
  `git config` subprocess (small `#[cfg]` branch).

The git2-native sync/merge logic is portable, so it is **unit-tested on desktop**
against a local bare repo, independent of running on iOS. That is where merge
correctness gets proven.

## Phase 2 — Credentials & remote config

**Hard constraint:** `.cortex/settings.yaml` is committed to the repo
(`config.rs:1`). Tokens must never live there.

- **PAT → iOS Keychain** (via `security-framework` or a small Tauri keychain
  plugin). Per-vault remote URL → app config dir (`app_data_dir`), not the
  committed settings.
- New commands: `set_remote_credentials(vault_id, url, token)`, consumed by the
  mobile clone/sync path; the token is passed into `Cred::userpass_plaintext`.

## Phase 3 — Vault lifecycle on mobile

No folder picker exists in the iOS sandbox, so the open/create flows change:

- **Add vault** = form (HTTPS URL + token) → `Git2Remote::clone_to`
  (`app_data_dir/vaults/<slug>`) → `open_vault(that path)`. `open_vault`,
  `VaultState`, and `recent.rs` already key off an absolute path, so they work
  unchanged once it is a container path.
- **`create_vault_from_template`** scaffolds from the bundled template
  (`cortex_core::template`) and inits with `git2` — no shell-out, so it works
  on mobile as-is. "Add an existing vault" is the clone case above.
- `reveal_path` (`notes.rs:455`) — `#[cfg]` it off on mobile.

## Phase 4 — Responsive UI mode

Rust-independent; can proceed in parallel once Phase 0 lands.

- Collapse `LeftPanel` + `PropertiesPanel` into drawers / bottom-sheets at narrow
  widths; main content full-bleed.
- Touch target sizing; verify BlockNote's mobile behavior (selection, slash menu,
  drag handles).
- Pull-to-refresh as the primary sync gesture.

## Phase 5 — Sync triggers & polish

- Desktop's focus/interval sync loop → mobile app-foreground event + manual
  pull-to-refresh. iOS has no reliable background sync; lean on foreground +
  explicit, consistent with the local-first model.
- The co-edit relay (`src/lib/collab.ts`) is pure network and works as-is.

---

## Risk register

| Risk | Phase | Mitigation |
|---|---|---|
| OpenSSL won't cross-compile to iOS | 0 | Spike first; fall back to rustls TLS / drop SSH |
| git2 merge UX drifts from CLI behavior | 1 | Desktop-run unit tests against a bare repo before shipping |
| Token leaking into committed `.cortex` | 2 | Keychain + `app_data_dir` only; never in the `Settings` struct |
| App Store background-sync limits | 5 | Foreground + manual sync (already the local-first model) |

**Critical path:** Phase 0 → 1 → 2 → 3 (Rust). Phase 4 (UI) parallelizes after
Phase 0.

---

## Android addendum

Everything above applies; these are the Android-specific answers from
`docs/parity/mobile-spike.md`, which also carries the file:line evidence
and the backlog rows (36–39).

### Storage: app-private directory, not scoped storage

The vault lives at `app.path().app_data_dir()/vaults/<slug>` (Android
`filesDir`). That is a real POSIX path, so `git2`, `rusqlite`, `walkdir`
and `notify` (inotify is enabled for `target_os = "android"`) work
untouched, there is no permission prompt, and the files are private to the
app and encrypted at rest. The Storage Access Framework is not an option:
it hands out `content://` URIs, every core crate wants a path, and
`tauri-plugin-dialog` has no directory picker on mobile
(`open({ directory: true })` returns `FolderPickerNotImplemented`). The
trade-off is that no other app can see the vault; git is the way out,
which is the product's story anyway.

### Credentials

Same rule as iOS: the token never enters the committed `.cortex/`. There
is no first-party Tauri keychain plugin. v1 keeps a per-vault
`{ url, username, token }` JSON under `app_data_dir` (already app-private
and encrypted at rest); a Kotlin `EncryptedSharedPreferences` plugin or
`tauri-plugin-stronghold` can take over later without changing the Rust
interface.

### TLS trust for the vendored OpenSSL

`git2` calls `openssl_probe` on Linux-like targets, which finds no
`/etc/ssl` on Android, so HTTPS would fail certificate verification. At
startup on Android call `git2::opts::set_ssl_cert_dir` with the system
store — `/apex/com.android.conscrypt/cacerts` on Android 14+, else
`/system/etc/security/cacerts` (both are OpenSSL hashed-directory format).
Marketplace fetches are unaffected: `ureq` uses rustls with bundled
`webpki-roots`.

### Two more Android-only gotchas

- `std::env::temp_dir()` is `/data/local/tmp`, which an app cannot write.
  Set `TMPDIR` to `app_cache_dir()` in `setup` so the Notion zip importer
  (`import/notion.rs:479`) and the gh-pages scratch (`publish.rs:592`) work.
- `portable-pty` must become a desktop-only dependency and `terminal.rs`,
  `reveal_path`, `detect_agents` and the Omarchy theme watcher go behind
  `#[cfg(desktop)]`; the frontend hides the terminal pane and the
  terminal-agent setting on mobile.

### Sync triggers

`tauri::WindowEvent::Resumed` (fired from the Activity's `onResume`) is the
mobile replacement for the desktop focus loop; pull-to-refresh is the
explicit gesture. No background sync.

### Toolchain

JDK 17, Android SDK (platform 34, build-tools, platform-tools), NDK r26+,
`rustup target add aarch64-linux-android armv7-linux-androideabi
i686-linux-android x86_64-linux-android`, `ANDROID_HOME` and `NDK_HOME`
exported; then `npx tauri android init` (commit `src-tauri/gen/android`),
`npx tauri icon`, `npx tauri android build --debug --target aarch64`. The
dev machine that produced the spike had none of this installed, so the
first APK is its own backlog row (38).
