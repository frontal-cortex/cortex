use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{Manager, State};

use cortex_core::db::Db;
use cortex_core::error::{AppError, Result};
use cortex_core::git;


/// Append `entry` to the vault's `.gitignore` if not already present, creating
/// the file with a sensible header if it doesn't exist. Idempotent.
fn ensure_gitignored(root: &PathBuf, entry: &str) -> Result<()> {
    let gitignore = root.join(".gitignore");
    let existing = std::fs::read_to_string(&gitignore).unwrap_or_default();

    let already = existing
        .lines()
        .map(|l| l.trim())
        .any(|l| l == entry || l == entry.trim_end_matches('/'));
    if already {
        return Ok(());
    }

    let mut out = existing;
    if !out.is_empty() && !out.ends_with('\n') {
        out.push('\n');
    }
    if out.is_empty() {
        out.push_str("# Cortex — rebuildable cache (safe to delete)\n");
    }
    out.push_str(entry);
    out.push('\n');
    out.push_str(".DS_Store\n");
    std::fs::write(&gitignore, out)?;
    Ok(())
}

#[derive(Debug, Default)]
pub struct VaultState(pub Mutex<Option<PathBuf>>);

#[derive(Debug, Default)]
pub struct DbState(pub Mutex<Option<Db>>);

#[derive(Debug, Serialize, Deserialize)]
pub struct VaultInfo {
    pub path: String,
    pub name: String,
    pub has_remote: bool,
}

/// Open a vault: make sure its skeleton, docs and settings exist, bring the
/// search index up to date, start following the folder. Off the main thread —
/// the index pass is the one thing here that scales with the vault.
#[tauri::command]
pub async fn open_vault(app: tauri::AppHandle, path: String) -> Result<VaultInfo> {
    super::off_thread(move || open_vault_blocking(&app, path)).await
}

fn open_vault_blocking(app: &tauri::AppHandle, path: String) -> Result<VaultInfo> {
    let state = app.state::<VaultState>();
    let db_state = app.state::<DbState>();
    let vault_path = PathBuf::from(&path);
    if !vault_path.exists() {
        return Err(AppError::Other(format!("Path does not exist: {path}")));
    }

    git::open_or_init(&vault_path)?;
    std::fs::create_dir_all(vault_path.join(".brain"))?;
    std::fs::create_dir_all(vault_path.join(".cortex"))?;
    std::fs::create_dir_all(vault_path.join("templates"))?;
    std::fs::create_dir_all(vault_path.join("notes"))?;

    // Ensure the rebuildable cache is gitignored. `.cortex/` (config) and
    // `.trash/` (soft-deletes) are intentionally committed.
    ensure_gitignored(&vault_path, ".brain/")?;

    // Write VAULT.md (for people) and AGENTS.md (for agents) only when
    // opening for the first time — both are the user's to edit afterwards.
    let vault_doc = vault_path.join("VAULT.md");
    if !vault_doc.exists() {
        std::fs::write(&vault_doc, cortex_core::vault::vault_md())?;
    }
    let agents_doc = vault_path.join("AGENTS.md");
    if !agents_doc.exists() {
        std::fs::write(&agents_doc, cortex_core::vault::agents_md())?;
    }

    // Spell out every setting in `.cortex/settings.yaml` (defaults for any
    // that are missing) so an agent editing the file sees the whole schema.
    // A malformed file is tolerated, not overwritten.
    let settings = cortex_core::settings::ensure_complete(&vault_path)?;

    // Best-effort prune of expired trash, using the vault's retention setting.
    let _ = crate::commands::trash::prune_expired(&vault_path, settings.trash_retention_days);

    // Open / migrate the SQLite index, then re-index all notes
    let db = Db::open(&vault_path)?;
    cortex_core::index::index_vault(&vault_path, &db)?;
    *db_state.0.lock().unwrap() = Some(db);

    let name = vault_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("vault")
        .to_string();

    let has_remote = git2::Repository::open(&vault_path)
        .map(|r| r.find_remote("origin").is_ok())
        .unwrap_or(false);

    crate::commands::recent::record_recent(app, &vault_path);

    // Follow external edits (agents, editors, git) for as long as the vault is open.
    crate::watcher::start(app, vault_path.clone())?;

    *state.0.lock().unwrap() = Some(vault_path);

    Ok(VaultInfo { path, name, has_remote })
}

/// Scaffold a brand-new vault at `path` from the bundled starter template
/// (`cortex_core::template`) — no network, no `git` binary needed.
///
/// Writes the files, initialises a fresh repository and makes an initial
/// commit, so the vault is the user's own from the first second. The caller
/// is expected to follow up with `open_vault(path)`, which adds `VAULT.md`,
/// `AGENTS.md` and `.cortex/settings.yaml`.
#[tauri::command]
pub async fn create_vault_from_template(path: String, template: Option<String>) -> Result<()> {
    super::off_thread(move || create_vault_blocking(path, template)).await
}

fn create_vault_blocking(path: String, template: Option<String>) -> Result<()> {
    use cortex_core::template::{self, TemplateSource};
    let target = PathBuf::from(&path);

    // The bundled tour, or a template the user named: a folder, an owner/repo
    // on GitHub, or a git URL — its files copied, its history left behind.
    let source = match template.as_deref().map(str::trim).filter(|t| !t.is_empty()) {
        Some(spec) => template::parse_source(spec)?,
        None => TemplateSource::Bundled,
    };
    // Refuses a non-empty directory — never clobber existing files.
    template::scaffold_from(&source, &target)?;

    let repo = git::open_or_init(&target)?;
    // Best-effort initial commit. If the user has no git identity configured,
    // the repo is still valid and the app will index the working tree on open.
    let _ = git::stage_all_and_commit(&repo, "Initial vault");

    Ok(())
}

/// Close the open vault — clears the in-memory vault path and index handle so
/// the app returns to the landing screen (like signing out).
#[tauri::command]
pub fn close_vault(
    app: tauri::AppHandle,
    state: State<'_, VaultState>,
    db_state: State<'_, DbState>,
) -> Result<()> {
    crate::watcher::stop(&app);
    *state.0.lock().unwrap() = None;
    *db_state.0.lock().unwrap() = None;
    Ok(())
}

#[tauri::command]
pub fn get_vault_info(state: State<'_, VaultState>) -> Result<Option<VaultInfo>> {
    let guard = state.0.lock().unwrap();
    let Some(ref path) = *guard else {
        return Ok(None);
    };

    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("vault")
        .to_string();

    let has_remote = git2::Repository::open(path)
        .map(|r| r.find_remote("origin").is_ok())
        .unwrap_or(false);

    Ok(Some(VaultInfo {
        path: path.to_string_lossy().to_string(),
        name,
        has_remote,
    }))
}
