//! Notion export → vault, in one go.
//!
//! A Notion "Markdown & CSV" export is a zip where every page is
//! `Title <32-hex>.md`, every database is `Title <hash>.csv` (plus a `_all`
//! variant with the rows a filtered view hid) next to a `Title <hash>/`
//! folder of row pages, links are relative paths with `%20` and the hash
//! suffix, and a database page opens with a `Key: value` block of its
//! properties. This module unpacks that shape into ordinary vault files:
//!
//! - pages → `notes/<into>/…` with the hashes stripped from every path
//!   component and the `# Title` heading moved into `title:`;
//! - each CSV + row folder → `collections/<name>/`, one row note per record,
//!   the schema inferred from the header and the cells (select, multi-select,
//!   date, checkbox, url, number, relation by title) and the row page's body
//!   kept under the frontmatter;
//! - links between exported files → `[[Title]]`, images → `assets/`;
//! - an import report note listing what could not be mapped.
//!
//! Nothing is written that the export did not contain; existing files are
//! never overwritten. The same export imported twice into the same vault
//! writes nothing the second time and says so.

use serde::Serialize;
use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

use super::{
    check_dest, coerce_cell, is_dot, is_image, is_markdown, normalize, parse_csv, percent_decode,
    property_name, rel_str, slugify, write_index_note, Assets, Skipped, SELECT_MAX_OPTIONS,
};
use crate::error::{AppError, Result};
use crate::schema::{self, PropType, PropertyDef, SelectOption};

// ── Report ────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct NotionCollection {
    /// Folder under `collections/`.
    pub name: String,
    /// The database's title in Notion (the `_index.md` title).
    pub title: String,
    /// Rows the export holds (written or skipped).
    pub rows: usize,
    /// Vault-relative row paths written.
    pub written: Vec<String>,
    pub schema_added: Vec<String>,
    pub index_created: bool,
}

