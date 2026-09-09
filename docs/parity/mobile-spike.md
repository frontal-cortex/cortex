# Mobile spike — Cortex on Tauri 2 mobile, Android first

Findings from a read-only feasibility pass on 2026-09-09 (`179330c`, after
the fourteen parity PRs). No Android toolchain exists on the machine this
ran on — `rustup target list --installed` shows only
`x86_64-unknown-linux-gnu`, `$ANDROID_HOME` / `$NDK_HOME` / `$JAVA_HOME` are
unset and there is no `java`, `adb` or `sdkmanager` on `PATH` — so **no
build was attempted**. Everything below comes from the crate manifests,
`cargo tree`, the registry sources of each dependency, and the app code.
`docs/MOBILE.md` holds the plan (iOS first, now with an Android section);
this document is the evidence behind it and the sequencing.

## Verdict: GO, with one prerequisite fix and one refactor

Nothing in `cortex-core` is hostile to Android. Every native dependency
either has an explicit Android branch in its build script or is pure Rust.
The blockers are all in the places the existing docs already suspected —
subprocesses and the folder picker — plus two things nobody would find
without looking at the feature graph:

1. **libgit2 is compiled without HTTPS.** `git2` is declared with
   `default-features = false, features = ["vendored-openssl"]`
   (`crates/cortex-core/Cargo.toml:19`, `src-tauri/Cargo.toml:25`). In
   git2 0.19 `vendored-openssl` only enables `openssl-sys/vendored` +
   `libgit2-sys/vendored-openssl`; it does **not** enable `https`, and
   `libgit2-sys`'s `build.rs:25` only defines `GIT_OPENSSL` when
   `CARGO_FEATURE_HTTPS` is set. `cargo tree -e features -i libgit2-sys`
   confirms: `default`, `openssl-sys`, `vendored-openssl` — no `https`. So
   OpenSSL is being built and linked but libgit2 cannot speak `https://` in
   process. Desktop never noticed because remote operations shell out to
   system `git`. Fix: `features = ["https", "vendored-openssl"]` in both
   manifests. One line each; verifiable on desktop with an in-process fetch
   test.
2. **`std::env::temp_dir()` is `/data/local/tmp` on Android**, which an app
   cannot write. Two production paths use it: the gh-pages publish scratch
   (`publish.rs:592`) and the Notion zip importer (`import/notion.rs:479`);
   the other `temp_dir()` hits (`marketplace.rs:1214,1478`, `index.rs:69`)
   are inside `#[cfg(test)]`. Set `TMPDIR` to `app.path().app_cache_dir()`
   in `setup` on mobile and both work unchanged.

The load-bearing refactor is still the in-process git transport
(`RemoteOps`, backlog priority 34). The vault-storage question has a clean
answer (app-private directory, below) and needs no scoped-storage work.

## Toolchain on this machine

| Check | Result |
|---|---|
| `rustup target list --installed` | `x86_64-unknown-linux-gnu` only; none of `aarch64-linux-android`, `armv7-linux-androideabi`, `i686-linux-android`, `x86_64-linux-android` |
| `$ANDROID_HOME`, `$NDK_HOME`, `$JAVA_HOME` | unset; `~/Android/Sdk`, `/opt/android-sdk`, `/opt/android-ndk` absent |
| `java`, `adb`, `sdkmanager`, `xcodebuild` | none on `PATH` |
| Tauri CLI | 2.11.2; `npx tauri android {init,dev,build,run}` available |
| `cargo tree` (offline) | resolves; `tauri 2.11.2`, `tauri-plugin-dialog 2.7.1`, `tauri-plugin-fs 2.5.1`, `tauri-plugin-shell 2.3.5`, `git2 0.19.0` / `libgit2-sys 0.17.0+1.8.1`, `openssl-src 300.6.0+3.6.2`, `rusqlite 0.32.1` / `libsqlite3-sys 0.30.1`, `notify 8.2.0`, `portable-pty 0.9.0`, `ureq 3.4.1` |

What a build machine needs, per the Tauri 2 prerequisites: JDK 17, Android
SDK (platform 34, build-tools, platform-tools), NDK r26+, the four rustup
targets above, and `ANDROID_HOME` / `NDK_HOME` exported. Nothing was
installed here, by instruction.

## Crate compatibility on `aarch64-linux-android`

