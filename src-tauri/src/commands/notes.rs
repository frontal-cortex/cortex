use std::collections::BTreeMap;
use std::path::PathBuf;
use tauri::State;
use walkdir::WalkDir;

use crate::commands::vault::{DbState, VaultState};
use crate::watcher::{self, SelfWrites};
use cortex_core::error::{AppError, Result};
use cortex_core::note::{self, Note, NoteEntry};
use cortex_core::search::SearchHit;

fn vault_path(state: &State<'_, VaultState>) -> Result<PathBuf> {
    state
        .0
        .lock()
        .unwrap()
        .clone()
        .ok_or(AppError::NoVault)
}

// ── List / Read ──────────────────────────────────────────────────────────────

#[tauri::command]
pub fn list_notes(state: State<'_, VaultState>) -> Result<Vec<NoteEntry>> {
    Ok(cortex_core::vault::list_notes(&vault_path(&state)?))
}

#[tauri::command]
pub fn read_note(path: String, state: State<'_, VaultState>) -> Result<Note> {
    let root = vault_path(&state)?;
    let abs = root.join(&path);
    let content = std::fs::read_to_string(&abs)?;
    note::parse_note(&path, &content)
}

/// Resolved target of a `![[note#section]]` transclusion.
#[derive(serde::Serialize)]
pub struct NoteRef {
    pub path: String,
    pub title: String,
    pub body: String,
    pub found: bool,
}

fn heading_level(line: &str) -> Option<(usize, String)> {
    let t = line.trim_start();
    if !t.starts_with('#') {
        return None;
    }
    let hashes = t.chars().take_while(|c| *c == '#').count();
    if hashes == 0 || hashes > 6 {
        return None;
    }
    Some((hashes, t[hashes..].trim().to_string()))
}

/// Slice out a heading's section: from the matching heading to the next heading
/// of the same or higher level (exclusive).
fn extract_section(body: &str, section: &str) -> Option<String> {
    let target = section.to_lowercase();
    let lines: Vec<&str> = body.lines().collect();
    let (start, level) = lines.iter().enumerate().find_map(|(i, l)| {
        heading_level(l).and_then(|(lvl, text)| (text.to_lowercase() == target).then_some((i, lvl)))
    })?;
    let mut end = lines.len();
    for i in (start + 1)..lines.len() {
        if let Some((lvl, _)) = heading_level(lines[i]) {
            if lvl <= level {
                end = i;
                break;
            }
        }
    }
    Some(lines[start..end].join("\n"))
}

/// Resolve a wiki-style ref in any written form (`Note Title`, `path/to/note`,
/// `Note#Section`, `Note|alias`, `![[Note#Section]]`) to a note's body, for
/// inline transclusion. The target is parsed and resolved by cortex-core, so
/// the app, the CLI and the publisher all agree on which note a link means.
#[tauri::command]
pub fn resolve_ref(target: String, state: State<'_, VaultState>) -> Result<NoteRef> {
    let root = vault_path(&state)?;
    let link = note::parse_wiki_link(&target);
    let notes = cortex_core::vault::list_notes(&root);
    let Some(entry) = cortex_core::vault::resolve(&notes, &link.target) else {
        return Ok(NoteRef { path: String::new(), title: link.target, body: String::new(), found: false });
    };
    let content = std::fs::read_to_string(root.join(&entry.path))?;
    let parsed = note::parse_note(&entry.path, &content)?;
    let body = match &link.section {
        Some(s) => extract_section(&parsed.body, s).unwrap_or(parsed.body),
        None => parsed.body,
    };
    Ok(NoteRef { path: entry.path.clone(), title: entry.title.clone(), body, found: true })
}

// ── Write / Create / Delete ──────────────────────────────────────────────────

