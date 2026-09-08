//! Vault settings — `.cortex/settings.yaml`, committed and human-readable.
//! Every field has a default so a missing key (or file) is never an error.
//!
//! The file is the one place all configuration lives, for people and agents
//! alike: the app writes every key (with its default) on first open so the
//! full schema is always visible, `describe()` documents each key in one
//! line, and `set_field()` applies a typed `key=value` edit — the same path
//! `cortex settings set` and the MCP `set_settings` tool use. The app watches
//! `.cortex/` and reloads on any change, so edits made here take effect live.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::Path;

use crate::error::{AppError, Result};

/// App settings, stored at `.cortex/settings.yaml`. Every field has a default so
/// a missing key (or a missing file) is never an error — the vault stays usable.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Settings {
    #[serde(default)]
    pub auto_commit: bool,
    #[serde(default = "default_note_type")]
    pub default_note_type: String,
    #[serde(default = "default_journal_template")]
    pub journal_template: String,
    /// "light" | "dark" | "system"
    #[serde(default = "default_theme")]
    pub theme: String,
    /// Days before trashed notes are auto-pruned. 0 = never.
    #[serde(default = "default_trash_retention")]
    pub trash_retention_days: u32,
    /// Minutes between automatic syncs (plus on-launch and on-focus). 0 = off.
    #[serde(default)]
    pub auto_sync_minutes: u32,
    /// Yjs websocket relay for presence + real-time co-editing (e.g.
    /// `ws://office-server:1234`). Empty = collaboration features off.
    #[serde(default)]
    pub collab_url: String,
    /// Palette file to follow — Omarchy's `colors.toml` shape (see theme.rs).
    /// `~` is expanded per machine; a missing file silently falls back to
    /// `theme`, so the setting can be committed with the vault.
    #[serde(default)]
    pub theme_file: String,
    /// The action colour: empty = the theme's own accent; a palette colour name
    /// (blue, green, yellow, orange, red, magenta, cyan, brown) picks that colour
    /// from the followed palette (or the matching tag colour without one); a hex
    /// value sets it outright. For desktops whose accent fights the rest.
    #[serde(default)]
    pub accent: String,
    /// Page (editor/viewer) typeface: a preset key — `ysabeau` (default),
    /// `quattro`, `duo`, `recursive`, `alegreya`, `fraunces`, `crimson`,
    /// `serif`, `system`, `mono` — or any CSS font-family name.
    /// Empty = the default. Chrome fonts are not affected.
    #[serde(default)]
    pub prose_font: String,
    /// Page tilt: "" (upright), a small number of degrees ("4", "8" — a true
    /// slant on variable fonts, the italic face otherwise), or "italic".
    #[serde(default)]
    pub prose_slant: String,
    /// Keyboard shortcut overrides: shortcut id → keys, e.g.
    /// `toggle-sidebar: mod+shift+b`. Ids and defaults live in the app's
    /// keymap (src/lib/keymap.ts); `mod` is ⌘ on macOS, Ctrl elsewhere.
    #[serde(default)]
    pub keybindings: BTreeMap<String, String>,
    /// Command to run inside the terminal pane when it opens — an agent CLI
    /// such as `claude`, `hermes` or `openclaw`. Empty = a plain shell.
    #[serde(default)]
    pub terminal_command: String,
    /// Title of the published site (see `publish`). Empty = the vault's folder name.
    #[serde(default)]
    pub site_title: String,
    /// Note shown on the published site's front page above the list of
    /// notes, e.g. `notes/about.md`. It must itself be published. Empty = list only.
    #[serde(default)]
    pub site_home: String,
    /// Marketplace index URL. Empty = the official index; a company points this at its own.
    #[serde(default)]
    pub marketplace_url: String,
    /// Additional index URLs, comma- or space-separated, merged with the first.
    #[serde(default)]
    pub marketplace_extra: String,
    /// Trust tiers shown: any of official, verified, community. Empty = all.
    #[serde(default)]
    pub marketplace_tiers: String,
}

fn default_note_type() -> String { "note".into() }
fn default_journal_template() -> String { "daily.md".into() }
fn default_theme() -> String { "system".into() }
fn default_trash_retention() -> u32 { 30 }

impl Default for Settings {
    fn default() -> Self {
        Settings {
            auto_commit: true,
            default_note_type: default_note_type(),
            journal_template: default_journal_template(),
            theme: default_theme(),
            trash_retention_days: default_trash_retention(),
            auto_sync_minutes: 0,
            collab_url: String::new(),
            theme_file: String::new(),
            accent: String::new(),
            prose_font: String::new(),
            prose_slant: String::new(),
            keybindings: BTreeMap::new(),
            terminal_command: String::new(),
            site_title: String::new(),
            site_home: String::new(),
            marketplace_url: String::new(),
            marketplace_extra: String::new(),
            marketplace_tiers: String::new(),
        }
    }
}

