use std::collections::BTreeMap;
use std::path::PathBuf;
use std::time::UNIX_EPOCH;
use tauri::State;
use walkdir::WalkDir;

use crate::commands::vault::{DbState, VaultState};
use crate::error::{AppError, Result};
use crate::note::{self, Note, NoteEntry};

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
    let root = vault_path(&state)?;
    let mut entries = Vec::new();

    for entry in WalkDir::new(&root)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| {
            let p = e.path();
            p.extension().and_then(|s| s.to_str()) == Some("md")
                && !p.components().any(|c| {
                    matches!(
                        c.as_os_str().to_str(),
                        Some(".brain") | Some(".git") | Some(".trash") | Some(".cortex")
                    )
                })
        })
    {
        let abs = entry.path();
        let rel = abs.strip_prefix(&root).unwrap().to_string_lossy().to_string();
        let Ok(content) = std::fs::read_to_string(abs) else { continue };

        let modified = abs
            .metadata()
            .ok()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0);

        // A file with unparseable frontmatter (e.g. a template with raw
        // `{{placeholder}}` values) must still appear in the tree rather than
        // silently vanishing — fall back to a filename-derived title.
        let (title, note_type, icon, tags) = match note::parse_note(&rel, &content) {
            Ok(parsed) => {
                let title = note::infer_title(&parsed);
                let note_type = parsed.frontmatter.get("type").and_then(|v| v.as_str()).map(str::to_string);
                let icon = parsed.frontmatter.get("icon").and_then(|v| v.as_str()).map(str::to_string);
                let tags = parsed
                    .frontmatter
                    .get("tags")
                    .and_then(|v| v.as_array())
                    .map(|arr| arr.iter().filter_map(|v| v.as_str().map(str::to_string)).collect())
                    .unwrap_or_default();
                (title, note_type, icon, tags)
            }
            Err(_) => {
                let title = std::path::Path::new(&rel)
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("Untitled")
                    .to_string();
                (title, None, None, Vec::new())
            }
        };

        entries.push(NoteEntry { path: rel, title, note_type, icon, tags, modified });
    }

    entries.sort_by(|a, b| b.modified.cmp(&a.modified));
    Ok(entries)
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

/// Resolve a wiki-style ref (`Note Title`, `path/to/note`, optionally with
/// `#Section`) to a note's body, for inline transclusion. Resolution order:
/// exact path, then case-insensitive title, then filename stem.
#[tauri::command]
pub fn resolve_ref(target: String, state: State<'_, VaultState>) -> Result<NoteRef> {
    let root = vault_path(&state)?;
    let (base, section) = match target.split_once('#') {
        Some((b, s)) => (b.trim().to_string(), Some(s.trim().to_string())),
        None => (target.trim().to_string(), None),
    };
    let base_lower = base.to_lowercase();

    let mut title_match: Option<(String, String, String)> = None;
    let mut stem_match: Option<(String, String, String)> = None;
    let mut exact: Option<(String, String, String)> = None;

    for entry in WalkDir::new(&root)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| {
            let p = e.path();
            p.extension().and_then(|s| s.to_str()) == Some("md")
                && !p.components().any(|c| {
                    matches!(
                        c.as_os_str().to_str(),
                        Some(".brain") | Some(".git") | Some(".trash") | Some(".cortex")
                    )
                })
        })
    {
        let abs = entry.path();
        let rel = abs.strip_prefix(&root).unwrap().to_string_lossy().to_string();
        let Ok(content) = std::fs::read_to_string(abs) else { continue };
        let Ok(parsed) = note::parse_note(&rel, &content) else { continue };
        let title = note::infer_title(&parsed);
        let stem = std::path::Path::new(&rel)
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_string();

        if rel == base || rel == format!("{base}.md") {
            exact = Some((rel.clone(), title.clone(), parsed.body));
            break;
        }
        if title.to_lowercase() == base_lower && title_match.is_none() {
            title_match = Some((rel.clone(), title.clone(), parsed.body.clone()));
        }
        if stem.to_lowercase() == base_lower && stem_match.is_none() {
            stem_match = Some((rel, title, parsed.body));
        }
    }

    match exact.or(title_match).or(stem_match) {
        Some((path, title, body)) => {
            let body = match &section {
                Some(s) => extract_section(&body, s).unwrap_or(body),
                None => body,
            };
            Ok(NoteRef { path, title, body, found: true })
        }
        None => Ok(NoteRef { path: String::new(), title: base, body: String::new(), found: false }),
    }
}

// ── Write / Create / Delete ──────────────────────────────────────────────────

#[tauri::command]
pub fn write_note(
    path: String,
    note: Note,
    state: State<'_, VaultState>,
    db_state: State<'_, DbState>,
) -> Result<()> {
    let root = vault_path(&state)?;
    let abs = root.join(&path);

    if let Some(parent) = abs.parent() {
        std::fs::create_dir_all(parent)?;
    }

    let content = note::serialize_note(&note)?;
    std::fs::write(&abs, &content)?;

    // Keep index in sync
    if let Some(db) = db_state.0.lock().unwrap().as_ref() {
        let _ = crate::commands::indexer::index_file(&root, &abs, db);
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
    std::fs::write(&abs, &content)?;

    if let Some(db) = db_state.0.lock().unwrap().as_ref() {
        let _ = crate::commands::indexer::index_file(&root, &abs, db);
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
        let _ = crate::commands::indexer::index_file(&root, &abs, db);
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

#[tauri::command]
pub fn search_notes(
    query: String,
    db_state: State<'_, DbState>,
) -> Result<Vec<NoteEntry>> {
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
        let _ = crate::commands::indexer::index_file(&root, &to_abs, db);
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
        let _ = crate::commands::indexer::index_file(&root, &candidate, db);
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
        let _ = crate::commands::indexer::index_file(&root, &to_abs, db);
    }

    Ok(new_path)
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

    let data = std::fs::read(&abs)?;
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
    use super::{extract_section, heading_level};

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