#[tauri::command]
pub fn write_note(
    path: String,
    note: Note,
    state: State<'_, VaultState>,
    db_state: State<'_, DbState>,
    self_writes: State<'_, SelfWrites>,
) -> Result<()> {
    let root = vault_path(&state)?;
    let abs = root.join(&path);

    if let Some(parent) = abs.parent() {
        std::fs::create_dir_all(parent)?;
    }

    let content = note::serialize_note(&note)?;
    watcher::record_self_write(&self_writes, &path, &content);
    std::fs::write(&abs, &content)?;

    // Keep index in sync
    if let Some(db) = db_state.0.lock().unwrap().as_ref() {
        let _ = cortex_core::index::index_file(&root, &abs, db);
    }

    Ok(())
}

#[tauri::command]
pub fn create_note(
    path: String,
    title: String,
    created: String,
    state: State<'_, VaultState>,
    db_state: State<'_, DbState>,
    self_writes: State<'_, SelfWrites>,
) -> Result<Note> {
    let root = vault_path(&state)?;
    let abs = root.join(&path);

    if abs.exists() {
        return Err(AppError::Other(format!("Note already exists: {path}")));
    }
    if let Some(parent) = abs.parent() {
        std::fs::create_dir_all(parent)?;
    }

    let mut frontmatter: BTreeMap<String, serde_json::Value> = BTreeMap::new();
    frontmatter.insert("title".into(), serde_json::Value::String(title));
    frontmatter.insert("type".into(), serde_json::Value::String("note".into()));
    frontmatter.insert("created".into(), serde_json::Value::String(created));
    frontmatter.insert("tags".into(), serde_json::Value::Array(vec![]));

    let note = Note { path: path.clone(), frontmatter, body: String::new() };
    let content = note::serialize_note(&note)?;
    watcher::record_self_write(&self_writes, &path, &content);
    std::fs::write(&abs, &content)?;

    if let Some(db) = db_state.0.lock().unwrap().as_ref() {
        let _ = cortex_core::index::index_file(&root, &abs, db);
    }

    Ok(note)
}

/// Create a new note from a template in `templates/`, substituting `{{key}}`
/// placeholders with the supplied values (date / time / title / uuid are
/// computed by the frontend, keeping this backend dependency-free). The result
/// is normalized through parse→serialize when the substituted frontmatter is
/// valid YAML, so the new note gets clean, sorted frontmatter.
#[tauri::command]
pub fn create_note_from_template(
    template: String,
    path: String,
    vars: std::collections::HashMap<String, String>,
    state: State<'_, VaultState>,
    db_state: State<'_, DbState>,
) -> Result<Note> {
    let root = vault_path(&state)?;
    let tpl_path = root.join("templates").join(&template);
    let mut content = std::fs::read_to_string(&tpl_path)
        .map_err(|_| AppError::Other(format!("Template not found: {template}")))?;

    for (k, v) in &vars {
        let needle = ["{{", k.as_str(), "}}"].concat();
        content = content.replace(&needle, v);
    }

    let abs = root.join(&path);
    if abs.exists() {
        return Err(AppError::Other(format!("Note already exists: {path}")));
    }
    if let Some(parent) = abs.parent() {
        std::fs::create_dir_all(parent)?;
    }

    let to_write = match note::parse_note(&path, &content) {
        Ok(n) => note::serialize_note(&n).unwrap_or_else(|_| content.clone()),
        Err(_) => content.clone(),
    };
    std::fs::write(&abs, &to_write)?;

    if let Some(db) = db_state.0.lock().unwrap().as_ref() {
        let _ = cortex_core::index::index_file(&root, &abs, db);
    }

    note::parse_note(&path, &to_write)
}

#[tauri::command]
pub fn delete_note(
    path: String,
    state: State<'_, VaultState>,
    db_state: State<'_, DbState>,
) -> Result<()> {
    let root = vault_path(&state)?;
    let abs = root.join(&path);
    if !abs.exists() {
        return Err(AppError::Other(format!("Note not found: {path}")));
    }

    // Soft-delete: move to `.trash/` instead of destroying. Restorable from the
    // Trash section, and committed so it syncs to other clones.
    crate::commands::trash::move_to_trash(&root, &path)?;

    if let Some(db) = db_state.0.lock().unwrap().as_ref() {
        let _ = db.remove_note(&path);
    }

    Ok(())
}

