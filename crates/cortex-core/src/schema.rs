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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PropType {
    #[default]
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
    /// Links to rows in another collection (`collection`). The stored value is a
    /// list of target row titles (wiki-link semantics); options are resolved at
    /// query time from the target collection.
    Relation,
    /// A read-only value computed by following a `relation` to its target rows
    /// and aggregating one of their `property` values with `function` — or,
    /// with `from`, by collecting the rows of another collection whose
    /// `relation` points at this row (the reverse side).
    Rollup,
    /// A read-only value computed from this row's own properties by `expr`
    /// (see `formula.rs`).
    Formula,
    /// A start and an end date under one key: `trip: {start: 2026-09-10,
    /// end: 2026-09-12}` — one nested mapping, so changing either end is a
    /// one-line diff and the pair can never drift apart across two keys.
    /// Filters compare `<`/`<=` against the end and `>`/`>=` against the
    /// start; `==` and `within` mean "overlaps"; sorting is by start.
    DateRange,
    /// A list of vault-relative file paths (`assets/…`), attached by the
    /// app's upload action or written by hand. Rendered as thumbnails/names.
    Files,
    /// Computed from git history (never written): when the file was first
    /// committed, by whom, when it was last changed, and by whom. Without a
    /// repository or a commit the file's mtime stands in and the author is
    /// empty. The local time is formatted `YYYY-MM-DDTHH:MM`.
    CreatedTime,
    CreatedBy,
    EditedTime,
    EditedBy,
}

impl PropType {
    /// Computed on read and never stored in a row: rollups, formulas and the
    /// git-derived properties. (The reverse side of a relation is computed
    /// too, but that is a `from:` on the definition, not a type.)
    pub fn is_computed(&self) -> bool {
        matches!(
            self,
            PropType::Rollup | PropType::Formula | PropType::CreatedTime | PropType::CreatedBy | PropType::EditedTime | PropType::EditedBy
        )
    }

