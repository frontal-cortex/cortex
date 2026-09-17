# Mobile spike — Cortex on Tauri 2 mobile, Android first

Second, read-only feasibility pass, 2026-09-17 at `3a48e76` (after serve
mode, PR #81). The first pass ran on 2026-09-09 at `179330c`; its findings
are folded in below and marked **landed** where the work has since been
merged. As before, no Android toolchain exists on this machine —
`rustup target list --installed` is `x86_64-unknown-linux-gnu` only,
`$ANDROID_HOME` / `$NDK_HOME` / `$JAVA_HOME` are unset, no `java`, `adb`,
`sdkmanager`, `gradle` or `cargo-ndk` on `PATH` — so **no build was
attempted**. Evidence is the crate manifests, `cargo tree` (including a
resolution for `--target aarch64-linux-android`), the registry sources of
each dependency, and the app code. `docs/MOBILE.md` holds the plan;
`docs/SERVE.md` describes the path a phone can use today.

## Verdict: GO — the hard part landed; what is left is a mobile host

Between the two passes the load-bearing work happened, mostly as a
by-product of other rows:

| 2026-09-09 blocker | State at `3a48e76` |
|---|---|
| 1. libgit2 built without HTTPS | **landed** — `features = ["https", "vendored-openssl"]` in `crates/cortex-core/Cargo.toml:20` and `crates/cortex-app/Cargo.toml`; `cargo tree -e features -i libgit2-sys` now lists `git2 feature "https"` |
| 2. remote git operations shell out | **landed** — `RemoteOps` in `crates/cortex-core/src/remote.rs` with `ShellRemote` (desktop) and `Git2Remote`; `default_remote()` (`remote.rs:59-73`) returns `Git2Remote` when `target_os` is android or ios; seven desktop tests against a local bare repo (`remote.rs:727-886`) |
| 3. vault open / create use a folder picker and a save dialog | open — but the frontend now has the capability model it needs (below) |
| 4. `temp_dir()` unwritable on Android | open — `import/notion.rs:479`, `publish.rs:1077`, and now `template.rs:150`; `src-tauri/src/lib.rs` sets no `TMPDIR` |
| 5. no CA store for OpenSSL | open — no `set_ssl_cert_dir` / `set_ssl_cert_file` anywhere in the tree |
| 6. `portable-pty` / terminal / agents / reveal | **landed** — `portable-pty` is a `cfg(not(android|ios))` dependency (`crates/cortex-app/Cargo.toml:35-37`); `terminal` module, `AppCtx.terminal` and the four `terminal_*` dispatch arms are gated the same way (`lib.rs:23`, `ctx.rs:21,55,75`, `dispatch.rs:838-862`). `reveal_path`, `detect_agents` and the theme watcher still compile, and are harmless on a phone (`$PATH` / `$HOME` empty → nothing found) |
| 7. layout assumes ≥ 800 px | **landed** — `src/lib/breakpoints.ts` (phone < 600, compact < 820), overlay drawer with edge swipe, pointer-event drags, phone-width views; the window's `min_width` is 360 (`src-tauri/src/lib.rs:81`) |
| 8. token storage | open — `Git2Remote::from_env` reads `CORTEX_GIT_TOKEN` (`remote.rs:275`), nothing else |
| 9. no CI | **partly landed** — `.github/workflows/ci.yml` (test, tsc, vite build, clippy) and `release.yml` (desktop matrix); no Android job; still no toolchain here |
| 10. folder import / publish into a folder | open on native, **solved for the served host** — `HostCapabilities.folders` hides them (`src/lib/host.ts`) |

The remaining blockers are all small and all verifiable on desktop except
the build itself. The vault storage answer is unchanged (app-private
directory). The new insight of this pass is that **serve mode built the
mobile host layer without meaning to**: its capability model and its
`Exposure::Desktop` command list are exactly the native app's allow-list,
and its upload-based import path works in the Android WebView as-is. The
native app should present itself as a third host kind, not as the
desktop.

## What serve mode changed for a native build

Serve mode split the app into `crates/cortex-app` (every command, the
watcher, the lock, the server) and a thin Tauri host (`src-tauri/src`,
five files). This is what a native mobile build inherits from it:

| Piece | Where | What it means on Android |
|---|---|---|
| `HostCapabilities` — `terminal`, `folders`, `updater`, `reveal`, `served` | `src/lib/host.ts:10-31`; consumers in `TopBar.tsx:103`, `LeftPanel.tsx:285,323`, `SettingsView.tsx:101,659,730,784`, `QuickSwitcher.tsx:224,284`, `Shell.tsx:71,818`, `PropertyInputs.tsx:178` | The exact switches a phone needs. **But** `current` is chosen by `isDesktop()` (`transport.ts:34`: `"__TAURI_INTERNALS__" in window`), which is **true inside a native Android build**, so a phone would get `DESKTOP` (`terminal: true, folders: true, reveal: true, updater: true`). A third host kind is the fix (row 40) |
| `isDesktop()` as "has a desktop" | `ImportModal.tsx:47,53,59,124,200,248,461` (dialog + path vs. upload), `export.ts:14` (save dialog vs. download), `Editor.tsx:548` (Rust clipboard vs. browser paste), `useVault.ts:56` (served boot), `links.ts:15`, `main.tsx:17` (service worker) | Same mis-classification. `links.ts` is fine either way (`shell.open` works on Android); the others need the mobile branch to be the served one |
| Upload imports — `upload_import_file` → `.brain/uploads/<id>/<name>`, then `import_csv_*_upload` / `import_notion_upload` | `crates/cortex-app/src/commands/import.rs:63-93`, `dispatch.rs:171-174` (`Exposure::Both`) | **Works natively.** The browser `<input type=file>` the served path uses is implemented by wry's Android chrome client (`wry-0.55.1/src/android/kotlin/RustWebChromeClient.kt:272`, `onShowFileChooser`). No `content://` handling, no dialog plugin, no new command |
| `Exposure::Desktop` commands | `dispatch.rs:70,94-97,115,134,137,139-140,142-143,160-162,169` — `export_to_file`, the path-based imports, `reveal_path`, `packs_export`, `allow_embed_frame`, `publish_*`, recent vaults, `open_vault`, `create_vault_from_template`, `close_vault`, `watch_theme_file` | The Tauri host routes every table command regardless of exposure (`src-tauri/src/host.rs:31`), so these stay callable on a phone; the frontend hides them by capability. Three of them the phone needs anyway (`open_vault`, `create_vault_from_template`, recent vaults) — they take container paths and work |
| Export as a browser download | `export.ts:14-26` (`<a download>` of a blob URL) | **Does not work in the Android WebView**: wry sets no `DownloadListener` (no hit in `wry-0.55.1/src/android/kotlin/`). Native export should use `dialog.save()` (implemented on Android as `ACTION_CREATE_DOCUMENT`, `DialogPlugin.kt:205`) and write through `@tauri-apps/plugin-fs`, which resolves `content://` URIs on Android (`tauri-plugin-fs-2.5.1/src/android.rs:37-51`). Small, row 44 |
| `read_clipboard` | `src-tauri/src/commands/clipboard.rs:26-48` spawns `wl-paste` / `xclip`; called from `Editor.tsx:548` whenever `isDesktop()` | On a phone the spawn fails and the editor alerts once per session on the first paste (`Editor.tsx:555`). The browser paste event already works in the WebView; gate the call on host kind (row 40) |
| `server` feature always on in the Tauri crate | `src-tauri/Cargo.toml:21`; `commands::serve::autostart` runs in `setup` (`lib.rs:106`) | Resolves and builds for Android (`axum 0.8.9`, `tokio 1.52`, `hyper 1.10` all appear in `cargo tree --target aarch64-linux-android`), but serving from a phone is not a feature and `tailscale::status` spawns a binary (`tailscale.rs:68`). Make the feature and the three `serve_*` commands desktop-only (row 41). Not a blocker |
| `AppDirs` from Tauri's path resolver | `src-tauri/src/lib.rs:58-59` (`app_config_dir`, `app_cache_dir`) | Correct on Android (the app's `filesDir` / `cacheDir`). `AppDirs::for_identifier` (`ctx.rs:36-43`, the `dirs` crate) is only used by `cortex serve`, which is not in the bundle |
| Writer lock | `crates/cortex-app/src/lock.rs:134` (`libc::kill(pid, 0)` under `cfg(unix)`) | Android is `unix`; works. The second-host case cannot arise on a phone |

