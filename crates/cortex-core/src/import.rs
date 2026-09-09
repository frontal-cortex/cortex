//! Importers — the way in from somewhere else.
//!
//! Two doors, both ending in ordinary files the user could have written by
//! hand:
//!
//! - **CSV → collection.** Each record becomes one row note under
//!   `collections/<name>/`, named from its title column, with the other
//!   columns as typed frontmatter. The collection's schema is written (or
//!   merged into) so the table view knows the types straight away. A plan
//!   (`plan_csv`) shows the column mapping and the first rows before anything
//!   is written; `import_csv` writes.
//! - **Markdown folder → notes.** Every `*.md` under a folder (an Obsidian
//!   vault, a Notion export, a pile of files) is copied under
//!   `notes/<into>/`, keeping its frontmatter and `[[links]]` as they are.
//!   Images the notes reference are copied into `assets/` and the references
//!   rewritten to that path. Dot-directories (`.obsidian/`, `.git/`) are
//!   skipped. The source folder is never modified.
//!
//! Nothing here writes derived data: what lands in a file came from the
//! source file, coerced to a type at most. Existing files are never
//! overwritten — a collision is reported as skipped.

use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

use crate::data::{self, ColumnType};
use crate::error::{AppError, Result};
use crate::schema::{self, PropType, PropertyDef, SelectOption, TypeSchema};

// ── CSV parsing ───────────────────────────────────────────────────────────────

/// RFC 4180-ish: quoted fields may hold commas, doubled quotes and newlines.
/// A BOM is dropped; CRLF and LF both end a record; blank records are skipped.
pub fn parse_csv(text: &str) -> Vec<Vec<String>> {
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    let mut records = Vec::new();
    let mut record = Vec::new();
    let mut field = String::new();
    let mut in_quotes = false;
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        if in_quotes {
            if c == '"' {
                if chars.peek() == Some(&'"') { field.push('"'); chars.next(); } else { in_quotes = false; }
            } else {
                field.push(c);
            }
            continue;
        }
        match c {
            '"' => in_quotes = true,
            ',' => record.push(std::mem::take(&mut field)),
            '\r' => {}
            '\n' => {
                record.push(std::mem::take(&mut field));
                if record.iter().any(|f| !f.trim().is_empty()) { records.push(std::mem::take(&mut record)); } else { record.clear(); }
            }
            _ => field.push(c),
        }
    }
    if !field.is_empty() || !record.is_empty() {
        record.push(field);
        if record.iter().any(|f| !f.trim().is_empty()) { records.push(record); }
    }
    records
}

// ── CSV → collection ──────────────────────────────────────────────────────────

/// How one CSV column lands. `property` empty = the column is skipped.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ColumnMap {
    /// The CSV header, exactly as in the file.
    pub header: String,
    /// Frontmatter key it becomes.
    pub property: String,
    /// text | number | date | checkbox | select | multi_select | url
    #[serde(rename = "type")]
    pub ty: String,
    /// Select: the distinct values seen (become the schema's options).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub options: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct CsvOptions {
    /// Target collection (the folder name under `collections/`).
    pub collection: String,
    /// Header of the column that names each row (default: `title` / `name`, else the first column).
    #[serde(default)]
    pub title_column: Option<String>,
    /// Overrides for the inferred mapping, by header. Absent headers keep the inference.
    #[serde(default)]
    pub columns: Vec<ColumnMap>,
}