/// Something the export had that has no exact equivalent here.
#[derive(Debug, Clone, Serialize)]
pub struct Unmapped {
    /// What it concerns: `collection · property`, or a note path.
    pub subject: String,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct NotionReport {
    pub source: String,
    /// `notes/<into>` — where the pages went.
    pub dest: String,
    /// Pages written, vault-relative.
    pub notes: Vec<String>,
    pub collections: Vec<NotionCollection>,
    /// Images copied into `assets/`.
    pub assets: Vec<String>,
    /// Export files not imported, and why.
    pub skipped: Vec<Skipped>,
    pub unmapped: Vec<Unmapped>,
    /// Links and image references that pointed outside the export; left as written.
    pub unresolved: Vec<String>,
    /// The import report note, when one was written.
    pub report: Option<String>,
}

// ── Names ─────────────────────────────────────────────────────────────────────

/// `Dune 3c4d…(32 hex)` → (`Dune`, hash). A name without the suffix is its own title.
fn split_hash(stem: &str) -> (String, Option<String>) {
    let s = stem.trim_end();
    if s.len() >= 32 && s.is_char_boundary(s.len() - 32) {
        let (head, tail) = s.split_at(s.len() - 32);
        if tail.chars().all(|c| c.is_ascii_hexdigit()) && (head.is_empty() || head.ends_with(' ')) {
            return (head.trim_end().to_string(), Some(tail.to_ascii_lowercase()));
        }
    }
    (s.to_string(), None)
}

fn clean_name(stem: &str) -> String {
    let (name, _) = split_hash(stem);
    if name.is_empty() { "Untitled".into() } else { name }
}

/// Every component with its hash stripped: `Home <h>/Meeting notes <h>.md` → `Home/Meeting notes.md`.
fn clean_rel(rel: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for c in rel.components() {
        let name = c.as_os_str().to_string_lossy();
        match name.rsplit_once('.') {
            Some((stem, ext)) if !stem.is_empty() => out.push(format!("{}.{ext}", clean_name(stem))),
            _ => out.push(clean_name(&name)),
        }
    }
    out
}

/// Letters and digits only, lower-cased — how two spellings of one title are compared.
fn loose(s: &str) -> String {
    s.chars().filter(|c| c.is_alphanumeric()).flat_map(char::to_lowercase).collect()
}

// ── Values ────────────────────────────────────────────────────────────────────

fn month_number(s: &str) -> Option<u32> {
    const MONTHS: [&str; 12] = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
    let l = s.to_ascii_lowercase();
    if !l.chars().all(|c| c.is_ascii_alphabetic()) { return None; }
    MONTHS.iter().position(|m| l.starts_with(m)).map(|i| i as u32 + 1)
}

fn iso_date_prefix(s: &str) -> Option<&str> {
    let b = s.as_bytes();
    if b.len() >= 10 && b[4] == b'-' && b[7] == b'-'
        && b[..10].iter().enumerate().all(|(i, c)| i == 4 || i == 7 || c.is_ascii_digit())
        && (b.len() == 10 || matches!(b[10], b'T' | b' '))
    {
        return Some(&s[..10]);
    }
    None
}

/// What a Notion date cell holds: `January 5, 2024`, `January 5, 2024 3:12 PM`,
/// `January 5, 2024 → January 6, 2024`, or ISO. Returns the start day and
/// whether a time of day or a range end was dropped to get there.
fn parse_notion_date(raw: &str) -> Option<(String, bool, bool)> {
    let s = raw.trim().trim_start_matches('@').trim();
    let (start, range) = match s.split_once('→') { Some((a, _)) => (a.trim(), true), None => (s, false) };
    if let Some(d) = iso_date_prefix(start) {
        return Some((d.to_string(), start.len() > 10, range));
    }
    let mut parts = start.split_whitespace();
    let month = month_number(parts.next()?)?;
    let day: u32 = parts.next()?.trim_end_matches(',').parse().ok()?;
    let year: i32 = parts.next()?.parse().ok()?;
    if !(1..=31).contains(&day) || !(1000..=9999).contains(&year) { return None; }
    Some((format!("{year:04}-{month:02}-{day:02}"), parts.next().is_some(), range))
}

/// `1,200`, `$12.50`, `35%` → the bare number text, if it is one.
fn notion_number(raw: &str) -> Option<String> {
    let t = raw.trim().trim_start_matches(['$', '€', '£', '¥']).trim_end_matches('%').replace(',', "");
    t.parse::<f64>().ok().map(|_| t)
}

fn is_yes_no(s: &str) -> bool {
    s.eq_ignore_ascii_case("yes") || s.eq_ignore_ascii_case("no")
}

/// A relation cell: `Dune (../Reading%20list%20<h>/Dune%20<h>.md), Emma (…)` →
/// the titles and the paths. None when the cell has no such link.
fn split_relation(raw: &str) -> Option<Vec<(String, String)>> {
    if !raw.contains(".md)") { return None; }
    let mut items = Vec::new();
    let mut rest = raw;
    while let Some(end) = rest.find(".md)") {
        let head = &rest[..end];
        let Some(open) = head.rfind('(') else { break };
        let title = head[..open].trim().trim_start_matches(',').trim();
        let path = percent_decode(&head[open + 1..]) + ".md";
        let title = if title.is_empty() { clean_name(Path::new(&path).file_stem().and_then(|s| s.to_str()).unwrap_or("")) } else { title.to_string() };
        items.push((title, path));
        rest = &rest[end + 4..];
    }
    if items.is_empty() { None } else { Some(items) }
}

fn relation_titles(raw: &str) -> Vec<String> {
    match split_relation(raw) {
        Some(items) => items.into_iter().map(|(t, _)| t).collect(),
        None => raw.split(',').map(str::trim).filter(|s| !s.is_empty()).map(str::to_string).collect(),
    }
}

/// One cell coerced to a property type; empty cells are omitted.
fn notion_cell(raw: &str, ty: &str) -> Option<serde_json::Value> {
    let t = raw.trim();
    if t.is_empty() { return None; }
    Some(match ty {
        "relation" => serde_json::Value::Array(relation_titles(t).into_iter().map(serde_json::Value::String).collect()),
        "date" => serde_json::Value::String(parse_notion_date(t).map(|(d, _, _)| d).unwrap_or_else(|| t.to_string())),
        "number" => return coerce_cell(&notion_number(t).unwrap_or_else(|| t.to_string()), "number"),
        "checkbox" => match t.to_ascii_lowercase().as_str() {
            "yes" => serde_json::Value::Bool(true),
            "no" => serde_json::Value::Bool(false),
            _ => return coerce_cell(t, "checkbox"),
        },
        "multi_select" => return coerce_cell(t, "multi_select"),
        _ => serde_json::Value::String(t.to_string()),
    })
}

/// A property-block value with no schema to go by: typed from its shape alone.
fn infer_value(raw: &str) -> serde_json::Value {
    let t = raw.trim();
    if is_yes_no(t) { return serde_json::Value::Bool(t.eq_ignore_ascii_case("yes")); }
    if split_relation(t).is_some() { return notion_cell(t, "relation").unwrap(); }
    if parse_notion_date(t).is_some() { return notion_cell(t, "date").unwrap(); }
    if notion_number(t).is_some() { return notion_cell(t, "number").unwrap(); }
    serde_json::Value::String(t.to_string())
}

// ── Pages ─────────────────────────────────────────────────────────────────────

/// `Key: value` (or a bare `Key:`) with a key that could be a Notion property.
fn property_line(line: &str, known: Option<&[String]>) -> Option<(String, String)> {
    let (key, value) = match line.split_once(':') {
        Some((k, v)) if v.is_empty() || v.starts_with(' ') => (k.trim(), v.trim()),
        _ => return None,
    };
    let ok_key = !key.is_empty()
        && key.chars().count() <= 60
        && key.chars().next().map(char::is_alphabetic).unwrap_or(false)
        && !key.contains(['[', ']', '(', ')', '*', '`', '#', '|']);
    if !ok_key { return None; }
    if let Some(known) = known {
        if !known.iter().any(|k| k.eq_ignore_ascii_case(key)) { return None; }
    }
    Some((key.to_string(), value.to_string()))
}

/// A Notion page split into its `# Title`, the property block that follows
/// it (only the columns of `known` for a database row; for a lone page, any
/// run of two or more `Key: value` lines ended by a blank line) and the body.
fn split_page(text: &str, known: Option<&[String]>) -> (Option<String>, Vec<(String, String)>, String) {
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    let lines: Vec<&str> = text.lines().collect();
    let mut i = 0;
    while i < lines.len() && lines[i].trim().is_empty() { i += 1; }
    let mut title = None;
    if let Some(h) = lines.get(i).and_then(|l| l.strip_prefix("# ")) {
        title = Some(h.trim().to_string());
        i += 1;
    }
    while i < lines.len() && lines[i].trim().is_empty() { i += 1; }
    let mut props = Vec::new();
    let mut j = i;
    while j < lines.len() && !lines[j].trim().is_empty() {
        match property_line(lines[j], known) {
            Some(kv) => { props.push(kv); j += 1; }
            None => { props.clear(); j = i; break; }
        }
    }
    let accept = !props.is_empty() && (known.is_some() || props.len() >= 2);
    if accept { i = j; } else { props.clear(); }
    while i < lines.len() && lines[i].trim().is_empty() { i += 1; }
    let body = if i < lines.len() { format!("{}\n", lines[i..].join("\n").trim_end()) } else { String::new() };
    (title, props, body)
}

struct Page {
    src: PathBuf,
    hash: Option<String>,
    /// The file name without its hash.
    stem: String,
    /// The `# Title` heading, else the stem.
    title: String,
    text: String,
    /// Index into `databases` when the page sits in a row folder.
    row_of: Option<usize>,
    matched: bool,
}

struct Database {
    csv: PathBuf,
    hash: Option<String>,
    title: String,
    /// `collections/<name>`.
    name: String,
    dir: Option<PathBuf>,
    header: Vec<String>,
    records: Vec<Vec<String>>,
}

impl Database {
    fn titles(&self) -> Vec<&str> {
        self.records.iter().filter_map(|r| r.first()).map(|s| s.trim()).collect()
    }
}

// ── Columns ───────────────────────────────────────────────────────────────────

struct Col {
    header: String,
    property: String,
    ty: String,
    options: Vec<String>,
    /// Relation: the target collection.
    relation: Option<String>,
    /// What the type could not carry (once per column).
    notes: Vec<String>,
}

fn ty_name(ty: PropType) -> &'static str {
    match ty {
        PropType::Number => "number", PropType::Date => "date", PropType::Checkbox => "checkbox",
        PropType::Select => "select", PropType::MultiSelect | PropType::Person => "multi_select",
        PropType::Status => "status", PropType::Url => "url", PropType::Relation => "relation", _ => "text",
    }
}

fn first_seen(values: impl Iterator<Item = String>) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for v in values { if !out.iter().any(|o| o == &v) { out.push(v); } }
    out
}

/// Which database a relation cell points at: by the hash in the path, else
/// by the folder's title, else the one database whose rows carry the titles.
fn relation_target(items: &[(String, String)], dbs: &[Database], me: usize) -> Option<usize> {
    for (_, path) in items {
        let dir = Path::new(path).parent().and_then(|d| d.file_name()).and_then(|n| n.to_str()).unwrap_or("");
        let (dir_title, dir_hash) = split_hash(dir);
        if let Some(h) = dir_hash {
            if let Some(i) = dbs.iter().position(|d| d.hash.as_deref() == Some(h.as_str())) { return Some(i); }
        }
        if !dir_title.is_empty() {
            if let Some(i) = dbs.iter().position(|d| d.title == dir_title) { return Some(i); }
        }
    }
    let titles: Vec<&str> = items.iter().map(|(t, _)| t.as_str()).collect();
    let owners: Vec<usize> = dbs.iter().enumerate()
        .filter(|(i, d)| *i != me && titles.iter().all(|t| d.titles().contains(t)))
        .map(|(i, _)| i)
        .collect();
    match owners.as_slice() { [one] => Some(*one), _ => None }
}

