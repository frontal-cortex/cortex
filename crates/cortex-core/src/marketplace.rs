//! The template marketplace: packs of Markdown and YAML that install into a
//! vault. See `docs/marketplace.md` for the design; this module is the whole
//! of it that runs — the CLI, the MCP server, the app, and the marketplace
//! repository's CI all call these functions.
//!
//! A pack is data, never code. Installing one writes ordinary files into
//! `templates/`, `.cortex/schemas/` and `collections/<name>/`, and records
//! every path with its hash in `.cortex/packs.yaml`, so `update` can tell a
//! file the user edited from one they left alone, and `remove` deletes only
//! what install wrote and only if it is unchanged. Nothing here runs on its
//! own: install, update and remove are explicit calls; the remote index is
//! fetched only when asked.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

use crate::error::{AppError, Result};
use crate::{schema, settings};

include!(concat!(env!("OUT_DIR"), "/packs_bundle.rs"));

/// The manifest format this build understands. A pack with a higher major is refused.
pub const FORMAT: u32 = 1;
/// The install record, committed with the vault.
pub const RECORD: &str = ".cortex/packs.yaml";
/// The app's own version, for `min_cortex` checks.
pub const APP_VERSION: &str = env!("CARGO_PKG_VERSION");
/// The official index, unless `marketplace_url` says otherwise.
pub const OFFICIAL_INDEX: &str = "https://frontal-cortex.github.io/marketplace/index.json";
/// Placeholder in seeds and `index.md`, expanded once at install.
const TODAY: &str = "{{today}}";

// ── Manifest ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Note,
    Collection,
    Bundle,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum Tier {
    Official,
    Verified,
    #[default]
    Community,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
pub struct Author {
    #[serde(default)]
    pub name: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Manifest {
    #[serde(default = "one")]
    pub format: u32,
    pub id: String,
    pub name: String,
    pub version: String,
    pub kind: Kind,
    #[serde(default)]
    pub summary: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub author: Author,
    #[serde(default)]
    pub license: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub credits: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub min_cortex: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub collection: Option<String>,
    /// Bundles: the packs installed together, in order.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub includes: Vec<String>,
    #[serde(default)]
    pub files: Vec<String>,
}

fn one() -> u32 { 1 }

pub fn parse_manifest(text: &str) -> Result<Manifest> {
    let m: Manifest = serde_yaml::from_str(text)?;
    if m.format > FORMAT {
        return Err(AppError::Other(format!("pack '{}' uses manifest format {}; this app understands {}", m.id, m.format, FORMAT)));
    }
    Ok(m)
}

// ── Packs ───────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct PackFile {
    /// Path inside the pack, e.g. `templates/daily.md`.
    pub path: String,
    #[serde(skip)]
    pub contents: Vec<u8>,
}

/// A pack with its files in memory — from the bundle, a directory, or a remote index.
#[derive(Debug, Clone, Serialize)]
pub struct Pack {
    pub manifest: Manifest,
    pub tier: Tier,
    /// `bundled`, a directory path, or the index URL it came from.
    pub source: String,
    pub files: Vec<PackFile>,
}

impl Pack {
    pub fn file(&self, path: &str) -> Option<&PackFile> {
        self.files.iter().find(|f| f.path == path)
    }
    fn text(&self, path: &str) -> Option<String> {
        self.file(path).map(|f| String::from_utf8_lossy(&f.contents).into_owned())
    }
}

/// The packs compiled into this build (the official tier).
pub fn bundled() -> Vec<Pack> {
    let mut by_id: BTreeMap<&str, Vec<PackFile>> = BTreeMap::new();
    for (id, rel, bytes) in BUNDLED {
        by_id.entry(id).or_default().push(PackFile { path: (*rel).into(), contents: bytes.to_vec() });
    }
    let mut out = Vec::new();
    for (_, files) in by_id {
        let Some(mf) = files.iter().find(|f| f.path == "manifest.yaml") else { continue };
        let Ok(manifest) = parse_manifest(&String::from_utf8_lossy(&mf.contents)) else { continue };
        out.push(Pack { manifest, tier: Tier::Official, source: "bundled".into(), files });
    }
    out
}

/// Read a pack from a directory (a checkout of the marketplace repo, or a
/// pack someone is authoring).
pub fn load_dir(dir: &Path) -> Result<Pack> {
    let manifest = parse_manifest(&std::fs::read_to_string(dir.join("manifest.yaml"))
        .map_err(|_| AppError::Other(format!("{}: no manifest.yaml", dir.display())))?)?;
    let mut files = Vec::new();
    for entry in walkdir::WalkDir::new(dir).into_iter().filter_map(|e| e.ok()) {
        if !entry.file_type().is_file() { continue }
        let rel = entry.path().strip_prefix(dir).unwrap().to_string_lossy().replace('\\', "/");
        files.push(PackFile { path: rel, contents: std::fs::read(entry.path())? });
    }
    files.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(Pack { manifest, tier: Tier::Community, source: dir.to_string_lossy().into_owned(), files })
}

// ── Lint ────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Severity { Error, Warning }

#[derive(Debug, Clone, Serialize)]
pub struct Finding {
    pub severity: Severity,
    pub file: Option<String>,
    pub message: String,
}

const ALLOWED_EXT: [&str; 6] = ["md", "yaml", "png", "jpg", "webp", "svg"];
const ALLOWED_DIRS: [&str; 4] = ["templates", "schemas", "seed", "assets"];
const TEMPLATE_VARS: [&str; 4] = ["date", "time", "title", "uuid"];
const RAW_HTML_OK: [&str; 6] = ["<br", "<sub", "</sub", "<sup", "</sup", "<!--"];
const PRODUCT_WORDS: [&str; 6] = ["notion", "obsidian", "evernote", "roam", "logseq", "craft"];

/// Every rule from the format spec. Errors block; warnings are advice.
pub fn lint(pack: &Pack) -> Vec<Finding> {
    let mut out = Vec::new();
    let err = |out: &mut Vec<Finding>, file: Option<&str>, m: String| out.push(Finding { severity: Severity::Error, file: file.map(Into::into), message: m });
    let warn = |out: &mut Vec<Finding>, file: Option<&str>, m: String| out.push(Finding { severity: Severity::Warning, file: file.map(Into::into), message: m });
    let m = &pack.manifest;

    // Identity and versioning.
    if m.id.is_empty() || !m.id.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-') {
        err(&mut out, None, format!("id '{}' must be lowercase letters, digits and dashes", m.id));
    }
    if semver::Version::parse(&m.version).is_err() {
        err(&mut out, None, format!("version '{}' is not semver (e.g. 1.0.0)", m.version));
    }
    if m.name.trim().is_empty() { err(&mut out, None, "name is empty".into()); }
    if m.summary.trim().is_empty() { err(&mut out, None, "summary is empty".into()); }
    if m.summary.chars().count() > 120 { warn(&mut out, None, "summary is longer than 120 characters".into()); }
    if m.license.trim().is_empty() { err(&mut out, None, "license is required (an SPDX id such as CC0-1.0 or CC-BY-4.0)".into()); }
    if !m.min_cortex.is_empty() && semver::Version::parse(&m.min_cortex).is_err() {
        err(&mut out, None, format!("min_cortex '{}' is not semver", m.min_cortex));
    }
    for w in PRODUCT_WORDS {
        if m.name.to_lowercase().contains(w) || m.summary.to_lowercase().contains(w) {
            warn(&mut out, None, format!("'{w}' in the name or summary — attribution belongs in `credits`"));
        }
    }
    match m.kind {
        Kind::Collection if m.collection.as_deref().map_or(true, str::is_empty) => err(&mut out, None, "collection packs need `collection: <name>`".into()),
        Kind::Bundle if m.includes.is_empty() => err(&mut out, None, "bundles need `includes: [pack ids]`".into()),
        Kind::Bundle if !m.files.is_empty() => err(&mut out, None, "bundles own no files".into()),
        _ => {}
    }

    // Files: listed ⇔ present, allowed types and places, size.
    let listed: BTreeSet<&str> = m.files.iter().map(String::as_str).collect();
    let present: BTreeSet<&str> = pack.files.iter().map(|f| f.path.as_str()).filter(|p| *p != "manifest.yaml" && *p != "README.md" && *p != "preview.png").collect();
    for p in listed.difference(&present) { err(&mut out, Some(p), "listed in `files` but missing".into()); }
    for p in present.difference(&listed) { err(&mut out, Some(p), "present but not listed in `files`".into()); }
    let mut total = 0usize;
    for f in &pack.files {
        total += f.contents.len();
        let p = Path::new(&f.path);
        if p.components().any(|c| !matches!(c, std::path::Component::Normal(_))) {
            err(&mut out, Some(&f.path), "path must be relative and free of `..`".into());
        }
        let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
        if !ALLOWED_EXT.contains(&ext.as_str()) {
            err(&mut out, Some(&f.path), format!("file type .{ext} is not allowed (md, yaml, png, jpg, webp, svg)"));
        }
        let top = f.path.split('/').next().unwrap_or("");
        let at_root = !f.path.contains('/');
        if !(at_root && ["manifest.yaml", "README.md", "index.md", "preview.png"].contains(&f.path.as_str())) && !ALLOWED_DIRS.contains(&top) {
            err(&mut out, Some(&f.path), "files live in templates/, schemas/, seed/, assets/ or are index.md / README.md / preview.png".into());
        }
        if ["png", "jpg", "webp", "svg"].contains(&ext.as_str()) && f.contents.len() > 200 * 1024 {
            err(&mut out, Some(&f.path), "images must be 200 KB or smaller".into());
        }
        if ext == "md" {
            let text = String::from_utf8_lossy(&f.contents);
            lint_markdown(&f.path, &text, &mut out);
        }
    }
    if total > 2 * 1024 * 1024 { err(&mut out, None, "pack is larger than 2 MB".into()); }

    // Collection packs: schema, views, seeds and row template agree.
    if m.kind == Kind::Collection {
        let coll = m.collection.clone().unwrap_or_default();
        let schema_path = format!("schemas/{coll}.yaml");
        let props: BTreeMap<String, String> = match pack.text(&schema_path) {
            None => { err(&mut out, Some(&schema_path), "collection packs ship a schema named after the collection".into()); BTreeMap::new() }
            Some(text) => match serde_yaml::from_str::<schema::TypeSchema>(&text) {
                Err(e) => { err(&mut out, Some(&schema_path), format!("schema does not parse: {e}")); BTreeMap::new() }
                Ok(s) => s.properties.iter().map(|p| (p.name.clone(), format!("{:?}", p.ty).to_lowercase())).collect(),
            },
        };
        match pack.text("index.md") {
            None => err(&mut out, Some("index.md"), "collection packs ship index.md with the views".into()),
            Some(text) => {
                if let Some(fm) = frontmatter_yaml(&text.replace(TODAY, "2000-01-01")) {
                    let views = fm.get("views").and_then(|v| v.as_sequence()).cloned().unwrap_or_default();
                    if views.is_empty() { err(&mut out, Some("index.md"), "no views".into()); }
                    for v in views {
                        for key in ["group", "date"] {
                            if let Some(p) = v.get(key).and_then(|x| x.as_str()) {
                                if !props.contains_key(p) { err(&mut out, Some("index.md"), format!("view `{key}: {p}` names a property the schema lacks")); }
                            }
                        }
                        if v.get("type").and_then(|x| x.as_str()) == Some("calendar") {
                            match v.get("date").and_then(|x| x.as_str()) {
                                Some(p) if props.get(p).map(String::as_str) == Some("date") => {}
                                _ => err(&mut out, Some("index.md"), "a calendar view needs `date:` naming a date property".into()),
                            }
                        }
                    }
                } else {
                    err(&mut out, Some("index.md"), "no frontmatter".into());
                }
            }
        }
        if pack.text(&format!("templates/{coll}.md")).is_none() {
            warn(&mut out, None, format!("no row template templates/{coll}.md — New row will have no shape"));
        }
        for f in &pack.files {
            if f.path.starts_with("seed/") || f.path == format!("templates/{coll}.md") {
                let text = String::from_utf8_lossy(&f.contents).replace(TODAY, "2000-01-01");
                let text = strip_template_vars(&text);
                if let Some(fm) = frontmatter_yaml(&text) {
                    for key in fm.keys().filter_map(|k| k.as_str()) {
                        if !["title", "type", "tags", "created", "icon", "cover"].contains(&key) && !props.contains_key(key) {
                            err(&mut out, Some(&f.path), format!("property `{key}` is not in the schema"));
                        }
                    }
                }
            }
        }
    }
    out
}

