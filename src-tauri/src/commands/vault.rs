use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::State;

use crate::db::Db;
use crate::error::{AppError, Result};
use crate::git;

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

#[tauri::command]
pub fn open_vault(
    path: String,
    state: State<'_, VaultState>,
    db_state: State<'_, DbState>,
) -> Result<VaultInfo> {
    let vault_path = PathBuf::from(&path);
    if !vault_path.exists() {
        return Err(AppError::Other(format!("Path does not exist: {path}")));
    }

    git::open_or_init(&vault_path)?;
    std::fs::create_dir_all(vault_path.join(".brain"))?;

    // Open / migrate the SQLite index, then re-index all notes
    let db = Db::open(&vault_path)?;
    crate::commands::indexer::index_vault(&vault_path, &db)?;
    *db_state.0.lock().unwrap() = Some(db);

    let name = vault_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("vault")
        .to_string();

    let has_remote = git2::Repository::open(&vault_path)
        .map(|r| r.find_remote("origin").is_ok())
        .unwrap_or(false);

    *state.0.lock().unwrap() = Some(vault_path);

    Ok(VaultInfo { path, name, has_remote })
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