/// One row as it would be written.
#[derive(Debug, Clone, Serialize)]
pub struct RowPreview {
    /// Vault-relative path of the note.
    pub path: String,
    pub frontmatter: BTreeMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Skipped {
    pub path: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct CsvPlan {
    pub collection: String,
    /// The collection folder already exists — rows are added to it.
    pub exists: bool,
    pub title_column: String,
    /// Every header, in file order, with where it goes.
    pub columns: Vec<ColumnMap>,
    pub rows: usize,
    /// The first rows, as they would be written.
    pub preview: Vec<RowPreview>,
    /// Properties the schema gains ("created" when there was no schema).
    pub schema_added: Vec<String>,
    pub schema_exists: bool,
    /// Rows that would not be written and why (a file already there, a duplicate title).
    pub skipped: Vec<Skipped>,
}

#[derive(Debug, Clone, Serialize)]
pub struct CsvReport {
    pub collection: String,
    /// Vault-relative paths written, in file order.
    pub written: Vec<String>,
    pub skipped: Vec<Skipped>,
    pub schema_added: Vec<String>,
    /// `_index.md` was created because the collection was new.
    pub index_created: bool,
}

const PREVIEW_ROWS: usize = 5;
/// A text column with this many distinct short values (or fewer), each used
/// more than once on average, is offered as a select.
const SELECT_MAX_OPTIONS: usize = 10;

/// `Due date` → `due_date`; a header that is already a key stays as it is.
pub fn property_name(header: &str) -> String {
    let mut out = String::new();
    let mut sep = false;
    for c in header.trim().chars() {
        if c.is_alphanumeric() { out.push(c.to_ascii_lowercase()); sep = false; }
        else if !sep && !out.is_empty() { out.push('_'); sep = true; }
    }
    let out = out.trim_end_matches('_').to_string();
    if out.is_empty() { "column".into() } else { out }
}

fn prop_type_name(ty: ColumnType) -> &'static str {
    match ty {
        ColumnType::Number => "number",
        ColumnType::Bool => "checkbox",
        ColumnType::Date => "date",
        ColumnType::List => "multi_select",
        ColumnType::Text => "text",
    }
}

fn parse_prop_type(s: &str) -> Result<PropType> {
    Ok(match s.trim() {
        "text" | "" => PropType::Text,
        "number" => PropType::Number,
        "date" => PropType::Date,
        "checkbox" => PropType::Checkbox,
        "select" => PropType::Select,
        "multi_select" => PropType::MultiSelect,
        "status" => PropType::Status,
        "url" => PropType::Url,
        other => return Err(AppError::Other(format!("Unknown property type '{other}' (text, number, date, checkbox, select, multi_select, status, url)"))),
    })
}

fn is_url(s: &str) -> bool {
    s.starts_with("http://") || s.starts_with("https://")
}

/// Infer each column's type from its cells, then upgrade text columns that
/// look like a small vocabulary to select and URL columns to url.
fn infer_mapping(header: &[String], records: &[Vec<String>]) -> Vec<ColumnMap> {
    let rows: Vec<data::Row> = records.iter().enumerate().map(|(i, rec)| {
        let cells = header.iter().enumerate()
            .map(|(j, h)| (h.clone(), data::infer_cell(rec.get(j).map(String::as_str).unwrap_or(""))))
            .collect();
        data::Row { id: i.to_string(), cells }
    }).collect();
    let inferred = data::infer_columns(&rows);
    let mut seen_props: BTreeSet<String> = BTreeSet::new();
    header.iter().enumerate().map(|(j, h)| {
        let mut ty = inferred.iter().find(|c| &c.key == h).map(|c| prop_type_name(c.ty)).unwrap_or("text").to_string();
        let mut options = Vec::new();
        if ty == "text" {
            let values: Vec<&str> = records.iter()
                .filter_map(|r| r.get(j).map(|s| s.trim()).filter(|s| !s.is_empty()))
                .collect();
            let distinct: BTreeSet<&str> = values.iter().copied().collect();
            if !values.is_empty() && values.iter().all(|v| is_url(v)) {
                ty = "url".into();
            } else if !distinct.is_empty()
                && distinct.len() <= SELECT_MAX_OPTIONS
                && values.len() >= distinct.len() * 2
                && distinct.iter().all(|v| v.chars().count() <= 32 && !v.contains(',') && !v.contains('\n'))
            {
                ty = "select".into();
                // First-seen order, the way the file introduces them.
                for v in &values { if !options.iter().any(|o| o == v) { options.push(v.to_string()); } }
            }
        }
        // Two headers that collapse to one key get numbered, never merged.
        let base = property_name(h);
        let mut property = base.clone();
        let mut n = 2;
        while !seen_props.insert(property.clone()) { property = format!("{base}_{n}"); n += 1; }
        ColumnMap { header: h.clone(), property, ty, options }
    }).collect()
}

fn pick_title_column(header: &[String], wanted: Option<&str>) -> Result<String> {
    if let Some(w) = wanted {
        return header.iter().find(|h| h.as_str() == w || h.eq_ignore_ascii_case(w))
            .cloned()
            .ok_or_else(|| AppError::Other(format!("No column '{w}' in the CSV (columns: {})", header.join(", "))));
    }
    for want in ["title", "name"] {
        if let Some(h) = header.iter().find(|h| property_name(h) == want) { return Ok(h.clone()); }
    }
    header.first().cloned().ok_or_else(|| AppError::Other("The CSV has no header row".into()))
}

/// A cell, coerced to the property's type. Empty cells are omitted from the
/// frontmatter rather than written as empty strings.
fn coerce_cell(raw: &str, ty: &str) -> Option<serde_json::Value> {
    let t = raw.trim();
    if t.is_empty() { return None; }
    Some(match ty {
        "number" => match t.parse::<f64>() {
            // `412` stays `412`, not `412.0`, so the file reads the way the CSV did.
            Ok(n) if n.fract() == 0.0 && n.abs() < 9e15 => serde_json::Value::Number((n as i64).into()),
            Ok(n) => serde_json::Number::from_f64(n).map(serde_json::Value::Number).unwrap_or_else(|| serde_json::Value::String(t.to_string())),
            Err(_) => serde_json::Value::String(t.to_string()),
        },
        "checkbox" => match t.to_ascii_lowercase().as_str() {
            "true" | "yes" | "x" | "1" | "✓" | "checked" => serde_json::Value::Bool(true),
            "false" | "no" | "0" | "unchecked" => serde_json::Value::Bool(false),
            _ => serde_json::Value::String(t.to_string()),
        },
        "multi_select" => serde_json::Value::Array(
            t.split(',').map(str::trim).filter(|s| !s.is_empty()).map(|s| serde_json::Value::String(s.to_string())).collect(),
        ),
        _ => serde_json::Value::String(t.to_string()),
    })
}

fn slugify(s: &str) -> String {
    let mut out = String::new();
    let mut dash = false;
    for c in s.to_lowercase().chars() {
        if c.is_alphanumeric() { out.push(c); dash = false; }
        else if !dash && !out.is_empty() { out.push('-'); dash = true; }
    }
    out.trim_matches('-').to_string()
}

fn check_collection_name(name: &str) -> Result<()> {
    if name.is_empty() || name.contains('/') || name.contains('\\') || name.contains("..") || name.starts_with('.') {
        return Err(AppError::Other(format!("Invalid collection name '{name}'")));
    }
    Ok(())
}

struct Prepared {
    plan: CsvPlan,
    /// Every row that would be written (the plan's preview is the head of this).
    rows: Vec<RowPreview>,
    schema: TypeSchema,
}

fn prepare_csv(root: &Path, text: &str, opts: &CsvOptions) -> Result<Prepared> {
    let collection = opts.collection.trim().to_string();
    check_collection_name(&collection)?;
    let mut records = parse_csv(text);
    if records.is_empty() { return Err(AppError::Other("The CSV is empty".into())); }
    let header: Vec<String> = records.remove(0).into_iter().map(|h| h.trim().to_string()).collect();
    let title_column = pick_title_column(&header, opts.title_column.as_deref())?;

    // Inferred mapping, then the caller's overrides on top.
    let mut columns = infer_mapping(&header, &records);
    for o in &opts.columns {
        let Some(c) = columns.iter_mut().find(|c| c.header == o.header) else {
            return Err(AppError::Other(format!("No column '{}' in the CSV (columns: {})", o.header, header.join(", "))));
        };
        c.property = o.property.trim().to_string();
        if !o.ty.trim().is_empty() {
            parse_prop_type(&o.ty)?;
            c.ty = o.ty.trim().to_string();
        }
        if !o.options.is_empty() { c.options = o.options.clone(); }
        if c.ty != "select" && c.ty != "status" { c.options.clear(); }
    }
    // The title column is always the row's `title`.
    if let Some(c) = columns.iter_mut().find(|c| c.header == title_column) {
        c.property = "title".into();
        c.ty = "text".into();
        c.options.clear();
    }
    let dup = columns.iter().filter(|c| !c.property.is_empty()).map(|c| &c.property).collect::<Vec<_>>();
    if let Some(d) = dup.iter().find(|p| dup.iter().filter(|q| q == p).count() > 1) {
        return Err(AppError::Other(format!("Two columns map to the property '{d}'")));
    }

    // Schema: an existing property keeps its type (and coerces the cells);
    // new ones are added from the mapping.
    let schema_exists = schema::load(root, &collection)?.is_some();
    let mut schema = schema::load(root, &collection)?.unwrap_or_default();
    let mut schema_added = Vec::new();
    for c in columns.iter_mut() {
        if c.property.is_empty() || c.property == "title" { continue; }
        match schema.property(&c.property) {
            Some(p) => {
                c.ty = match p.ty {
                    PropType::Number => "number", PropType::Date => "date", PropType::Checkbox => "checkbox",
                    PropType::Select => "select", PropType::MultiSelect | PropType::Relation | PropType::Person => "multi_select",
                    PropType::Status => "status", PropType::Url => "url", _ => "text",
                }.into();
                c.options.clear();
            }
            None => {
                schema.properties.push(PropertyDef {
                    name: c.property.clone(),
                    ty: parse_prop_type(&c.ty)?,
                    options: c.options.iter().map(|o| SelectOption { name: o.clone(), color: "gray".into() }).collect(),
                    ..Default::default()
                });
                schema_added.push(c.property.clone());
            }
        }
    }

    let dir = root.join("collections").join(&collection);
    let exists = dir.is_dir();
    let mut rows = Vec::new();
    let mut skipped = Vec::new();
    let mut taken: BTreeSet<String> = BTreeSet::new();
    let title_idx = header.iter().position(|h| h == &title_column).unwrap_or(0);
    for (i, rec) in records.iter().enumerate() {
        let title = rec.get(title_idx).map(|s| s.trim()).unwrap_or("");
        let base = slugify(title);
        let base = if base.is_empty() { format!("row-{}", i + 1) } else { base };
        let mut id = base.clone();
        let mut n = 2;
        while !taken.insert(id.clone()) { id = format!("{base}-{n}"); n += 1; }
        let path = format!("collections/{collection}/{id}.md");
        if root.join(&path).exists() {
            skipped.push(Skipped { path, reason: format!("already exists (row {}: {})", i + 2, if title.is_empty() { "untitled" } else { title }) });
            continue;
        }
        let mut fm: BTreeMap<String, serde_json::Value> = BTreeMap::new();
        fm.insert("title".into(), serde_json::Value::String(if title.is_empty() { format!("Row {}", i + 1) } else { title.to_string() }));
        for (j, c) in columns.iter().enumerate() {
            if c.property.is_empty() || c.property == "title" { continue; }
            if let Some(v) = rec.get(j).and_then(|raw| coerce_cell(raw, &c.ty)) {
                fm.insert(c.property.clone(), v);
            }
        }
        rows.push(RowPreview { path, frontmatter: fm });
    }

    let plan = CsvPlan {
        collection,
        exists,
        title_column,
        columns,
        rows: records.len(),
        preview: rows.iter().take(PREVIEW_ROWS).cloned().collect(),
        schema_added,
        schema_exists,
        skipped,
    };
    Ok(Prepared { plan, rows, schema })
}

/// What importing `csv_path` into a collection would do: the column mapping
/// (inferred, then `opts.columns` applied), the first rows as notes, and what
/// the schema gains. Writes nothing.
pub fn plan_csv(root: &Path, csv_path: &Path, opts: &CsvOptions) -> Result<CsvPlan> {
    let text = std::fs::read_to_string(csv_path)
        .map_err(|e| AppError::Other(format!("Cannot read {}: {e}", csv_path.display())))?;
    Ok(prepare_csv(root, &text, opts)?.plan)
}

/// Import a CSV: one row note per record, the schema written or merged, and
/// `_index.md` created for a new collection. Rows whose file already exists
/// are skipped, never overwritten.
pub fn import_csv(root: &Path, csv_path: &Path, opts: &CsvOptions) -> Result<CsvReport> {
    let text = std::fs::read_to_string(csv_path)
        .map_err(|e| AppError::Other(format!("Cannot read {}: {e}", csv_path.display())))?;
    let Prepared { plan, rows, schema } = prepare_csv(root, &text, opts)?;
    let dir = root.join("collections").join(&plan.collection);
    std::fs::create_dir_all(&dir)?;

    let mut index_created = false;
    let index = dir.join("_index.md");
    if !index.exists() {
        let mut fm: BTreeMap<String, serde_json::Value> = BTreeMap::new();
        fm.insert("title".into(), serde_json::Value::String(plan.collection.clone()));
        fm.insert("type".into(), serde_json::Value::String("database".into()));
        fm.insert("views".into(), serde_json::json!([{ "name": "Table", "type": "table" }]));
        let note = crate::note::Note { path: format!("collections/{}/_index.md", plan.collection), frontmatter: fm, body: String::new() };
        std::fs::write(&index, crate::note::serialize_note(&note)?)?;
        index_created = true;
    }

    let mut written = Vec::new();
    for row in rows {
        let note = crate::note::Note { path: row.path.clone(), frontmatter: row.frontmatter, body: String::new() };
        std::fs::write(root.join(&row.path), crate::note::serialize_note(&note)?)?;
        written.push(row.path);
    }
    // The schema follows the rows: nothing written, nothing declared.
    let schema_added = if written.is_empty() && plan.schema_exists { Vec::new() } else { plan.schema_added };
    if !schema_added.is_empty() || !plan.schema_exists {
        schema::save(root, &plan.collection, &schema)?;
    }
    Ok(CsvReport { collection: plan.collection, written, skipped: plan.skipped, schema_added, index_created })
}

// ── Markdown folder → notes ───────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct MarkdownReport {
    /// The folder under `notes/` the files landed in (vault-relative).
    pub dest: String,
    /// Notes written, vault-relative, in walk order.
    pub notes: Vec<String>,
    /// Images copied into `assets/`, vault-relative.
    pub assets: Vec<String>,
    /// Source paths (relative to the source folder) not imported, and why.
    pub skipped: Vec<Skipped>,
    /// Image references that pointed nowhere; the text is left as it was.
    pub unresolved: Vec<String>,
}