## Toolchain on this machine

| Check | Result |
|---|---|
| `rustup target list --installed` | `x86_64-unknown-linux-gnu` only; none of `aarch64-linux-android`, `armv7-linux-androideabi`, `i686-linux-android`, `x86_64-linux-android` |
| `$ANDROID_HOME`, `$NDK_HOME`, `$ANDROID_NDK_HOME`, `$JAVA_HOME` | unset; `~/Android/Sdk`, `/opt/android-sdk`, `/opt/android-ndk`, `/usr/lib/jvm/*` absent |
| `java`, `adb`, `sdkmanager`, `gradle`, `cargo-ndk`, `xcodebuild` | none on `PATH` |
| `rustc` / `cargo` | 1.98.1 |
| Tauri CLI | `@tauri-apps/cli ^2` in `package.json:40`, but `node_modules` in this worktree is a symlink to the main checkout's, which is empty — `npx tauri` does not resolve until `npm ci --legacy-peer-deps` |
| `cargo tree --target aarch64-linux-android` (offline) | resolves; `portable-pty`, `tauri-plugin-updater` and `tauri-plugin-process` correctly drop out; `jni 0.21`, `ndk 0.9`, `android_system_properties` come in via `tauri` / `tao` |

A build machine needs, per the Tauri 2 prerequisites: JDK 17, Android SDK
(platform 34, build-tools, platform-tools), NDK r26+, the four rustup
targets, `ANDROID_HOME` and `NDK_HOME` exported. `cargo check --target
aarch64-linux-android` is not a shortcut: `openssl-src` and `libgit2-sys`
run their C builds from `build.rs` and need the NDK's clang even for a
check, so nothing short of the real toolchain proves the link. Nothing was
installed here, by instruction.