| Crate | Verdict | Evidence |
|---|---|---|
| `git2` 0.19 / `libgit2-sys` 0.17 (libgit2 1.8.1) | compiles; **no HTTPS** (see verdict §1); no SSH (`libssh2-sys` absent from the lock file — intended) | `libgit2-sys/build.rs:155` has an explicit `android` branch (drops `GIT_USE_NSEC`); `build.rs:25,187-211` gate OpenSSL on the `https` feature |
| `openssl-src` 300.6 (vendored OpenSSL 3.6) | compiles with the NDK clang | `openssl-src/src/lib.rs:282-393` maps every `*-linux-android*` target to an OpenSSL config (`aarch64-linux-android` → `linux-aarch64`) and reads the NDK from `ANDROID_NDK_HOME` |
| OpenSSL trust store | **needs a one-liner**: Android has no `/etc/ssl` | `git2/src/lib.rs:876` calls `openssl_probe::init_ssl_cert_env_vars()` on `unix && !macos`, which finds nothing on Android. Point libgit2 at the system store with `git2::opts::set_ssl_cert_dir("/system/etc/security/cacerts")` (`git2/src/opts.rs:219`; on Android 14+ the live copy is `/apex/com.android.conscrypt/cacerts`, try it first), or ship a PEM bundle in `app_data_dir` and use `set_ssl_cert_file` (`opts.rs:200`) |
| `rusqlite` 0.32 `bundled` | compiles; Android-aware | `libsqlite3-sys/build.rs:17` `android_target()`, `:222-224` sets `SQLITE_TEMP_STORE=3` so SQLite never needs a temp directory |
| `serde_yaml`, `serde_json`, `regex`, `chrono`, `pulldown-cmark`, `sha2`, `hex`, `semver`, `walkdir`, `toml`, `base64` | pure Rust | — |
| `zip` 8 (`deflate-flate2`) + `flate2` (`rust_backend`) | pure Rust (miniz_oxide) | `crates/cortex-core/Cargo.toml:32-33` |
| `ureq` 3 (`rustls`, `gzip`) | compiles; marketplace fetch works without a system store | `cargo tree -e features`: `rustls` → `_ring` + `rustls-webpki-roots`; `ring 0.17` and `webpki-roots 1.0` are in the lock file. `ring` builds for Android with the NDK |
| `notify` 8 | works inside the app-private directory (inotify) | `notify/Cargo.toml:85-89` and `src/lib.rs:172-206` enable the inotify backend for `target_os = "android"` |
| `portable-pty` 0.9 (+ `nix` 0.28) | **gate out with `#[cfg(desktop)]`** | `src-tauri/Cargo.toml:41`; `src-tauri/src/terminal.rs:17` (`libc::openpty` via `portable-pty/src/unix.rs:36`). Even if it links, there is no shell to spawn and no agent CLI on the device |
| `tauri` 2.11 | mobile runtime present | `tauri/src/app.rs:159-169` exposes `WindowEvent::Suspended` / `Resumed` on mobile — the replacement for the desktop focus-sync loop |
| `cortex-cli` (`rmcp`, `tokio`, `clap`) | not part of the app bundle | `Cargo.toml` workspace member; the Android app links `second_brain_lib` only |

## Tauri config and the app shell

| Item | State | Evidence |
|---|---|---|
| `mobile_entry_point` | present | `src-tauri/src/lib.rs:24` |
| `crate-type` includes `staticlib` + `cdylib` | present (required by the Android Gradle project) | `src-tauri/Cargo.toml:10` |
| `identifier` | `com.cortex.app` — valid Android package name | `src-tauri/tauri.conf.json:4` |
| `bundle.android` | absent; optional. Defaults: `minSdkVersion` 24. Add `versionCode` when shipping | `tauri-utils/src/config.rs:3211-3234` (`AndroidConfig`) |
| `src-tauri/gen/android` | absent; created by `npx tauri android init` (commit it) | — |
| Icons | `bundle.icon` lists PNG/ICNS/ICO only; `npx tauri icon` also writes the Android mipmaps into `gen/android` | `tauri.conf.json:31-37` |
| Window creation | built in `setup`, not in config; on mobile `min_width` 800 / `min_height` 600 / `title_bar_style` / `set_decorations` are ignored (the `#[cfg(target_os = "linux")]` branch is false on Android, whose `target_os` is `android`). The `on_navigation` guard already allows `tauri.localhost`, which is the Android webview origin | `src-tauri/src/lib.rs:41-64` |
| CSP | `connect-src 'self' ipc: http://ipc.localhost` matches Tauri's Android IPC; the co-edit relay needs `ws:`/`wss:` on every platform (pre-existing, not a mobile issue) | `tauri.conf.json:13` |
| Capabilities | `windows: ["main"]` matches the label built in `setup`. `fs:default` is declared but the frontend never imports `@tauri-apps/plugin-fs` (no hit for `plugin-fs` under `src/`) — unused; harmless | `src-tauri/capabilities/default.json` |