/// Every settings key with a one-line description (allowed values and the
/// default). Kept beside the struct — a test checks the list matches the
/// serialised field names exactly, so a new field can't be forgotten here.
pub fn describe() -> Vec<(&'static str, &'static str)> {
    vec![
        ("auto_commit", "Commit after every note save, debounced so a burst of edits is one commit. true | false (default true)."),
        ("default_note_type", "Frontmatter `type` pre-filled on new notes (default note)."),
        ("journal_template", "Template under templates/ used for Today / daily notes (default daily.md)."),
        ("theme", "Colour scheme: light | dark | system (default system)."),
        ("trash_retention_days", "Days before trashed notes are pruned; 0 = never (default 30)."),
        ("auto_sync_minutes", "Minutes between automatic git syncs, plus on launch/focus; 0 = off (default 0)."),
        ("collab_url", "Yjs websocket relay for presence and co-editing, e.g. ws://host:1234; empty = off (default empty)."),
        ("theme_file", "Palette file to follow (Omarchy colors.toml shape, `~` expands); empty = use `theme` (default empty)."),
        ("accent", "Action colour: empty = the theme's accent; a palette colour name (blue green yellow orange red magenta cyan brown) or a #hex (default empty)."),
        ("prose_font", "Page typeface: ysabeau | quattro | duo | recursive | alegreya | fraunces | crimson | serif | system | mono | any font-family; empty = ysabeau (default empty)."),
        ("prose_slant", "Page tilt: empty (upright) | degrees such as 4 or 8 | italic (default empty)."),
        ("keybindings", "Shortcut overrides, id -> keys (e.g. toggle-sidebar: mod+shift+b); set one with keybindings.<id>=<keys>, empty value removes it (default {})."),
        ("terminal_command", "Command run when the terminal pane opens — an agent CLI such as claude, hermes, openclaw; empty = plain shell (default empty). See `cortex agents`."),
        ("site_title", "Title of the published site (`cortex publish`); empty = the vault folder's name (default empty)."),
        ("site_home", "Published note shown on the site's front page above the list, e.g. notes/about.md; empty = list only (default empty)."),
        ("marketplace_url", "Template marketplace index URL; empty = the official one. Point it at a company registry to use your own packs (default empty)."),
        ("marketplace_extra", "Additional marketplace index URLs, comma-separated, merged with the first (default empty)."),
        ("marketplace_tiers", "Trust tiers shown in the marketplace: official, verified, community (comma-separated); empty = all (default empty)."),
    ]
}

/// The settings as a YAML mapping, for `get`-style lookups. Field order is
/// the struct's, which is also the order of the file on disk.
pub fn to_value(settings: &Settings) -> Result<serde_yaml::Value> {
    Ok(serde_yaml::to_value(settings)?)
}

/// Read one key. `keybindings.<id>` reaches into the map; an unset binding
/// is `null` rather than an error, since "not overridden" is a valid answer.
pub fn get_field(settings: &Settings, key: &str) -> Result<serde_yaml::Value> {
    if let Some(id) = key.strip_prefix("keybindings.") {
        return Ok(match settings.keybindings.get(id) {
            Some(keys) => serde_yaml::Value::String(keys.clone()),
            None => serde_yaml::Value::Null,
        });
    }
    let map = to_value(settings)?;
    map.get(key).cloned().ok_or_else(|| unknown_key(key))
}