## Crate compatibility on `aarch64-linux-android`

Versions from `Cargo.lock` at `3a48e76`; unchanged from the first pass
unless noted.

| Crate | Verdict | Evidence |
|---|---|---|
| `git2` 0.19 / `libgit2-sys` 0.17 (libgit2 1.8.1) | compiles; **HTTPS now enabled**; no SSH (`libssh2-sys` absent — intended) | `libgit2-sys/build.rs:155` has an explicit `android` branch; `build.rs:25` defines `GIT_OPENSSL` under the `https` feature, which both manifests now set |
| `openssl-src` 300.6 (vendored OpenSSL 3.6) | compiles with the NDK clang | `openssl-src/src/lib.rs:282-393` maps every `*-linux-android*` target and reads `ANDROID_NDK_HOME` |
| OpenSSL trust store | **needs a one-liner** (blocker 5) | `git2/src/lib.rs:876` calls `openssl_probe::init_ssl_cert_env_vars()` on `unix && !macos`, which finds no `/etc/ssl` on Android. `git2::opts::set_ssl_cert_dir("/apex/com.android.conscrypt/cacerts")` (Android 14+) with `/system/etc/security/cacerts` as fallback, at startup on Android |
| `rusqlite` 0.32 `bundled` | compiles; Android-aware | `libsqlite3-sys/build.rs:17` `android_target()`, `:222-224` `SQLITE_TEMP_STORE=3` |
| `notify` 8.2 | inotify backend on `target_os = "android"` | `notify/Cargo.toml:85-89` |
| `ureq` 3.4 (`rustls`, `gzip`) | compiles; marketplace fetch works without a system store | `rustls 0.23` + `webpki-roots 1.0.9` + `ring 0.17.14` in the lock; `ring` builds for Android with the NDK |
| `zip` 8, `flate2` (`rust_backend`), `serde_yaml`, `regex`, `chrono`, `pulldown-cmark`, `walkdir`, `toml`, `base64`, `qrcode` 0.14 (`svg`) | pure Rust | — |
| `axum` 0.8 / `tokio` 1.52 / `hyper` 1.10 (new: the `server` feature) | compile; unwanted in the bundle | `cargo tree --target aarch64-linux-android` resolves them; see the serve row above |
| `dirs` 6 / `dirs-sys` 0.5 | returns `None` for most dirs on Android (`dirs-sys/src/lib.rs:39`) | only reached by `cortex serve`; the Tauri host passes its own `AppDirs` |
| `libc` (writer lock) | fine | `cfg(unix)` includes Android |
| `portable-pty` 0.9 | **gated out** | `crates/cortex-app/Cargo.toml:35-37` |
| `tauri` 2.11.2, `tauri-plugin-dialog` 2.7.1, `tauri-plugin-fs` 2.5.1, `tauri-plugin-shell` 2.3.5 | mobile runtime present; `WindowEvent::Suspended` / `Resumed` at `tauri/src/app.rs:160,169` | `tauri-plugin-updater` / `-process` are desktop-only deps (`src-tauri/Cargo.toml:30-32`) with a matching `platforms` capability (`capabilities/desktop.json`) |
| `cortex-cli` (`rmcp`, `tokio`, `clap`) | not in the bundle | the Android app links `second_brain_lib` only |

