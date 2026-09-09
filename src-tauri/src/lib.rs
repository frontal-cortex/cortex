mod agents;
mod commands;
mod terminal;
mod theme;
mod watcher;

use commands::vault::{DbState, VaultState};
use tauri::Manager;

/// Tiling compositors own the window frame; GTK's client-side title bar with
/// min/max/close only gets in the way there. Desktops that need a close button
/// (GNOME, KDE) keep it.
#[cfg(target_os = "linux")]
fn is_tiling_desktop() -> bool {
    let desktop = std::env::var("XDG_CURRENT_DESKTOP")
        .or_else(|_| std::env::var("XDG_SESSION_DESKTOP"))
        .unwrap_or_default()
        .to_ascii_lowercase();
    ["hyprland", "sway", "niri", "river", "i3", "bspwm", "dwm", "qtile"]
        .iter()
        .any(|d| desktop.contains(d))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init());
    // In-app updates are desktop only. The plugin reads its endpoint and
    // public key from `plugins.updater` in tauri.conf.json; with no endpoint
    // (or the placeholder key) the UI reports "not configured" and nothing
    // else changes — see commands/updates.rs and docs/development.md.
    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init());
    builder
        .manage(VaultState::default())
        .manage(DbState::default())
        .manage(watcher::WatcherState::default())
        .manage(watcher::SelfWrites::default())
        .manage(theme::ThemeWatcher::default())
        .manage(terminal::TerminalState::default())
        .setup(|app| {
            // The window is built here rather than listed in tauri.conf.json so it
            // can carry a navigation guard: the webview only ever shows the app. A
            // link in a note or a pack's README goes through the frontend's opener
            // (http, https, mailto only), never through the webview itself.
            let cfg = tauri::utils::config::WindowConfig {
                label: "main".into(),
                title: String::new(),
                width: 1280.0,
                height: 840.0,
                min_width: Some(800.0),
                min_height: Some(600.0),
                resizable: true,
                fullscreen: false,
                title_bar_style: tauri::TitleBarStyle::Overlay,
                drag_drop_enabled: false,
                ..Default::default()
            };
            let window = tauri::WebviewWindowBuilder::from_config(&*app, &cfg)?
                .on_navigation(|url| {
                    let host = url.host_str().unwrap_or("");
                    url.scheme() == "tauri" || url.scheme() == "about" || host == "localhost" || host == "tauri.localhost"
                })
                .build()?;
            #[cfg(target_os = "linux")]
            if is_tiling_desktop() {
                let _ = window.set_decorations(false);
            }
            let _ = window;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::vault::open_vault,
            commands::vault::create_vault_from_template,
            commands::vault::close_vault,
            commands::vault::get_vault_info,
            commands::recent::get_recent_vaults,
            commands::notes::list_notes,
            commands::notes::list_tags,
            commands::notes::read_note,
            commands::notes::resolve_ref,
            commands::notes::write_note,
            commands::notes::create_note,
            commands::notes::create_note_from_template,
            commands::notes::delete_note,
            commands::notes::search_notes,
            commands::notes::create_folder,
            commands::notes::delete_folder,
            commands::notes::rename_note,
            commands::notes::title_changed,
            commands::notes::resolve_note,
            commands::notes::duplicate_note,
            commands::notes::reveal_path,
            commands::notes::convert_note_to_database,
            commands::notes::convert_database_to_note,
            commands::notes::create_database_from_items,
            commands::notes::move_note,
            commands::notes::list_vault_dirs,
            commands::notes::save_asset,
            commands::notes::read_asset,
            commands::config::get_favorites,
            commands::config::set_favorites,
            commands::config::get_settings,
            commands::config::set_settings,
            commands::trash::list_trash,
            commands::trash::restore_trashed,
            commands::trash::delete_trashed,
            commands::trash::empty_trash,
            commands::notes::get_all_links,
            commands::notes::get_backlinks,
            commands::notes::list_templates,
            commands::notes::read_template,
            commands::git::git_status,
            commands::git::git_commit,
            commands::git::git_sync,
            commands::git::git_conflicts,
            commands::git::git_resolve_conflict,
            commands::git::git_complete_merge,
            commands::git::git_abort_merge,
            commands::git::git_log,
            commands::git::git_diff,
            commands::git::note_history,
            commands::git::note_authorship,
            commands::git::note_at,
            commands::git::restore_note,
            commands::git::list_agent_branches,
            commands::git::agent_branch_diff,
            commands::git::apply_agent_branch,
            commands::git::discard_agent_branch,
            commands::data::run_view,
            commands::data::run_chart,
            commands::data::set_cell,
            commands::data::add_row,
            commands::data::delete_row,
            commands::data::duplicate_row,
            commands::data::list_row_templates,
            commands::data::add_row_from_template,
            commands::data::save_row_as_template,
            commands::data::export_to_file,
            commands::data::list_collections,
            commands::data::parse_view_spec,
            commands::data::serialize_view_spec,
            commands::data::parse_view_doc,
            commands::data::serialize_view_doc,
            commands::schema::get_schema,
            commands::schema::get_schema_for_note,
            commands::schema::set_schema,
            commands::schema::upsert_property,
            commands::schema::rename_property,
            commands::schema::delete_property,
            commands::members::get_members,
            commands::members::set_members,
            commands::members::current_user,
            agents::detect_agents,
            commands::updates::update_config,
            commands::publish::publish_preview,
            commands::publish::publish_to_dir,
            commands::publish::publish_gh_pages,
            commands::publish::publish_write_github_action,
            commands::packs::packs_catalog,
            commands::packs::packs_show,
            commands::packs::packs_files,
            commands::packs::packs_install,
            commands::packs::packs_update,
            commands::packs::packs_remove,
            commands::packs::packs_export,
            commands::tracker::run_tracker,
            commands::tracker::tracker_toggle,
            commands::tracker::list_trackers,
            commands::import::import_csv_plan,
            commands::import::import_csv,
            commands::import::import_markdown,
            commands::import::import_notion,
            commands::trash::trash_collection,
            commands::data::ensure_row,
            theme::watch_theme_file,
            theme::detect_desktop_theme,
            terminal::terminal_spawn,
            terminal::terminal_write,
            terminal::terminal_resize,
            terminal::terminal_kill,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