## Plugin and API surface used by the frontend

| Call | Where | On Android |
|---|---|---|
| `dialog.open({ directory: true })` | `src/hooks/useVault.ts:57` (open vault), `src/components/Shell/PublishModal.tsx:46` (publish into…), `src/components/Shell/ImportModal.tsx:123,155` (import folder / unpacked Notion export) | **fails**: `tauri-plugin-dialog/src/commands.rs:185-186` returns `Error::FolderPickerNotImplemented` under `#[cfg(mobile)]`; the Kotlin side only issues `ACTION_GET_CONTENT` (`DialogPlugin.kt:62-64`, with a `TODO: ACTION_OPEN_DOCUMENT`) |
| `dialog.save()` | `src/hooks/useVault.ts:64` (create vault), `src/lib/export.ts:11` (export HTML) | exists on mobile (`mobile.rs:91`) but returns a `content://` URI, not a path; `createVaultFromTemplate(selected)` and the export write would fail. Both need a mobile path |
| `dialog.open()` for files (CSV / Notion zip) | `ImportModal.tsx` | works (file picker is implemented) but returns a `content://` URI; the Rust side reads by path today |
| `shell.open(url)` | `src/lib/links.ts:12` | works (`tauri-plugin-shell/src/lib.rs:84-90`; deprecated in favour of `tauri-plugin-opener`, swap at leisure) |
| `event.listen` | `Shell.tsx`, `SettingsView.tsx`, `theme.ts`, `TerminalPane.tsx` | works |
| `invoke` (everything else) | `src/lib/commands.ts` | works; the Rust command decides |

## Filesystem and vault access model on Android

Four options, one of which fits the "vault is a directory that is a git
repository" invariant:

| Model | Fits? | Why |
|---|---|---|
| **App-private directory** (`app.path().app_data_dir()/vaults/<slug>`, i.e. `filesDir`) | **yes — v1** | Real POSIX paths, so `git2`, `rusqlite`, `walkdir` and `notify` work untouched. No permission prompt. Private per app UID, encrypted at rest by file-based encryption. Backup story is git, which is the product's story anyway. Downside: other apps (a file manager, Obsidian, Termux) cannot see the files; Android 11+ hides `Android/data` too |
| Storage Access Framework (`ACTION_OPEN_DOCUMENT_TREE`) | no | Yields `content://` URIs, not paths. Every core crate wants a path; a copy-in/copy-out shim would break the watcher, double the storage and make `.brain/` racy. Also the dialog plugin has no tree picker (above) |
| `MANAGE_EXTERNAL_STORAGE` | no | Play policy rejects it for a notes app |
| Shared media collections | no | For images/video, not `.md` trees |

Consequences of the app-private model, each a small `#[cfg(desktop)]`:

- `reveal_path` (`src-tauri/src/commands/notes.rs:368-383`) has nothing to reveal into; hide the menu item on mobile.
- "Open vault…" and "Create vault…" (`useVault.ts:56-77`, `VaultPicker.tsx`) become "Clone a vault (URL + token)" and "New vault" with a name, both landing in the container. `open_vault`, `VaultState` and `recent.rs` (`app_config_dir`, `recent.rs:24-30`) key off an absolute path and work unchanged.
- `publish_to_dir` / "Publish into…" are desktop features; `publish_gh_pages` (`publish.rs:588-625`) shells out and should route through `RemoteOps` or stay desktop-only.
- Imports keep working for files (CSV, Notion zip) once the command accepts bytes or a `content://` read via the fs plugin; folder import is desktop-only.
- `.brain/index.db` lives inside the vault directory as today; the `.brain/` cache and `packs.rs:18` (`app_cache_dir`) both resolve to app-private storage.
- `theme.rs:64-79` reads `$HOME` for the Omarchy palette; `$HOME` is unset on Android so `detect_desktop_theme` returns `None` and the light/dark setting wins. No change needed.
- `agents.rs:59-64` scans `$PATH`; empty on Android, so `detect_agents` returns nothing and the terminal-agent setting is moot. Hide the Terminal section of Settings on mobile.