    /// One of the four git-derived properties.
    pub fn is_authorship(&self) -> bool {
        matches!(self, PropType::CreatedTime | PropType::CreatedBy | PropType::EditedTime | PropType::EditedBy)
    }
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

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct PropertyDef {
    pub name: String,
    #[serde(rename = "type")]
    pub ty: PropType,
    /// Only meaningful for select/multi_select/status. Order is the display
    /// order, so it is preserved as authored (hence a Vec, not a map).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub options: Vec<SelectOption>,
    /// Relation: the target collection name this property links to.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub collection: Option<String>,
    /// Rollup: the relation property to follow.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub relation: Option<String>,
    /// Rollup: the target property to aggregate.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub property: Option<String>,
    /// Rollup: count | values | sum | avg | min | max | percent.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub function: Option<String>,
    /// Reverse rollup or reverse relation: the collection whose rows point at
    /// this row through their `relation` property (`from: milestones`,
    /// `relation: project`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub from: Option<String>,
    /// Reverse rollup: only rows matching this filter count (`done == true`);
    /// `function: percent` reports them as a share of all pointing rows.
    #[serde(default, skip_serializing_if = "Option::is_none", rename = "where")]
    pub where_: Option<String>,
    /// Formula: the expression over this row's properties.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expr: Option<String>,
    /// Number display: percent | progress | currency | stars | integer | decimal.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub format: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub min: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max: Option<f64>,
    /// Currency symbol or unit shown with a number (`€`, `kg`, `h`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub unit: Option<String>,
    /// Date: stamped with today when this condition on the row holds and the
    /// date is empty (`status == done` → a completed date).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auto: Option<String>,
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

// ── Rename and delete a property everywhere it is referenced ─────────────────
//
// A property name lives in more places than the schema: every row's
// frontmatter key, the collection's views (columns, sort, filter, group, the
// date/chart fields), rollups that aggregate it — in this schema and in
// others — and formula expressions. Renaming rewrites all of them in one
// pass; deleting removes the key from every row and every view, and refuses
// while anything still computes from it, naming what does.

/// What a rename or delete touched, for the CLI's summary and the app.
#[derive(Debug, Default, Clone, Serialize)]
pub struct PropertyChange {
    /// Row files rewritten (one frontmatter line each).
    pub rows: usize,
    /// View definitions updated in the collection's `_index.md`.
    pub views: usize,
    /// Schema files updated, this one first.
    pub schemas: Vec<String>,
    /// Every note file written, vault-relative — for re-indexing.
    pub files: Vec<String>,
}

/// View keys whose value names one field of the view's own collection.
const FIELD_KEYS: [&str; 7] = ["group", "date", "x", "y", "series", "start", "end"];

fn check_name(name: &str) -> Result<()> {
    if name.trim().is_empty() || name != name.trim() || name.starts_with('$') || name.contains(':') {
        return Err(AppError::Other(format!("'{name}' is not a valid property name")));
    }
    if name == "title" || name == "type" {
        return Err(AppError::Other(format!("'{name}' is built in and cannot be renamed or deleted")));
    }
    Ok(())
}

/// Rewrite the field names of a filter expression (`status == done and due < @today`).
/// Only field positions change: values, quoted or bare, and `@` placeholders
/// are left alone, and the text is otherwise preserved byte for byte.
fn rewrite_filter_fields(src: &str, old: &str, new: &str) -> String {
    // Tokenise, then rename a bare word only when the next token is an
    // operator: that is the field position in every form the grammar allows
    // (`(a == 1 or b is_empty) and not c in [x, y]`). Values, connectors and
    // list items are never followed by an operator, so they are left alone.
    const OPS: &[&str] = &[
        "==", "=", "!=", "<", "<=", ">", ">=", "contains", "does_not_contain",
        "starts_with", "ends_with", "is_empty", "is_not_empty", "in", "within",
    ];
    let chars: Vec<char> = src.chars().collect();
    let mut toks: Vec<String> = Vec::new();
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        let start = i;
        if c.is_whitespace() {
            while i < chars.len() && chars[i].is_whitespace() { i += 1; }
        } else if c == '\'' || c == '"' {
            i += 1;
            while i < chars.len() && chars[i] != c { i += 1; }
            if i < chars.len() { i += 1; }
        } else if matches!(c, '(' | ')' | '[' | ']' | ',') {
            i += 1;
        } else if matches!(c, '=' | '!' | '<' | '>') {
            i += 1;
            if i < chars.len() && chars[i] == '=' { i += 1; }
        } else {
            while i < chars.len()
                && !chars[i].is_whitespace()
                && !matches!(chars[i], '=' | '!' | '<' | '>' | '\'' | '"' | '(' | ')' | '[' | ']' | ',')
            { i += 1; }
        }
        toks.push(chars[start..i].iter().collect());
    }
    let is_op = |t: &str| OPS.contains(&t.to_ascii_lowercase().as_str());
    let mut out = String::new();
    for (n, tok) in toks.iter().enumerate() {
        let next = toks[n + 1..].iter().find(|t| !t.trim().is_empty());
        if tok == old && next.map(|t| is_op(t)).unwrap_or(false) {
            out.push_str(new);
        } else {
            out.push_str(tok);
        }
    }
    out
}

/// Drop every clause on `field`, descending into parenthesised groups; a
/// group left empty disappears with them.
fn drop_field(clauses: Vec<crate::data::FilterClause>, field: &str) -> Vec<crate::data::FilterClause> {
    clauses
        .into_iter()
        .filter_map(|mut c| {
            if !c.clauses.is_empty() {
                c.clauses = drop_field(c.clauses, field);
                if c.clauses.is_empty() { None } else { Some(c) }
            } else if c.field == field {
                None
            } else {
                Some(c)
            }
        })
        .collect()
}

/// Does a filter name this field?
fn filter_mentions(src: &str, name: &str) -> bool {
    rewrite_filter_fields(src, name, "\u{1}") != src
}

/// Rewrite bare identifiers in a formula expression. Quoted strings and
/// function names (an identifier followed by `(`) are left alone.
fn rewrite_expr_idents(src: &str, old: &str, new: &str) -> String {
    let chars: Vec<char> = src.chars().collect();
    let mut out = String::new();
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if c == '\'' || c == '"' {
            let start = i;
            i += 1;
            while i < chars.len() && chars[i] != c { i += 1; }
            if i < chars.len() { i += 1; }
            out.extend(&chars[start..i]);
        } else if c.is_alphabetic() || c == '_' {
            let start = i;
            while i < chars.len() && (chars[i].is_alphanumeric() || chars[i] == '_') { i += 1; }
            let ident: String = chars[start..i].iter().collect();
            let mut j = i;
            while j < chars.len() && chars[j].is_whitespace() { j += 1; }
            let is_call = chars.get(j) == Some(&'(');
            if ident == old && !is_call { out.push_str(new); } else { out.push_str(&ident); }
        } else {
            out.push(c);
            i += 1;
        }
    }
    out
}