/// Type one column from its header and the cells the export holds.
fn notion_column(header: &str, cells: &[&str], dbs: &[Database], me: usize) -> Col {
    let values: Vec<&str> = cells.iter().map(|s| s.trim()).filter(|s| !s.is_empty()).collect();
    let mut col = Col { header: header.to_string(), property: property_name(header), ty: "text".into(), options: vec![], relation: None, notes: vec![] };
    if values.is_empty() { return col; }

    if values.iter().all(|v| is_yes_no(v)) {
        col.ty = "checkbox".into();
    } else if values.iter().any(|v| v.contains(".md)")) {
        let items: Vec<(String, String)> = values.iter().filter_map(|v| split_relation(v)).flatten().collect();
        match relation_target(&items, dbs, me) {
            Some(i) => { col.ty = "relation".into(); col.relation = Some(dbs[i].name.clone()); }
            None => col.notes.push("relation to a database that is not in the export; the titles were kept as text".into()),
        }
    } else if let Some(dates) = values.iter().map(|v| parse_notion_date(v)).collect::<Option<Vec<_>>>() {
        col.ty = "date".into();
        let times = dates.iter().filter(|(_, t, _)| *t).count();
        let ranges = dates.iter().filter(|(_, _, r)| *r).count();
        if times > 0 { col.notes.push(format!("time of day dropped from {times} value(s); the property is a day")); }
        if ranges > 0 { col.notes.push(format!("date range end dropped from {ranges} value(s); only the start day is kept")); }
    } else if values.iter().all(|v| notion_number(v).is_some()) {
        col.ty = "number".into();
    } else if values.iter().all(|v| v.starts_with("http://") || v.starts_with("https://")) {
        col.ty = "url".into();
    } else {
        let short = |v: &str| v.chars().count() <= 32 && !v.contains('\n');
        let distinct: BTreeSet<&str> = values.iter().copied().collect();
        let tokens: Vec<String> = values.iter().flat_map(|v| v.split(',')).map(str::trim).filter(|s| !s.is_empty()).map(str::to_string).collect();
        let distinct_tokens: BTreeSet<&str> = tokens.iter().map(String::as_str).collect();
        if property_name(header) == "status" && distinct.len() <= SELECT_MAX_OPTIONS && distinct.iter().all(|v| short(v) && !v.contains(',')) {
            col.ty = "status".into();
            col.options = first_seen(values.iter().map(|v| v.to_string()));
        } else if values.iter().any(|v| v.contains(',')) && distinct_tokens.len() <= 2 * SELECT_MAX_OPTIONS && tokens.iter().all(|t| short(t)) {
            col.ty = "multi_select".into();
            col.options = first_seen(tokens.iter().cloned());
        } else if distinct.len() <= SELECT_MAX_OPTIONS && values.len() >= distinct.len() * 2 && distinct.iter().all(|v| short(v) && !v.contains(',')) {
            col.ty = "select".into();
            col.options = first_seen(values.iter().map(|v| v.to_string()));
        }
    }
    col
}

// ── Links ─────────────────────────────────────────────────────────────────────

/// Every page and database of the export, by hash and by path, with the title
/// a `[[link]]` to it needs.
struct Targets {
    by_hash: BTreeMap<String, String>,
    by_path: BTreeMap<PathBuf, String>,
}

impl Targets {
    fn title_for(&self, note_dir: &Path, target: &str) -> Option<String> {
        let target = percent_decode(target.split('#').next().unwrap_or("").trim());
        let lower = target.to_ascii_lowercase();
        if target.is_empty() || target.contains("://") || !(lower.ends_with(".md") || lower.ends_with(".csv")) { return None; }
        let stem = Path::new(&target).file_stem().and_then(|s| s.to_str()).unwrap_or("");
        let stem = stem.strip_suffix("_all").unwrap_or(stem);
        if let (_, Some(h)) = split_hash(stem) {
            if let Some(t) = self.by_hash.get(&h) { return Some(t.clone()); }
        }
        self.by_path.get(&normalize(&note_dir.join(&target))).cloned()
    }

    /// `[text](Page%20<hash>.md)` → `[[Title]]`; images and anything not in
    /// the export are left exactly as written (the latter listed).
    fn rewrite(&self, note_dir: &Path, note: &str, text: &str, unresolved: &mut Vec<String>) -> String {
        let mut out = String::with_capacity(text.len());
        let mut rest = text;
        while let Some(i) = rest.find('[') {
            out.push_str(&rest[..i]);
            let after = &rest[i + 1..];
            let is_image = out.ends_with('!');
            if !is_image && !after.starts_with('[') {
                if let Some(close) = after.find("](") {
                    let label = &after[..close];
                    let tail = &after[close + 2..];
                    if let Some(end) = tail.find(')') {
                        let link = &tail[..end];
                        let target = match link.trim().strip_prefix('<') { Some(t) => t.trim_end_matches('>'), None => link.split_whitespace().next().unwrap_or("") };
                        let lower = target.to_ascii_lowercase();
                        let local = !target.contains("://") && (lower.contains(".md") || lower.contains(".csv"));
                        if !label.contains('\n') && !link.contains('\n') && local {
                            match self.title_for(note_dir, target) {
                                Some(title) => {
                                    out.push_str(&format!("[[{title}]]"));
                                    rest = &tail[end + 1..];
                                    continue;
                                }
                                None => unresolved.push(format!("{note}: {}", percent_decode(target))),
                            }
                        }
                    }
                }
            }
            out.push('[');
            rest = after;
        }
        out.push_str(rest);
        out
    }
}

// ── The export on disk ────────────────────────────────────────────────────────

/// A zip unpacked under the system temp dir; removed when the import ends.
struct Unpacked(PathBuf);

impl Drop for Unpacked {
    fn drop(&mut self) { let _ = std::fs::remove_dir_all(&self.0); }
}

fn extract_zip(zip_path: &Path, dest: &Path, skipped: &mut Vec<Skipped>) -> Result<()> {
    let file = std::fs::File::open(zip_path).map_err(|e| AppError::Other(format!("Cannot read {}: {e}", zip_path.display())))?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| AppError::Other(format!("{} is not a zip file: {e}", zip_path.display())))?;
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| AppError::Other(format!("Cannot read {}: {e}", zip_path.display())))?;
        let Some(rel) = entry.enclosed_name() else {
            skipped.push(Skipped { path: entry.name().to_string(), reason: "unsafe path inside the zip".into() });
            continue;
        };
        let out = dest.join(rel);
        if entry.is_dir() { std::fs::create_dir_all(&out)?; continue; }
        if let Some(p) = out.parent() { std::fs::create_dir_all(p)?; }
        let mut f = std::fs::File::create(&out)?;
        std::io::copy(&mut entry, &mut f)?;
    }
    Ok(())
}