## The git-backed vault on Android

Everything that reaches a remote goes through system `git` today. The
complete list, with the line where each subprocess is spawned:

| Operation | File:line | Today |
|---|---|---|
| any `git` call | `crates/cortex-core/src/git.rs:321-334` (`run_git`, `git_stdout`) | `std::process::Command::new("git")` |
| current branch / head oid | `git.rs:336-346` | `symbolic-ref`, `rev-parse` |
| list conflicts | `git.rs:348-351` | `diff --name-only --diff-filter=U` |
| sync: pull, abort on error, push | `git.rs:377`, `:387`, `:394` | `pull --no-rebase --no-edit`, `merge --abort`, `push -u origin` |
| resolve ours / theirs | `git.rs:408`, `:416` | `checkout --ours/--theirs`, `add` |
| complete merge + push | `git.rs:431`, `:437` | `commit --no-edit`, `push -u` |
| abort merge | `git.rs:447` | `merge --abort` |
| discard a pushed agent branch | `git.rs:497` | `push origin --delete` |
| user identity | `crates/cortex-core/src/members.rs:64` | `git config user.name/email` |
| gh-pages publish | `crates/cortex-core/src/publish.rs:589-625` | `init`, `add`, `commit`, `remote add`, `push --force` |
| marketplace `generate_index` | `crates/cortex-core/src/marketplace.rs:1001` | `rev-parse HEAD`, `.ok()`-tolerant; CI-only path, harmless on device |
| reveal in file manager | `src-tauri/src/commands/notes.rs:376-381` | `open -R` / `explorer` / `xdg-open` |
| embedded terminal | `src-tauri/src/terminal.rs` | PTY + `$SHELL` |

What replaces them, in `git2` (all of which the existing priority-34 row
already specifies; the additions from this spike are in bold):

- **Enable the `https` feature** (verdict §1) — without it none of the
  below can reach `https://github.com`.
- **CA trust**: `git2::opts::set_ssl_cert_dir` to the Android system store
  at startup (table above). On desktop `openssl-probe` keeps doing its job.
- Auth: `RemoteCallbacks::credentials` returning
  `Cred::userpass_plaintext(user, token)`. GitHub, GitLab, Gitea and Codeberg
  all accept a PAT as the password over HTTPS. SSH stays out of scope.
- Clone: `RepoBuilder::new().fetch_options(...).clone(url, dest)`. **New
  operation** — the desktop path never clones.
- Fetch + merge: `remote.fetch(&[branch])`, `repo.merge(&[annotated])`, which
  writes the same `<<<<<<<` markers; conflicts from `repo.index().conflicts()`.
- Ours / theirs: write the `our` / `their` blob from the conflict entry and
  `index.add_path`. Abort: `reset --hard` to the pre-merge OID +
  `cleanup_state()`. Complete: `write_tree` → two-parent commit → push.
- Identity: `repo.config()` read/write instead of the `git config`
  subprocess. Note `git::signature` (`git.rs:257-275`) falls back to
  `$USER@$HOSTNAME`, which on Android are unset, so a fresh install commits
  as `cortex <cortex@…>` until the user sets a name; the mobile Settings
  page must write `user.name` / `user.email` into the repo config.
- Token storage: `.cortex/settings.yaml` is committed and must never carry
  it. There is no first-party Tauri keychain plugin. v1: a JSON file in
  `app_data_dir` (already app-private and encrypted at rest on Android);
  later: `tauri-plugin-stronghold` or a small Kotlin `EncryptedSharedPreferences`
  plugin. The iOS plan's Keychain is the same slot.
- Sync triggers: `WindowEvent::Resumed` (`tauri/src/app.rs:168`) plus
  pull-to-refresh; no background sync.

All of the `git2` sync logic is testable on desktop against a local bare
repo, exactly like the current `sync_round_trip_and_conflict_resolution`
test (`git.rs:686`) — that is where correctness gets proven long before an
APK exists.