const IMAGE_EXTS: [&str; 8] = ["png", "jpg", "jpeg", "gif", "svg", "webp", "bmp", "avif"];

fn is_image(p: &Path) -> bool {
    p.extension().and_then(|e| e.to_str()).map(|e| IMAGE_EXTS.contains(&e.to_ascii_lowercase().as_str())).unwrap_or(false)
}

fn is_markdown(p: &Path) -> bool {
    p.extension().and_then(|e| e.to_str()).map(|e| e.eq_ignore_ascii_case("md")).unwrap_or(false)
}

fn is_dot(p: &Path) -> bool {
    p.file_name().and_then(|n| n.to_str()).map(|n| n.starts_with('.')).unwrap_or(false)
}

/// `my%20image.png` → `my image.png`, leaving anything that is not a valid escape.
fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            if let Ok(v) = u8::from_str_radix(&s[i + 1..i + 3], 16) { out.push(v); i += 3; continue; }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8(out).unwrap_or_else(|_| s.to_string())
}

fn check_dest(into: &str) -> Result<String> {
    let into = into.trim().trim_matches('/').to_string();
    if into.is_empty() || into.split('/').any(|seg| seg.is_empty() || seg == "." || seg == ".." || seg.starts_with('.')) || into.contains('\\') {
        return Err(AppError::Other(format!("Invalid destination folder '{into}' (a folder name under notes/)")));
    }
    Ok(into)
}