/// Unpack a zip (and the zips Notion nests inside a large export), or take a
/// folder as it is. Returns the folder that holds the pages.
fn unpack(src: &Path, skipped: &mut Vec<Skipped>) -> Result<(PathBuf, Option<Unpacked>)> {
    let src = src.canonicalize().map_err(|e| AppError::Other(format!("Cannot read {}: {e}", src.display())))?;
    let (dir, guard) = if src.is_dir() {
        (src, None)
    } else {
        let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.subsec_nanos()).unwrap_or(0);
        let tmp = std::env::temp_dir().join(format!("cortex-notion-{}-{nanos}", std::process::id()));
        std::fs::create_dir_all(&tmp)?;
        let guard = Unpacked(tmp.clone());
        extract_zip(&src, &tmp, skipped)?;
        // A large workspace exports as a zip of `Part-N.zip`s.
        let inner: Vec<PathBuf> = std::fs::read_dir(&tmp)?.flatten().map(|e| e.path())
            .filter(|p| p.extension().and_then(|e| e.to_str()).map(|e| e.eq_ignore_ascii_case("zip")).unwrap_or(false))
            .collect();
        for z in inner {
            extract_zip(&z, &tmp, skipped)?;
            std::fs::remove_file(&z)?;
        }
        (tmp, Some(guard))
    };
    Ok((descend_wrappers(dir), guard))
}

/// `Export-<uuid>/` or `Private & Shared/` around the pages: step inside
/// while a folder holds nothing but one folder.
fn descend_wrappers(mut dir: PathBuf) -> PathBuf {
    loop {
        let entries: Vec<PathBuf> = match std::fs::read_dir(&dir) {
            Ok(rd) => rd.flatten().map(|e| e.path()).filter(|p| !is_dot(p) && p.file_name().and_then(|n| n.to_str()) != Some("__MACOSX")).collect(),
            Err(_) => return dir,
        };
        match entries.as_slice() {
            [one] if one.is_dir() => dir = one.clone(),
            _ => return dir,
        }
    }
}

// ── Import ────────────────────────────────────────────────────────────────────