## Blocker list

Severity: **hard** stops the app from building or opening a vault;
**soft** degrades a feature that must be hidden or replaced.

| # | Blocker | Severity | Evidence | Fix lands in |
|---|---|---|---|---|
| 1 | libgit2 built without HTTPS | hard (for any in-process remote op) | `crates/cortex-core/Cargo.toml:19`, `src-tauri/Cargo.toml:25`; `libgit2-sys/build.rs:25` | row 36 |
| 2 | Remote git operations shell out | hard | `git.rs:321-449,497`, `members.rs:64`, `publish.rs:589-625` | row 34 (existing) |
| 3 | Vault open / create use a folder picker and a save dialog path | hard | `useVault.ts:57,64`; `tauri-plugin-dialog/src/commands.rs:185` | row 37 |
| 4 | `temp_dir()` unwritable on Android | hard for Notion zip import (and gh-pages publish, itself desktop-only) | `publish.rs:592`, `import/notion.rs:479` | row 36 |
| 5 | No CA store for OpenSSL | hard for HTTPS git | `git2/src/lib.rs:876` | row 34 |
| 6 | `portable-pty` / terminal / agent detection / `reveal_path` | soft; must compile out | `src-tauri/Cargo.toml:41`, `lib.rs:3,35,171-174`, `notes.rs:376-381`, `agents.rs:59` | row 36 |
| 7 | Layout assumes ≥ 800 px: fixed 260 px sidebar, 440 px picker, three `@media` rules in the whole app | soft | `lib.rs:46`, `src/styles/tokens.css:60`, `VaultPicker.module.css:41`; `obsidian-parity.md` §14 | "responsive shell groundwork" (existing row) + row 35 (existing) |
| 8 | Token storage location | design decision | `.cortex/settings.yaml` is committed (`settings.rs`) | row 37 |
| 9 | No Android toolchain on the dev machine; no CI at all (`.github/` absent) | process | this document, `notion-parity.md` §15 | row 38 |
| 10 | Folder-based import and "publish into a folder" | soft; desktop-only | `ImportModal.tsx:123,155`, `PublishModal.tsx:46` | row 37 (hide) |

Not blockers, verified: `rusqlite` bundled, `notify` inotify, `serde_yaml`,
`ureq` + `webpki-roots`, `zip`/`flate2` pure Rust, `shell.open`,
`event.listen`, `recent.rs` / `packs.rs` app-dir lookups, the window guard,
the CSP, `mobile_entry_point`, `crate-type`.

## Proposed sequence

Existing rows keep their priorities: 34 *Mobile — in-process git transport
(RemoteOps)*, 35 *Mobile — touch input and phone-width database views*,
and the vault's *Mobile mode — responsive shell groundwork*. The four rows
below slot around them. Order: **36 → 34 → 37 → responsive shell → 38 →
35 → 39**. Rows 36 and 34 need no Android toolchain; 38 is the first one
that does.

```markdown
---
created: 2026-09-09
effort: S
priority: 36
status: planned
tags: [parity, mobile]
title: Mobile — desktop-only gates, libgit2 HTTPS, and a writable TMPDIR
type: note
---

Prerequisites for any mobile build, all verifiable on desktop
(`docs/parity/mobile-spike.md` blockers 1, 4, 6). Enable the `https`
feature of `git2` in `crates/cortex-core/Cargo.toml` and
`src-tauri/Cargo.toml` (`vendored-openssl` alone leaves libgit2 without an
HTTPS transport; `cargo tree -e features -i libgit2-sys` must list
`https`) and add a core test that fetches from a local `file://` remote
in-process to prove the transport is wired. Make `portable-pty` a
`[target.'cfg(not(any(target_os = "android", target_os = "ios")))']`
dependency and put `terminal.rs`, its four commands, `reveal_path`, the
`detect_agents` command and the Omarchy `theme.rs` watcher behind
`#[cfg(desktop)]`; the frontend hides the terminal pane, the
terminal-agent setting and "Reveal in file manager" when
`platform()` from `@tauri-apps/plugin-os` (add it) reports android or
ios. In `setup`, on mobile, set `TMPDIR` to `app_cache_dir()` so the
Notion importer (`import/notion.rs:479`) and `publish::push_gh_pages`
(`publish.rs:592`) can create scratch directories. Desktop behaviour stays byte-for-byte the
same: `cargo test --workspace`, `tsc`, `vite build` all green, no UI
change on desktop.
```

```markdown
---
created: 2026-09-09
effort: M
priority: 37
status: planned
tags: [parity, mobile]
title: Mobile — clone-a-vault flow, container storage, and a credential file
type: note
---

