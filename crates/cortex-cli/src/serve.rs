//! `cortex serve` — the vault as an installed web app for your own devices.
//!
//! Opens the vault the way the desktop app does (index, watcher, writer lock),
//! then serves the app bundle and every command on 127.0.0.1 until Ctrl-C.
//! `tailscale serve` puts it on the tailnet; see docs/SERVE.md.

use std::path::PathBuf;
use std::sync::Arc;

use cortex_app::ctx::{AppCtx, AppDirs, APP_IDENTIFIER};
use cortex_app::serve_config::{new_token, AuthMode, ServeConfig};
use cortex_app::server::{DirAssets, Server};
use cortex_app::tailscale;
use cortex_core::error::AppError;

use crate::ops::Vault;

pub struct ServeArgs {
    pub port: Option<u16>,
    pub dist: Option<PathBuf>,
    /// Sign devices in with a pairing code instead of their Tailscale login.
    pub token: bool,
    pub allow: Vec<String>,
    pub terminal: bool,
}

/// The built frontend: `--dist`, `$CORTEX_DIST`, or the repository's own
/// `dist/` when running from a checkout.
fn find_dist(explicit: Option<PathBuf>) -> Option<PathBuf> {
    explicit
        .into_iter()
        .chain(std::env::var_os("CORTEX_DIST").map(PathBuf::from))
        .chain(std::iter::once(PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/../../dist"))))
        .find(|d| d.join("index.html").is_file())
}

pub async fn serve(vault: Vault, args: ServeArgs) -> crate::ops::Result<()> {
    let Some(dist) = find_dist(args.dist) else {
        return Err(AppError::Other(
            "The app bundle wasn't found. Build the frontend first (npm run build), or pass --dist <dir>.".into(),
        )
        .into());
    };

    let ctx = AppCtx::new(AppDirs::for_identifier(APP_IDENTIFIER));
    ctx.set_host_kind("cortex serve");
    let root = vault.root.to_string_lossy().into_owned();
    let info = {
        let ctx = ctx.clone();
        tokio::task::spawn_blocking(move || cortex_app::commands::vault::open_vault(&ctx, root))
            .await
            .map_err(|e| AppError::Other(format!("opening the vault failed: {e}")))??
    };

    let config_dir = ctx.config_dir()?;
    let mut config = ServeConfig::load(&config_dir);
    if let Some(port) = args.port {
        config.port = port;
    }
    if args.token {
        config.auth = AuthMode::Token;
    }
    if !args.allow.is_empty() {
        config.allow = args.allow;
    }
    if args.terminal {
        config.terminal = true;
    }
    if config.auth == AuthMode::Token && config.token.is_empty() {
        config.token = new_token();
        config.save(&config_dir)?;
    }

    let me = tokio::task::spawn_blocking(tailscale::status).await.ok().flatten();
    let host_login = me.as_ref().and_then(|t| t.login.clone());
    let server = Server::start(ctx.clone(), config.clone(), host_login.clone(), Arc::new(DirAssets::new(&dist))).await?;
    let local = format!("http://127.0.0.1:{}", server.addr().port());

    println!("Serving {} at {local}", info.name);
    println!("  app bundle  {}", dist.display());
    match config.auth {
        AuthMode::Tailscale => {
            let who = if config.allow.is_empty() {
                host_login.clone().map(|l| format!("{l} (this machine's Tailscale login)"))
            } else {
                Some(config.allow.join(", "))
            };
            match who {
                Some(who) => println!("  signs in    {who}"),
                None => println!("  signs in    nobody yet — Tailscale reports no login here; pass --allow <login> or --token"),
            }
            if !config.token.is_empty() {
                println!("  pairing     {}", config.token);
            }
        }
        AuthMode::Token => println!("  pairing     {}", config.token),
    }
    println!("  terminal    {}", if config.terminal { "on — served devices can run a shell here" } else { "off" });
    println!();
    match me.as_ref().filter(|t| t.running) {
        Some(t) => {
            println!("On your tailnet:");
            println!("  tailscale serve --bg {local}");
            if let Some(url) = t.url() {
                println!("  then open {url} on your phone and add it to the home screen.");
            }
            if !t.https {
                println!("  (turn on HTTPS certificates in the Tailscale admin console first: installing needs HTTPS.)");
            }
        }
        None => println!("Tailscale isn't running here. Start it, or use --token to pair devices on another network."),
    }
    println!("\nPress Ctrl-C to stop.");

    let _ = tokio::signal::ctrl_c().await;
    drop(server);
    let _ = cortex_app::commands::vault::close_vault(&ctx);
    println!("Stopped.");
    Ok(())
}