/// Import a Notion export (a zip, or the folder it unpacks to) into the
/// vault: pages under `notes/<into>/`, databases as collections, images in
/// `assets/`, and an import report note. With `dry_run` nothing is written.
pub fn import_notion(root: &Path, src: &Path, into: &str, dry_run: bool) -> Result<NotionReport> {
    let into = check_dest(into)?;
    if !src.exists() { return Err(AppError::Other(format!("Not found: {}", src.display()))); }
    let source = src.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| src.display().to_string());
    let mut skipped = Vec::new();
    let (export_root, _unpacked) = unpack(src, &mut skipped)?;

    // ── Inventory: pages, databases (preferring `_all.csv`), images ──
    let mut pages: Vec<Page> = Vec::new();
    let mut csvs: BTreeMap<(PathBuf, String), (PathBuf, bool)> = BTreeMap::new();
    let mut by_name: BTreeMap<String, Vec<PathBuf>> = BTreeMap::new();
    let mut walker = walkdir::WalkDir::new(&export_root).sort_by_file_name().into_iter();
    while let Some(entry) = walker.next() {
        let entry = match entry {
            Ok(e) => e,
            Err(e) => { skipped.push(Skipped { path: e.path().map(|p| rel_str(&export_root, p)).unwrap_or_default(), reason: format!("unreadable: {e}") }); continue; }
        };
        let p = entry.path();
        if p == export_root { continue; }
        let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("");
        if is_dot(p) || name == "__MACOSX" {
            skipped.push(Skipped { path: rel_str(&export_root, p), reason: if entry.file_type().is_dir() { "hidden folder".into() } else { "hidden file".into() } });
            if entry.file_type().is_dir() { walker.skip_current_dir(); }
            continue;
        }
        if entry.file_type().is_dir() { continue; }
        let ext = p.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase()).unwrap_or_default();
        if is_markdown(p) {
            let text = match std::fs::read_to_string(p) {
                Ok(t) => t,
                Err(e) => { skipped.push(Skipped { path: rel_str(&export_root, p), reason: format!("unreadable: {e}") }); continue; }
            };
            let stem = p.file_stem().and_then(|s| s.to_str()).unwrap_or("");
            let (clean, hash) = split_hash(stem);
            let stem = if clean.is_empty() { "Untitled".to_string() } else { clean };
            let (h1, _, _) = split_page(&text, None);
            let title = h1.filter(|t| !t.is_empty()).unwrap_or_else(|| stem.clone());
            pages.push(Page { src: p.to_path_buf(), hash, stem, title, text, row_of: None, matched: false });
        } else if ext == "csv" {
            let stem = p.file_stem().and_then(|s| s.to_str()).unwrap_or("");
            let all = stem.ends_with("_all");
            let key = (p.parent().map(Path::to_path_buf).unwrap_or_default(), stem.strip_suffix("_all").unwrap_or(stem).to_string());
            let dup = |p: &Path| Skipped { path: rel_str(&export_root, p), reason: "the same database as its _all.csv".into() };
            match csvs.get(&key) {
                None => { csvs.insert(key, (p.to_path_buf(), all)); }
                Some((_, true)) => skipped.push(dup(p)),
                Some((_, false)) if !all => skipped.push(dup(p)),
                Some((other, false)) => {
                    let other = other.clone();
                    skipped.push(dup(&other));
                    csvs.insert(key, (p.to_path_buf(), all));
                }
            }
        } else if is_image(p) {
            by_name.entry(name.to_ascii_lowercase()).or_default().push(p.to_path_buf());
        } else {
            skipped.push(Skipped { path: rel_str(&export_root, p), reason: "not Markdown, CSV or an image".into() });
        }
    }

    let mut databases: Vec<Database> = Vec::new();
    let mut names: BTreeSet<String> = BTreeSet::new();
    for ((dir, stem), (csv, _)) in csvs {
        let text = match std::fs::read_to_string(&csv) {
            Ok(t) => t,
            Err(e) => { skipped.push(Skipped { path: rel_str(&export_root, &csv), reason: format!("unreadable: {e}") }); continue; }
        };
        let mut records = parse_csv(&text);
        if records.is_empty() {
            skipped.push(Skipped { path: rel_str(&export_root, &csv), reason: "empty CSV".into() });
            continue;
        }
        let header: Vec<String> = records.remove(0).into_iter().map(|h| h.trim().to_string()).collect();
        let (title, hash) = split_hash(&stem);
        let title = if title.is_empty() { "Untitled".to_string() } else { title };
        let base = { let s = slugify(&title); if s.is_empty() { "database".to_string() } else { s } };
        let mut name = base.clone();
        let mut n = 2;
        while !names.insert(name.clone()) { name = format!("{base}-{n}"); n += 1; }
        let row_dir = dir.join(&stem);
        databases.push(Database { csv, hash, title, name, dir: row_dir.is_dir().then_some(row_dir), header, records });
    }
    for page in pages.iter_mut() {
        page.row_of = page.src.parent().and_then(|d| databases.iter().position(|db| db.dir.as_deref() == Some(d)));
    }

    // Link targets: every page and database, by hash and by path.
    let mut targets = Targets { by_hash: BTreeMap::new(), by_path: BTreeMap::new() };
    for p in &pages {
        if let Some(h) = &p.hash { targets.by_hash.insert(h.clone(), p.title.clone()); }
        targets.by_path.insert(normalize(&p.src), p.title.clone());
    }
    for d in &databases {
        if let Some(h) = &d.hash { targets.by_hash.insert(h.clone(), d.title.clone()); }
        targets.by_path.insert(normalize(&d.csv), d.title.clone());
        if let Some(stem) = d.csv.file_stem().and_then(|s| s.to_str()) {
            let stem = stem.strip_suffix("_all").unwrap_or(stem);
            for variant in [format!("{stem}.csv"), format!("{stem}_all.csv")] {
                targets.by_path.insert(normalize(&d.csv.with_file_name(variant)), d.title.clone());
            }
        }
    }

    let mut assets = Assets { root, src_root: &export_root, by_name, placed: BTreeMap::new(), claimed: BTreeSet::new(), copied: Vec::new(), unresolved: Vec::new(), dry_run };
    let mut unresolved_links: Vec<String> = Vec::new();
    let mut unmapped: Vec<Unmapped> = Vec::new();
    let mut titles_seen: BTreeMap<String, usize> = BTreeMap::new();
    let mut claimed_paths: BTreeSet<String> = BTreeSet::new();

    // ── Databases → collections ──
    let mut collections = Vec::new();
    for di in 0..databases.len() {
        let db = &databases[di];
        let dir = root.join("collections").join(&db.name);
        let known = db.header.clone();
        let mut cols: Vec<Col> = db.header.iter().enumerate().map(|(j, h)| {
            let cells: Vec<&str> = db.records.iter().map(|r| r.get(j).map(String::as_str).unwrap_or("")).collect();
            notion_column(h, &cells, &databases, di)
        }).collect();
        // The first column is the title in Notion; a property named `title` elsewhere would clash.
        if let Some(c) = cols.first_mut() { c.property = "title".into(); c.ty = "text".into(); }
        let mut seen: BTreeSet<String> = BTreeSet::new();
        for c in cols.iter_mut().skip(1) {
            let base = if c.property == "title" { "title_2".to_string() } else { c.property.clone() };
            let mut p = base.clone();
            let mut n = 2;
            while p == "title" || !seen.insert(p.clone()) { p = format!("{base}_{n}"); n += 1; }
            c.property = p;
        }

        // Schema: an existing property keeps its type; new ones come from the columns.
        let schema_exists = schema::load(root, &db.name)?.is_some();
        let mut schema = schema::load(root, &db.name)?.unwrap_or_default();
        let mut schema_added = Vec::new();
        for c in cols.iter_mut().skip(1) {
            match schema.property(&c.property) {
                Some(p) => {
                    c.ty = ty_name(p.ty).into();
                    c.relation = p.collection.clone();
                    c.options.clear();
                }
                None => {
                    let ty = match c.ty.as_str() {
                        "number" => PropType::Number, "date" => PropType::Date, "checkbox" => PropType::Checkbox,
                        "select" => PropType::Select, "multi_select" => PropType::MultiSelect, "status" => PropType::Status,
                        "url" => PropType::Url, "relation" => PropType::Relation, _ => PropType::Text,
                    };
                    schema.properties.push(PropertyDef {
                        name: c.property.clone(),
                        ty,
                        options: c.options.iter().map(|o| SelectOption { name: o.clone(), color: "gray".into() }).collect(),
                        collection: c.relation.clone(),
                        ..Default::default()
                    });
                    schema_added.push(c.property.clone());
                }
            }
            for n in &c.notes {
                unmapped.push(Unmapped { subject: format!("{} · {}", db.name, c.header), detail: n.clone() });
            }
        }

        // Rows: every CSV record, with its page's body when the row folder has one.
        let page_ids: Vec<usize> = pages.iter().enumerate().filter(|(_, p)| p.row_of == Some(di)).map(|(i, _)| i).collect();
        let mut rows: Vec<(String, BTreeMap<String, serde_json::Value>, Option<usize>)> = Vec::new();
        for rec in &db.records {
            let title = rec.first().map(|s| s.trim()).unwrap_or("").to_string();
            let mut fm: BTreeMap<String, serde_json::Value> = BTreeMap::new();
            for (j, c) in cols.iter().enumerate().skip(1) {
                if let Some(v) = rec.get(j).and_then(|raw| notion_cell(raw, &c.ty)) { fm.insert(c.property.clone(), v); }
            }
            let want = loose(&title);
            let page = page_ids.iter().copied().find(|&i| !pages[i].matched && (loose(&pages[i].stem) == want || loose(&pages[i].title) == want))
                .or_else(|| page_ids.iter().copied().find(|&i| !pages[i].matched && !want.is_empty() && want.starts_with(&loose(&pages[i].stem))));
            if let Some(i) = page { pages[i].matched = true; }
            rows.push((title, fm, page));
        }
        // Pages in the row folder the CSV did not list: rows too, from their property block.
        for &i in &page_ids {
            if pages[i].matched { continue; }
            pages[i].matched = true;
            let (_, props, _) = split_page(&pages[i].text, Some(known.as_slice()));
            let mut fm: BTreeMap<String, serde_json::Value> = BTreeMap::new();
            for (k, v) in props {
                let Some(c) = cols.iter().skip(1).find(|c| c.header.eq_ignore_ascii_case(&k)) else { continue };
                if let Some(val) = notion_cell(&v, &c.ty) { fm.insert(c.property.clone(), val); }
            }
            rows.push((pages[i].title.clone(), fm, Some(i)));
        }

        let mut written = Vec::new();
        let mut index_created = false;
        if !dry_run { std::fs::create_dir_all(&dir)?; }
        for (n, (title, mut fm, page)) in rows.into_iter().enumerate() {
            let base = { let s = slugify(&title); if s.is_empty() { format!("row-{}", n + 1) } else { s } };
            let mut id = base.clone();
            let mut k = 2;
            while !claimed_paths.insert(format!("collections/{}/{id}.md", db.name)) { id = format!("{base}-{k}"); k += 1; }
            let path = format!("collections/{}/{id}.md", db.name);
            let title = if title.is_empty() { format!("Row {}", n + 1) } else { title };
            *titles_seen.entry(title.clone()).or_default() += 1;
            if root.join(&path).exists() {
                skipped.push(Skipped { path: path.clone(), reason: format!("already exists ({title})") });
                continue;
            }
            fm.insert("title".into(), serde_json::Value::String(title));
            let body = match page {
                Some(i) => {
                    let (_, _, body) = split_page(&pages[i].text, Some(known.as_slice()));
                    let note_dir = pages[i].src.parent().unwrap_or(&export_root);
                    let body = assets.rewrite(note_dir, &body)?;
                    targets.rewrite(note_dir, &path, &body, &mut unresolved_links)
                }
                None => String::new(),
            };
            if !dry_run {
                let note = crate::note::Note { path: path.clone(), frontmatter: fm, body };
                std::fs::write(root.join(&path), crate::note::serialize_note(&note)?)?;
            }
            written.push(path);
        }
        if !dry_run {
            index_created = write_index_note(root, &db.name, &db.title)?;
            if !written.is_empty() && (!schema_exists || !schema_added.is_empty()) {
                schema::save(root, &db.name, &schema)?;
            }
        }
        *titles_seen.entry(db.title.clone()).or_default() += 1;
        let schema_added = if written.is_empty() && schema_exists { Vec::new() } else { schema_added };
        collections.push(NotionCollection { name: db.name.clone(), title: db.title.clone(), rows: db.records.len(), written, schema_added, index_created });
    }

    // ── Pages → notes ──
    let dest_root = format!("notes/{into}");
    let mut notes = Vec::new();
    for pi in 0..pages.len() {
        if pages[pi].matched { continue; }
        let page = &pages[pi];
        let rel = page.src.strip_prefix(&export_root).unwrap_or(&page.src);
        let clean = clean_rel(rel);
        let clean_str = clean.to_string_lossy().replace('\\', "/");
        let (stem, _) = clean_str.rsplit_once('.').map(|(s, e)| (s.to_string(), e)).unwrap_or((clean_str.clone(), "md"));
        let mut path = format!("{dest_root}/{stem}.md");
        let mut k = 2;
        while !claimed_paths.insert(path.clone()) { path = format!("{dest_root}/{stem} {k}.md"); k += 1; }
        *titles_seen.entry(page.title.clone()).or_default() += 1;
        if root.join(&path).exists() {
            skipped.push(Skipped { path: rel_str(&export_root, &page.src), reason: "already exists".into() });
            continue;
        }
        let (_, props, body) = split_page(&page.text, None);
        let mut fm: BTreeMap<String, serde_json::Value> = BTreeMap::new();
        fm.insert("title".into(), serde_json::Value::String(page.title.clone()));
        for (k, v) in props {
            let key = property_name(&k);
            if key == "title" || v.trim().is_empty() { continue; }
            fm.insert(key, infer_value(&v));
        }
        let note_dir = page.src.parent().unwrap_or(&export_root);
        let body = assets.rewrite(note_dir, &body)?;
        let body = targets.rewrite(note_dir, &path, &body, &mut unresolved_links);
        if !dry_run {
            if let Some(parent) = root.join(&path).parent() { std::fs::create_dir_all(parent)?; }
            let note = crate::note::Note { path: path.clone(), frontmatter: fm, body };
            std::fs::write(root.join(&path), crate::note::serialize_note(&note)?)?;
        }
        notes.push(path);
    }

    for (title, n) in &titles_seen {
        if *n > 1 {
            unmapped.push(Unmapped { subject: title.clone(), detail: format!("{n} pages share this title, so a [[{title}]] link is ambiguous") });
        }
    }
    let mut unresolved: Vec<String> = unresolved_links;
    unresolved.extend(assets.unresolved.iter().map(|u| format!("image: {u}")));
    unresolved.sort();
    unresolved.dedup();

    let mut report = NotionReport {
        source, dest: dest_root.clone(), notes, collections, assets: assets.copied, skipped, unmapped, unresolved, report: None,
    };

    // ── The import report note ──
    let report_path = format!("{dest_root}/Notion import report.md");
    if root.join(&report_path).exists() {
        report.skipped.push(Skipped { path: report_path, reason: "already exists (the import report)".into() });
    } else {
        if !dry_run {
            std::fs::create_dir_all(root.join(&dest_root))?;
            let mut fm: BTreeMap<String, serde_json::Value> = BTreeMap::new();
            fm.insert("title".into(), serde_json::Value::String("Notion import report".into()));
            fm.insert("tags".into(), serde_json::json!(["import"]));
            let note = crate::note::Note { path: report_path.clone(), frontmatter: fm, body: report_body(&report) };
            std::fs::write(root.join(&report_path), crate::note::serialize_note(&note)?)?;
        }
        report.report = Some(report_path);
    }
    Ok(report)
}