fn lint_markdown(path: &str, text: &str, out: &mut Vec<Finding>) {
    let err = |out: &mut Vec<Finding>, m: String| out.push(Finding { severity: Severity::Error, file: Some(path.into()), message: m });
    // Frontmatter must parse once placeholders are quoted; unquoted `{{` is the classic mistake.
    if text.starts_with("---") {
        for line in text.lines().skip(1).take_while(|l| *l != "---") {
            if let Some((_, v)) = line.split_once(':') {
                if v.trim_start().starts_with("{{") {
                    err(out, format!("unquoted placeholder in frontmatter: `{}` — write `\"{}\"`", line.trim(), v.trim()));
                }
            }
        }
        let probe = strip_template_vars(&text.replace(TODAY, "2000-01-01"));
        if frontmatter_yaml(&probe).is_none() {
            err(out, "frontmatter does not parse as YAML".into());
        }
    }
    // Only the placeholders the app expands.
    let mut i = 0;
    while let Some(s) = text[i..].find("{{") {
        let start = i + s + 2;
        let Some(e) = text[start..].find("}}") else { break };
        let name = text[start..start + e].trim();
        let ok = TEMPLATE_VARS.contains(&name) || (name == "today" && (path.starts_with("seed/") || path == "index.md"));
        if !ok {
            err(out, format!("unknown placeholder {{{{{name}}}}} (templates: date, time, title, uuid; seeds and index.md: today)"));
        }
        i = start + e + 2;
    }
    // Raw HTML beyond the allow-list.
    for (pos, _) in text.match_indices('<') {
        let tail = &text[pos..];
        let looks_like_tag = tail.len() > 1 && (tail.as_bytes()[1].is_ascii_alphabetic() || tail.as_bytes()[1] == b'/' || tail.starts_with("<!"));
        if looks_like_tag && !RAW_HTML_OK.iter().any(|ok| tail.to_lowercase().starts_with(ok)) {
            err(out, format!("raw HTML is not allowed: `{}`", tail.chars().take(20).collect::<String>().replace('\n', " ")));
            break;
        }
    }
}

