# Mobile mode (iOS)

Plan for shipping Cortex as an iOS app on Tauri 2.0's mobile target.

## Guiding principle

Desktop behavior stays **byte-for-byte unchanged**. It keeps shelling out to
system `git` for remote operations, which preserves SSH agents and credential
helpers — the reason `git.rs` shells out in the first place (see the comment at
`git.rs:241`). Mobile gets a **parallel, in-process path** selected at compile
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
| pull (fetch + merge) | `git.rs:311` | `git pull --no-rebase` |
| push | `git.rs:328`, `git.rs:371` | `git push -u origin <branch>` |
| merge abort | `git.rs:381` | `git merge --abort` |
| conflict resolve (ours/theirs) | `git.rs:342`, `git.rs:350` | `git checkout --ours/--theirs` + `add` |
| complete merge | `git.rs:365` | `git commit --no-edit` |
| branch/state | `git.rs:270`–`285` | `symbolic-ref`, `rev-parse`, `diff` |
| template clone | `vault.rs:268` | `git clone --depth 1` |
| user identity | `members.rs:64` | `git config user.name/email` |
| reveal in OS | `notes.rs:455` | `open -R` / `explorer` (desktop only) |

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
- **`create_vault_from_template`** (`vault.rs:251`) shells out to clone — add a
  `#[cfg(mobile)]` branch that uses `Git2Remote::clone_to`, or create an empty
  repo locally and attach a remote.
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