fn expr_mentions(src: &str, name: &str) -> bool {
    rewrite_expr_idents(src, name, "\u{1}") != src
}

/// Every schema key on disk, sorted.
fn schema_keys(root: &Path) -> Vec<String> {
    let mut keys: Vec<String> = std::fs::read_dir(schemas_dir(root))
        .map(|rd| rd.flatten()
            .filter_map(|e| e.file_name().to_str().map(str::to_string))
            .filter_map(|f| f.strip_suffix(".yaml").map(str::to_string))
            .collect())
        .unwrap_or_default();
    keys.sort();
    keys
}

/// The files that carry this schema's rows: a collection's row notes, or —
/// for a note type — every note under `notes/` whose `type` is the key.
fn row_files(root: &Path, key: &str) -> Vec<PathBuf> {
    let coll = root.join("collections").join(key);
    if coll.is_dir() {
        let mut files: Vec<PathBuf> = std::fs::read_dir(&coll).map(|rd| rd.flatten().map(|e| e.path())
            .filter(|p| p.extension().and_then(|s| s.to_str()) == Some("md"))
            .filter(|p| !p.file_name().and_then(|s| s.to_str()).unwrap_or("").starts_with('_'))
            .collect()).unwrap_or_default();
        files.sort();
        return files;
    }
    let mut files = Vec::new();
    for entry in walkdir::WalkDir::new(root.join("notes")).into_iter().filter_map(|e| e.ok()) {
        let p = entry.path();
        if p.extension().and_then(|s| s.to_str()) != Some("md") { continue; }
        let Ok(text) = std::fs::read_to_string(p) else { continue };
        let Ok(note) = crate::note::parse_note("", &text) else { continue };
        if note.frontmatter.get("type").and_then(|t| t.as_str()) == Some(key) { files.push(p.to_path_buf()); }
    }
    files.sort();
    files
}

fn rel(root: &Path, p: &Path) -> String {
    p.strip_prefix(root).unwrap_or(p).to_string_lossy().replace('\\', "/")
}

/// A forward rollup in `schema` that aggregates `prop` of collection `key`
/// (through one of the schema's own relations to that collection).
fn rolls_up_from(schema: &TypeSchema, p: &PropertyDef, key: &str, prop: &str) -> bool {
    if p.ty != PropType::Rollup || p.from.is_some() { return false; }
    let Some(rel) = p.relation.as_deref().and_then(|r| schema.property(r)) else { return false };
    rel.collection.as_deref() == Some(key) && p.property.as_deref() == Some(prop)
}

/// Rewrite one row's frontmatter key; `new` = None removes it. Returns whether
/// the file changed.
fn rewrite_row(path: &Path, old: &str, new: Option<&str>) -> Result<bool> {
    let text = std::fs::read_to_string(path)?;
    let Ok(mut note) = crate::note::parse_note("", &text) else { return Ok(false) };
    let Some(value) = note.frontmatter.remove(old) else { return Ok(false) };
    if let Some(new) = new { note.frontmatter.insert(new.to_string(), value); }
    std::fs::write(path, crate::note::serialize_note(&note)?)?;
    Ok(true)
}