/// Apply one `key=value` edit, parsing `raw` for the field's type: `true` /
/// `false` for flags, an integer for counts, YAML for the keybindings map
/// (`{toggle-sidebar: mod+shift+b}`) or a single `keybindings.<id>` entry
/// (empty value removes the override). Strings are taken as written, minus
/// YAML quoting, so `theme_file=""` clears a path and `prose_slant=4` works.
/// Unknown keys are rejected with the list of valid ones.
pub fn set_field(settings: &mut Settings, key: &str, raw: &str) -> Result<()> {
    if let Some(id) = key.strip_prefix("keybindings.") {
        let id = id.trim();
        if id.is_empty() {
            return Err(AppError::Other("keybindings.<id> needs a shortcut id".into()));
        }
        let keys = parse_string(raw);
        if keys.is_empty() {
            settings.keybindings.remove(id);
        } else {
            settings.keybindings.insert(id.to_string(), keys);
        }
        return Ok(());
    }
    match key {
        "auto_commit" => settings.auto_commit = parse_bool(key, raw)?,
        "default_note_type" => settings.default_note_type = parse_string(raw),
        "journal_template" => settings.journal_template = parse_string(raw),
        "theme" => {
            let v = parse_string(raw);
            if !matches!(v.as_str(), "light" | "dark" | "system") {
                return Err(AppError::Other(format!("theme must be light, dark or system, got '{v}'")));
            }
            settings.theme = v;
        }
        "trash_retention_days" => settings.trash_retention_days = parse_u32(key, raw)?,
        "auto_sync_minutes" => settings.auto_sync_minutes = parse_u32(key, raw)?,
        "collab_url" => settings.collab_url = parse_string(raw),
        "theme_file" => settings.theme_file = parse_string(raw),
        "accent" => {
            let v = parse_string(raw).trim().to_lowercase();
            let named = ["blue", "green", "yellow", "orange", "red", "magenta", "cyan", "brown", "purple", "pink"];
            let hex = v.starts_with('#') && (v.len() == 7 || v.len() == 4) && v[1..].chars().all(|c| c.is_ascii_hexdigit());
            if !(v.is_empty() || named.contains(&v.as_str()) || hex) {
                return Err(AppError::Other(format!("accent must be empty, a palette colour name, or a #hex, got '{v}'")));
            }
            settings.accent = v;
        }
        "prose_font" => settings.prose_font = parse_string(raw),
        "prose_slant" => settings.prose_slant = parse_string(raw),
        "keybindings" => {
            settings.keybindings = if raw.trim().is_empty() {
                BTreeMap::new()
            } else {
                serde_yaml::from_str(raw).map_err(|e| {
                    AppError::Other(format!("keybindings must be a YAML map of id: keys ({e})"))
                })?
            };
        }
        "terminal_command" => settings.terminal_command = parse_string(raw),
        "site_title" => settings.site_title = parse_string(raw),
        "site_home" => settings.site_home = parse_string(raw),
        "marketplace_url" => settings.marketplace_url = parse_string(raw),
        "marketplace_extra" => settings.marketplace_extra = parse_string(raw),
        "marketplace_tiers" => settings.marketplace_tiers = parse_string(raw),
        _ => return Err(unknown_key(key)),
    }
    Ok(())
}

fn unknown_key(key: &str) -> AppError {
    let valid: Vec<&str> = describe().into_iter().map(|(k, _)| k).collect();
    AppError::Other(format!("unknown setting '{key}'; valid keys: {}", valid.join(", ")))
}

/// A string as the user meant it: YAML quoting stripped (`""` → empty,
/// `'a b'` → `a b`), `null`/`~` → empty, anything else verbatim.
fn parse_string(raw: &str) -> String {
    match serde_yaml::from_str::<serde_yaml::Value>(raw) {
        Ok(serde_yaml::Value::String(s)) => s,
        Ok(serde_yaml::Value::Null) => String::new(),
        _ => raw.trim().to_string(),
    }
}

fn parse_bool(key: &str, raw: &str) -> Result<bool> {
    match raw.trim() {
        "true" | "yes" | "on" | "1" => Ok(true),
        "false" | "no" | "off" | "0" => Ok(false),
        other => Err(AppError::Other(format!("{key} must be true or false, got '{other}'"))),
    }
}

fn parse_u32(key: &str, raw: &str) -> Result<u32> {
    raw.trim()
        .parse()
        .map_err(|_| AppError::Other(format!("{key} must be a whole number, got '{}'", raw.trim())))
}

pub fn load(root: &Path) -> Result<Settings> {
    let path = root.join(".cortex").join("settings.yaml");
    if !path.exists() {
        return Ok(Settings::default());
    }
    let content = std::fs::read_to_string(&path)?;
    // Tolerate a malformed/partial file rather than blocking the whole app.
    Ok(serde_yaml::from_str(&content).unwrap_or_default())
}

pub fn save(root: &Path, settings: &Settings) -> Result<()> {
    let dir = root.join(".cortex");
    std::fs::create_dir_all(&dir)?;
    std::fs::write(dir.join("settings.yaml"), serde_yaml::to_string(settings)?)?;
    Ok(())
}