fn strip_template_vars(text: &str) -> String {
    let mut s = text.to_string();
    for v in TEMPLATE_VARS {
        s = s.replace(&format!("{{{{{v}}}}}"), "x");
    }
    s
}

fn frontmatter_yaml(text: &str) -> Option<serde_yaml::Mapping> {
    let rest = text.strip_prefix("---")?;
    let end = rest.find("\n---")?;
    serde_yaml::from_str::<serde_yaml::Value>(&rest[..end]).ok()?.as_mapping().cloned()
}

// ── Destinations ────────────────────────────────────────────────────────────

/// Where a pack file lands in the vault, or None for files that are not installed.
pub fn destination(m: &Manifest, path: &str) -> Option<String> {
    let coll = m.collection.as_deref();
    if let Some(f) = path.strip_prefix("templates/") { return Some(format!("templates/{f}")); }
    if let Some(f) = path.strip_prefix("schemas/") { return Some(format!(".cortex/schemas/{f}")); }
    if path == "index.md" { return coll.map(|c| format!("collections/{c}/_index.md")); }
    if let Some(f) = path.strip_prefix("seed/") { return coll.map(|c| format!("collections/{c}/{f}")); }
    if let Some(f) = path.strip_prefix("assets/") { return Some(format!("assets/{}/{f}", m.id)); }
    None
}

// ── Install record ──────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct InstalledFile {
    pub path: String,
    pub sha256: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Installed {
    pub id: String,
    pub version: String,
    #[serde(default)]
    pub tier: Tier,
    #[serde(default)]
    pub source: String,
    pub installed: String,
    #[serde(default)]
    pub files: Vec<InstalledFile>,
}

pub fn installed(root: &Path) -> Vec<Installed> {
    std::fs::read_to_string(root.join(RECORD)).ok().and_then(|s| serde_yaml::from_str(&s).ok()).unwrap_or_default()
}

fn save_installed(root: &Path, list: &[Installed]) -> Result<()> {
    let path = root.join(RECORD);
    if let Some(parent) = path.parent() { std::fs::create_dir_all(parent)?; }
    if list.is_empty() {
        let _ = std::fs::remove_file(&path);
        return Ok(());
    }
    std::fs::write(&path, serde_yaml::to_string(list)?)?;
    Ok(())
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

fn file_hash(path: &Path) -> Option<String> {
    std::fs::read(path).ok().map(|b| sha256_hex(&b))
}

fn today() -> String {
    chrono::Local::now().format("%Y-%m-%d").to_string()
}

/// A pack file with placeholders that install expands (`{{today}}` in seeds
/// and index.md); templates are written verbatim.
fn rendered(pack_path: &str, contents: &[u8]) -> Vec<u8> {
    if pack_path.starts_with("seed/") || pack_path == "index.md" {
        String::from_utf8_lossy(contents).replace(TODAY, &today()).into_bytes()
    } else {
        contents.to_vec()
    }
}

// ── Install ─────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "snake_case", tag = "action")]
pub enum Action {
    /// A new file.
    Write,
    /// The file exists and belongs to no pack; left alone (`force` overwrites templates and schemas).
    Skip { reason: String },
    /// Replace a file: one of ours that is unchanged since install, or (`force`) someone else's.
    Overwrite,
    /// A schema that already exists: properties the vault lacks are added, nothing removed.
    Merge,
}

#[derive(Debug, Clone, Serialize)]
pub struct Planned {
    pub pack_path: String,
    pub dest: String,
    #[serde(flatten)]
    pub action: Action,
}

#[derive(Debug, Clone, Serialize)]
pub struct Plan {
    pub id: String,
    pub version: String,
    pub steps: Vec<Planned>,
}

/// What `install` would do, without doing it.
pub fn plan(root: &Path, pack: &Pack, force: bool) -> Plan {
    let m = &pack.manifest;
    // Our own files from an earlier install, with the hash we wrote them at.
    let mine: BTreeMap<String, String> = installed(root).into_iter().filter(|r| r.id == m.id).flat_map(|r| r.files.into_iter().map(|f| (f.path, f.sha256))).collect();
    let collection_exists = m.collection.as_deref().map(|c| root.join("collections").join(c).is_dir()).unwrap_or(false);
    let mut steps = Vec::new();
    for f in &pack.files {
        let Some(dest) = destination(m, &f.path) else { continue };
        let exists = root.join(&dest).exists();
        let action = if !exists {
            Action::Write
        } else if let Some(recorded) = mine.get(&dest) {
            // Ours. Untouched since install → refresh it. Edited → it is the
            // user's now: keep it, exactly as `update` would. `force` resets
            // templates and schemas, never a collection row.
            if file_hash(&root.join(&dest)).as_deref() == Some(recorded.as_str()) {
                Action::Overwrite
            } else if force && !f.path.starts_with("seed/") {
                Action::Overwrite
            } else {
                Action::Skip { reason: "edited since it was installed; kept your version (force resets templates and schemas)".into() }
            }
        } else if f.path.starts_with("schemas/") {
            Action::Merge
        } else if f.path == "index.md" {
            Action::Skip { reason: "the collection already has views; keeping yours".into() }
        } else if f.path.starts_with("seed/") {
            Action::Skip { reason: "the collection already exists; seeds are not added".into() }
        } else if force && (f.path.starts_with("templates/") || f.path.starts_with("assets/")) {
            Action::Overwrite
        } else {
            Action::Skip { reason: "exists and is not from this pack (use force to overwrite templates)".into() }
        };
        // Seeds into a collection that existed before this pack: never.
        let action = if f.path.starts_with("seed/") && collection_exists && !mine.contains_key(&dest) {
            Action::Skip { reason: "the collection already exists; seeds are not added".into() }
        } else { action };
        steps.push(Planned { pack_path: f.path.clone(), dest, action });
    }
    Plan { id: m.id.clone(), version: m.version.clone(), steps }
}

#[derive(Debug, Clone, Serialize)]
pub struct InstallReport {
    pub id: String,
    pub version: String,
    pub written: Vec<String>,
    pub merged: Vec<String>,
    pub skipped: Vec<(String, String)>,
}

/// Install a pack: apply the plan, record what was written. Bundles install
/// each included pack (resolved through `resolve`) and record nothing themselves.
pub fn install(root: &Path, pack: &Pack, force: bool, resolve: &dyn Fn(&str) -> Option<Pack>) -> Result<Vec<InstallReport>> {
    if pack.manifest.kind == Kind::Bundle {
        let mut reports = Vec::new();
        for id in &pack.manifest.includes {
            let inner = resolve(id).ok_or_else(|| AppError::Other(format!("bundle '{}' includes unknown pack '{id}'", pack.manifest.id)))?;
            reports.extend(install(root, &inner, force, resolve)?);
        }
        return Ok(reports);
    }
    if !min_version_ok(&pack.manifest) {
        return Err(AppError::Other(format!("pack '{}' needs Cortex {} or newer (this is {})", pack.manifest.id, pack.manifest.min_cortex, APP_VERSION)));
    }
    let errors: Vec<_> = lint(pack).into_iter().filter(|f| f.severity == Severity::Error).collect();
    if !errors.is_empty() {
        return Err(AppError::Other(format!("pack '{}' fails lint: {}", pack.manifest.id, errors.iter().map(|e| e.message.clone()).collect::<Vec<_>>().join("; "))));
    }

    let p = plan(root, pack, force);
    let previous: Vec<InstalledFile> = installed(root).into_iter().filter(|r| r.id == pack.manifest.id).flat_map(|r| r.files).collect();
    let mut report = InstallReport { id: p.id.clone(), version: p.version.clone(), written: vec![], merged: vec![], skipped: vec![] };
    let mut recorded: Vec<InstalledFile> = Vec::new();
    for step in &p.steps {
        let file = pack.file(&step.pack_path).unwrap();
        let dest = root.join(&step.dest);
        match &step.action {
            Action::Skip { reason } => {
                // A file of ours we kept the user's edits to stays in the record,
                // so `update` and `remove` still know it is this pack's.
                if let Some(prev) = previous.iter().find(|f| f.path == step.dest) { recorded.push(prev.clone()); }
                report.skipped.push((step.dest.clone(), reason.clone()));
            }
            Action::Write | Action::Overwrite => {
                let bytes = rendered(&step.pack_path, &file.contents);
                if let Some(parent) = dest.parent() { std::fs::create_dir_all(parent)?; }
                std::fs::write(&dest, &bytes)?;
                recorded.push(InstalledFile { path: step.dest.clone(), sha256: sha256_hex(&bytes) });
                report.written.push(step.dest.clone());
            }
            Action::Merge => {
                merge_schema(root, &step.dest, &file.contents)?;
                recorded.push(InstalledFile { path: step.dest.clone(), sha256: file_hash(&dest).unwrap_or_default() });
                report.merged.push(step.dest.clone());
            }
        }
    }
    let mut list: Vec<Installed> = installed(root).into_iter().filter(|r| r.id != pack.manifest.id).collect();
    list.push(Installed { id: pack.manifest.id.clone(), version: pack.manifest.version.clone(), tier: pack.tier, source: pack.source.clone(), installed: today(), files: recorded });
    list.sort_by(|a, b| a.id.cmp(&b.id));
    save_installed(root, &list)?;
    Ok(vec![report])
}

fn min_version_ok(m: &Manifest) -> bool {
    match (semver::Version::parse(&m.min_cortex), semver::Version::parse(APP_VERSION)) {
        (Ok(need), Ok(have)) => have >= need,
        _ => true,
    }
}

/// Add properties the vault's schema lacks; never remove or retype existing ones.
fn merge_schema(root: &Path, dest: &str, incoming: &[u8]) -> Result<()> {
    let incoming: schema::TypeSchema = serde_yaml::from_str(&String::from_utf8_lossy(incoming))?;
    let path = root.join(dest);
    let mut current: schema::TypeSchema = serde_yaml::from_str(&std::fs::read_to_string(&path)?)?;
    for p in incoming.properties {
        if current.property(&p.name).is_none() {
            current.properties.push(p);
        }
    }
    std::fs::write(&path, serde_yaml::to_string(&current)?)?;
    Ok(())
}

// ── Update / remove ─────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct UpdateReport {
    pub id: String,
    pub from: String,
    pub to: String,
    pub replaced: Vec<String>,
    /// Files the user edited since install, left as they are.
    pub kept: Vec<String>,
    pub added: Vec<String>,
}

