//! Typed property schemas — the Notion-style "a database has typed properties"
//! layer. A schema declares each property's type and, for the select-like types,
//! its named options and their colors.
//!
//! Stored at `.cortex/schemas/<key>.yaml` (committed + portable, the same
//! convention as `settings.yaml`/`favorites.yaml`). `.brain/` is deliberately
//! NOT used here: it is gitignored and rebuildable, but a schema is authored
//! data that must travel with the vault.
//!
//! ## Key resolution
//!
//! A note under `collections/<name>/` is keyed by `<name>` — the database it
//! belongs to. Any other note is keyed by its frontmatter `type`. So a
//! collection's data view and one of its rows' property panel resolve to the
//! SAME schema file and can never drift apart.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

use crate::error::{AppError, Result};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PropType {
    Text,
    Number,
    Date,
    Checkbox,
    Select,
    MultiSelect,
    Status,
    Url,
    /// Like a select, but its options are the vault's members (see `members.rs`),
    /// not authored inline. Used for assignees.
    Person,
}

/// One named choice for a select/multi-select/status property. `color` is a
/// palette name (gray, blue, …) resolved to CSS on the frontend; an unknown
/// name simply falls back to the default swatch, so the data is never invalid.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SelectOption {
    pub name: String,
    #[serde(default = "default_color")]
    pub color: String,
}

fn default_color() -> String {
    "gray".into()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PropertyDef {
    pub name: String,
    #[serde(rename = "type")]
    pub ty: PropType,
    /// Only meaningful for select/multi_select/status. Order is the display
    /// order, so it is preserved as authored (hence a Vec, not a map).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub options: Vec<SelectOption>,
}

/// A database/type's full property schema. `properties` is ordered.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct TypeSchema {
    #[serde(default)]
    pub properties: Vec<PropertyDef>,
}

impl TypeSchema {
    pub fn property(&self, name: &str) -> Option<&PropertyDef> {
        self.properties.iter().find(|p| p.name == name)
    }
}

fn schemas_dir(root: &Path) -> PathBuf {
    root.join(".cortex").join("schemas")
}

/// Keys come from collection names and note types — keep them filesystem-safe.
fn sanitize_key(key: &str) -> Option<String> {
    if key.is_empty() || key.contains('/') || key.contains('\\') || key.contains("..") {
        return None;
    }
    Some(key.to_string())
}

/// Resolve which schema file a note (by path + frontmatter `type`) maps to.
/// `collections/<name>/…` → `<name>`; otherwise the note's `type`.
pub fn schema_key(path: &str, note_type: Option<&str>) -> Option<String> {
    if let Some(rest) = path.strip_prefix("collections/") {
        if let Some(name) = rest.split('/').next() {
            if !name.is_empty() {
                return Some(name.to_string());
            }
        }
    }
    note_type.filter(|t| !t.is_empty()).map(str::to_string)
}

/// Load a schema by key. A missing or malformed file is `None`, never an error —
/// the vault stays usable without any schemas.
pub fn load(root: &Path, key: &str) -> Result<Option<TypeSchema>> {
    let key = match sanitize_key(key) {
        Some(k) => k,
        None => return Ok(None),
    };
    let path = schemas_dir(root).join(format!("{key}.yaml"));
    if !path.exists() {
        return Ok(None);
    }
    let content = std::fs::read_to_string(&path)?;
    Ok(serde_yaml::from_str(&content).ok())
}

pub fn save(root: &Path, key: &str, schema: &TypeSchema) -> Result<()> {
    let key = sanitize_key(key).ok_or_else(|| AppError::Other("Invalid schema key".into()))?;
    let dir = schemas_dir(root);
    std::fs::create_dir_all(&dir)?;
    let yaml = serde_yaml::to_string(schema)?;
    std::fs::write(dir.join(format!("{key}.yaml")), yaml)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn key_resolution_prefers_collection_then_type() {
        assert_eq!(
            schema_key("collections/books/dune.md", Some("note")).as_deref(),
            Some("books")
        );
        assert_eq!(
            schema_key("notes/journal/2026-06-08.md", Some("daily")).as_deref(),
            Some("daily")
        );
        assert_eq!(schema_key("notes/loose.md", None), None);
    }

    #[test]
    fn save_then_load_round_trips() {
        let root = std::env::temp_dir().join(format!("cortex-schema-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let schema = TypeSchema {
            properties: vec![PropertyDef {
                name: "status".into(),
                ty: PropType::Status,
                options: vec![
                    SelectOption { name: "reading".into(), color: "blue".into() },
                    SelectOption { name: "done".into(), color: "green".into() },
                ],
            }],
        };
        save(&root, "books", &schema).unwrap();
        let loaded = load(&root, "books").unwrap().unwrap();
        assert_eq!(loaded.properties.len(), 1);
        let p = &loaded.properties[0];
        assert_eq!(p.name, "status");
        assert_eq!(p.ty, PropType::Status);
        assert_eq!(p.options.len(), 2);
        assert_eq!(p.options[1].color, "green");

        // Unsafe keys never touch the filesystem.
        assert!(load(&root, "../escape").unwrap().is_none());
        assert!(save(&root, "a/b", &schema).is_err());

        std::fs::remove_dir_all(&root).ok();
    }
}