// ── Search ───────────────────────────────────────────────────────────────────

/// Full-text search with operators (`"phrase"`, `-word`, `OR`, `tag:`,
/// `type:`, `path:`); see `cortex_core::search`. Each hit carries a snippet.
#[tauri::command]
pub fn search_notes(
    query: String,
    db_state: State<'_, DbState>,
) -> Result<Vec<SearchHit>> {
    let guard = db_state.0.lock().unwrap();
    match guard.as_ref() {
        Some(db) => db.search(&query),
        None => Ok(vec![]),
    }
}

// ── Folders ──────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn delete_folder(
    path: String,
    state: State<'_, VaultState>,
    db_state: State<'_, DbState>,
) -> Result<()> {
    let root = vault_path(&state)?;

    // Protect system and root directories
    let trimmed = path.trim_end_matches('/');
    if trimmed.contains("..") || matches!(trimmed, ".git" | ".brain" | "notes" | "templates") {
        return Err(AppError::Other(format!("Cannot delete protected path: {path}")));
    }

    let abs = root.join(&path);
    if !abs.exists() {
        return Err(AppError::Other(format!("Folder not found: {path}")));
    }

    std::fs::remove_dir_all(&abs)?;

    // Purge index entries for all notes that were inside this folder
    let prefix = if path.ends_with('/') { path.clone() } else { format!("{path}/") };
    if let Some(db) = db_state.0.lock().unwrap().as_ref() {
        let _ = db.remove_notes_by_prefix(&prefix);
    }

    Ok(())
}

/// Rename a note to a new vault-relative path (can change directory and/or filename).
/// Returns the new path.
#[tauri::command]
pub fn rename_note(
    old_path: String,
    new_path: String,
    state: State<'_, VaultState>,
    db_state: State<'_, DbState>,
) -> Result<()> {
    let root = vault_path(&state)?;
    let from_abs = root.join(&old_path);
    let to_abs = root.join(&new_path);

    if !from_abs.exists() {
        return Err(AppError::Other(format!("Source not found: {old_path}")));
    }
    if to_abs.exists() && to_abs != from_abs {
        return Err(AppError::Other(format!("Target already exists: {new_path}")));
    }
    if let Some(parent) = to_abs.parent() {
        std::fs::create_dir_all(parent)?;
    }

    std::fs::rename(&from_abs, &to_abs)?;

    if let Some(db) = db_state.0.lock().unwrap().as_ref() {
        let _ = db.rename_note(&old_path, &new_path);
        let _ = cortex_core::index::index_file(&root, &to_abs, db);
    }

    Ok(())
}

/// Duplicate a note as a `<stem>-copy[-N].md` sibling, bumping its title so the
/// two are distinguishable. Returns the new vault-relative path.
#[tauri::command]
pub fn duplicate_note(
    path: String,
    state: State<'_, VaultState>,
    db_state: State<'_, DbState>,
) -> Result<String> {
    let root = vault_path(&state)?;
    let from_abs = root.join(&path);
    if !from_abs.is_file() {
        return Err(AppError::Other(format!("Not a file: {path}")));
    }
    let parent = from_abs.parent().ok_or_else(|| AppError::Other("Invalid path".into()))?;
    let stem = from_abs.file_stem().and_then(|s| s.to_str()).unwrap_or("note");

    // Find a free `<stem>-copy[-N].md` next to the original.
    let mut candidate = parent.join(format!("{stem}-copy.md"));
    let mut n = 2;
    while candidate.exists() {
        candidate = parent.join(format!("{stem}-copy-{n}.md"));
        n += 1;
    }
    let new_rel = candidate.strip_prefix(&root).unwrap().to_string_lossy().to_string();

    let content = std::fs::read_to_string(&from_abs)?;
    let mut dup = note::parse_note(&new_rel, &content)?;
    if let Some(t) = dup.frontmatter.get("title").and_then(|v| v.as_str()) {
        dup.frontmatter.insert("title".into(), serde_json::Value::String(format!("{t} copy")));
    }
    std::fs::write(&candidate, note::serialize_note(&dup)?)?;

    if let Some(db) = db_state.0.lock().unwrap().as_ref() {
        let _ = cortex_core::index::index_file(&root, &candidate, db);
    }
    Ok(new_rel)
}