/// Rewrite the field references in one view (an entry of `_index.md`'s
/// `views:`); `new` = None drops them. Returns whether anything changed.
fn rewrite_view(view: &mut serde_json::Value, old: &str, new: Option<&str>) -> bool {
    let Some(obj) = view.as_object_mut() else { return false };
    let mut changed = false;
    if let Some(cols) = obj.get_mut("columns").and_then(|c| c.as_array_mut()) {
        let before = cols.len();
        match new {
            Some(new) => for c in cols.iter_mut() {
                if c.as_str() == Some(old) { *c = serde_json::Value::String(new.into()); changed = true; }
            },
            None => { cols.retain(|c| c.as_str() != Some(old)); changed |= cols.len() != before; }
        }
    }
    if let Some(sort) = obj.get_mut("sort").and_then(|s| s.as_array_mut()) {
        let before = sort.len();
        match new {
            Some(new) => for s in sort.iter_mut() {
                let Some(text) = s.as_str() else { continue };
                let mut parts = text.splitn(2, char::is_whitespace);
                if parts.next() == Some(old) {
                    let rest = parts.next().map(|r| format!(" {}", r.trim_start())).unwrap_or_default();
                    *s = serde_json::Value::String(format!("{new}{rest}"));
                    changed = true;
                }
            },
            None => { sort.retain(|s| s.as_str().map(|t| t.split_whitespace().next() != Some(old)).unwrap_or(true)); changed |= sort.len() != before; }
        }
    }
    if let Some(serde_json::Value::String(f)) = obj.get("filter").cloned() {
        let next = match new {
            Some(new) => Some(rewrite_filter_fields(&f, old, new)),
            None => match crate::data::flatten_filter(&f) {
                Some((clauses, join)) => {
                    Some(crate::data::build_filter(&drop_field(clauses, old), &join))
                }
                None => None, // mixed and/or: left for the user to edit
            },
        };
        if let Some(next) = next {
            if next != f {
                if next.trim().is_empty() { obj.remove("filter"); } else { obj.insert("filter".into(), serde_json::Value::String(next)); }
                changed = true;
            }
        }
    }
    // `summary: {field: function}` (a table footer, since #33).
    if let Some(sum) = obj.get_mut("summary").and_then(|s| s.as_object_mut()) {
        if let Some(func) = sum.remove(old) {
            if let Some(new) = new { sum.insert(new.into(), func); }
            changed = true;
        }
        if sum.is_empty() { obj.remove("summary"); }
    }
    for k in FIELD_KEYS {
        if obj.get(k).and_then(|v| v.as_str()) == Some(old) {
            match new {
                Some(new) => { obj.insert(k.into(), serde_json::Value::String(new.into())); }
                None => { obj.remove(k); }
            }
            changed = true;
        }
    }
    changed
}

/// Apply `rewrite_view` to every view of the collection's `_index.md`.
/// Returns the number of views changed and the file path when written.
fn rewrite_views(root: &Path, key: &str, old: &str, new: Option<&str>) -> Result<(usize, Option<PathBuf>)> {
    let path = root.join("collections").join(key).join("_index.md");
    let Ok(text) = std::fs::read_to_string(&path) else { return Ok((0, None)) };
    let Ok(mut note) = crate::note::parse_note("", &text) else { return Ok((0, None)) };
    let mut changed = 0;
    if let Some(views) = note.frontmatter.get_mut("views").and_then(|v| v.as_array_mut()) {
        for v in views.iter_mut() {
            if rewrite_view(v, old, new) { changed += 1; }
        }
    }
    if changed == 0 { return Ok((0, None)); }
    std::fs::write(&path, crate::note::serialize_note(&note)?)?;
    Ok((changed, Some(path)))
}