/// The report note's body: counts, then everything that needs a human eye.
fn report_body(r: &NotionReport) -> String {
    let mut b = String::new();
    b.push_str(&format!("Imported from `{}`.\n\n", r.source));
    b.push_str(&format!("- {} page(s) → `{}/`\n", r.notes.len(), r.dest));
    for c in &r.collections {
        b.push_str(&format!("- [[{}]] → `collections/{}/`: {} of {} row(s) written{}\n", c.title, c.name, c.written.len(), c.rows,
            if c.schema_added.is_empty() { String::new() } else { format!("; schema: {}", c.schema_added.join(", ")) }));
    }
    b.push_str(&format!("- {} image(s) → `assets/`\n", r.assets.len()));
    if !r.unmapped.is_empty() {
        b.push_str("\n## Could not be mapped\n\n");
        for u in &r.unmapped { b.push_str(&format!("- **{}** — {}\n", u.subject, u.detail)); }
    }
    if !r.unresolved.is_empty() {
        b.push_str("\n## Links left as written\n\nThese pointed outside the export.\n\n");
        for u in &r.unresolved { b.push_str(&format!("- `{u}`\n")); }
    }
    if !r.skipped.is_empty() {
        b.push_str("\n## Skipped\n\n");
        for s in &r.skipped { b.push_str(&format!("- `{}` — {}\n", s.path, s.reason)); }
    }
    b
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/notion-export")
    }

    fn scratch(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!("cortex-notion-test-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        root
    }

    fn known(v: &[&str]) -> Vec<String> { v.iter().map(|s| s.to_string()).collect() }

    fn read(root: &Path, rel: &str) -> String {
        std::fs::read_to_string(root.join(rel)).unwrap_or_else(|e| panic!("{rel}: {e}"))
    }

    #[test]
    fn names_lose_their_hash() {
        assert_eq!(split_hash("Dune 3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f"), ("Dune".into(), Some("3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f".into())));
        assert_eq!(split_hash("3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f"), ("".into(), Some("3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f".into())));
        assert_eq!(split_hash("Plain name"), ("Plain name".into(), None));
        assert_eq!(split_hash("Café 3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f").0, "Café");
        assert_eq!(clean_rel(Path::new("Home 1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d/Meeting notes 9c0d1e2f3a4b5c6d7e8f900112233445.md")), PathBuf::from("Home/Meeting notes.md"));
    }

    #[test]
    fn notion_values_parse() {
        assert_eq!(parse_notion_date("January 5, 2024"), Some(("2024-01-05".into(), false, false)));
        assert_eq!(parse_notion_date("January 5, 2024 3:12 PM"), Some(("2024-01-05".into(), true, false)));
        assert_eq!(parse_notion_date("February 10, 2024 → February 12, 2024"), Some(("2024-02-10".into(), false, true)));
        assert_eq!(parse_notion_date("2024-02-10T10:00:00.000Z"), Some(("2024-02-10".into(), true, false)));
        assert_eq!(parse_notion_date("Sept 1, 2024").map(|d| d.0), Some("2024-09-01".into()));
        assert_eq!(parse_notion_date("not a date"), None);
        assert_eq!(parse_notion_date("Dune"), None);
        assert_eq!(notion_number("$1,200.50"), Some("1200.50".into()));
        assert_eq!(notion_number("35%"), Some("35".into()));
        assert_eq!(notion_number("4 stars"), None);
        let rel = split_relation("Dune (../Reading%20list%20abc/Dune%20def.md), Emma (../Reading%20list%20abc/Emma%20ghi.md)").unwrap();
        assert_eq!(rel.iter().map(|(t, _)| t.as_str()).collect::<Vec<_>>(), vec!["Dune", "Emma"]);
        assert_eq!(rel[0].1, "../Reading list abc/Dune def.md");
        assert_eq!(split_relation("plain text"), None);
        assert_eq!(infer_value("Yes"), serde_json::json!(true));
        assert_eq!(infer_value("March 3, 2024"), serde_json::json!("2024-03-03"));
        assert_eq!(infer_value("2.5"), serde_json::json!(2.5));
    }

    #[test]
    fn pages_split_into_title_properties_and_body() {
        let (t, props, body) = split_page("# Dune\n\nStatus: Done\nPages: 412\nWebsite:\n\nBody here.\n\nMore.\n", Some(known(&["Status", "Pages", "Website"]).as_slice()));
        assert_eq!(t.as_deref(), Some("Dune"));
        assert_eq!(props, vec![("Status".into(), "Done".into()), ("Pages".into(), "412".into()), ("Website".into(), "".into())]);
        assert_eq!(body, "Body here.\n\nMore.\n");
        // A lone line right after the title is body text, not a property.
        let (_, props, body) = split_page("# Notes\n\nNote: this is prose.\n\nMore.\n", None);
        assert!(props.is_empty());
        assert!(body.starts_with("Note: this is prose."));
        // Two or more lines are a block even without a CSV to name the keys.
        let (_, props, body) = split_page("# Task\n\nStatus: Done\nDue: March 3, 2024\n\nBody.\n", None);
        assert_eq!(props.len(), 2);
        assert_eq!(body, "Body.\n");
        // A URL on its own is not a property.
        let (_, props, _) = split_page("# X\n\nhttps://example.com\nhttp://other.org\n\n", None);
        assert!(props.is_empty());
        // A column the CSV does not have stops the block for a row page.
        let (_, props, body) = split_page("# Row\n\nStatus: Done\nOops: no\n\nBody.\n", Some(known(&["Status"]).as_slice()));
        assert!(props.is_empty());
        assert!(body.starts_with("Status: Done"));
    }

    #[test]
    fn export_folder_becomes_notes_collections_and_a_report() {
        let root = scratch("folder");
        let dry = import_notion(&root, &fixture(), "notion", true).unwrap();
        assert!(!root.join("notes").exists() && !root.join("collections").exists(), "dry run writes nothing");
        assert_eq!(dry.notes.len(), 5, "{:?}", dry.notes);

        let r = import_notion(&root, &fixture(), "notion", false).unwrap();
        assert_eq!(r.dest, "notes/notion");
        assert_eq!(r.notes, vec![
            "notes/notion/Home/Meeting notes/Untitled.md",
            "notes/notion/Home/Meeting notes.md",
            "notes/notion/Home/Standalone task.md",
            "notes/notion/Home/Untitled.md",
            "notes/notion/Home.md",
        ]);
        assert_eq!(r.report.as_deref(), Some("notes/notion/Notion import report.md"));
        assert_eq!(r.assets, vec!["assets/cover.png"]);

        // Collections: the _all CSV wins, rows carry typed frontmatter and the page body.
        assert_eq!(r.collections.iter().map(|c| c.name.as_str()).collect::<Vec<_>>(), vec!["authors", "reading-list"]);
        let rl = r.collections.iter().find(|c| c.name == "reading-list").unwrap();
        assert_eq!(rl.title, "Reading list");
        assert_eq!(rl.rows, 3, "Solaris comes from _all.csv");
        assert_eq!(rl.written, vec!["collections/reading-list/dune.md", "collections/reading-list/emma.md", "collections/reading-list/solaris.md"]);
        assert!(rl.index_created);
        assert_eq!(rl.schema_added, vec!["author", "finished", "pages", "rating", "read", "status", "tags", "link", "created_time"]);
        assert!(r.skipped.iter().any(|s| s.path.ends_with("2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e.csv") && s.reason.contains("_all")), "{:?}", r.skipped);
        assert!(r.skipped.iter().any(|s| s.path.ends_with("agenda.pdf")), "{:?}", r.skipped);

        let dune = read(&root, "collections/reading-list/dune.md");
        assert_eq!(dune, "---\nauthor:\n- Frank Herbert\ncreated_time: 2024-01-01\nfinished: 2024-01-05\nlink: https://example.com/dune\npages: 412\nrating: ⭐⭐⭐⭐\nread: true\nstatus: Done\ntags:\n- sci-fi\n- classic\ntitle: Dune\n---\n\nArrakis. Dune. Desert planet. Compare with [[Emma]] and see the cover in [[Meeting notes]].\n\n![cover](assets/cover.png)\n");
        let solaris = read(&root, "collections/reading-list/solaris.md");
        assert!(solaris.contains("finished: 2024-02-10") && solaris.contains("title: Solaris") && solaris.ends_with("---\n\n"), "{solaris}");
        assert!(!solaris.contains("author"), "an empty cell is omitted: {solaris}");

        let schema = schema::load(&root, "reading-list").unwrap().unwrap();
        let ty = |n: &str| schema.property(n).unwrap().ty;
        assert_eq!(ty("author"), PropType::Relation);
        assert_eq!(schema.property("author").unwrap().collection.as_deref(), Some("authors"));
        assert_eq!(ty("finished"), PropType::Date);
        assert_eq!(ty("pages"), PropType::Number);
        assert_eq!(ty("read"), PropType::Checkbox);
        assert_eq!(ty("status"), PropType::Status);
        assert_eq!(schema.property("status").unwrap().options.iter().map(|o| o.name.as_str()).collect::<Vec<_>>(), vec!["Done", "Reading"]);
        assert_eq!(ty("tags"), PropType::MultiSelect);
        assert_eq!(schema.property("tags").unwrap().options.iter().map(|o| o.name.as_str()).collect::<Vec<_>>(), vec!["sci-fi", "classic", "romance"]);
        assert_eq!(ty("link"), PropType::Url);
        assert_eq!(ty("rating"), PropType::Text);
        assert_eq!(ty("created_time"), PropType::Date);
        let index = read(&root, "collections/reading-list/_index.md");
        assert!(index.contains("title: Reading list") && index.contains("type: database"), "{index}");

        let authors = schema::load(&root, "authors").unwrap().unwrap();
        assert_eq!(authors.property("books").unwrap().ty, PropType::Relation);
        assert_eq!(authors.property("books").unwrap().collection.as_deref(), Some("reading-list"));
        assert_eq!(authors.property("born").unwrap().ty, PropType::Date);
        assert_eq!(authors.property("website").unwrap().ty, PropType::Url);
        let jane = read(&root, "collections/authors/jane-austen.md");
        assert!(jane.contains("born: 1775-12-16") && !jane.contains("website"), "{jane}");
        let frank = read(&root, "collections/authors/frank-herbert.md");
        assert!(frank.contains("Wrote [[Dune]].\n"), "{frank}");

        // Pages: hashes gone, title in frontmatter, links rewritten, images in assets/.
        let home = read(&root, "notes/notion/Home.md");
        assert!(home.starts_with("---\ntitle: Home\n---\n\n"), "{home}");
        assert!(home.contains("The books are in [[Reading list]] and the people in [[Authors]]."), "{home}");
        assert!(home.contains("[[Meeting notes]] and an [[Untitled]] page."), "{home}");
        assert!(home.contains("[page that is not here](Gone%20ffffffffffffffffffffffffffffffff.md) and the [Notion site](https://www.notion.so/)"), "{home}");
        let meet = read(&root, "notes/notion/Home/Meeting notes.md");
        assert!(meet.contains("Note: this line looks like a property but is body text."), "{meet}");
        assert!(!meet.contains("note:"), "a lone line is not a property: {meet}");
        assert!(meet.contains("![cover](assets/cover.png) and a [[Untitled]]."), "{meet}");
        let sub = read(&root, "notes/notion/Home/Meeting notes/Untitled.md");
        assert!(sub.contains("Back to [[Home]]."), "{sub}");
        let task = read(&root, "notes/notion/Home/Standalone task.md");
        assert!(task.starts_with("---\ndue: 2024-03-03\nestimate: 2.5\nstatus: Done\ntitle: Standalone task\n---\n\nA database page"), "{task}");

        // The report lists what needed a human.
        assert!(r.unresolved.contains(&"notes/notion/Home.md: Gone ffffffffffffffffffffffffffffffff.md".to_string()), "{:?}", r.unresolved);
        assert!(r.unmapped.iter().any(|u| u.subject == "Untitled" && u.detail.contains("2 pages")), "{:?}", r.unmapped);
        assert!(r.unmapped.iter().any(|u| u.subject == "reading-list · Finished" && u.detail.contains("range")), "{:?}", r.unmapped);
        assert!(r.unmapped.iter().any(|u| u.subject == "reading-list · Created time" && u.detail.contains("time of day")), "{:?}", r.unmapped);
        let report = read(&root, "notes/notion/Notion import report.md");
        assert!(report.contains("Imported from `notion-export`.") && report.contains("[[Reading list]]") && report.contains("## Could not be mapped") && report.contains("Gone ffff"), "{report}");
        assert!(fixture().join("Home 1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d.md").exists(), "the source is untouched");

        // Again: nothing is overwritten, everything is reported as already there.
        let again = import_notion(&root, &fixture(), "notion", false).unwrap();
        assert!(again.notes.is_empty() && again.collections.iter().all(|c| c.written.is_empty() && c.schema_added.is_empty()), "{again:?}");
        assert_eq!(again.report, None);
        assert_eq!(read(&root, "collections/reading-list/dune.md"), dune, "a re-run leaves the rows as they were");
        assert!(again.skipped.iter().filter(|s| s.reason.starts_with("already exists")).count() >= 11, "{:?}", again.skipped);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_zip_imports_like_the_folder_and_is_cleaned_up() {
        let root = scratch("zip");
        // Zip the fixture the way Notion does: one wrapper folder, stored entries.
        let zip_path = root.join("Export-abc.zip");
        {
            let file = std::fs::File::create(&zip_path).unwrap();
            let mut zw = zip::ZipWriter::new(file);
            let opts = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
            for entry in walkdir::WalkDir::new(fixture()).sort_by_file_name() {
                let entry = entry.unwrap();
                if !entry.file_type().is_file() { continue; }
                let rel = entry.path().strip_prefix(fixture()).unwrap().to_string_lossy().replace('\\', "/");
                zw.start_file(format!("Export-abc/{rel}"), opts).unwrap();
                std::io::copy(&mut std::fs::File::open(entry.path()).unwrap(), &mut zw).unwrap();
            }
            zw.finish().unwrap();
        }
        let r = import_notion(&root, &zip_path, "notion", false).unwrap();
        assert_eq!(r.source, "Export-abc.zip");
        assert!(r.notes.contains(&"notes/notion/Home.md".to_string()), "the wrapper folder is stepped over: {:?}", r.notes);
        assert_eq!(r.collections.iter().map(|c| c.written.len()).sum::<usize>(), 5);
        assert_eq!(read(&root, "collections/reading-list/dune.md"), {
            let other = scratch("zip-folder");
            import_notion(&other, &fixture(), "notion", false).unwrap();
            let d = read(&other, "collections/reading-list/dune.md");
            let _ = std::fs::remove_dir_all(&other);
            d
        }, "the zip and the folder import identically");
        let leftovers: Vec<_> = std::fs::read_dir(std::env::temp_dir()).unwrap().flatten()
            .filter(|e| e.file_name().to_string_lossy().starts_with(&format!("cortex-notion-{}-", std::process::id()))).collect();
        assert!(leftovers.is_empty(), "the unpacked zip is removed: {leftovers:?}");
        assert!(import_notion(&root, &root.join("nope.zip"), "notion", true).is_err());
        let _ = std::fs::remove_dir_all(&root);
    }
}
