//! Settings → Serve to my devices: the desktop app as a Cortex server for this
//! machine's own devices, over Tailscale.
//!
//! The server shares the app's context, so there is still exactly one index
//! writer and one watcher, and it serves whichever vault is open. Its settings
//! live in the app's config directory (`serve.yaml`), never in the vault.

use std::sync::{Arc, Mutex};

use cortex_app::ctx::AppCtx;
use cortex_app::serve_config::{new_token, AuthMode, ServeConfig};
use cortex_app::server::{Assets, DirAssets, Server};
use cortex_app::tailscale::{self, TailscaleSelf};
use cortex_core::error::{AppError, Result};
use serde::Serialize;
use tauri::{AppHandle, Manager};

/// The running server, if serving is on.
#[derive(Default)]
pub struct Serving(pub Mutex<Option<Server>>);

#[derive(Debug, Serialize)]
pub struct ServeStatus {
    pub running: bool,
    /// Why the last change couldn't start serving (a port in use, …).
    pub error: Option<String>,
    pub local_url: String,
    pub tailscale: Option<TailscaleSelf>,
    /// The address a device opens once `tailscale serve` forwards to us.
    pub tailnet_url: Option<String>,
    /// The one command that puts the server on the tailnet.
    pub tailscale_command: String,
    /// A QR code of `tailnet_url`, as SVG.
    pub qr_svg: Option<String>,
    pub config: ServeConfig,
}

/// The app bundle as the webview has it: embedded in a release build.
struct AppAssets(AppHandle);

impl Assets for AppAssets {
    fn get(&self, path: &str) -> Option<Vec<u8>> {
        self.0.asset_resolver().get(path.to_string()).map(|a| a.bytes().to_vec())
    }
}

/// During development the webview loads from Vite, so nothing is embedded:
/// serve the last `npm run build` instead.
fn assets(app: &AppHandle) -> Arc<dyn Assets> {
    #[cfg(debug_assertions)]
    {
        let dist = std::path::PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/../dist"));
        if dist.join("index.html").is_file() {
            return Arc::new(DirAssets::new(dist));
        }
    }
    Arc::new(AppAssets(app.clone()))
}

fn ctx(app: &AppHandle) -> Arc<AppCtx> {
    app.state::<Arc<AppCtx>>().inner().clone()
}

fn qr_svg(text: &str) -> Option<String> {
    use qrcode::render::svg;
    let code = qrcode::QrCode::new(text.as_bytes()).ok()?;
    Some(code.render::<svg::Color>().min_dimensions(180, 180).quiet_zone(true).build())
}

/// Blocking: asks Tailscale about this machine.
fn status(app: &AppHandle, config: ServeConfig, error: Option<String>) -> ServeStatus {
    let port = {
        let serving = app.state::<Serving>();
        let guard = serving.0.lock().unwrap();
        guard.as_ref().map(|s| s.addr().port())
    };
    let running = port.is_some();
    let local_url = format!("http://127.0.0.1:{}", port.unwrap_or(config.port));
    let ts = tailscale::status();
    let tailnet_url = ts.as_ref().filter(|t| t.running).and_then(|t| t.url());
    ServeStatus {
        running,
        error,
        tailscale_command: format!("tailscale serve --bg {local_url}"),
        local_url,
        qr_svg: tailnet_url.as_deref().and_then(qr_svg),
        tailnet_url,
        tailscale: ts,
        config,
    }
}

async fn status_off_thread(app: AppHandle, config: ServeConfig, error: Option<String>) -> Result<ServeStatus> {
    tauri::async_runtime::spawn_blocking(move || status(&app, config, error))
        .await
        .map_err(|e| AppError::Other(format!("background task failed: {e}")))
}

/// Make the running server match `config`: start it, stop it, restart it on a
/// new port, or update who may connect in place.
async fn apply(app: &AppHandle, config: ServeConfig) -> Result<()> {
    let running_port = {
        let serving = app.state::<Serving>();
        let guard = serving.0.lock().unwrap();
        guard.as_ref().map(|s| s.addr().port())
    };
    match (config.enabled, running_port) {
        (false, None) => Ok(()),
        (false, Some(_)) => {
            *app.state::<Serving>().0.lock().unwrap() = None;
            Ok(())
        }
        (true, Some(port)) if port == config.port => {
            if let Some(server) = app.state::<Serving>().0.lock().unwrap().as_ref() {
                server.set_config(config);
            }
            Ok(())
        }
        (true, _) => {
            // Free the old port before binding the new one.
            *app.state::<Serving>().0.lock().unwrap() = None;
            let host_login = tauri::async_runtime::spawn_blocking(tailscale::status)
                .await
                .ok()
                .flatten()
                .and_then(|t| t.login);
            let server = Server::start(ctx(app), config, host_login, assets(app)).await?;
            *app.state::<Serving>().0.lock().unwrap() = Some(server);
            Ok(())
        }
    }
}

#[tauri::command]
pub async fn serve_status(app: AppHandle) -> Result<ServeStatus> {
    let config = ServeConfig::load(&ctx(&app).config_dir()?);
    status_off_thread(app, config, None).await
}

/// Save serve settings and apply them.
#[tauri::command]
pub async fn serve_set(app: AppHandle, config: ServeConfig) -> Result<ServeStatus> {
    let mut config = config;
    if config.auth == AuthMode::Token && config.token.is_empty() {
        config.token = new_token();
    }
    config.save(&ctx(&app).config_dir()?)?;
    let error = apply(&app, config.clone()).await.err().map(|e| e.to_string());
    status_off_thread(app, config, error).await
}

/// Replace the pairing code; devices paired with the old one must pair again.
#[tauri::command]
pub async fn serve_new_token(app: AppHandle) -> Result<ServeStatus> {
    let mut config = ServeConfig::load(&ctx(&app).config_dir()?);
    config.token = new_token();
    serve_set(app, config).await
}

/// On launch: resume serving if it was on.
pub fn autostart(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let Ok(dir) = ctx(&app).config_dir() else { return };
        let config = ServeConfig::load(&dir);
        if config.enabled {
            let _ = apply(&app, config).await;
        }
    });
}