/// Reveal a note in the OS file manager (Finder / Explorer / file manager).
#[tauri::command]
pub fn reveal_path(path: String, state: State<'_, VaultState>) -> Result<()> {
    let root = vault_path(&state)?;
    let abs = root.join(&path);
    if !abs.exists() {
        return Err(AppError::Other(format!("Path not found: {path}")));
    }
    #[cfg(target_os = "macos")]
    { std::process::Command::new("open").arg("-R").arg(&abs).spawn()?; }
    #[cfg(target_os = "windows")]
    { std::process::Command::new("explorer").arg(format!("/select,{}", abs.display())).spawn()?; }
    #[cfg(all(unix, not(target_os = "macos")))]
    { std::process::Command::new("xdg-open").arg(abs.parent().unwrap_or(&abs)).spawn()?; }
    Ok(())
}

/// Move a note to a different folder, keeping the same filename.
/// Returns the new vault-relative path.
#[tauri::command]
pub fn move_note(
    from_path: String,
    to_dir: String,
    state: State<'_, VaultState>,
    db_state: State<'_, DbState>,
) -> Result<String> {
    let root = vault_path(&state)?;
    let from_abs = root.join(&from_path);

    if !from_abs.exists() {
        return Err(AppError::Other(format!("Source not found: {from_path}")));
    }

    let filename = from_abs
        .file_name()
        .ok_or_else(|| AppError::Other("Invalid source path".into()))?;

    let to_dir_clean = to_dir.trim_end_matches('/');
    let to_dir_abs = root.join(to_dir_clean);
    std::fs::create_dir_all(&to_dir_abs)?;

    let to_abs = to_dir_abs.join(filename);

    if to_abs.exists() {
        return Err(AppError::Other(format!(
            "A note with this name already exists in {}",
            to_dir_clean
        )));
    }

    let new_path = format!("{}/{}", to_dir_clean, filename.to_string_lossy());
    std::fs::rename(&from_abs, &to_abs)?;

    // Update index: rename the path row, then re-index the content at new location
    if let Some(db) = db_state.0.lock().unwrap().as_ref() {
        let _ = db.rename_note(&from_path, &new_path);
        let _ = cortex_core::index::index_file(&root, &to_abs, db);
    }

    Ok(new_path)
}

// ── Convert between a checklist note and a database ─────────────────────────────
//
// A todo list (a note of `- [ ]` / `- [x]` / bullet lines) and a database (a
// `collections/<name>/` folder of row-notes) hold the same information in two
// shapes. These commands transform one into the other; the frontend handles
// removing the source (trash the note / delete the folder) so the destructive
// step keeps its existing confirmation + recovery path.

#[derive(serde::Deserialize)]
pub struct TodoItem {
    text: String,
    done: bool,
}

/// Pull checklist items out of markdown: `- [ ]` / `- [x]` checkboxes (with their
/// checked state) and plain `-`/`*` bullets (unchecked).
fn parse_todo_items(body: &str) -> Vec<TodoItem> {
    let mut items = Vec::new();
    for line in body.lines() {
        let t = line.trim_start();
        let checkbox = t.strip_prefix("- [").or_else(|| t.strip_prefix("* ["));
        if let Some(rest) = checkbox {
            let b = rest.as_bytes();
            if b.len() >= 2 && b[1] == b']' {
                let text = rest[2..].trim().to_string();
                if !text.is_empty() {
                    items.push(TodoItem { text, done: b[0] == b'x' || b[0] == b'X' });
                }
                continue;
            }
        }
        for p in ["- ", "* "] {
            if let Some(text) = t.strip_prefix(p) {
                let text = text.trim();
                if !text.is_empty() {
                    items.push(TodoItem { text: text.to_string(), done: false });
                }
                break;
            }
        }
    }
    items
}