/// Bring an installed pack to `pack`'s version. A recorded file whose hash
/// still matches is replaced; an edited one is kept and reported; a seed
/// the user deleted is not re-added; schemas are merged, never replaced.
pub fn update(root: &Path, pack: &Pack) -> Result<UpdateReport> {
    let m = &pack.manifest;
    let mut list = installed(root);
    let idx = list.iter().position(|r| r.id == m.id).ok_or_else(|| AppError::Other(format!("'{}' is not installed", m.id)))?;
    let rec = list[idx].clone();
    let by_dest: BTreeMap<&str, &InstalledFile> = rec.files.iter().map(|f| (f.path.as_str(), f)).collect();
    let mut report = UpdateReport { id: m.id.clone(), from: rec.version.clone(), to: m.version.clone(), replaced: vec![], kept: vec![], added: vec![] };
    let mut recorded: Vec<InstalledFile> = Vec::new();
    for f in &pack.files {
        let Some(dest) = destination(m, &f.path) else { continue };
        let abs = root.join(&dest);
        match by_dest.get(dest.as_str()) {
            Some(old) => {
                if !abs.exists() {
                    // Deleted by the user (a seed, typically): stay deleted.
                    report.kept.push(dest);
                    continue;
                }
                if file_hash(&abs).as_deref() == Some(old.sha256.as_str()) || f.path.starts_with("schemas/") {
                    if f.path.starts_with("schemas/") {
                        merge_schema(root, &dest, &f.contents)?;
                    } else {
                        // Keep the original install date in seeds: re-render would stamp today.
                        std::fs::write(&abs, rendered(&f.path, &f.contents))?;
                    }
                    recorded.push(InstalledFile { path: dest.clone(), sha256: file_hash(&abs).unwrap_or_default() });
                    report.replaced.push(dest);
                } else {
                    recorded.push((*old).clone());
                    report.kept.push(dest);
                }
            }
            None => {
                if abs.exists() || f.path.starts_with("seed/") && root.join("collections").join(m.collection.as_deref().unwrap_or("")).is_dir() {
                    report.kept.push(dest);
                    continue;
                }
                let bytes = rendered(&f.path, &f.contents);
                if let Some(parent) = abs.parent() { std::fs::create_dir_all(parent)?; }
                std::fs::write(&abs, &bytes)?;
                recorded.push(InstalledFile { path: dest.clone(), sha256: sha256_hex(&bytes) });
                report.added.push(dest);
            }
        }
    }
    list[idx] = Installed { id: m.id.clone(), version: m.version.clone(), tier: pack.tier, source: pack.source.clone(), installed: today(), files: recorded };
    save_installed(root, &list)?;
    Ok(report)
}

#[derive(Debug, Clone, Serialize)]
pub struct RemoveReport {
    pub id: String,
    pub removed: Vec<String>,
    /// Edited since install, so left in place.
    pub kept: Vec<String>,
}

/// Delete what install wrote, if unchanged. Rows the user added to a pack's
/// collection are never touched; the folder goes only if it is then empty.
pub fn remove(root: &Path, id: &str) -> Result<RemoveReport> {
    let mut list = installed(root);
    let idx = list.iter().position(|r| r.id == id).ok_or_else(|| AppError::Other(format!("'{id}' is not installed")))?;
    let rec = list.remove(idx);
    let mut report = RemoveReport { id: id.into(), removed: vec![], kept: vec![] };
    let mut dirs: BTreeSet<PathBuf> = BTreeSet::new();
    for f in &rec.files {
        let abs = root.join(&f.path);
        if !abs.exists() { continue }
        if file_hash(&abs).as_deref() == Some(f.sha256.as_str()) {
            std::fs::remove_file(&abs)?;
            report.removed.push(f.path.clone());
            if let Some(d) = abs.parent() { dirs.insert(d.to_path_buf()); }
        } else {
            report.kept.push(f.path.clone());
        }
    }
    for d in dirs.iter().rev() {
        let _ = std::fs::remove_dir(d); // only succeeds when empty
    }
    save_installed(root, &list)?;
    Ok(report)
}

