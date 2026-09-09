# Mobile mode (iOS)

Plan for shipping Cortex as an iOS app on Tauri 2.0's mobile target.

## Guiding principle

Desktop behavior stays **byte-for-byte unchanged**. It keeps shelling out to
system `git` for remote operations, which preserves SSH agents and credential
helpers — the reason `git.rs` shells out in the first place (see `remote.rs`). Mobile gets a **parallel, in-process path** selected at
compile time by target OS (`remote::default_remote`).

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

## Shell-out surface (desktop) and its in-process counterpart

| Operation | Desktop (`ShellRemote`) | Mobile (`Git2Remote`) |
|---|---|---|
| pull (fetch + merge) | `git pull --no-rebase` | `Remote::fetch` + `Repository::merge` |
| push | `git push -u origin <branch>` | `Remote::push` + `Branch::set_upstream` |
| merge abort | `git merge --abort` | index ← HEAD, force-checkout touched paths, `cleanup_state` |
| conflict resolve (ours/theirs) | `git checkout --ours/--theirs` + `add` | conflict entry blob → workdir, `Index::add_path` |
| complete merge | `git commit --no-edit` | two-parent commit from `MERGE_HEAD`, `cleanup_state` |
| branch/state | `symbolic-ref`, `rev-parse`, `diff` | `HEAD` symbolic target, `Index::conflicts` |
| user identity | `git config user.name/email` | `Repository::config` |
| reveal in OS | `open -R` / `explorer` (`notes.rs`) | desktop only — `#[cfg]` off (Phase 3) |

All of the above live in `crates/cortex-core/src/remote.rs` (Phase 1, below).

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

**Exit criterion:** a blank-ish app runs on the iOS simulator with git2/rusqlite
linked.

## Phase 1 — Remote-ops abstraction (load-bearing refactor) — **landed**

`crates/cortex-core/src/remote.rs` owns every remote + merge operation behind
one trait; `git.rs` (`sync_vault`, `list_conflicts`, `resolve_conflict`,
`complete_merge`, `abort_merge`, the remote half of proposal deletion) and
`members.rs` (`current_user`) are thin delegates, so the app, CLI and MCP all
go through it and the backend is chosen in exactly one place.

```rust
pub trait RemoteOps: Send + Sync {
    fn clone_to(&self, url: &str, dest: &Path) -> Result<()>;
    fn list_conflicts(&self, repo: &Path) -> Result<Vec<String>>;
    fn sync(&self, repo: &Path) -> Result<SyncOutcome>;          // commit dirty, fetch + merge, push
    fn resolve_conflict(&self, repo: &Path, file: &str, side: &str) -> Result<()>; // ours | theirs | manual
    fn complete_merge(&self, repo: &Path) -> Result<SyncOutcome>; // two-parent commit + push
    fn abort_merge(&self, repo: &Path) -> Result<()>;
    fn delete_remote_branch(&self, repo: &Path, branch: &str) -> Result<()>;
    fn identity(&self, repo: &Path) -> CurrentUser;              // user.name / user.email
}
```

- **`ShellRemote`** — the original `git.rs` code, lifted verbatim. The desktop
  default; zero behavior change.
- **`Git2Remote`** — libgit2 (`git2`, now built with its `https` feature):
  - *clone / fetch / push* via `RemoteCallbacks` + `Cred::userpass_plaintext`
    (HTTPS + token; `Git2Remote::with_token(user, token)`), falling back to the
    credential helper / default credentials when no token is set. Credential
    retries are capped so a bad token fails instead of looping.
  - *fetch* goes into a private `refs/cortex/sync/<branch>` ref cleared
    beforehand — its presence afterwards is the "remote has this branch"
    signal (a new branch has nothing to pull), then updates
    `refs/remotes/origin/<branch>`.
  - *merge* — `repo.merge()` of the fetched commit with `allow_conflicts`,
    labels `HEAD` / `origin/<branch>`, so files carry the same `<<<<<<<`
    markers the resolution UI already understands. Fast-forward and
    unborn-HEAD cases move the branch ref directly. `ORIG_HEAD` is written
    like git does.
  - *list conflicts* — `repo.index().conflicts()`.
  - *resolve ours/theirs* — write that side's blob from the conflict entry to
    the working tree and `add_path` it (a side that deleted the file removes
    it); `manual` stages whatever is on disk.
  - *abort* — HEAD is the pre-merge commit (a merge never moves it until it is
    committed); reset the index to it, force-checkout only the paths the merge
    touched (files the merge added are removed; ignored `.brain/` and
    unrelated edits survive), then `cleanup_state()`.
  - *complete* — `write_tree` → commit with HEAD + every `MERGE_HEAD` as
    parents, message from `MERGE_MSG` → `cleanup_state` → push, and set the
    upstream (the `-u` in `git push -u`).
  - *identity* — `repo.config()` (repo, then global) instead of a subprocess.

### Selecting the backend

`remote::default_remote()` returns `ShellRemote` on desktop and `Git2Remote`
when the target OS is iOS or Android (`cfg(any(target_os = "ios",
target_os = "android"))` — the same compile-time truth Tauri's `mobile` cfg
reflects, without needing the tauri build script to reach into
`cortex-core`). A mobile build therefore needs no extra wiring for the
transport itself; Phase 2 only has to hand it the token
(`Git2Remote::with_token`, today read from `CORTEX_GIT_TOKEN` /
`CORTEX_GIT_USERNAME` by `Git2Remote::from_env`).

To try the in-process path on a desktop against a real remote:

```sh
CORTEX_GIT_TRANSPORT=git2 CORTEX_GIT_TOKEN=<pat> cortex ...   # or launch the app with it
```

`CORTEX_GIT_TRANSPORT=shell` forces the shell path anywhere.

### Tests

`remote::tests` exercise `Git2Remote` on desktop against a local bare repo
built with git2 only: clean sync (fast-forward, then a two-parent merge of
non-overlapping edits), a same-line conflict resolved `theirs`, resolved
`ours`, resolved `manual`, abort (pre-pull state back, merge-added file gone,
`.brain/` untouched), identity, and a shell/git2 interop test — a merge
started in-process is finished by system git and vice versa, so the on-disk
state is the one git itself expects. `git::tests` still cover `ShellRemote`
through the unchanged public functions.

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
| git2 merge UX drifts from CLI behavior | 1 | Desktop-run unit tests against a bare repo, including shell/git2 interop (done) |
| Token leaking into committed `.cortex` | 2 | Keychain + `app_data_dir` only; never in the `Settings` struct |
| App Store background-sync limits | 5 | Foreground + manual sync (already the local-first model) |

**Critical path:** Phase 0 → 1 → 2 → 3 (Rust). Phase 4 (UI) parallelizes after
Phase 0.