## Tauri config and the app shell

| Item | State | Evidence |
|---|---|---|
| `mobile_entry_point` | present | `src-tauri/src/lib.rs:37` |
| `crate-type` `staticlib` + `cdylib` + `rlib` | present | `src-tauri/Cargo.toml:10` |
| `identifier` `com.cortex.app` | valid Android package name; also `APP_IDENTIFIER` in `ctx.rs:47` | `tauri.conf.json:4` |
| `bundle.android` | absent; optional (`minSdkVersion` defaults to 24). Add `versionCode` when shipping | `tauri-utils` `AndroidConfig` |
| `src-tauri/gen/android` | absent; created by `npx tauri android init`. **`src-tauri/gen/` is gitignored** (`.gitignore:13`) — the row that inits the project must un-ignore `gen/android` (keeping `gen/android/app/build`, `.gradle` out) so the project is committed | — |
| Icons | `bundle.icon` lists PNG/ICNS/ICO; `npx tauri icon` writes the Android mipmaps into `gen/android` | `tauri.conf.json:21-27` |
| Window | built in `setup`; `min_width` 360, `title_bar_style: Overlay` (macOS-only, ignored elsewhere); the `on_navigation` guard allows `tauri.localhost`, the Android origin, plus `frames.allows` for embeds | `src-tauri/src/lib.rs:74-98` |
| CSP | `connect-src 'self' ipc: http://ipc.localhost` matches Android's IPC | `tauri.conf.json:14` |
| Capabilities | `default.json` (`windows: ["main"]`) has `dialog:default`, `fs:default`, `shell:allow-open`. Native export (row 44) needs `fs:allow-write-text-file`; a path picked by the dialog is auto-allowed by the plugin's scope (`tauri-plugin-dialog/src/commands.rs:152-177`) | `src-tauri/capabilities/` |
| Service worker / manifest | registered only when `!isDesktop()` (`main.tsx:17`); a native build never registers it | correct as-is |

## Plugin and API surface used by the frontend

| Call | Where | On Android |
|---|---|---|
| `dialog.open({ directory: true })` | `useVault.ts:87` (open vault), `PublishModal.tsx:46`, `ImportModal.tsx:169,203` | **fails**: `tauri-plugin-dialog/src/commands.rs:186` returns `FolderPickerNotImplemented` on mobile; the Kotlin side only issues `ACTION_GET_CONTENT` (`DialogPlugin.kt:62-63`, with a `TODO: ACTION_OPEN_DOCUMENT`). All four call sites are already hidden when `capabilities().folders` is false or `served` is true; the native app needs the same flags |
| `dialog.save()` | `useVault.ts:93` (create vault), `export.ts:27` | exists on mobile (`ACTION_CREATE_DOCUMENT`) but returns a `content://` URI, not a directory path; `createVaultFromTemplate(uri)` would fail. Create-vault on mobile takes a name and lands in the container; export writes through the fs plugin |
| `dialog.open()` for a file (CSV / zip) | `ImportModal.tsx:125,202` | works but returns `content://`; the Rust importer reads by path. Use the upload branch instead (works natively, above) |
| `<input type=file>` (upload branch) | `ImportModal.tsx:24-35` | works: wry implements `onShowFileChooser` |
| `shell.open(url)` | `links.ts:15` | works (`tauri-plugin-shell/src/lib.rs`); `tauri-plugin-opener` is the successor, swap at leisure |
| `event.listen`, `invoke` | `transport.ts` | work; the Rust command decides |
| `plugin-updater`, `plugin-process` | `updater.ts` | desktop-only imports; the modules are only reached when `capabilities().updater` is true |