/// Rename a property: in `.cortex/schemas/<key>.yaml` (and the rollups and
/// formulas there and in other schemas that reference it), in every row of
/// the collection, and in the collection's views. Refuses a name that is
/// already taken by the schema or by any row.
pub fn rename_property(root: &Path, key: &str, old: &str, new: &str) -> Result<PropertyChange> {
    check_name(old)?;
    check_name(new)?;
    if new.contains(char::is_whitespace) {
        return Err(AppError::Other(format!("'{new}' is not a valid property name (no spaces)")));
    }
    if old == new { return Ok(PropertyChange::default()); }
    sanitize_key(key).ok_or_else(|| AppError::Other("Invalid schema key".into()))?;
    let mut schema = load(root, key)?.unwrap_or_default();
    if schema.property(new).is_some() {
        return Err(AppError::Other(format!("'{key}' already has a property '{new}'")));
    }
    let rows = row_files(root, key);
    let mut has_old = schema.property(old).is_some();
    for path in &rows {
        let Ok(note) = std::fs::read_to_string(path).map_err(AppError::from).and_then(|t| crate::note::parse_note("", &t)) else { continue };
        if note.frontmatter.contains_key(new) {
            return Err(AppError::Other(format!("{} already has '{new}'; not renaming over it", rel(root, path))));
        }
        has_old |= note.frontmatter.contains_key(old);
    }
    if !has_old {
        return Err(AppError::Other(format!("'{key}' has no property '{old}'")));
    }

    let mut change = PropertyChange::default();

    // This schema: the property itself, rollups through it, formulas and
    // auto-date conditions naming it.
    let mut touched = false;
    for p in &mut schema.properties {
        if p.name == old { p.name = new.into(); touched = true; }
        if p.from.is_none() && p.relation.as_deref() == Some(old) { p.relation = Some(new.into()); touched = true; }
        if let Some(e) = &p.expr { let r = rewrite_expr_idents(e, old, new); if r != *e { p.expr = Some(r); touched = true; } }
        if let Some(a) = &p.auto { let r = rewrite_filter_fields(a, old, new); if r != *a { p.auto = Some(r); touched = true; } }
    }
    if touched { save(root, key, &schema)?; change.schemas.push(key.into()); }

    // Other schemas: forward rollups aggregating it, and the reverse side —
    // relations and rollups `from` this collection following or filtering it.
    for other in schema_keys(root) {
        if other == key { continue; }
        let Some(mut s) = load(root, &other)? else { continue };
        let snapshot = s.clone();
        let mut touched = false;
        for p in &mut s.properties {
            if rolls_up_from(&snapshot, p, key, old) { p.property = Some(new.into()); touched = true; }
            if p.from.as_deref() == Some(key) {
                if p.relation.as_deref() == Some(old) { p.relation = Some(new.into()); touched = true; }
                if p.property.as_deref() == Some(old) { p.property = Some(new.into()); touched = true; }
                if let Some(w) = &p.where_ { let r = rewrite_filter_fields(w, old, new); if r != *w { p.where_ = Some(r); touched = true; } }
            }
        }
        if touched { save(root, &other, &s)?; change.schemas.push(other); }
    }

    let (views, index) = rewrite_views(root, key, old, Some(new))?;
    change.views = views;
    if let Some(p) = index { change.files.push(rel(root, &p)); }

    for path in &rows {
        if rewrite_row(path, old, Some(new))? { change.rows += 1; change.files.push(rel(root, path)); }
    }
    Ok(change)
}

/// Everything that still computes from `name` in collection `key`: rollups
/// (here or in another schema), formulas, auto-date conditions. Each entry
/// reads `<schema>.<property> (<kind>)`.
pub fn property_dependents(root: &Path, key: &str, name: &str) -> Result<Vec<String>> {
    let mut out = Vec::new();
    for other in schema_keys(root) {
        let Some(s) = load(root, &other)? else { continue };
        for p in &s.properties {
            if p.name == name && other == key { continue; }
            let own = other == key;
            let hit = if own {
                (p.from.is_none() && p.relation.as_deref() == Some(name) && p.ty == PropType::Rollup)
                    || p.expr.as_deref().map(|e| expr_mentions(e, name)).unwrap_or(false)
                    || p.auto.as_deref().map(|a| filter_mentions(a, name)).unwrap_or(false)
            } else {
                rolls_up_from(&s, p, key, name)
                    || (p.from.as_deref() == Some(key)
                        && (p.relation.as_deref() == Some(name)
                            || p.property.as_deref() == Some(name)
                            || p.where_.as_deref().map(|w| filter_mentions(w, name)).unwrap_or(false)))
            };
            if hit {
                let kind = match p.ty { PropType::Rollup => "rollup", PropType::Formula => "formula", PropType::Relation => "relation", _ => "auto date" };
                out.push(format!("{other}.{} ({kind})", p.name));
            }
        }
    }
    Ok(out)
}