/// Where each image reference goes. Shared by every note of one import so a
/// picture two notes use is copied once.
struct Assets<'a> {
    root: &'a Path,
    src_root: &'a Path,
    /// Basename (lower-cased) → source paths, for Obsidian's `![[image.png]]`.
    by_name: BTreeMap<String, Vec<PathBuf>>,
    /// Source path → vault-relative asset path already assigned.
    placed: BTreeMap<PathBuf, String>,
    /// Asset filenames claimed in this run (the ones on disk are checked too).
    claimed: BTreeSet<String>,
    copied: Vec<String>,
    unresolved: Vec<String>,
    dry_run: bool,
}

impl Assets<'_> {
    /// The `assets/<name>` for a source image, copying it on first use. A
    /// name already in `assets/` with different content gets a numbered one.
    fn place(&mut self, src: &Path) -> Result<String> {
        if let Some(rel) = self.placed.get(src) { return Ok(rel.clone()); }
        let name = src.file_name().and_then(|n| n.to_str()).unwrap_or("image").to_string();
        let (stem, ext) = match name.rsplit_once('.') { Some((s, e)) => (s.to_string(), format!(".{e}")), None => (name.clone(), String::new()) };
        let bytes = std::fs::read(src)?;
        let mut candidate = name.clone();
        let mut n = 2;
        loop {
            let on_disk = self.root.join("assets").join(&candidate);
            let same = on_disk.exists() && std::fs::read(&on_disk).map(|b| b == bytes).unwrap_or(false);
            if same { break; }
            if !on_disk.exists() && !self.claimed.contains(&candidate) { break; }
            candidate = format!("{stem}-{n}{ext}");
            n += 1;
        }
        let rel = format!("assets/{candidate}");
        self.claimed.insert(candidate);
        if !self.dry_run {
            std::fs::create_dir_all(self.root.join("assets"))?;
            let dest = self.root.join(&rel);
            if !dest.exists() { std::fs::write(&dest, &bytes)?; }
        }
        self.placed.insert(src.to_path_buf(), rel.clone());
        self.copied.push(rel.clone());
        Ok(rel)
    }

    /// Resolve a reference from `note_dir`: a relative path first, then (the
    /// Obsidian way) any file in the source tree with that basename.
    fn resolve(&self, note_dir: &Path, target: &str) -> Option<PathBuf> {
        let target = percent_decode(target.trim());
        if target.is_empty() || target.contains("://") || target.starts_with("data:") || target.starts_with('/') { return None; }
        let direct = note_dir.join(&target);
        if direct.is_file() && is_image(&direct) { return Some(direct); }
        let from_root = self.src_root.join(&target);
        if from_root.is_file() && is_image(&from_root) { return Some(from_root); }
        let base = Path::new(&target).file_name()?.to_str()?.to_ascii_lowercase();
        self.by_name.get(&base).and_then(|v| v.first()).cloned()
    }

    /// Rewrite `![alt](rel.png)` and `![[image.png]]` (with an optional
    /// `|alias`) to `assets/` paths; everything else is left exactly as it is.
    fn rewrite(&mut self, note_dir: &Path, text: &str) -> Result<String> {
        let mut out = String::with_capacity(text.len());
        let mut rest = text;
        while let Some(i) = rest.find("![") {
            out.push_str(&rest[..i]);
            let after = &rest[i + 2..];
            if let Some(inner) = after.strip_prefix('[') {
                // ![[target|alias]]
                if let Some(end) = inner.find("]]") {
                    let body = &inner[..end];
                    let target = body.split('|').next().unwrap_or("").trim();
                    if !body.contains('\n') && is_image(Path::new(target)) {
                        match self.resolve(note_dir, target) {
                            Some(src) => {
                                let alt = body.split('|').nth(1).unwrap_or("").trim();
                                out.push_str(&format!("![{alt}]({})", self.place(&src)?));
                                rest = &inner[end + 2..];
                                continue;
                            }
                            None => self.unresolved.push(target.to_string()),
                        }
                    }
                }
            } else if let Some(close) = after.find("](") {
                // ![alt](target "title")
                let alt = &after[..close];
                let tail = &after[close + 2..];
                if let Some(end) = tail.find(')') {
                    let link = &tail[..end];
                    let target = match link.trim().strip_prefix('<') { Some(t) => t.trim_end_matches('>'), None => link.split_whitespace().next().unwrap_or("") };
                    if !alt.contains('\n') && !link.contains('\n') && !target.is_empty() && !target.contains("://") && !target.starts_with("data:") {
                        match self.resolve(note_dir, target) {
                            Some(src) => {
                                out.push_str(&format!("![{alt}]({})", self.place(&src)?));
                                rest = &tail[end + 1..];
                                continue;
                            }
                            None => if is_image(Path::new(target)) { self.unresolved.push(target.to_string()) },
                        }
                    }
                }
            }
            out.push_str("![");
            rest = after;
        }
        out.push_str(rest);
        Ok(out)
    }
}