fn slugify(s: &str) -> String {
    let mut out = String::new();
    let mut prev_dash = false;
    for c in s.to_lowercase().chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c);
            prev_dash = false;
        } else if !prev_dash && !out.is_empty() {
            out.push('-');
            prev_dash = true;
        }
    }
    let s = out.trim_matches('-').to_string();
    if s.is_empty() { "untitled".into() } else { s }
}

/// `notes/<base>[-N].md` that doesn't exist yet.
fn unique_note_path(root: &std::path::Path, base: &str) -> String {
    let mut name = base.to_string();
    let mut n = 2;
    while root.join("notes").join(format!("{name}.md")).exists() {
        name = format!("{base}-{n}");
        n += 1;
    }
    format!("notes/{name}.md")
}

/// Create a `collections/<slug>/` database from a title + items: a board (grouped
/// by status) + table index, plus one row-note per item. Returns the collection
/// directory name (slug). Shared by both "convert note" and "convert selection".
fn build_database(
    root: &std::path::Path,
    db_state: &State<'_, DbState>,
    title: &str,
    items: &[TodoItem],
    date: &str,
) -> Result<String> {
    // Unique collection directory.
    let base = slugify(title);
    let (mut dir_name, mut n) = (base.clone(), 2);
    while root.join("collections").join(&dir_name).exists() {
        dir_name = format!("{base}-{n}");
        n += 1;
    }
    let dir = root.join("collections").join(&dir_name);
    std::fs::create_dir_all(&dir)?;

    let reindex = |abs: &std::path::Path| {
        if let Some(db) = db_state.0.lock().unwrap().as_ref() {
            let _ = cortex_core::index::index_file(root, abs, db);
        }
    };

    // Database index: a board grouped by status + a table.
    let index_rel = format!("collections/{dir_name}/_index.md");
    let mut fm: BTreeMap<String, serde_json::Value> = BTreeMap::new();
    fm.insert("type".into(), serde_json::json!("database"));
    fm.insert("title".into(), serde_json::json!(title));
    fm.insert("icon".into(), serde_json::json!("✅"));
    fm.insert("views".into(), serde_json::json!([
        { "name": "Board", "type": "board", "group": "status" },
        { "name": "Table", "type": "table" },
    ]));
    let index_abs = dir.join("_index.md");
    std::fs::write(&index_abs, note::serialize_note(&Note { path: index_rel, frontmatter: fm, body: String::new() })?)?;
    reindex(&index_abs);

    // One row-note per item.
    for (i, item) in items.iter().enumerate() {
        let base = slugify(&item.text);
        let base = if base == "untitled" { format!("row-{}", i + 1) } else { base };
        let (mut id, mut m) = (base.clone(), 2);
        while dir.join(format!("{id}.md")).exists() {
            id = format!("{base}-{m}");
            m += 1;
        }
        let mut rfm: BTreeMap<String, serde_json::Value> = BTreeMap::new();
        rfm.insert("title".into(), serde_json::json!(item.text));
        rfm.insert("status".into(), serde_json::json!(if item.done { "done" } else { "todo" }));
        rfm.insert("type".into(), serde_json::json!("task"));
        rfm.insert("created".into(), serde_json::json!(date));
        let row_abs = dir.join(format!("{id}.md"));
        std::fs::write(&row_abs, note::serialize_note(&Note {
            path: format!("collections/{dir_name}/{id}.md"),
            frontmatter: rfm,
            body: String::new(),
        })?)?;
        reindex(&row_abs);
    }

    // Give the database a Status property with categories, so status renders as
    // colored chips immediately and the board groups by it sensibly.
    let schema = cortex_core::schema::TypeSchema {
        properties: vec![cortex_core::schema::PropertyDef {
            name: "status".into(),
            ty: cortex_core::schema::PropType::Status,
            options: vec![
                cortex_core::schema::SelectOption { name: "todo".into(), color: "gray".into() },
                cortex_core::schema::SelectOption { name: "in-progress".into(), color: "blue".into() },
                cortex_core::schema::SelectOption { name: "done".into(), color: "green".into() },
            ],
            ..Default::default()
        }],
    };
    let _ = cortex_core::schema::save(root, &dir_name, &schema);

    Ok(dir_name)
}

