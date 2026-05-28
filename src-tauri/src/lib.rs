mod commands;
mod db;
mod error;
mod git;
mod note;

use commands::vault::{DbState, VaultState};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .manage(VaultState::default())
        .manage(DbState::default())
        .invoke_handler(tauri::generate_handler![
            commands::vault::open_vault,
            commands::vault::get_vault_info,
            commands::notes::list_notes,
            commands::notes::read_note,
            commands::notes::write_note,
            commands::notes::create_note,
            commands::notes::delete_note,
            commands::notes::search_notes,
            commands::git::git_status,
            commands::git::git_commit,
            commands::git::git_sync,
            commands::git::git_log,
            commands::git::list_agent_branches,
            commands::git::apply_agent_branch,
            commands::git::discard_agent_branch,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