## Filesystem and vault access model on Android

Unchanged from the first pass; the reasoning in short.

| Model | Fits? | Why |
|---|---|---|
| **App-private directory** (`app_data_dir()/vaults/<slug>`, i.e. `filesDir`) | **yes — v1** | Real POSIX paths: `git2`, `rusqlite`, `walkdir`, `notify` and the writer lock work untouched; no permission prompt; private per app UID and encrypted at rest. Backup is git, which is the product's story. Other apps cannot see the files |
| Storage Access Framework (`ACTION_OPEN_DOCUMENT_TREE`) | no | `content://` URIs, not paths; every core crate wants a path; a copy shim breaks the watcher and makes `.brain/` racy; and the dialog plugin has no tree picker |
| `MANAGE_EXTERNAL_STORAGE` | no | Play policy rejects it for a notes app |

Consequences at HEAD: `open_vault`, `VaultState`, `recent.rs`
(`ctx.config_dir()`), `.brain/index.db`, `.brain/uploads/`, and the pack
cache (`app_cache_dir`) all key off absolute paths or the host's
`AppDirs` and work unchanged inside the container. `reveal_path`,
folder import, "Publish into…" and the terminal are hidden by capability.
`create_vault_from_template` with a git URL or `owner/repo`
(`template.rs:148-163`) shells out to `git clone` and uses `temp_dir()`;
on mobile that path must either be refused ("New vault" offers the bundled
tour only) or go through `RemoteOps::clone_to` — the second is a
few lines once the CA store and token exist.

## The git-backed vault on Android

The transport question is closed: `git::sync_vault`, `list_conflicts`,
`resolve_conflict`, `complete_merge`, `abort_merge`, the remote half of
`discard_agent_branch` and `members::current_user` all go through
`default_remote()` (`git.rs:455-526`, `members.rs:66`), which on Android is
`Git2Remote`. What still shells out, and whether it matters:

| Subprocess | File:line | On a phone |
|---|---|---|
| `git clone --depth 1` for a URL template | `crates/cortex-core/src/template.rs:152` | reachable from "New vault"; refuse or route through `clone_to` (row 41) |
| gh-pages publish | `crates/cortex-core/src/publish.rs:1096,1108` | `Exposure::Desktop`, hidden when `served`; hide on mobile too |
| marketplace `generate_index` | `crates/cortex-core/src/marketplace.rs:1335` | CI-only path, `.ok()`-tolerant |
| `tailscale status` | `crates/cortex-app/src/tailscale.rs:68` | serve only (row 41 makes it desktop-only) |
| reveal in file manager | `crates/cortex-app/src/commands/notes.rs:301-305` | `Exposure::Desktop`, hidden by `capabilities().reveal` |
| `wl-paste` / `xclip` | `src-tauri/src/commands/clipboard.rs:26` | gate the call (row 40) |
| `git` in tests | `git.rs:676`, `remote.rs` interop test | desktop tests only |

What `Git2Remote` still lacks for a phone, in order:

- **Trust.** Blocker 5 above; one call at startup on Android.
- **A token from somewhere other than the environment.** `default_remote()`
  builds `Git2Remote::from_env()`; on a phone `CORTEX_GIT_TOKEN` is never
  set, so the credential callback (`remote.rs:285-313`) falls to
  `Cred::credential_helper` (no helper on Android) and then
  `Cred::default`, and a private remote fails with "No credentials for
  this remote". The fix is a `remote_for(vault)` that reads a per-vault
  credential record from the host's `AppDirs` and calls
  `Git2Remote::with_token` (`remote.rs:268`) — the plumbing is one
  function in `cortex-app` plus a parameter on the `git_*` commands (row 42).
- **Clone as a user action.** `RemoteOps::clone_to` exists for both
  backends (`remote.rs:130`, `:495`); nothing calls it from a command yet.
