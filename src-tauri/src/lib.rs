mod commands;
mod host;

use std::sync::Arc;

use cortex_app::ctx::{AppCtx, AppDirs};
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

/// The commands this crate still defines itself: they need the Tauri runtime
/// (the updater's config) or this desktop session (the Wayland clipboard,
/// serving to devices). Every other command is `cortex_app::dispatch`, reached
/// through `host::route`.
fn desktop_only() -> impl Fn(tauri::ipc::Invoke<tauri::Wry>) -> bool + Send + Sync + 'static {
    tauri::generate_handler![
        commands::updates::update_config,
        commands::clipboard::read_clipboard,
        commands::serve::serve_status,
        commands::serve::serve_set,
        commands::serve::serve_new_token,
    ]
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
    let desktop_only = desktop_only();
    builder
        .manage(commands::serve::Serving::default())
        .setup(|app| {
            // One application context for every command, with this machine's
            // directories and the webview attached as an event sink.
            let dirs = AppDirs {
                config: app.path().app_config_dir().ok(),
                cache: app.path().app_cache_dir().ok(),
            };
            let ctx = AppCtx::new(dirs);
            ctx.add_emitter(Arc::new(host::TauriEmitter(app.handle().clone())));
            app.manage(ctx.clone());

            // The window is built here rather than listed in tauri.conf.json so it
            // can carry a navigation guard: the webview only ever shows the app. A
            // link in a note or a pack's README goes through the frontend's opener
            // (http, https, mailto only), never through the webview itself. The
            // one exception is a web-embed block's <iframe>: on WebKitGTK subframe
            // loads pass through this same guard, so the player URLs the embed
            // table hands out, and hosts the user loaded through a shield, are
            // let through (see cortex_app::commands::preview).
            let frames = ctx.frames.clone();
            let cfg = tauri::utils::config::WindowConfig {
                label: "main".into(),
                title: String::new(),
                width: 1280.0,
                height: 840.0,
                // Phone-width and up: below `compact` the shell rearranges itself
                // (lib/breakpoints.ts), so a narrow window is a layout, not a bug.
                min_width: Some(360.0),
                min_height: Some(480.0),
                resizable: true,
                fullscreen: false,
                title_bar_style: tauri::TitleBarStyle::Overlay,
                drag_drop_enabled: false,
                ..Default::default()
            };
            let window = tauri::WebviewWindowBuilder::from_config(&*app, &cfg)?
                .on_navigation(move |url| {
                    let host = url.host_str().unwrap_or("");
                    url.scheme() == "tauri"
                        || url.scheme() == "about"
                        || host == "localhost"
                        || host == "tauri.localhost"
                        || frames.allows(url.as_str())
                })
                .build()?;
            #[cfg(target_os = "linux")]
            if is_tiling_desktop() {
                let _ = window.set_decorations(false);
            }
            let _ = window;

            // Resume serving to devices if it was on (Settings → Serve to my devices).
            commands::serve::autostart(app.handle());
            Ok(())
        })
        .invoke_handler(move |invoke| match host::route(invoke) {
            Ok(()) => true,
            Err(invoke) => desktop_only(invoke),
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
