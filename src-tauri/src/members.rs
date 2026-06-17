//! Team members — the people who can be assigned to things. Stored at
//! `.cortex/members.yaml` (committed + portable, same convention as schemas):
//!
//! ```yaml
//! - name: Diyahir
//!   email: diyahirc@gmail.com
//!   color: blue
//! ```
//!
//! A `person` property's options are these members (resolved at query time, so a
//! database never has to duplicate the roster). "Who am I" comes from git config
//! — the same identity that authors commits — so there's no separate login.

use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::error::Result;
use crate::schema::{PropType, SelectOption, TypeSchema};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Member {
    pub name: String,
    #[serde(default)]
    pub email: String,
    #[serde(default = "default_color")]
    pub color: String,
}

fn default_color() -> String {
    "gray".into()
}

/// The current user's git identity (repo config, falling back to global).
#[derive(Debug, Clone, Default, Serialize)]
pub struct CurrentUser {
    pub name: String,
    pub email: String,
}

fn members_path(root: &Path) -> std::path::PathBuf {
    root.join(".cortex").join("members.yaml")
}

pub fn load(root: &Path) -> Vec<Member> {
    let path = members_path(root);
    if !path.exists() {
        return Vec::new();
    }
    std::fs::read_to_string(&path)
        .ok()
        .and_then(|c| serde_yaml::from_str(&c).ok())
        .unwrap_or_default()
}

pub fn save(root: &Path, members: &[Member]) -> Result<()> {
    let dir = root.join(".cortex");
    std::fs::create_dir_all(&dir)?;
    std::fs::write(members_path(root), serde_yaml::to_string(members)?)?;
    Ok(())
}

fn git_config(root: &Path, key: &str) -> Option<String> {
    let out = std::process::Command::new("git")
        .args(["config", key])
        .current_dir(root)
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
    (!s.is_empty()).then_some(s)
}

pub fn current_user(root: &Path) -> CurrentUser {
    CurrentUser {
        name: git_config(root, "user.name").unwrap_or_default(),
        email: git_config(root, "user.email").unwrap_or_default(),
    }
}

/// Members as select options (name + color), for rendering person cells as pills.
pub fn as_options(members: &[Member]) -> Vec<SelectOption> {
    members.iter().map(|m| SelectOption { name: m.name.clone(), color: m.color.clone() }).collect()
}

/// Populate every `person` property's options from the member roster, so the
/// frontend can render them identically to a select.
pub fn fill_person_options(schema: &mut TypeSchema, members: &[Member]) {
    let opts = as_options(members);
    for p in &mut schema.properties {
        if p.ty == PropType::Person {
            p.options = opts.clone();
        }
    }
}

/// Replace the `@me` token in a view spec with the current user's name, so a
/// shared filter like `assignee == @me` resolves per-viewer. Handles the token
/// bare or already quoted (the GUI filter builder quotes string values).
pub fn resolve_me(spec: &str, root: &Path) -> String {
    if !spec.contains("@me") {
        return spec.to_string();
    }
    let user = current_user(root);
    // Person cells store the member's NAME, so resolve `@me` to the member that
    // matches the current git identity (by email, else name); fall back to the
    // raw git name when the user hasn't added themselves to the roster.
    let name = load(root)
        .into_iter()
        .find(|m| (!user.email.is_empty() && m.email == user.email) || m.name == user.name)
        .map(|m| m.name)
        .unwrap_or(user.name);
    if name.is_empty() {
        return spec.to_string();
    }
    let quoted = format!("'{}'", name.replace('\'', ""));
    spec.replace("'@me'", &quoted)
        .replace("\"@me\"", &quoted)
        .replace("@me", &quoted)
}