- **Identity.** `git::signature` falls back to `$USER@$HOSTNAME`, both
  unset on Android, so a fresh install commits as `cortex <cortex@…>`
  until the mobile Settings page writes `user.name` / `user.email` into the
  repo config (`Git2Remote::identity` already reads it via `repo.config()`).
- **Token storage.** `.cortex/settings.yaml` is committed and must never
  carry it; `serve.yaml` set the precedent of a per-machine file in the app
  config dir with owner-only permissions (`serve_config.rs:81-98`). The
  same slot, app-private and encrypted at rest on Android, is v1; a Kotlin
  `EncryptedSharedPreferences` plugin or `tauri-plugin-stronghold` can take
  over later behind the same Rust interface.
- **Triggers.** `WindowEvent::Resumed` → `git_sync`, plus pull-to-refresh.
  No background sync.

Everything above except the CA path is testable on desktop against a
local bare repo, exactly as `remote::tests` already does.

## Blocker list

Severity: **hard** stops the app from building, opening a vault, or
syncing; **soft** degrades a feature that must be hidden or replaced.

| # | Blocker | Severity | Evidence | Fix lands in |
|---|---|---|---|---|
| 1 | Native build is classified as the desktop host: folder pickers, reveal, terminal, updater and the Rust clipboard all switched on | hard (the vault picker cannot open or create a vault) | `transport.ts:34`, `host.ts:33-44`, `ImportModal.tsx`, `export.ts:14`, `Editor.tsx:548` | row 40 |
| 2 | No CA store for the vendored OpenSSL | hard for HTTPS git | `git2/src/lib.rs:876`; no `set_ssl_cert_*` in the tree | row 41 |
| 3 | `temp_dir()` unwritable on Android | hard for the Notion zip importer and URL templates | `import/notion.rs:479`, `template.rs:150`, `publish.rs:1077`; no `TMPDIR` in `lib.rs` | row 41 |
| 4 | No token source but the environment; no clone command; no identity UI | hard for any private remote | `remote.rs:59-73,275,290-313`; `git.rs:455-526` | row 42 |
| 5 | Vault open / create need a mobile flow (clone by URL, new-in-container) | hard | `useVault.ts:86-102`, `VaultPicker.tsx` | row 42 |
| 6 | No Android project, icons or `bundle.android`; `gen/` gitignored; no toolchain here | process | `.gitignore:13`, `tauri.conf.json` | row 43 |
| 7 | Export as a blob download does not work in the WebView | soft | `export.ts:14-26`; no `DownloadListener` in wry | row 44 |
| 8 | No resume-triggered sync, no pull-to-refresh | soft | `tauri/src/app.rs:169` | row 44 |
| 9 | `server` feature, `serve_*` commands and `tailscale` spawn compiled into the phone | soft (dead weight, a spawn that fails) | `src-tauri/Cargo.toml:21`, `lib.rs:27-34,106` | row 41 |
| 10 | URL / `owner/repo` templates shell out | soft | `template.rs:152` | row 41 |
| 11 | No CI job cross-compiles the core crates | process | `.github/workflows/ci.yml` | row 45 |

Verified and not blockers: `git2` HTTPS feature, `RemoteOps` selection,
`portable-pty` gating, `rusqlite` bundled, `notify` inotify, `ureq` +
`webpki-roots`, `zip`/`flate2`, `shell.open`, `event.listen`, the writer
lock, `AppDirs` from Tauri's resolver, the upload import path, the
breakpoint system, the window guard, the CSP, `mobile_entry_point`,
`crate-type`, the desktop-only updater/process plugins and their
`platforms`-scoped capability.

## Proposed sequence

The first pass proposed rows 36–39; they were never added to the vault's
backlog (which holds only this spike, priority 17, and the shell
groundwork row, priority 16), and most of their content has since landed
through the parity branches. The six rows below replace them, numbered
from 40 to stay clear of `docs/parity/proposed-backlog.md`. Order:
**40 → 41 → 42 → 43 → 44 → 45**. Rows 40–42 need no Android toolchain and
are the whole of the Rust and UI work; 43 is the first build; 44 and 45
polish and protect it.

