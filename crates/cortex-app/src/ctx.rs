//! The one context every command runs against.
//!
//! What the desktop app used to keep as seven separately managed Tauri states
//! — the open vault, its index, the watcher, the app's own-write hashes, the
//! palette follower, the terminal sessions and the embed allow-list — lives
//! here together, with the directories and the event emitters a host supplies
//! and the vault's writer lock.

use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, RwLock};

use serde::Serialize;

use cortex_core::error::{AppError, Result};

use crate::commands::preview::EmbedFrames;
use crate::commands::vault::{DbState, VaultState};
use crate::emit::Emitter;
use crate::lock::WriterLock;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
use crate::terminal::TerminalState;
use crate::theme::ThemeWatcher;
use crate::watcher::{SelfWrites, WatcherState};

/// Where per-machine files go: the recent-vaults list, the pack cache, serve
/// settings. Never inside a vault.
#[derive(Debug, Clone, Default)]
pub struct AppDirs {
    pub config: Option<PathBuf>,
    pub cache: Option<PathBuf>,
}

impl AppDirs {
    /// The directories Tauri uses for an app `identifier`, resolved without
    /// Tauri, so `cortex serve` reads and writes the same files the desktop
    /// app does.
    pub fn for_identifier(identifier: &str) -> Self {
        AppDirs {
            config: dirs::config_dir().map(|d| d.join(identifier)),
            cache: dirs::cache_dir().map(|d| d.join(identifier)),
        }
    }
}

/// The desktop app's identifier (`tauri.conf.json`), shared by `cortex serve`.
pub const APP_IDENTIFIER: &str = "com.cortex.app";

pub struct AppCtx {
    pub vault: VaultState,
    pub db: DbState,
    pub watcher: WatcherState,
    pub self_writes: SelfWrites,
    pub theme: ThemeWatcher,
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    pub terminal: TerminalState,
    pub frames: EmbedFrames,
    pub dirs: AppDirs,
    /// Held while a vault is open, so a second host refuses it (`crate::lock`).
    pub writer: Mutex<Option<WriterLock>>,
    /// What this process is, for another host's refusal message.
    host_kind: RwLock<String>,
    emitters: RwLock<Vec<(u64, Arc<dyn Emitter>)>>,
    next_emitter: AtomicU64,
}

impl AppCtx {
    pub fn new(dirs: AppDirs) -> Arc<Self> {
        Arc::new(AppCtx {
            vault: VaultState::default(),
            db: DbState::default(),
            watcher: WatcherState::default(),
            self_writes: SelfWrites::default(),
            theme: ThemeWatcher::default(),
            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            terminal: TerminalState::default(),
            frames: EmbedFrames::default(),
            dirs,
            writer: Mutex::new(None),
            host_kind: RwLock::new("the desktop app".into()),
            emitters: RwLock::new(Vec::new()),
            next_emitter: AtomicU64::new(1),
        })
    }

    /// The open vault's root, or `NoVault`.
    pub fn vault_path(&self) -> Result<PathBuf> {
        self.vault.0.lock().unwrap().clone().ok_or(AppError::NoVault)
    }

    /// What this process is called when it holds a vault: "the desktop app",
    /// "cortex serve".
    pub fn host_kind(&self) -> String {
        self.host_kind.read().unwrap().clone()
    }

    pub fn set_host_kind(&self, kind: &str) {
        *self.host_kind.write().unwrap() = kind.to_string();
    }

    /// The per-machine config directory, created on first use.
    pub fn config_dir(&self) -> Result<PathBuf> {
        let dir = self
            .dirs
            .config
            .clone()
            .ok_or_else(|| AppError::Other("this machine has no config directory".into()))?;
        std::fs::create_dir_all(&dir)?;
        Ok(dir)
    }

    /// The per-machine cache directory (not created here).
    pub fn cache_dir(&self) -> Result<PathBuf> {
        self.dirs
            .cache
            .clone()
            .ok_or_else(|| AppError::Other("this machine has no cache directory".into()))
    }

    /// Send an event to every attached host: the desktop webview, and the
    /// event stream of a running server.
    pub fn emit<T: Serialize>(&self, event: &str, payload: T) {
        let Ok(value) = serde_json::to_value(payload) else { return };
        for (_, emitter) in self.emitters.read().unwrap().iter() {
            emitter.emit(event, &value);
        }
    }

    /// Attach an emitter; the id detaches it again.
    pub fn add_emitter(&self, emitter: Arc<dyn Emitter>) -> u64 {
        let id = self.next_emitter.fetch_add(1, Ordering::Relaxed);
        self.emitters.write().unwrap().push((id, emitter));
        id
    }

    pub fn remove_emitter(&self, id: u64) {
        self.emitters.write().unwrap().retain(|(i, _)| *i != id);
    }
}
