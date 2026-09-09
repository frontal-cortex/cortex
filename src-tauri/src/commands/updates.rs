//! Auto-update: what this build knows about where updates come from.
//!
//! The updater itself is `tauri-plugin-updater`, driven from the frontend
//! (`src/lib/updater.ts`); the plugin reads its endpoint and public key from
//! `plugins.updater` in `tauri.conf.json`. This command exposes that config so
//! the UI can say "this build has no update channel" instead of letting a
//! check fail on an empty endpoint list or an unsigned placeholder key — a
//! development build behaves exactly as before.

use serde::Serialize;
use tauri::AppHandle;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct UpdateConfig {
    /// The running app's version (`tauri.conf.json` → `version`).
    pub current_version: String,
    /// The first update endpoint, if any; shown to the user so the source is
    /// never a mystery.
    pub endpoint: Option<String>,
    /// True when an endpoint and a non-placeholder public key are both set,
    /// i.e. a check can actually succeed and a download can be verified.
    pub configured: bool,
}

/// Read `plugins.updater` out of the compiled-in Tauri config.
pub fn from_plugin_config(version: &str, updater: Option<&serde_json::Value>) -> UpdateConfig {
    let endpoint = updater
        .and_then(|u| u.get("endpoints"))
        .and_then(|e| e.as_array())
        .and_then(|e| e.first())
        .and_then(|e| e.as_str())
        .filter(|s| !s.trim().is_empty())
        .map(str::to_string);
    let pubkey = updater
        .and_then(|u| u.get("pubkey"))
        .and_then(|p| p.as_str())
        .map(str::trim)
        .unwrap_or("");
    UpdateConfig {
        current_version: version.to_string(),
        configured: endpoint.is_some() && !pubkey.is_empty(),
        endpoint,
    }
}

#[tauri::command]
pub fn update_config(app: AppHandle) -> UpdateConfig {
    let config = app.config();
    let version = config.version.clone().unwrap_or_default();
    from_plugin_config(&version, config.plugins.0.get("updater"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn no_plugin_block_means_unconfigured() {
        let c = from_plugin_config("0.1.0", None);
        assert_eq!(c, UpdateConfig { current_version: "0.1.0".into(), endpoint: None, configured: false });
    }

    #[test]
    fn placeholder_pubkey_is_unconfigured_but_reports_endpoint() {
        let cfg = json!({ "endpoints": ["https://example.com/latest.json"], "pubkey": "" });
        let c = from_plugin_config("0.1.0", Some(&cfg));
        assert_eq!(c.endpoint.as_deref(), Some("https://example.com/latest.json"));
        assert!(!c.configured);
    }

    #[test]
    fn endpoint_and_key_are_configured() {
        let cfg = json!({ "endpoints": ["https://example.com/latest.json"], "pubkey": "dW50cnVzdGVkIGNvbW1lbnQ6" });
        assert!(from_plugin_config("0.2.0", Some(&cfg)).configured);
    }

    #[test]
    fn key_without_endpoint_is_unconfigured() {
        let cfg = json!({ "endpoints": [], "pubkey": "dW50cnVzdGVkIGNvbW1lbnQ6" });
        let c = from_plugin_config("0.2.0", Some(&cfg));
        assert!(c.endpoint.is_none());
        assert!(!c.configured);
    }
}