Phase 2 + 3 of `docs/MOBILE.md`, Android storage model from
`docs/parity/mobile-spike.md`: the vault lives in
`app_data_dir()/vaults/<slug>` and is cloned over HTTPS with a token.
Depends on the `RemoteOps` row (`Git2Remote::clone_to`). In `cortex-core`,
add `credentials.rs`: a `{ url, username, token }` record per vault stored
as JSON under the app data dir the caller passes in — never under the
vault, never in `.cortex/settings.yaml` — and a `slug_for_url()` helper
with tests. Tauri commands `clone_vault(url, username, token)` (clone into
the container, save the credential, `open_vault`) and
`set_remote_credentials(vault, url, username, token)`; `git_sync` passes
the credential into `Git2Remote` on mobile. Frontend: on mobile the
`VaultPicker` shows "Clone a vault" (URL + username + token) and "New
vault" (a name; scaffolds into the container with
`create_vault_from_template`) instead of the folder / save dialogs; the
Settings page gets a Remote section that writes `user.name` /
`user.email` into the repo config via `git2` and edits the token. Desktop
keeps the folder picker and system git untouched. Hide "Publish into…",
"Import a folder…" and "Reveal" on mobile. Tests: credential round-trip,
slug rules, and a clone-then-sync against a local bare repo on desktop.
```

```markdown
---
created: 2026-09-09
effort: M
priority: 38
status: planned
tags: [parity, mobile]
title: Mobile — Android project init and first debug APK
type: note
---

The first row that needs the toolchain (JDK 17, Android SDK 34, NDK r26+,
`rustup target add aarch64-linux-android armv7-linux-androideabi
i686-linux-android x86_64-linux-android`); skip if it is not installed and
say so. Run `npx tauri android init`, commit `src-tauri/gen/android`
(without local `.gradle` / build output; extend `.gitignore`), run
`npx tauri icon` to generate the mipmaps, add `bundle.android` with
`minSdkVersion: 24` and a `versionCode` to `tauri.conf.json`. Build with
`npx tauri android build --debug --target aarch64` and record in
`docs/parity/mobile-spike.md` which of the predicted issues appeared:
OpenSSL cross-compile, `ring`, the CA store (`set_ssl_cert_dir` to
`/apex/com.android.conscrypt/cacerts` then `/system/etc/security/cacerts`),
inotify in the container. Exit criterion: the app boots on an emulator,
clones a public HTTPS repo into the container and opens it. No layout
work; the desktop layout is expected to look wrong at phone width.
```

```markdown
---
created: 2026-09-09
effort: M
priority: 39
status: planned
tags: [parity, mobile]
title: Mobile — foreground sync, pull-to-refresh, and an Android CI build
type: note
---

Phase 5 of `docs/MOBILE.md`. Replace the desktop focus/interval sync loop
on mobile with `WindowEvent::Resumed` → `git_sync`, and add a
pull-to-refresh gesture on the note list and the open note that calls the
same command; the conflict modal must open from a mobile sync exactly as
it does from a desktop one (it is the same `SyncOutcome`). Add
`.github/workflows/android.yml`: JDK 17 + SDK + NDK via the official
actions, cache cargo, `npx tauri android build --apk --target aarch64`,
upload the APK as a workflow artifact; run `cargo check -p cortex-core
--target aarch64-linux-android` as a separate fast job so a core crate
that stops cross-compiling fails a PR before the full build does. Sign
with a debug key; release signing and Play listing are out of scope.
```

## What was not done

- No `cargo check --target aarch64-linux-android`: the target is not
  installed and installing SDKs was out of scope. Every "compiles" verdict
  above is from the dependency's own build script or a pure-Rust check,
  not from a link.
- No config change was made: with nothing to build against, a
  `bundle.android` block or a `gen/android` tree would be unverifiable
  noise. Row 38 owns them.
- iOS was not re-audited; the Android findings that also apply there
  (`https` feature, `temp_dir`, token storage, folder picker) are called
  out in `docs/MOBILE.md`.