// ── Export ──────────────────────────────────────────────────────────────────

/// Turn a template or a collection in the vault into a pack directory —
/// the contributor's on-ramp. Rows are not exported (they are personal data);
/// the author adds seeds by hand.
pub fn export(root: &Path, id: &str, from: &str, out_dir: &Path) -> Result<PathBuf> {
    if !id.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-') || id.is_empty() {
        return Err(AppError::Other("pack id must be lowercase letters, digits and dashes".into()));
    }
    let dir = out_dir.join(id);
    if dir.exists() { return Err(AppError::Other(format!("{} already exists", dir.display()))); }
    let mut files: Vec<(String, Vec<u8>)> = Vec::new();
    let (kind, collection, name) = if let Some(rest) = from.strip_prefix("collections/") {
        let coll = rest.trim_end_matches('/').to_string();
        let sch = root.join(".cortex/schemas").join(format!("{coll}.yaml"));
        let idx = root.join("collections").join(&coll).join("_index.md");
        if !sch.exists() || !idx.exists() {
            return Err(AppError::Other(format!("collections/{coll} needs both .cortex/schemas/{coll}.yaml and _index.md")));
        }
        files.push((format!("schemas/{coll}.yaml"), std::fs::read(&sch)?));
        let index = std::fs::read_to_string(&idx)?;
        files.push(("index.md".into(), generalize_dates(&index).into_bytes()));
        let row = root.join("templates").join(format!("{coll}.md"));
        if row.exists() { files.push((format!("templates/{coll}.md"), std::fs::read(&row)?)); }
        (Kind::Collection, Some(coll.clone()), title_case(&coll))
    } else if let Some(t) = from.strip_prefix("templates/") {
        let src = root.join("templates").join(t);
        if !src.is_file() { return Err(AppError::Other(format!("templates/{t} not found"))); }
        files.push((format!("templates/{t}"), std::fs::read(&src)?));
        (Kind::Note, None, title_case(t.trim_end_matches(".md")))
    } else {
        return Err(AppError::Other("export from `templates/<file>.md` or `collections/<name>`".into()));
    };
    let manifest = Manifest {
        format: FORMAT, id: id.into(), name, version: "1.0.0".into(), kind,
        summary: "One line about what this pack is for.".into(),
        description: "A paragraph: what it installs, how to use it, what it pairs with.\n".into(),
        tags: vec![], author: Author { name: crate::git::open(root).ok().and_then(|r| r.signature().ok().and_then(|s| s.name().map(String::from))).unwrap_or_default(), url: String::new() },
        license: "CC0-1.0".into(), credits: String::new(), min_cortex: APP_VERSION.into(), collection, includes: vec![],
        files: files.iter().map(|(p, _)| p.clone()).collect(),
    };
    std::fs::create_dir_all(&dir)?;
    std::fs::write(dir.join("manifest.yaml"), serde_yaml::to_string(&manifest)?)?;
    for (rel, bytes) in files {
        let p = dir.join(&rel);
        if let Some(parent) = p.parent() { std::fs::create_dir_all(parent)?; }
        std::fs::write(p, bytes)?;
    }
    Ok(dir)
}

fn generalize_dates(text: &str) -> String {
    // `created: 2026-09-08` → `created: "{{today}}"` in frontmatter.
    let mut out = String::new();
    let mut in_fm = false;
    for (i, line) in text.lines().enumerate() {
        if i == 0 && line == "---" { in_fm = true; out.push_str(line); out.push('\n'); continue; }
        if in_fm && line == "---" { in_fm = false; }
        if in_fm && line.starts_with("created:") { out.push_str("created: \"{{today}}\"\n"); continue; }
        out.push_str(line); out.push('\n');
    }
    out
}

fn title_case(s: &str) -> String {
    s.split(['-', '_']).filter(|w| !w.is_empty()).map(|w| { let mut c = w.chars(); c.next().map(|f| f.to_uppercase().collect::<String>() + c.as_str()).unwrap_or_default() }).collect::<Vec<_>>().join(" ")
}

// ── Index (the marketplace repo's product) ──────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IndexEntry {
    #[serde(flatten)]
    pub manifest: Manifest,
    pub tier: Tier,
    #[serde(default)]
    pub preview: Option<String>,
    /// path inside the pack → sha256 of the file's bytes.
    pub sha256: BTreeMap<String, String>,
    #[serde(default)]
    pub commit: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Index {
    pub format: u32,
    pub generated: String,
    /// Files are fetched from `{base}{id}/{path}`.
    pub base: String,
    pub packs: Vec<IndexEntry>,
}

/// Build the index from a `packs/` directory plus `tiers.yaml` beside it.
/// This is what the marketplace repo's CI commits as `index.json`.
pub fn generate_index(repo: &Path, base: &str) -> Result<Index> {
    let packs_dir = repo.join("packs");
    let tiers: BTreeMap<String, Tier> = std::fs::read_to_string(repo.join("tiers.yaml")).ok()
        .and_then(|s| serde_yaml::from_str(&s).ok()).unwrap_or_default();
    let commit = std::process::Command::new("git").args(["rev-parse", "HEAD"]).current_dir(repo).output().ok()
        .filter(|o| o.status.success()).map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string()).unwrap_or_default();
    let mut entries = Vec::new();
    let mut dirs: Vec<PathBuf> = std::fs::read_dir(&packs_dir)?.flatten().map(|e| e.path()).filter(|p| p.is_dir()).collect();
    dirs.sort();
    for dir in dirs {
        let pack = load_dir(&dir)?;
        let errors: Vec<_> = lint(&pack).into_iter().filter(|f| f.severity == Severity::Error).collect();
        if !errors.is_empty() {
            return Err(AppError::Other(format!("{}: {}", pack.manifest.id, errors.iter().map(|e| e.message.clone()).collect::<Vec<_>>().join("; "))));
        }
        if pack.manifest.id != dir.file_name().unwrap().to_string_lossy() {
            return Err(AppError::Other(format!("{}: id does not match folder", dir.display())));
        }
        let sha256 = pack.files.iter().map(|f| (f.path.clone(), sha256_hex(&f.contents))).collect();
        let preview = pack.file("preview.png").map(|_| format!("{}/preview.png", pack.manifest.id));
        let tier = tiers.get(&pack.manifest.id).copied().unwrap_or(Tier::Community);
        entries.push(IndexEntry { manifest: pack.manifest, tier, preview, sha256, commit: commit.clone() });
    }
    Ok(Index { format: FORMAT, generated: chrono::Utc::now().to_rfc3339(), base: base.into(), packs: entries })
}

/// GET bytes. `file://` and plain paths are read from disk (a company share,
/// a checkout, tests); anything else goes over HTTPS.
pub fn fetch_bytes(url: &str) -> Result<Vec<u8>> {
    if let Some(p) = url.strip_prefix("file://") {
        return Ok(std::fs::read(p)?);
    }
    if !url.contains("://") {
        return Ok(std::fs::read(url)?);
    }
    let mut resp = ureq::get(url).call().map_err(|e| AppError::Other(format!("fetch {url}: {e}")))?;
    let body = resp.body_mut().with_config().limit(20 * 1024 * 1024).read_to_vec().map_err(|e| AppError::Other(format!("read {url}: {e}")))?;
    Ok(body)
}