/// Copy every Markdown file under `src_dir` to `notes/<into>/`, with the
/// images they reference into `assets/`. With `dry_run` nothing is written
/// and the report says what would be. The source folder is only read.
pub fn import_markdown(root: &Path, src_dir: &Path, into: &str, dry_run: bool) -> Result<MarkdownReport> {
    let into = check_dest(into)?;
    if !src_dir.is_dir() {
        return Err(AppError::Other(format!("Not a folder: {}", src_dir.display())));
    }
    let src_dir = src_dir.canonicalize().unwrap_or_else(|_| src_dir.to_path_buf());
    let dest_root = root.join("notes").join(&into);
    if let Ok(canon_root) = root.canonicalize() {
        if src_dir.starts_with(canon_root.join("notes").join(&into)) {
            return Err(AppError::Other("The source folder is the destination".into()));
        }
    }

    let mut skipped = Vec::new();
    let mut files: Vec<PathBuf> = Vec::new();
    let mut by_name: BTreeMap<String, Vec<PathBuf>> = BTreeMap::new();
    let mut walker = walkdir::WalkDir::new(&src_dir).sort_by_file_name().into_iter();
    while let Some(entry) = walker.next() {
        let entry = match entry { Ok(e) => e, Err(e) => { skipped.push(Skipped { path: e.path().map(|p| rel_str(&src_dir, p)).unwrap_or_default(), reason: format!("unreadable: {e}") }); continue; } };
        let p = entry.path();
        if p == src_dir { continue; }
        if is_dot(p) {
            skipped.push(Skipped { path: rel_str(&src_dir, p), reason: if entry.file_type().is_dir() { "hidden folder".into() } else { "hidden file".into() } });
            if entry.file_type().is_dir() { walker.skip_current_dir(); }
            continue;
        }
        if entry.file_type().is_dir() { continue; }
        if is_markdown(p) {
            files.push(p.to_path_buf());
        } else if is_image(p) {
            by_name.entry(p.file_name().unwrap().to_string_lossy().to_ascii_lowercase()).or_default().push(p.to_path_buf());
        } else {
            skipped.push(Skipped { path: rel_str(&src_dir, p), reason: "not Markdown".into() });
        }
    }

    let mut assets = Assets { root, src_root: &src_dir, by_name, placed: BTreeMap::new(), claimed: BTreeSet::new(), copied: Vec::new(), unresolved: Vec::new(), dry_run };
    let mut notes = Vec::new();
    for src in &files {
        let rel = src.strip_prefix(&src_dir).unwrap_or(src);
        let dest = dest_root.join(rel);
        let dest_rel = format!("notes/{into}/{}", rel.to_string_lossy().replace('\\', "/"));
        if dest.exists() {
            skipped.push(Skipped { path: rel_str(&src_dir, src), reason: "already exists".into() });
            continue;
        }
        let text = match std::fs::read_to_string(src) {
            Ok(t) => t,
            Err(e) => { skipped.push(Skipped { path: rel_str(&src_dir, src), reason: format!("unreadable: {e}") }); continue; }
        };
        let note_dir = src.parent().unwrap_or(&src_dir);
        let rewritten = assets.rewrite(note_dir, &text)?;
        if !dry_run {
            if let Some(parent) = dest.parent() { std::fs::create_dir_all(parent)?; }
            std::fs::write(&dest, rewritten)?;
        }
        notes.push(dest_rel);
    }
    let mut unresolved = assets.unresolved;
    unresolved.sort();
    unresolved.dedup();
    Ok(MarkdownReport { dest: format!("notes/{into}"), notes, assets: assets.copied, skipped, unresolved })
}