/// Delete a property from the schema, from every row of the collection and
/// from its views. Refuses while a rollup, formula or auto-date condition —
/// in this schema or another — still depends on it, and names them.
pub fn delete_property(root: &Path, key: &str, name: &str) -> Result<PropertyChange> {
    check_name(name)?;
    sanitize_key(key).ok_or_else(|| AppError::Other("Invalid schema key".into()))?;
    let deps = property_dependents(root, key, name)?;
    if !deps.is_empty() {
        return Err(AppError::Other(format!("'{name}' is still used by {}; remove or change those first", deps.join(", "))));
    }
    let mut change = PropertyChange::default();
    if let Some(mut schema) = load(root, key)? {
        let before = schema.properties.len();
        schema.properties.retain(|p| p.name != name);
        if schema.properties.len() != before { save(root, key, &schema)?; change.schemas.push(key.into()); }
    }
    let (views, index) = rewrite_views(root, key, name, None)?;
    change.views = views;
    if let Some(p) = index { change.files.push(rel(root, &p)); }
    for path in row_files(root, key) {
        if rewrite_row(&path, name, None)? { change.rows += 1; change.files.push(rel(root, &path)); }
    }
    if change.rows == 0 && change.views == 0 && change.schemas.is_empty() {
        return Err(AppError::Other(format!("'{key}' has no property '{name}'")));
    }
    Ok(change)
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
                ..Default::default()
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

        // The newer types round-trip under their snake_case names.
        let schema = TypeSchema { properties: vec![
            PropertyDef { name: "trip".into(), ty: PropType::DateRange, ..Default::default() },
            PropertyDef { name: "attachments".into(), ty: PropType::Files, ..Default::default() },
            PropertyDef { name: "added".into(), ty: PropType::CreatedTime, ..Default::default() },
            PropertyDef { name: "editor".into(), ty: PropType::EditedBy, ..Default::default() },
        ] };
        save(&root, "trips", &schema).unwrap();
        let yaml = std::fs::read_to_string(root.join(".cortex/schemas/trips.yaml")).unwrap();
        assert!(yaml.contains("type: date_range") && yaml.contains("type: files") && yaml.contains("type: created_time") && yaml.contains("type: edited_by"), "{yaml}");
        let loaded = load(&root, "trips").unwrap().unwrap();
        assert_eq!(loaded.property("added").unwrap().ty, PropType::CreatedTime);
        assert!(PropType::EditedBy.is_computed() && PropType::EditedBy.is_authorship());
        assert!(!PropType::DateRange.is_computed() && !PropType::Rollup.is_authorship());

        // Unsafe keys never touch the filesystem.
        assert!(load(&root, "../escape").unwrap().is_none());
        assert!(save(&root, "a/b", &schema).is_err());

        std::fs::remove_dir_all(&root).ok();
    }

    fn put(root: &Path, rel: &str, text: &str) {
        let p = root.join(rel);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, text).unwrap();
    }
    fn read(root: &Path, rel: &str) -> String { std::fs::read_to_string(root.join(rel)).unwrap() }

    /// Two collections: tasks point at projects; projects roll tasks up both
    /// ways; a formula, an auto-date and two views name task properties.
    fn fixture(tag: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!("cortex-prop-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        put(&root, ".cortex/schemas/tasks.yaml", "properties:\n- name: hours\n  type: number\n- name: est\n  type: number\n- name: status\n  type: status\n  options:\n  - name: todo\n  - name: done\n- name: project\n  type: relation\n  collection: projects\n- name: left\n  type: formula\n  expr: est - hours\n- name: completed\n  type: date\n  auto: status == done\n");
        put(&root, ".cortex/schemas/projects.yaml", "properties:\n- name: tasks\n  type: relation\n  collection: tasks\n- name: total_hours\n  type: rollup\n  relation: tasks\n  property: hours\n  function: sum\n- name: done_count\n  type: rollup\n  from: tasks\n  relation: project\n  function: count\n  where: status == done\n");
        put(&root, "collections/tasks/_index.md", "---\ntitle: Tasks\ntype: database\nviews:\n- name: Table\n  type: table\n  columns: [title, hours, status]\n  sort: [hours desc, title]\n  filter: status == done and hours > 2\n  summary: {hours: sum}\n- name: Board\n  type: board\n  group: status\n---\n");
        put(&root, "collections/tasks/a.md", "---\nest: 4\nhours: 3\nproject:\n- Launch\nstatus: done\ntitle: A\n---\n\nBody of A.\n");
        put(&root, "collections/tasks/b.md", "---\nstatus: todo\ntitle: B\n---\n");
        put(&root, "collections/projects/launch.md", "---\ntasks: [A]\ntitle: Launch\n---\n");
        root
    }

    #[test]
    fn rename_rewrites_schema_rows_views_and_dependents() {
        let root = fixture("rename");
        let before = read(&root, "collections/tasks/a.md");
        let c = rename_property(&root, "tasks", "hours", "effort").unwrap();
        assert_eq!((c.rows, c.views), (1, 1), "{c:?}");
        assert_eq!(c.schemas, vec!["tasks", "projects"]);
        assert_eq!(c.files, vec!["collections/tasks/_index.md", "collections/tasks/a.md"]);

        let tasks = load(&root, "tasks").unwrap().unwrap();
        assert!(tasks.property("effort").is_some() && tasks.property("hours").is_none());
        assert_eq!(tasks.property("left").unwrap().expr.as_deref(), Some("est - effort"));
        let projects = load(&root, "projects").unwrap().unwrap();
        assert_eq!(projects.property("total_hours").unwrap().property.as_deref(), Some("effort"));

        // One frontmatter line changed in the row; the body is untouched.
        let after = read(&root, "collections/tasks/a.md");
        let removed: Vec<&str> = before.lines().filter(|l| !after.contains(l)).collect();
        let added: Vec<&str> = after.lines().filter(|l| !before.contains(l)).collect();
        assert_eq!((removed, added), (vec!["hours: 3"], vec!["effort: 3"]), "{after}");
        assert!(after.ends_with("Body of A.\n"));
        assert_eq!(read(&root, "collections/tasks/b.md"), "---\nstatus: todo\ntitle: B\n---\n");

        let idx = crate::note::parse_note("", &read(&root, "collections/tasks/_index.md")).unwrap();
        let views = idx.frontmatter["views"].as_array().unwrap();
        assert_eq!(views[0]["columns"], serde_json::json!(["title", "effort", "status"]));
        assert_eq!(views[0]["sort"], serde_json::json!(["effort desc", "title"]));
        assert_eq!(views[0]["summary"], serde_json::json!({"effort": "sum"}));
        assert_eq!(views[0]["filter"], serde_json::json!("status == done and effort > 2"));
        assert_eq!(views[1]["group"], serde_json::json!("status"));

        // The reverse side: `relation`, `where` and the auto condition follow too.
        rename_property(&root, "tasks", "status", "state").unwrap();
        rename_property(&root, "tasks", "project", "parent").unwrap();
        let tasks = load(&root, "tasks").unwrap().unwrap();
        assert_eq!(tasks.property("completed").unwrap().auto.as_deref(), Some("state == done"));
        let projects = load(&root, "projects").unwrap().unwrap();
        let dc = projects.property("done_count").unwrap();
        assert_eq!((dc.relation.as_deref(), dc.where_.as_deref()), (Some("parent"), Some("state == done")));
        let idx = crate::note::parse_note("", &read(&root, "collections/tasks/_index.md")).unwrap();
        assert_eq!(idx.frontmatter["views"][1]["group"], serde_json::json!("state"));
        assert_eq!(idx.frontmatter["views"][0]["filter"], serde_json::json!("state == done and effort > 2"));
        // The whole thing still computes.
        let t = crate::data::resolve_view(&root, "source: collections/projects\n").unwrap();
        assert_eq!(t.rows[0].cells["total_hours"], serde_json::json!(3.0));
        assert_eq!(t.rows[0].cells["done_count"], serde_json::json!(1.0));

        // Refusals: taken names, built-ins, unknown properties.
        assert!(rename_property(&root, "tasks", "est", "effort").unwrap_err().to_string().contains("already has"));
        assert!(rename_property(&root, "tasks", "title", "name").is_err());
        assert!(rename_property(&root, "tasks", "nope", "x").unwrap_err().to_string().contains("no property"));
        assert!(rename_property(&root, "tasks", "est", "with space").is_err());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn delete_refuses_dependents_then_clears_rows_and_views() {
        let root = fixture("delete");
        let err = delete_property(&root, "tasks", "hours").unwrap_err().to_string();
        assert!(err.contains("projects.total_hours (rollup)") && err.contains("tasks.left (formula)"), "{err}");
        let err = delete_property(&root, "tasks", "project").unwrap_err().to_string();
        assert!(err.contains("projects.done_count (rollup)"), "{err}");
        let err = delete_property(&root, "tasks", "status").unwrap_err().to_string();
        assert!(err.contains("tasks.completed (auto date)") && err.contains("projects.done_count"), "{err}");

        // Computed properties have no rows; removing them is a schema-only edit.
        let c = delete_property(&root, "projects", "total_hours").unwrap();
        assert_eq!((c.rows, c.views, c.schemas.clone()), (0, 0, vec!["projects".to_string()]));
        delete_property(&root, "tasks", "left").unwrap();

        let c = delete_property(&root, "tasks", "hours").unwrap();
        assert_eq!((c.rows, c.views), (1, 1), "{c:?}");
        assert!(load(&root, "tasks").unwrap().unwrap().property("hours").is_none());
        assert_eq!(read(&root, "collections/tasks/a.md"), "---\nest: 4\nproject:\n- Launch\nstatus: done\ntitle: A\n---\n\nBody of A.\n");
        let idx = crate::note::parse_note("", &read(&root, "collections/tasks/_index.md")).unwrap();
        let v = &idx.frontmatter["views"][0];
        assert_eq!(v["columns"], serde_json::json!(["title", "status"]));
        assert_eq!(v["sort"], serde_json::json!(["title"]));
        assert_eq!(v["filter"], serde_json::json!("status == 'done'"));

        assert!(delete_property(&root, "tasks", "hours").unwrap_err().to_string().contains("no property"));
        assert!(delete_property(&root, "tasks", "title").is_err());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn note_type_schemas_rename_across_notes() {
        let root = std::env::temp_dir().join(format!("cortex-prop-type-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        put(&root, ".cortex/schemas/meeting.yaml", "properties:\n- name: attendees\n  type: multi_select\n");
        put(&root, "notes/work/standup.md", "---\nattendees: [Ann]\ntitle: Standup\ntype: meeting\n---\n");
        put(&root, "notes/other.md", "---\nattendees: [Bob]\ntitle: Other\ntype: note\n---\n");
        let c = rename_property(&root, "meeting", "attendees", "people").unwrap();
        assert_eq!(c.files, vec!["notes/work/standup.md"]);
        assert!(read(&root, "notes/work/standup.md").contains("people:"));
        assert!(read(&root, "notes/other.md").contains("attendees:"), "other types are not touched");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn expression_rewrites_respect_positions_and_quotes() {
        assert_eq!(rewrite_filter_fields("status == done and done == true", "done", "finished"), "status == done and finished == true");
        assert_eq!(rewrite_filter_fields("name contains 'due' or due<@today", "due", "deadline"), "name contains 'due' or deadline<@today");
        // The grammar since #34: parentheses, `not`, emptiness tests, `in` lists.
        assert_eq!(
            rewrite_filter_fields("(status == todo or owner is_empty) and not owner in [ana, owner]", "owner", "assignee"),
            "(status == todo or assignee is_empty) and not assignee in [ana, owner]"
        );
        assert_eq!(rewrite_filter_fields("due within 7d and status != done", "status", "state"), "due within 7d and state != done");
    }

    #[test]
    fn delete_drops_clauses_inside_groups() {
        let (clauses, join) = crate::data::flatten_filter("(status == todo or owner is_empty) and priority >= 2").unwrap();
        let kept = drop_field(clauses, "owner");
        assert_eq!(crate::data::build_filter(&kept, &join), "(status == 'todo') and priority >= 2");
        let (clauses, join) = crate::data::flatten_filter("(owner is_empty or owner == ana) and priority >= 2").unwrap();
        let kept = drop_field(clauses, "owner");
        assert_eq!(crate::data::build_filter(&kept, &join), "priority >= 2");
        assert_eq!(rewrite_expr_idents("round(hours / est * 100, 'hours')", "hours", "effort"), "round(effort / est * 100, 'hours')");
        assert_eq!(rewrite_expr_idents("round(x) + round_up", "round", "r"), "round(x) + round_up");
        assert!(expr_mentions("days_until(due)", "due") && !expr_mentions("days_until(due_date)", "due"));
    }
}
