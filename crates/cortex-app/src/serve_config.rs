//! How this machine serves Cortex to its own devices.
//!
//! These settings live in the app's config directory (`serve.yaml` beside the
//! recent-vaults list), never in the vault: `.cortex/settings.yaml` is committed
//! and syncs to every clone, and a vault synced to two machines must not make
//! both of them serve — nor carry a pairing token into a repository.

use std::path::Path;

use serde::{Deserialize, Serialize};

use cortex_core::error::Result;

const FILE: &str = "serve.yaml";

/// Who may use the served app.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum AuthMode {
    /// Requests must come through `tailscale serve` from an allowed login.
    #[default]
    Tailscale,
    /// Requests must carry the pairing token. For a network without Tailscale,
    /// or trying the server on this machine.
    Token,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct ServeConfig {
    /// Start serving whenever the desktop app opens a vault.
    pub enabled: bool,
    /// Port on 127.0.0.1. `tailscale serve` forwards HTTPS to it.
    pub port: u16,
    pub auth: AuthMode,
    /// Tailscale logins allowed in. Empty means this machine's own login.
    pub allow: Vec<String>,
    /// Pairing token. With `auth: tailscale` it is a second check when set;
    /// with `auth: token` it is required.
    pub token: String,
    /// Let served devices use the terminal — a shell on this machine.
    pub terminal: bool,
}

pub const DEFAULT_PORT: u16 = 4870;

impl Default for ServeConfig {
    fn default() -> Self {
        ServeConfig {
            enabled: false,
            port: DEFAULT_PORT,
            auth: AuthMode::Tailscale,
            allow: Vec::new(),
            token: String::new(),
            terminal: false,
        }
    }
}

impl ServeConfig {
    /// The settings in `config_dir`, or the defaults. A malformed file is
    /// treated as absent rather than refusing to start.
    pub fn load(config_dir: &Path) -> ServeConfig {
        std::fs::read_to_string(config_dir.join(FILE))
            .ok()
            .and_then(|text| serde_yaml::from_str(&text).ok())
            .unwrap_or_default()
    }

    pub fn save(&self, config_dir: &Path) -> Result<()> {
        std::fs::create_dir_all(config_dir)?;
        let text = serde_yaml::to_string(self)?;
        let path = config_dir.join(FILE);
        std::fs::write(&path, text)?;
        restrict(&path);
        Ok(())
    }
}

/// The file can hold a token: readable by this user only.
#[cfg(unix)]
fn restrict(path: &Path) {
    use std::os::unix::fs::PermissionsExt;
    let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
}

#[cfg(not(unix))]
fn restrict(_path: &Path) {}

/// A new pairing token: 24 random bytes as lowercase hex, from the operating
/// system's generator.
pub fn new_token() -> String {
    let mut bytes = [0u8; 24];
    fill_random(&mut bytes);
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

#[cfg(unix)]
fn fill_random(buf: &mut [u8]) {
    use std::io::Read;
    if std::fs::File::open("/dev/urandom").and_then(|mut f| f.read_exact(buf)).is_ok() {
        return;
    }
    fill_from_hasher(buf);
}

#[cfg(not(unix))]
fn fill_random(buf: &mut [u8]) {
    fill_from_hasher(buf);
}

/// Standard library hashers are keyed from the operating system's random
/// source per process; hashing a counter through fresh ones yields
/// unpredictable bytes without another dependency.
fn fill_from_hasher(buf: &mut [u8]) {
    use std::collections::hash_map::RandomState;
    use std::hash::{BuildHasher, Hasher};
    for (i, chunk) in buf.chunks_mut(8).enumerate() {
        let mut h = RandomState::new().build_hasher();
        h.write_usize(i);
        h.write_u128(std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0));
        let v = h.finish().to_le_bytes();
        chunk.copy_from_slice(&v[..chunk.len()]);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn settings_round_trip_and_default_when_missing() {
        let dir = std::env::temp_dir().join(format!("cortex-serve-config-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        assert_eq!(ServeConfig::load(&dir), ServeConfig::default());
        let cfg = ServeConfig { enabled: true, allow: vec!["you@example.com".into()], token: new_token(), ..Default::default() };
        cfg.save(&dir).unwrap();
        assert_eq!(ServeConfig::load(&dir), cfg);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn tokens_are_long_and_different() {
        let a = new_token();
        let b = new_token();
        assert_eq!(a.len(), 48);
        assert!(a.chars().all(|c| c.is_ascii_hexdigit()));
        assert_ne!(a, b);
    }
}