/// Turn a whole checklist note into a database. Returns the new index path; the
/// source note is untouched (the caller trashes it).
#[tauri::command]
pub fn convert_note_to_database(
    path: String,
    date: String,
    state: State<'_, VaultState>,
    db_state: State<'_, DbState>,
) -> Result<String> {
    let root = vault_path(&state)?;
    let content = std::fs::read_to_string(root.join(&path))?;
    let note = note::parse_note(&path, &content)?;
    let title = note::infer_title(&note);
    let items = parse_todo_items(&note.body);
    let dir_name = build_database(&root, &db_state, &title, &items, &date)?;
    Ok(format!("collections/{dir_name}/_index.md"))
}

/// Create a database from explicit items (a selection of blocks in the editor),
/// to embed inline. Returns the collection directory name (the view `source` is
/// `collections/<name>`).
#[tauri::command]
pub fn create_database_from_items(
    name: String,
    items: Vec<TodoItem>,
    date: String,
    state: State<'_, VaultState>,
    db_state: State<'_, DbState>,
) -> Result<String> {
    let root = vault_path(&state)?;
    let title = if name.trim().is_empty() { "Tasks".to_string() } else { name };
    build_database(&root, &db_state, &title, &items, &date)
}

/// Turn a database into a checklist note: each row becomes a `- [ ]`/`- [x]`
/// line (checked when its status is "done"), ordered by created then title.
/// Returns the new note path. The source collection is untouched (the caller
/// deletes it after confirming).
#[tauri::command]
pub fn convert_database_to_note(
    name: String,
    state: State<'_, VaultState>,
    db_state: State<'_, DbState>,
) -> Result<String> {
    let root = vault_path(&state)?;
    let dir = root.join("collections").join(&name);
    if !dir.is_dir() {
        return Err(AppError::Other(format!("Not a database: {name}")));
    }

    let mut title = name.clone();
    if let Ok(c) = std::fs::read_to_string(dir.join("_index.md")) {
        if let Ok(idx) = note::parse_note("_index.md", &c) {
            if let Some(t) = idx.frontmatter.get("title").and_then(|v| v.as_str()) {
                title = t.to_string();
            }
        }
    }

    let mut rows: Vec<(String, String, bool)> = Vec::new();
    for entry in std::fs::read_dir(&dir)?.flatten() {
        let p = entry.path();
        if p.extension().and_then(|s| s.to_str()) != Some("md") {
            continue;
        }
        let stem = p.file_stem().and_then(|s| s.to_str()).unwrap_or("");
        if stem.starts_with('_') {
            continue;
        }
        let Ok(c) = std::fs::read_to_string(&p) else { continue };
        let Ok(n) = note::parse_note(stem, &c) else { continue };
        let rtitle = n.frontmatter.get("title").and_then(|v| v.as_str()).map(str::to_string).unwrap_or_else(|| stem.to_string());
        let status = n.frontmatter.get("status").and_then(|v| v.as_str()).unwrap_or("");
        let created = n.frontmatter.get("created").and_then(|v| v.as_str()).unwrap_or("").to_string();
        rows.push((created, rtitle, status.eq_ignore_ascii_case("done")));
    }
    rows.sort_by(|a, b| a.0.cmp(&b.0).then(a.1.cmp(&b.1)));

    let mut body = String::new();
    for (_, t, done) in &rows {
        body.push_str(&format!("- [{}] {}\n", if *done { "x" } else { " " }, t));
    }

    let note_rel = unique_note_path(&root, &slugify(&title));
    let abs = root.join(&note_rel);
    if let Some(parent) = abs.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let mut fm: BTreeMap<String, serde_json::Value> = BTreeMap::new();
    fm.insert("title".into(), serde_json::json!(title));
    std::fs::write(&abs, note::serialize_note(&Note { path: note_rel.clone(), frontmatter: fm, body })?)?;
    if let Some(db) = db_state.0.lock().unwrap().as_ref() {
        let _ = cortex_core::index::index_file(&root, &abs, db);
    }
    Ok(note_rel)
}

