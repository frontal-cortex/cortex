//! Bookmark cards and web embeds: thin wrappers over `cortex_core::preview`
//! and `cortex_core::embed`, plus the one piece of state the webview's
//! navigation guard needs — which hosts the user has chosen to load in a
//! frame through an embed's click-to-load shield.

use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::State;

use crate::commands::vault::VaultState;
use cortex_core::embed::{self, Embed};
use cortex_core::error::{AppError, Result};
use cortex_core::preview::{self, LinkPreview};

/// Hosts a generic (`web`) embed may load in a subframe, armed by the user
/// clicking "Load" on the shield. On WebKitGTK every subframe navigation
/// passes through the window's navigation guard, so without this the frame
/// would stay blank. Session-only; nothing is stored.
#[derive(Debug, Default, Clone)]
pub struct EmbedFrames(pub Arc<Mutex<HashSet<String>>>);

impl EmbedFrames {
    /// Whether `url` may load in a subframe: a player URL the embed table
    /// hands out, or a host the user armed.
    pub fn allows(&self, url: &str) -> bool {
        if embed::is_frame_url(url) {
            return true;
        }
        let host = embed::domain(url);
        !host.is_empty() && url.starts_with("https://") && self.0.lock().unwrap().contains(&host)
    }
}

fn vault_path(state: &State<'_, VaultState>) -> Result<PathBuf> {
    state.0.lock().unwrap().clone().ok_or(AppError::NoVault)
}

/// The card data for a bookmark: cached in `.brain/previews/`, fetched once
/// when missing (`refresh` refetches). Runs off the main thread — it is a
/// network call with a timeout.
#[tauri::command(async)]
pub fn fetch_link_preview(url: String, refresh: bool, state: State<'_, VaultState>) -> Result<LinkPreview> {
    let root = vault_path(&state)?;
    preview::fetch(&root, &url, refresh)
}

/// What the editor should render for an embed URL (`None`: keep it a link).
#[tauri::command]
pub fn resolve_embed(url: String) -> Option<Embed> {
    embed::resolve(&url)
}

/// The user clicked through a generic embed's shield: let its host load in
/// a frame for the rest of this session.
#[tauri::command]
pub fn allow_embed_frame(url: String, frames: State<'_, EmbedFrames>) -> Result<()> {
    if embed::resolve(&url).is_none() {
        return Err(AppError::Other(format!("not an embeddable link: {url}")));
    }
    let host = embed::domain(&url);
    if !host.is_empty() {
        frames.0.lock().unwrap().insert(host);
    }
    Ok(())
}