pub fn fetch_index(url: &str) -> Result<Index> {
    let bytes = fetch_bytes(url)?;
    let index: Index = serde_json::from_slice(&bytes).map_err(|e| AppError::Other(format!("{url}: not a marketplace index ({e})")))?;
    if index.format > FORMAT {
        return Err(AppError::Other(format!("{url}: index format {} is newer than this app understands", index.format)));
    }
    Ok(index)
}

/// Fetch a pack's files from an index, verifying every hash the index promised.
pub fn fetch_pack(index: &Index, index_url: &str, entry: &IndexEntry) -> Result<Pack> {
    let base = resolve_base(index_url, &index.base);
    let mut files = Vec::new();
    for (path, want) in &entry.sha256 {
        let url = format!("{base}{}/{path}", entry.manifest.id);
        let bytes = fetch_bytes(&url)?;
        let got = sha256_hex(&bytes);
        if &got != want {
            return Err(AppError::Other(format!("{url}: hash mismatch (index says {want}, file is {got}) — refusing to install")));
        }
        files.push(PackFile { path: path.clone(), contents: bytes });
    }
    files.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(Pack { manifest: entry.manifest.clone(), tier: entry.tier, source: index_url.into(), files })
}

/// `base` may be relative to the index's own location.
fn resolve_base(index_url: &str, base: &str) -> String {
    if base.contains("://") || base.starts_with('/') { return base.to_string(); }
    let dir = match index_url.rfind('/') { Some(i) => &index_url[..=i], None => "" };
    format!("{dir}{base}")
}

// ── Catalog: everything the user can browse ────────────────────────────────

/// One row of the marketplace, merged across sources and the install record.
#[derive(Debug, Clone, Serialize)]
pub struct CatalogEntry {
    #[serde(flatten)]
    pub manifest: Manifest,
    pub tier: Tier,
    pub source: String,
    pub preview: Option<String>,
    pub installed_version: Option<String>,
    pub update_available: bool,
    pub needs_newer_app: bool,
    pub featured: bool,
}

#[derive(Debug, Clone, Serialize, Default)]
pub struct Catalog {
    pub entries: Vec<CatalogEntry>,
    /// Sources that could not be fetched, with the reason; the bundled packs still show.
    pub errors: Vec<(String, String)>,
    pub fetched_at: Option<String>,
}

/// The index URLs the vault's settings name: `marketplace_url` (empty = official) plus `marketplace_extra`.
pub fn index_urls(root: &Path) -> Vec<String> {
    let s = settings::load(root).unwrap_or_default();
    let mut urls = vec![if s.marketplace_url.trim().is_empty() { OFFICIAL_INDEX.to_string() } else { s.marketplace_url.trim().to_string() }];
    urls.extend(s.marketplace_extra.split([',', ' ', '\n']).map(str::trim).filter(|u| !u.is_empty()).map(String::from));
    urls.dedup();
    urls
}

pub fn tiers_shown(root: &Path) -> Vec<Tier> {
    let s = settings::load(root).unwrap_or_default();
    let mut out: Vec<Tier> = s.marketplace_tiers.split([',', ' ']).filter_map(|t| match t.trim() {
        "official" => Some(Tier::Official), "verified" => Some(Tier::Verified), "community" => Some(Tier::Community), _ => None,
    }).collect();
    if out.is_empty() { out = vec![Tier::Official, Tier::Verified, Tier::Community]; }
    out
}

/// Where fetched indexes are cached: `<cache_dir>/<sha of url>.json`.
fn cache_path(cache_dir: &Path, url: &str) -> PathBuf {
    cache_dir.join(format!("{}.json", &sha256_hex(url.as_bytes())[..16]))
}

/// Merge bundled packs with the configured remote indexes (from cache unless
/// `refresh`, or on a cache miss when `online`). Higher version wins per id;
/// bundled packs are the fallback when nothing can be fetched.
pub fn catalog(root: &Path, cache_dir: Option<&Path>, refresh: bool, online: bool) -> Catalog {
    let mut best: BTreeMap<String, (Manifest, Tier, String, Option<String>)> = BTreeMap::new();
    for p in bundled() {
        best.insert(p.manifest.id.clone(), (p.manifest, Tier::Official, "bundled".into(), None));
    }
    let mut errors = Vec::new();
    let mut fetched_at = None;
    for url in index_urls(root) {
        let cached = cache_dir.map(|d| cache_path(d, &url));
        let index: Option<Index> = if !refresh {
            cached.as_ref().and_then(|p| std::fs::read_to_string(p).ok()).and_then(|s| serde_json::from_str(&s).ok())
        } else { None };
        let index = match index {
            Some(i) => Some(i),
            None if online => match fetch_index(&url) {
                Ok(i) => {
                    if let Some(p) = &cached { let _ = std::fs::create_dir_all(p.parent().unwrap()); let _ = std::fs::write(p, serde_json::to_vec(&i).unwrap_or_default()); }
                    Some(i)
                }
                Err(e) => { errors.push((url.clone(), e.to_string())); None }
            },
            None => None,
        };
        let Some(index) = index else { continue };
        fetched_at = Some(index.generated.clone());
        for e in index.packs {
            let newer = match best.get(&e.manifest.id) {
                Some((m, ..)) => version_gt(&e.manifest.version, &m.version),
                None => true,
            };
            if newer {
                best.insert(e.manifest.id.clone(), (e.manifest, e.tier, url.clone(), e.preview.map(|p| format!("{}{p}", resolve_base(&url, &index.base)))));
            }
        }
    }
    let inst: BTreeMap<String, String> = installed(root).into_iter().map(|r| (r.id, r.version)).collect();
    let featured: Vec<String> = bundled_featured();
    let shown = tiers_shown(root);
    let mut entries: Vec<CatalogEntry> = best.into_values().filter(|(_, tier, ..)| shown.contains(tier)).map(|(manifest, tier, source, preview)| {
        let installed_version = inst.get(&manifest.id).cloned();
        let update_available = installed_version.as_deref().map(|v| version_gt(&manifest.version, v)).unwrap_or(false);
        let needs_newer_app = !min_version_ok(&manifest);
        let featured = featured.contains(&manifest.id);
        CatalogEntry { manifest, tier, source, preview, installed_version, update_available, needs_newer_app, featured }
    }).collect();
    // Featured first (in curated order), then by tier, then by name.
    entries.sort_by_key(|e| (featured.iter().position(|f| *f == e.manifest.id).unwrap_or(usize::MAX), e.tier, e.manifest.name.to_lowercase()));
    Catalog { entries, errors, fetched_at }
}

fn bundled_featured() -> Vec<String> {
    // The curated order ships beside the packs as `featured.yaml` when vendored; until then, the bundle order.
    let text = include_str!("../../../marketplace/featured.yaml");
    serde_yaml::from_str::<serde_yaml::Value>(text).ok()
        .and_then(|v| v.get("featured").and_then(|f| f.as_sequence()).map(|s| s.iter().filter_map(|x| x.as_str().map(String::from)).collect()))
        .unwrap_or_default()
}

fn version_gt(a: &str, b: &str) -> bool {
    match (semver::Version::parse(a), semver::Version::parse(b)) {
        (Ok(a), Ok(b)) => a > b,
        _ => a != b,
    }
}