#[tauri::command]
pub fn create_folder(path: String, state: State<'_, VaultState>) -> Result<()> {
    let root = vault_path(&state)?;

    // Guard against path traversal and system directories
    if path.contains("..") || path.starts_with('/') || path.starts_with('\\') {
        return Err(AppError::Other("Invalid folder path".into()));
    }
    let first = path.split('/').next().unwrap_or("");
    if matches!(first, ".git" | ".brain") {
        return Err(AppError::Other("Cannot create folders in system directories".into()));
    }

    let abs = root.join(&path);
    std::fs::create_dir_all(&abs)?;

    // .gitkeep so git tracks the otherwise-empty directory
    let gitkeep = abs.join(".gitkeep");
    if !gitkeep.exists() {
        std::fs::write(gitkeep, "")?;
    }

    Ok(())
}

/// Return all subdirectory paths under `notes/`, relative to vault root,
/// with a trailing slash. Used by the frontend to show empty directories.
#[tauri::command]
pub fn list_vault_dirs(state: State<'_, VaultState>) -> Result<Vec<String>> {
    let root = vault_path(&state)?;
    let notes_root = root.join("notes");

    if !notes_root.exists() {
        return Ok(vec![]);
    }

    let mut dirs = Vec::new();
    for entry in WalkDir::new(&notes_root)
        .min_depth(1)
        .into_iter()
        // Skip hidden directories (.git, .brain, .DS_Store dirs, etc.) and never
        // descend into them — a nested repo would otherwise flood the tree.
        .filter_entry(|e| {
            e.file_name()
                .to_str()
                .map(|name| !name.starts_with('.'))
                .unwrap_or(false)
        })
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_dir())
    {
        if let Ok(rel) = entry.path().strip_prefix(&root) {
            let mut path = rel.to_string_lossy().replace('\\', "/");
            if !path.ends_with('/') {
                path.push('/');
            }
            dirs.push(path);
        }
    }

    dirs.sort();
    Ok(dirs)
}

// ── Assets ───────────────────────────────────────────────────────────────────

/// Save a binary asset (image, file) to vault/assets/ and return the relative path.
/// `data_base64` is the file content as a standard base64 string.
#[tauri::command]
pub fn save_asset(
    name: String,
    data_base64: String,
    state: State<'_, VaultState>,
) -> Result<String> {
    use base64::{Engine as _, engine::general_purpose};

    let data = general_purpose::STANDARD
        .decode(&data_base64)
        .map_err(|e| AppError::Other(format!("base64 decode: {e}")))?;

    let root = vault_path(&state)?;
    let assets_dir = root.join("assets");
    std::fs::create_dir_all(&assets_dir)?;

    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);

    let ext = std::path::Path::new(&name)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("png");

    let stem = std::path::Path::new(&name)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("image");

    let clean_stem: String = stem
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '-' })
        .collect();

    let filename = format!("{clean_stem}-{ts}.{ext}");
    std::fs::write(assets_dir.join(&filename), data)?;

    Ok(format!("assets/{filename}"))
}

/// Read an asset from vault/assets/ and return it as a base64 data URI.
/// `rel_path` is like `assets/image-1234.png`.
#[tauri::command]
pub fn read_asset(rel_path: String, state: State<'_, VaultState>) -> Result<String> {
    use base64::{Engine as _, engine::general_purpose};

    let root = vault_path(&state)?;
    let abs = root.join(&rel_path);

    if !abs.exists() {
        return Err(AppError::Other(format!("Asset not found: {rel_path}")));
    }
    // A `cover:` value comes from frontmatter — possibly a pack's seed row. It
    // may point anywhere inside the vault, never outside it (no `..`, no symlink out).
    let (real, real_root) = (abs.canonicalize()?, root.canonicalize()?);
    if !real.starts_with(&real_root) {
        return Err(AppError::Other(format!("Asset is outside the vault: {rel_path}")));
    }

    let data = std::fs::read(&real)?;
    let b64 = general_purpose::STANDARD.encode(&data);

    let ext = std::path::Path::new(&rel_path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("png");

    let mime = match ext {
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        _ => "image/png",
    };

    Ok(format!("data:{mime};base64,{b64}"))
}

// ── Graph ─────────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_all_links(db_state: State<'_, DbState>) -> Result<Vec<(String, String)>> {
    let guard = db_state.0.lock().unwrap();
    match guard.as_ref() {
        Some(db) => db.get_all_links(),
        None => Ok(vec![]),
    }
}