fn rel_str(base: &Path, p: &Path) -> String {
    p.strip_prefix(base).unwrap_or(p).to_string_lossy().replace('\\', "/")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!("cortex-import-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        root
    }

    fn put(base: &Path, rel: &str, text: &str) -> PathBuf {
        let p = base.join(rel);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(&p, text).unwrap();
        p
    }

    #[test]
    fn csv_parser_handles_quotes_newlines_and_bom() {
        let recs = parse_csv("\u{feff}a,b\r\n1,\"x, \"\"y\"\"\nz\"\n\n2,\n");
        assert_eq!(recs, vec![vec!["a", "b"], vec!["1", "x, \"y\"\nz"], vec!["2", ""]]);
    }

    #[test]
    fn property_names_are_keys() {
        assert_eq!(property_name("Due date"), "due_date");
        assert_eq!(property_name("  Status  "), "status");
        assert_eq!(property_name("Price ($)"), "price");
        assert_eq!(property_name("---"), "column");
    }

    #[test]
    fn csv_plan_infers_types_and_previews_rows() {
        let root = scratch("plan");
        let csv = put(&root, "in/books.csv",
            "Name,Author,Pages,Read,Finished,Status,Tags,Link\n\
             Dune,Frank Herbert,412,true,2024-01-05,done,sci-fi,https://example.com/dune\n\
             Emma,Jane Austen,474,false,,reading,\"classic, romance\",https://example.com/emma\n\
             Ubik,Philip K. Dick,224,true,2024-02-10,done,sci-fi,https://example.com/ubik\n\
             Solaris,Stanisław Lem,204,false,,reading,sci-fi,https://example.com/solaris\n");
        let plan = plan_csv(&root, &csv, &CsvOptions { collection: "books".into(), ..Default::default() }).unwrap();
        assert_eq!(plan.title_column, "Name");
        assert!(!plan.exists && !plan.schema_exists);
        let ty = |h: &str| plan.columns.iter().find(|c| c.header == h).unwrap().ty.clone();
        assert_eq!(ty("Name"), "text");
        assert_eq!(ty("Pages"), "number");
        assert_eq!(ty("Read"), "checkbox");
        assert_eq!(ty("Finished"), "date");
        assert_eq!(ty("Status"), "select");
        assert_eq!(ty("Link"), "url");
        assert_eq!(ty("Author"), "text", "four distinct authors in four rows is not a vocabulary");
        let status = plan.columns.iter().find(|c| c.header == "Status").unwrap();
        assert_eq!(status.options, vec!["done", "reading"]);
        assert_eq!(plan.rows, 4);
        assert_eq!(plan.preview.len(), 4);
        assert_eq!(plan.preview[0].path, "collections/books/dune.md");
        assert_eq!(plan.preview[0].frontmatter["pages"], serde_json::json!(412));
        assert_eq!(plan.preview[0].frontmatter["read"], serde_json::json!(true));
        assert_eq!(plan.preview[1].frontmatter.get("finished"), None, "empty cells are omitted");
        assert_eq!(plan.schema_added, vec!["author", "pages", "read", "finished", "status", "tags", "link"]);
        assert!(!root.join("collections").exists(), "a plan writes nothing");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn csv_import_writes_rows_schema_and_index() {
        let root = scratch("import");
        let csv = put(&root, "in/tasks.csv", "Title,Done,Tags,Notes\nBuy milk,yes,\"home, errand\",\nBuy milk,no,home,again\n,true,,no title\n");
        let opts = CsvOptions {
            collection: "tasks".into(),
            title_column: None,
            columns: vec![ColumnMap { header: "Tags".into(), property: "tags".into(), ty: "multi_select".into(), options: vec![] },
                          ColumnMap { header: "Notes".into(), property: String::new(), ty: String::new(), options: vec![] }],
        };
        let r = import_csv(&root, &csv, &opts).unwrap();
        assert_eq!(r.written, vec!["collections/tasks/buy-milk.md", "collections/tasks/buy-milk-2.md", "collections/tasks/row-3.md"]);
        assert!(r.index_created);
        let milk = std::fs::read_to_string(root.join("collections/tasks/buy-milk.md")).unwrap();
        assert_eq!(milk, "---\ndone: true\ntags:\n- home\n- errand\ntitle: Buy milk\n---\n\n");
        let row3 = std::fs::read_to_string(root.join("collections/tasks/row-3.md")).unwrap();
        assert!(row3.contains("title: Row 3") && !row3.contains("notes"), "{row3}");
        let schema = schema::load(&root, "tasks").unwrap().unwrap();
        assert_eq!(schema.properties.iter().map(|p| p.name.as_str()).collect::<Vec<_>>(), vec!["done", "tags"]);
        assert_eq!(schema.property("done").unwrap().ty, PropType::Checkbox);
        assert_eq!(schema.property("tags").unwrap().ty, PropType::MultiSelect);
        let index = std::fs::read_to_string(root.join("collections/tasks/_index.md")).unwrap();
        assert!(index.contains("type: database"), "{index}");

        // A second import into the same collection: existing files are
        // skipped, the schema gains only what is new, the index is kept.
        let csv2 = put(&root, "in/more.csv", "Title,Done,Priority\nBuy milk,yes,3\nCall mum,no,1\n");
        let r2 = import_csv(&root, &csv2, &CsvOptions { collection: "tasks".into(), ..Default::default() }).unwrap();
        assert_eq!(r2.written, vec!["collections/tasks/call-mum.md"]);
        assert_eq!(r2.skipped.len(), 1);
        assert!(r2.skipped[0].path.ends_with("buy-milk.md"));
        assert!(!r2.index_created);
        assert_eq!(r2.schema_added, vec!["priority"]);
        let schema = schema::load(&root, "tasks").unwrap().unwrap();
        assert_eq!(schema.properties.len(), 3);
        assert_eq!(schema.property("done").unwrap().ty, PropType::Checkbox, "existing properties keep their type");
        // Nothing new to write: the schema is left alone too.
        let csv3 = put(&root, "in/dup.csv", "Title,Weight\nCall mum,2\n");
        let r3 = import_csv(&root, &csv3, &CsvOptions { collection: "tasks".into(), ..Default::default() }).unwrap();
        assert!(r3.written.is_empty() && r3.schema_added.is_empty());
        assert!(schema::load(&root, "tasks").unwrap().unwrap().property("weight").is_none());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn csv_rejects_bad_input() {
        let root = scratch("bad");
        let csv = put(&root, "in/x.csv", "A,B\n1,2\n");
        assert!(plan_csv(&root, &csv, &CsvOptions { collection: "../x".into(), ..Default::default() }).is_err());
        assert!(plan_csv(&root, &csv, &CsvOptions { collection: "x".into(), title_column: Some("Nope".into()), ..Default::default() }).is_err());
        let bad_type = CsvOptions { collection: "x".into(), columns: vec![ColumnMap { header: "B".into(), property: "b".into(), ty: "rollup".into(), options: vec![] }], ..Default::default() };
        assert!(plan_csv(&root, &csv, &bad_type).is_err());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn markdown_import_copies_notes_and_images_and_skips_dotdirs() {
        let root = scratch("md");
        let src = root.join("in/obsidian");
        put(&src, "Welcome.md", "---\ntitle: Welcome\naliases: [hi]\n---\n\nSee [[Daily/2024-01-01]] and ![[pic.png]] and ![shot](attachments/shot%20one.png).\n\n![web](https://example.com/x.png) ![missing](nope.png)\n");
        put(&src, "Daily/2024-01-01.md", "# Day one\n\n![[pic.png|the pic]]\n");
        put(&src, "attachments/pic.png", "PNG1");
        put(&src, "attachments/shot one.png", "PNG2");
        put(&src, "notes.pdf", "%PDF");
        put(&src, ".obsidian/app.json", "{}");
        put(&src, ".obsidian/plugins/x/main.js", "//");
        // An asset with the same name but different content already in the vault.
        put(&root, "assets/pic.png", "OTHER");

        let dry = import_markdown(&root, &src, "obsidian", true).unwrap();
        assert_eq!(dry.notes, vec!["notes/obsidian/Daily/2024-01-01.md", "notes/obsidian/Welcome.md"]);
        assert!(!root.join("notes/obsidian").exists(), "dry run writes nothing");
        assert!(!root.join("assets/pic-2.png").exists());

        let r = import_markdown(&root, &src, "obsidian", false).unwrap();
        assert_eq!(r.dest, "notes/obsidian");
        assert_eq!(r.notes, dry.notes);
        assert_eq!(r.assets, vec!["assets/pic-2.png", "assets/shot one.png"]);
        assert_eq!(r.unresolved, vec!["nope.png"]);
        let reasons: Vec<(String, String)> = r.skipped.iter().map(|s| (s.path.clone(), s.reason.clone())).collect();
        assert!(reasons.contains(&(".obsidian".into(), "hidden folder".into())), "{reasons:?}");
        assert!(reasons.contains(&("notes.pdf".into(), "not Markdown".into())), "{reasons:?}");
        assert!(!reasons.iter().any(|(p, _)| p.contains("plugins")), "hidden folders are not descended into");

        let welcome = std::fs::read_to_string(root.join("notes/obsidian/Welcome.md")).unwrap();
        assert!(welcome.starts_with("---\ntitle: Welcome\naliases: [hi]\n---\n"), "frontmatter is kept verbatim: {welcome}");
        assert!(welcome.contains("[[Daily/2024-01-01]]"), "wiki links are untouched");
        assert!(welcome.contains("![](assets/pic-2.png)"), "{welcome}");
        assert!(welcome.contains("![shot](assets/shot one.png)"), "{welcome}");
        assert!(welcome.contains("![web](https://example.com/x.png)") && welcome.contains("![missing](nope.png)"), "{welcome}");
        let day = std::fs::read_to_string(root.join("notes/obsidian/Daily/2024-01-01.md")).unwrap();
        assert!(day.contains("![the pic](assets/pic-2.png)"), "{day}");
        assert_eq!(std::fs::read_to_string(root.join("assets/pic.png")).unwrap(), "OTHER", "existing assets are never overwritten");
        assert_eq!(std::fs::read_to_string(root.join("assets/pic-2.png")).unwrap(), "PNG1");
        assert!(src.join("Welcome.md").exists() && src.join(".obsidian/app.json").exists(), "the source is untouched");

        // Importing again: everything already exists, nothing is rewritten.
        let again = import_markdown(&root, &src, "obsidian", false).unwrap();
        assert!(again.notes.is_empty());
        assert_eq!(again.skipped.iter().filter(|s| s.reason == "already exists").count(), 2);
        assert!(import_markdown(&root, &src, "../escape", false).is_err());
        assert!(import_markdown(&root, &src, ".hidden", false).is_err());
        let _ = std::fs::remove_dir_all(&root);
    }
}