/// Find a pack by id across the bundle and the configured indexes, fetching
/// its files (and verifying them) when it comes from an index.
pub fn resolve(root: &Path, cache_dir: Option<&Path>, id: &str, online: bool) -> Result<Pack> {
    let cat = catalog(root, cache_dir, false, online);
    let entry = cat.entries.iter().find(|e| e.manifest.id == id)
        .ok_or_else(|| AppError::Other(format!("no pack named '{id}' (see `cortex packs list`)")))?;
    if entry.source == "bundled" {
        return bundled().into_iter().find(|p| p.manifest.id == id).ok_or_else(|| AppError::Other(format!("bundled pack '{id}' vanished")));
    }
    let url = entry.source.clone();
    let cached = cache_dir.map(|d| cache_path(d, &url));
    let index: Index = match cached.and_then(|p| std::fs::read_to_string(p).ok()).and_then(|s| serde_json::from_str(&s).ok()) {
        Some(i) => i,
        None => fetch_index(&url)?,
    };
    let ie = index.packs.iter().find(|e| e.manifest.id == id).ok_or_else(|| AppError::Other(format!("'{id}' is no longer in {url}")))?;
    fetch_pack(&index, &url, ie)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn vault(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("cortex-mkt-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        crate::template::scaffold(&dir).unwrap();
        dir
    }

    fn pack(id: &str) -> Pack {
        bundled().into_iter().find(|p| p.manifest.id == id).unwrap_or_else(|| panic!("bundled pack {id}"))
    }

    #[test]
    fn bundled_packs_exist_and_pass_lint() {
        let packs = bundled();
        assert!(packs.len() >= 11, "expected the eleven official packs, got {}", packs.len());
        for p in &packs {
            let errors: Vec<_> = lint(p).into_iter().filter(|f| f.severity == Severity::Error).collect();
            assert!(errors.is_empty(), "{}: {:?}", p.manifest.id, errors);
        }
        let ids: Vec<&str> = packs.iter().map(|p| p.manifest.id.as_str()).collect();
        for want in ["tasks", "daily-note", "reading-list", "habit-tracker"] {
            assert!(ids.contains(&want), "{want} missing from bundle: {ids:?}");
        }
    }

    #[test]
    fn lint_catches_the_classic_mistakes() {
        let mut p = pack("tasks");
        p.manifest.version = "one".into();
        p.manifest.summary = "Like Notion but better".into();
        let idx = p.files.iter_mut().find(|f| f.path == "index.md").unwrap();
        idx.contents = b"---\ncreated: {{today}}\ntitle: T\ntype: database\nviews:\n- name: Cal\n  type: calendar\n  date: nope\n---\n<script>alert(1)</script>\n".to_vec();
        let f = lint(&p);
        let msgs: Vec<&str> = f.iter().map(|x| x.message.as_str()).collect();
        assert!(msgs.iter().any(|m| m.contains("not semver")), "{msgs:?}");
        assert!(msgs.iter().any(|m| m.contains("credits")), "{msgs:?}");
        assert!(msgs.iter().any(|m| m.contains("unquoted placeholder")), "{msgs:?}");
        assert!(msgs.iter().any(|m| m.contains("calendar view")), "{msgs:?}");
        assert!(msgs.iter().any(|m| m.contains("raw HTML")), "{msgs:?}");
    }

    #[test]
    fn install_writes_records_and_skips_on_reinstall() {
        let root = vault("install");
        let tasks = pack("tasks");
        let reports = install(&root, &tasks, false, &|_| None).unwrap();
        let r = &reports[0];
        assert_eq!(r.written.len(), 4, "{r:?}");
        assert!(root.join("collections/tasks/_index.md").exists());
        assert!(root.join(".cortex/schemas/tasks.yaml").exists());
        assert!(root.join("templates/tasks.md").exists());
        let seed = std::fs::read_to_string(root.join("collections/tasks/example-task.md")).unwrap();
        assert!(!seed.contains("{{today}}") && seed.contains("created: \""));
        let rec = installed(&root);
        assert_eq!(rec.len(), 1);
        assert_eq!(rec[0].files.len(), 4);

        // Reinstall: our own untouched files are refreshed, nothing skipped.
        let again = install(&root, &tasks, false, &|_| None).unwrap();
        assert!(again[0].skipped.is_empty(), "{again:?}");

        // The seed row became a real task and the template was tweaked:
        // a reinstall keeps both and still records them as this pack's.
        let seed_path = root.join("collections/tasks/example-task.md");
        std::fs::write(&seed_path, "---\ntitle: Renew passport\n---\n").unwrap();
        std::fs::write(root.join("templates/tasks.md"), "mine").unwrap();
        let kept = install(&root, &tasks, false, &|_| None).unwrap();
        assert_eq!(kept[0].skipped.len(), 2, "{kept:?}");
        assert_eq!(kept[0].written.len(), 2);
        assert!(std::fs::read_to_string(&seed_path).unwrap().contains("Renew passport"));
        assert_eq!(installed(&root)[0].files.len(), 4);
        // force resets the template but never a collection row.
        let forced = install(&root, &tasks, true, &|_| None).unwrap();
        assert!(forced[0].written.iter().any(|w| w == "templates/tasks.md"), "{forced:?}");
        assert!(std::fs::read_to_string(&seed_path).unwrap().contains("Renew passport"));
        assert_eq!(installed(&root)[0].files.len(), 4);

        // A note pack over an existing template: skipped unless forced.
        std::fs::write(root.join("templates/daily.md"), "mine").unwrap();
        let daily = pack("daily-note");
        let r = install(&root, &daily, false, &|_| None).unwrap();
        assert_eq!(r[0].skipped.len(), 1);
        assert_eq!(std::fs::read_to_string(root.join("templates/daily.md")).unwrap(), "mine");
        let r = install(&root, &daily, true, &|_| None).unwrap();
        assert_eq!(r[0].written, vec!["templates/daily.md"]);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn install_into_existing_collection_merges_schema_and_keeps_views() {
        let root = vault("merge");
        std::fs::create_dir_all(root.join("collections/tasks")).unwrap();
        std::fs::create_dir_all(root.join(".cortex/schemas")).unwrap();
        std::fs::write(root.join(".cortex/schemas/tasks.yaml"), "properties:\n  - name: status\n    type: select\n    options:\n      - name: open\n        color: blue\n  - name: owner\n    type: text\n").unwrap();
        std::fs::write(root.join("collections/tasks/_index.md"), "---\ntitle: tasks\ntype: database\nviews:\n- name: Mine\n  type: table\n---\n").unwrap();
        let r = install(&root, &pack("tasks"), false, &|_| None).unwrap();
        assert_eq!(r[0].merged, vec![".cortex/schemas/tasks.yaml"]);
        assert!(r[0].skipped.iter().any(|(p, _)| p.ends_with("_index.md")));
        assert!(r[0].skipped.iter().any(|(p, _)| p.ends_with("example-task.md")), "seeds not added to an existing collection");
        let s: schema::TypeSchema = serde_yaml::from_str(&std::fs::read_to_string(root.join(".cortex/schemas/tasks.yaml")).unwrap()).unwrap();
        assert_eq!(s.property("status").unwrap().options[0].name, "open", "existing property untouched");
        assert!(s.property("owner").is_some() && s.property("priority").is_some() && s.property("due").is_some());
        assert!(std::fs::read_to_string(root.join("collections/tasks/_index.md")).unwrap().contains("Mine"));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn update_replaces_untouched_and_keeps_edited_and_deleted() {
        let root = vault("update");
        install(&root, &pack("project-tracker"), false, &|_| None).unwrap();
        std::fs::write(root.join("templates/projects.md"), "my own row template").unwrap();
        std::fs::remove_file(root.join("collections/projects/example-project.md")).unwrap();
        let mut newer = pack("project-tracker");
        newer.manifest.version = "1.1.0".into();
        let idx = newer.files.iter_mut().find(|f| f.path == "index.md").unwrap();
        idx.contents.extend_from_slice(b"\nNew in 1.1\n");
        let r = update(&root, &newer).unwrap();
        assert!(r.replaced.contains(&"collections/projects/_index.md".to_string()), "{r:?}");
        assert!(r.kept.contains(&"templates/projects.md".to_string()), "{r:?}");
        assert!(r.kept.contains(&"collections/projects/example-project.md".to_string()), "deleted seed stays deleted: {r:?}");
        assert!(!root.join("collections/projects/example-project.md").exists());
        assert_eq!(std::fs::read_to_string(root.join("templates/projects.md")).unwrap(), "my own row template");
        assert_eq!(installed(&root)[0].version, "1.1.0");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn remove_deletes_only_unchanged_files_and_leaves_user_rows() {
        let root = vault("remove");
        install(&root, &pack("budget-tracker"), false, &|_| None).unwrap();
        std::fs::write(root.join("collections/budget/rent.md"), "---\ntitle: Rent\n---\n").unwrap();
        std::fs::write(root.join("templates/budget.md"), "edited").unwrap();
        let r = remove(&root, "budget-tracker").unwrap();
        assert!(r.removed.contains(&"collections/budget/_index.md".to_string()));
        assert!(r.kept == vec!["templates/budget.md".to_string()], "{r:?}");
        assert!(root.join("collections/budget/rent.md").exists(), "user rows survive");
        assert!(root.join("collections/budget").exists(), "folder kept because it is not empty");
        assert!(installed(&root).is_empty());
        assert!(!root.join(RECORD).exists());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn bundles_install_their_parts() {
        let root = vault("bundle");
        let bundle = Pack {
            manifest: Manifest { format: 1, id: "starter".into(), name: "Starter".into(), version: "1.0.0".into(), kind: Kind::Bundle, summary: "s".into(), description: String::new(), tags: vec![], author: Author::default(), license: "CC0-1.0".into(), credits: String::new(), min_cortex: String::new(), collection: None, includes: vec!["tasks".into(), "daily-note".into()], files: vec![] },
            tier: Tier::Official, source: "test".into(), files: vec![],
        };
        let r = install(&root, &bundle, false, &|id| bundled().into_iter().find(|p| p.manifest.id == id)).unwrap();
        assert_eq!(r.len(), 2);
        assert_eq!(installed(&root).len(), 2);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn export_roundtrips_through_lint_and_install() {
        let root = vault("export");
        install(&root, &pack("reading-list"), false, &|_| None).unwrap();
        let out = root.join("out");
        let dir = export(&root, "my-reading", "collections/reading", &out).unwrap();
        let p = load_dir(&dir).unwrap();
        assert_eq!(p.manifest.kind, Kind::Collection);
        assert!(p.file("index.md").is_some() && p.file("schemas/reading.yaml").is_some() && p.file("templates/reading.md").is_some());
        assert!(p.text("index.md").unwrap().contains("{{today}}"));
        let errors: Vec<_> = lint(&p).into_iter().filter(|f| f.severity == Severity::Error).collect();
        assert!(errors.is_empty(), "{errors:?}");
        // Installs into a fresh vault under its new collection name? No — same collection; into a fresh vault it is a plain install.
        let fresh = vault("export2");
        let r = install(&fresh, &p, false, &|_| None).unwrap();
        assert_eq!(r[0].written.len(), 3);
        let _ = std::fs::remove_dir_all(&root);
        let _ = std::fs::remove_dir_all(&fresh);
    }

    #[test]
    fn index_generation_and_remote_fetch_with_hash_check() {
        // A "remote" made of the repo's own marketplace directory, served via file://.
        let repo = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../marketplace");
        let index = generate_index(&repo, "packs/").unwrap();
        assert!(index.packs.len() >= 11);
        let tasks = index.packs.iter().find(|e| e.manifest.id == "tasks").unwrap();
        assert_eq!(tasks.tier, Tier::Official);
        assert!(tasks.sha256.contains_key("index.md"));

        let dir = std::env::temp_dir().join(format!("cortex-mkt-index-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        // Copy the packs next to the index so relative `base` resolves.
        for e in &index.packs {
            for (p, _) in &e.sha256 {
                let src = repo.join("packs").join(&e.manifest.id).join(p);
                let dst = dir.join("packs").join(&e.manifest.id).join(p);
                std::fs::create_dir_all(dst.parent().unwrap()).unwrap();
                std::fs::copy(src, dst).unwrap();
            }
        }
        std::fs::write(dir.join("index.json"), serde_json::to_vec(&index).unwrap()).unwrap();
        let url = format!("file://{}/index.json", dir.display());
        let fetched = fetch_index(&url).unwrap();
        let p = fetch_pack(&fetched, &url, fetched.packs.iter().find(|e| e.manifest.id == "tasks").unwrap()).unwrap();
        assert_eq!(p.files.len(), tasks.sha256.len());

        // Tamper with a file: the fetch refuses.
        std::fs::write(dir.join("packs/tasks/index.md"), "evil").unwrap();
        assert!(fetch_pack(&fetched, &url, fetched.packs.iter().find(|e| e.manifest.id == "tasks").unwrap()).is_err());

        // A vault pointed at this index sees a newer version from it and an update for what it installed.
        let root = vault("remote");
        install(&root, &pack("tasks"), false, &|_| None).unwrap();
        let mut newer = index.clone();
        newer.packs.iter_mut().find(|e| e.manifest.id == "tasks").unwrap().manifest.version = "9.0.0".into();
        std::fs::write(dir.join("index.json"), serde_json::to_vec(&newer).unwrap()).unwrap();
        std::fs::write(root.join(".cortex/settings.yaml"), format!("marketplace_url: \"{url}\"\n")).unwrap();
        let cat = catalog(&root, Some(&dir.join("cache")), true, true);
        let t = cat.entries.iter().find(|e| e.manifest.id == "tasks").unwrap();
        assert_eq!(t.manifest.version, "9.0.0");
        assert_eq!(t.installed_version.as_deref(), Some("1.0.0"));
        assert!(t.update_available);
        assert_eq!(t.source, url);
        // Offline with a cache: still served.
        let cat2 = catalog(&root, Some(&dir.join("cache")), false, false);
        assert!(cat2.entries.iter().any(|e| e.manifest.id == "tasks" && e.manifest.version == "9.0.0"));
        // A dead URL: bundled packs remain, the error is reported.
        std::fs::write(root.join(".cortex/settings.yaml"), "marketplace_url: \"file:///nonexistent/index.json\"\n").unwrap();
        let cat3 = catalog(&root, None, true, true);
        assert_eq!(cat3.errors.len(), 1);
        assert!(cat3.entries.iter().any(|e| e.manifest.id == "tasks" && e.source == "bundled"));
        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::remove_dir_all(&root);
    }
}