// ── Backlinks ────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_backlinks(
    path: String,
    db_state: State<'_, DbState>,
) -> Result<Vec<NoteEntry>> {
    let guard = db_state.0.lock().unwrap();
    match guard.as_ref() {
        Some(db) => db.get_backlinks(&path),
        None => Ok(vec![]),
    }
}

// ── Templates ────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn list_templates(state: State<'_, VaultState>) -> Result<Vec<String>> {
    let root = vault_path(&state)?;
    let templates_dir = root.join("templates");
    if !templates_dir.exists() {
        return Ok(vec![]);
    }
    let names = std::fs::read_dir(templates_dir)?
        .filter_map(|e| e.ok())
        .filter(|e| {
            e.path().extension().and_then(|s| s.to_str()) == Some("md")
        })
        .filter_map(|e| e.file_name().to_str().map(str::to_string))
        .collect();
    Ok(names)
}

/// Read a template file by name (e.g. "daily.md") and return its raw content.
/// Returns None if the template doesn't exist — the frontend falls back gracefully.
#[tauri::command]
pub fn read_template(name: String, state: State<'_, VaultState>) -> Result<Option<String>> {
    let root = vault_path(&state)?;
    let path = root.join("templates").join(&name);
    if !path.exists() {
        return Ok(None);
    }
    let content = std::fs::read_to_string(path)?;
    Ok(Some(content))
}

#[cfg(test)]
mod tests {
    use super::{extract_section, heading_level, parse_todo_items, slugify};

    #[test]
    fn parse_todo_items_reads_checkboxes_and_bullets() {
        let body = "# Groceries\n\n- [ ] Milk\n- [x] Eggs\n* [X] Bread\n- Plain bullet\nnot an item\n";
        let items = parse_todo_items(body);
        let got: Vec<(&str, bool)> = items.iter().map(|i| (i.text.as_str(), i.done)).collect();
        assert_eq!(got, vec![
            ("Milk", false),
            ("Eggs", true),
            ("Bread", true),
            ("Plain bullet", false),
        ]);
    }

    #[test]
    fn slugify_is_filesystem_safe() {
        assert_eq!(slugify("Grita's To-Do!"), "grita-s-to-do");
        assert_eq!(slugify("  "), "untitled");
        assert_eq!(slugify("Café ☕ Plan"), "caf-plan");
    }

    #[test]
    fn heading_level_parses_atx() {
        assert_eq!(heading_level("## Tasks"), Some((2, "Tasks".to_string())));
        assert_eq!(heading_level("   # Title  "), Some((1, "Title".to_string())));
        assert_eq!(heading_level("not a heading"), None);
        assert_eq!(heading_level("####### too deep"), None);
    }

    #[test]
    fn extract_section_slices_to_next_same_or_higher_heading() {
        let body = "# Top\nintro\n\n## Tasks\n- a\n- b\n\n### Sub\nx\n\n## Done\ny";
        let sect = extract_section(body, "Tasks").unwrap();
        // Includes its own heading, its body, and the deeper ### Sub, but stops
        // at the next `## Done` (same level).
        assert!(sect.contains("## Tasks"));
        assert!(sect.contains("- a"));
        assert!(sect.contains("### Sub"));
        assert!(!sect.contains("## Done"));
        assert!(!sect.contains("# Top"));

        // Case-insensitive match; missing section returns None.
        assert!(extract_section(body, "tasks").is_some());
        assert!(extract_section(body, "Nope").is_none());
    }
}