/// Make sure the file on disk spells out every key, so an agent reading it
/// sees the whole schema rather than an empty file or a partial one from an
/// older version. A missing file gets the defaults; a parseable file missing
/// keys is rewritten with them filled in; a malformed file is left alone
/// (`load` tolerates it, and clobbering it would lose whatever the user meant).
pub fn ensure_complete(root: &Path) -> Result<Settings> {
    let path = root.join(".cortex").join("settings.yaml");
    if !path.exists() {
        let defaults = Settings::default();
        save(root, &defaults)?;
        return Ok(defaults);
    }
    let content = std::fs::read_to_string(&path)?;
    let Ok(settings) = serde_yaml::from_str::<Settings>(&content) else {
        return Ok(Settings::default());
    };
    let present: Option<serde_yaml::Mapping> = serde_yaml::from_str(&content).ok();
    let missing = present.map_or(true, |m| {
        describe().iter().any(|(k, _)| !m.contains_key(serde_yaml::Value::String((*k).into())))
    });
    if missing {
        save(root, &settings)?;
    }
    Ok(settings)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// `describe()` must name exactly the serialised fields, in order — the
    /// guard that keeps the docs, the CLI and the struct from drifting apart.
    #[test]
    fn describe_matches_struct() {
        let map = to_value(&Settings::default()).unwrap();
        let fields: Vec<String> = map
            .as_mapping()
            .unwrap()
            .keys()
            .map(|k| k.as_str().unwrap().to_string())
            .collect();
        let described: Vec<String> = describe().into_iter().map(|(k, _)| k.to_string()).collect();
        assert_eq!(fields, described);
    }

    #[test]
    fn set_field_types_values() {
        let mut s = Settings::default();
        set_field(&mut s, "auto_commit", "true").unwrap();
        set_field(&mut s, "trash_retention_days", "7").unwrap();
        set_field(&mut s, "theme", "dark").unwrap();
        set_field(&mut s, "prose_slant", "4").unwrap();
        set_field(&mut s, "theme_file", "\"\"").unwrap();
        set_field(&mut s, "terminal_command", "claude").unwrap();
        set_field(&mut s, "keybindings.toggle-sidebar", "mod+shift+b").unwrap();
        assert!(s.auto_commit);
        assert_eq!(s.trash_retention_days, 7);
        assert_eq!(s.theme, "dark");
        assert_eq!(s.prose_slant, "4");
        assert_eq!(s.theme_file, "");
        assert_eq!(s.terminal_command, "claude");
        assert_eq!(s.keybindings["toggle-sidebar"], "mod+shift+b");

        set_field(&mut s, "keybindings.toggle-sidebar", "").unwrap();
        assert!(s.keybindings.is_empty());
        set_field(&mut s, "keybindings", "{quick-switcher: mod+p, toggle-terminal: mod+l}").unwrap();
        assert_eq!(s.keybindings.len(), 2);
        set_field(&mut s, "keybindings", "").unwrap();
        assert!(s.keybindings.is_empty());

        assert!(set_field(&mut s, "theme", "sepia").is_err());
        assert!(set_field(&mut s, "auto_commit", "maybe").is_err());
        assert!(set_field(&mut s, "auto_sync_minutes", "soon").is_err());
        let err = set_field(&mut s, "nope", "1").unwrap_err().to_string();
        assert!(err.contains("auto_commit") && err.contains("terminal_command"));
    }

    #[test]
    fn get_field_reads_bindings() {
        let mut s = Settings::default();
        set_field(&mut s, "keybindings.toggle-sidebar", "mod+shift+b").unwrap();
        assert_eq!(get_field(&s, "keybindings.toggle-sidebar").unwrap(), serde_yaml::Value::String("mod+shift+b".into()));
        assert_eq!(get_field(&s, "keybindings.other").unwrap(), serde_yaml::Value::Null);
        assert_eq!(get_field(&s, "trash_retention_days").unwrap(), serde_yaml::Value::Number(30.into()));
        assert!(get_field(&s, "nope").is_err());
    }

    #[test]
    fn ensure_complete_fills_the_file() {
        let dir = std::env::temp_dir().join(format!("cortex-settings-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();

        // Absent → defaults, every key present.
        ensure_complete(&dir).unwrap();
        let text = std::fs::read_to_string(dir.join(".cortex/settings.yaml")).unwrap();
        for (k, _) in describe() {
            assert!(text.contains(&format!("{k}:")), "missing {k}");
        }

        // Partial → kept values, missing keys filled.
        std::fs::write(dir.join(".cortex/settings.yaml"), "auto_commit: false\n").unwrap();
        let s = ensure_complete(&dir).unwrap();
        assert!(!s.auto_commit, "a non-default value in the file must survive");
        let text = std::fs::read_to_string(dir.join(".cortex/settings.yaml")).unwrap();
        assert!(text.contains("auto_commit: false") && text.contains("terminal_command:"));

        // Malformed → untouched.
        std::fs::write(dir.join(".cortex/settings.yaml"), "auto_commit: [oops\n").unwrap();
        ensure_complete(&dir).unwrap();
        assert_eq!(std::fs::read_to_string(dir.join(".cortex/settings.yaml")).unwrap(), "auto_commit: [oops\n");

        let _ = std::fs::remove_dir_all(&dir);
    }
}