```markdown
---
created: 2026-09-17
effort: S
priority: 40
status: planned
tags: [parity, mobile]
title: Mobile — a host kind the frontend and Rust agree on
type: note
---

Blocker 1 of `docs/parity/mobile-spike.md`: a native Android build has
`__TAURI_INTERNALS__`, so `isDesktop()` (`src/lib/transport.ts`) is true
and `host.ts` hands it the desktop capabilities — folder pickers, reveal,
terminal, updater, the Wayland clipboard. Add a `host_info` command to
`cortex_app::dispatch` (`Exposure::Both`) returning `{ platform:
std::env::consts::OS, kind: "desktop" | "mobile" }`, with a
`CORTEX_HOST_KIND=mobile` environment override so the mobile UI can be
exercised on a desktop at 390 px. In the frontend, replace the six
`isDesktop()` call sites that mean "has a desktop" (`ImportModal.tsx`,
`export.ts`, `Editor.tsx` paste, `useVault.ts` boot) with a `hostKind()`
from `host.ts`; keep `isDesktop()` for what it really asks (is the
transport Tauri: `transport.ts`, `links.ts`, `main.tsx`). Add a `MOBILE`
capability set (`terminal: false, folders: false, updater: false,
reveal: false, served: false`). Imports on mobile take the upload branch
(the WebView implements the file chooser). Desktop is unchanged:
`npm run test:lib`, `tsc`, `vite build` green; run the app with the
override at phone width and screenshot the vault picker and the import
modal without folder buttons.
```

```markdown
---
created: 2026-09-17
effort: S
priority: 41
status: planned
tags: [parity, mobile]
title: Mobile — Android runtime prerequisites in Rust
type: note
---

Blockers 2, 3, 9 and 10 of `docs/parity/mobile-spike.md`, every one a
few lines and all checkable on desktop. In `src-tauri/src/lib.rs` `setup`,
under `#[cfg(mobile)]`: set `TMPDIR` to `app_cache_dir()` before anything
uses `std::env::temp_dir()` (the Notion importer, URL templates, the
publish scratch); and on Android call `git2::opts::set_ssl_cert_dir` with
`/apex/com.android.conscrypt/cacerts` if it exists, else
`/system/etc/security/cacerts`, so libgit2's OpenSSL can verify
`https://github.com`. Make the `server` feature of `cortex-app` a
desktop-only dependency of the Tauri crate (`[target.'cfg(not(any(
target_os = "android", target_os = "ios")))'.dependencies]`, as the
updater already is) and put `commands::serve`, `Serving` and the three
`serve_*` handlers behind `#[cfg(desktop)]`. In
`cortex_core::template::scaffold_from`, route `TemplateSource::Repo`
through `remote::default_remote().clone_to` into the temp dir instead of
spawning `git`, so URL templates work wherever sync does. Tests: a core
test that scaffolds from a local `file://` repo via `clone_to`; `cargo
test --workspace` and `cargo check -p second-brain` green; `cargo tree
--target aarch64-linux-android -p second-brain` no longer lists `axum`.
```

```markdown
---
created: 2026-09-17
effort: M
priority: 42
status: planned
tags: [parity, mobile]
title: Mobile — clone a vault into the container with a stored token
type: note
---

Blockers 4 and 5 of `docs/parity/mobile-spike.md`; Phases 2 and 3 of
`docs/MOBILE.md`. In `cortex-app` add `credentials.rs`: a per-vault
`{ url, username, token }` record as JSON under the host's `AppDirs.config`
(owner-only permissions like `serve_config.rs`; never under the vault,
never in `.cortex/settings.yaml`), plus `slug_for_url()` with tests. Add
`remote_for(ctx, vault) -> Box<dyn RemoteOps>` that returns
`Git2Remote::with_token` when a record exists and `default_remote()`
otherwise, and thread it through the `git_*` commands (`git.rs` gains
`*_with(remote, …)` variants; the CLI and MCP keep `default_remote`).
Commands: `clone_vault(url, username, token)` — clone into
`app_data_dir()/vaults/<slug>` via `RemoteOps::clone_to`, save the
record, `open_vault`; `set_remote_credentials`; `set_git_identity(name,
email)` writing `user.name` / `user.email` to the repo config with `git2`.
Frontend, when `hostKind()` is mobile: the `VaultPicker` offers "Clone a
vault" (URL, username, token) and "New vault" (a name; bundled tour only)
in place of the folder and save dialogs, and Settings gains a Remote
section (identity, token). Desktop keeps the folder picker and system
git untouched. Tests on desktop: credential round-trip, slug rules, and
clone-then-sync-then-conflict against a local bare repo through
`remote_for`.
```

```markdown
---
created: 2026-09-17
effort: M
priority: 43
status: planned
tags: [parity, mobile]
title: Mobile — Android project init and first debug APK
type: note
---

The first row that needs the toolchain (JDK 17, Android SDK 34, NDK r26+,
`rustup target add aarch64-linux-android armv7-linux-androideabi
i686-linux-android x86_64-linux-android`, `ANDROID_HOME` / `NDK_HOME`);
skip if it is not installed and say so. `npm ci --legacy-peer-deps`, then
`npx tauri android init`; un-ignore `src-tauri/gen/android` in
`.gitignore` (keep `gen/android/.gradle`, `gen/android/app/build`,
`local.properties` ignored) and commit the project; `npx tauri icon` for
the mipmaps; add `bundle.android` with `minSdkVersion: 24` and a
`versionCode` to `tauri.conf.json`. Build with `npx tauri android build
--debug --target aarch64` and record in `docs/parity/mobile-spike.md`
which of the predicted issues appeared: the OpenSSL cross-compile, `ring`,
the CA path, inotify in the container, the WebView file chooser. Exit
criterion: the app boots on an emulator, clones a public HTTPS repo into
the container through the row-42 flow, opens it, edits a note, and
`git_sync` pushes with a token. No layout work.
```

```markdown
---
created: 2026-09-17
effort: S
priority: 44
status: planned
tags: [parity, mobile]
title: Mobile — resume sync, pull-to-refresh, and export through the save dialog
type: note
---

Blockers 7 and 8 of `docs/parity/mobile-spike.md`; Phase 5 of
`docs/MOBILE.md`. On mobile, replace the desktop focus/interval sync loop
with `tauri::WindowEvent::Resumed` → `git_sync` (emit the same
`SyncOutcome` events so the conflict modal opens exactly as on desktop),
and add a pull-to-refresh gesture on the note list and the open note
calling the same command. Export on mobile: `dialog.save()` for a
`content://` target, then `writeTextFile` from `@tauri-apps/plugin-fs`
with the text `export_text` already returns (the blob download the served
app uses does not work in the WebView); add `fs:allow-write-text-file` to
the default capability. Desktop unchanged; verify on the emulator from
row 43 and on desktop with `CORTEX_HOST_KIND=mobile`.
```

```markdown
---
created: 2026-09-17
effort: S
priority: 45
status: planned
tags: [parity, mobile, ci]
title: Mobile — an Android cross-compile job in CI
type: note
---

Blocker 11 of `docs/parity/mobile-spike.md`. Add
`.github/workflows/android.yml` with two jobs. The fast one runs on every
PR: JDK 17 and NDK via the official setup actions, `cargo-ndk`, and
`cargo ndk -t arm64-v8a check -p cortex-core -p cortex-app` — the C
builds of OpenSSL and libgit2 are the part that breaks silently, and a
core crate that stops cross-compiling should fail a PR before anyone
tries a phone. The full one, on pushes to main and manual dispatch: SDK
34, `npm ci --legacy-peer-deps`, `npx tauri android build --apk --target
aarch64`, upload the APK as a workflow artifact, debug-signed. Cache
cargo and the NDK build. Release signing and a Play listing are out of
scope.
```

## What was not done

- No `cargo check --target aarch64-linux-android`: the target is not
  installed, and the C build scripts need the NDK regardless. Every
  "compiles" verdict is from the dependency's own build script or a
  pure-Rust check, not from a link.
- No config or code change: with nothing to build against, a
  `bundle.android` block or a `gen/android` tree would be unverifiable
  noise, and the Rust prerequisites are small enough to be their own row.
- iOS was not re-audited; the findings that also apply there (CA store
  is different — iOS has no OpenSSL directory either, so the same
  `set_ssl_cert_file` with a bundled PEM is the portable form; `temp_dir`
  is writable on iOS; token storage; folder picker) are noted in
  `docs/MOBILE.md`.
