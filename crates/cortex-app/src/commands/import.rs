//! Import commands — thin wrappers over `cortex_core::import`. Each one is an
//! explicit user action from the Import dialog; the plan calls write nothing.


use crate::ctx::AppCtx;
use cortex_core::error::{AppError, Result};
use cortex_core::import::notion::{self, NotionReport};
use cortex_core::import::{self, ColumnMap, CsvOptions, CsvPlan, CsvReport, MarkdownReport};


fn options(collection: String, title_column: Option<String>, columns: Option<Vec<ColumnMap>>) -> CsvOptions {
    CsvOptions { collection, title_column, columns: columns.unwrap_or_default() }
}

/// The column mapping and the first rows a CSV import would write.
pub fn import_csv_plan(ctx: &AppCtx, path: String, collection: String, title_column: Option<String>, columns: Option<Vec<ColumnMap>>) -> Result<CsvPlan> {
    import::plan_csv(&ctx.vault_path()?, std::path::Path::new(&path), &options(collection, title_column, columns))
}

/// Write the rows (and schema, and `_index.md` for a new collection), then index them.
pub fn import_csv(ctx: &AppCtx, path: String, collection: String, title_column: Option<String>, columns: Option<Vec<ColumnMap>>) -> Result<CsvReport> {
    let root = ctx.vault_path()?;
    let r = import::import_csv(&root, std::path::Path::new(&path), &options(collection, title_column, columns))?;
    if let Some(db) = ctx.db.0.lock().unwrap().as_ref() {
        for p in &r.written {
            let _ = cortex_core::index::index_file(&root, &root.join(p), db);
        }
    }
    Ok(r)
}

/// Copy a folder of Markdown under `notes/<into>/`; `dry_run` only reports.
pub fn import_markdown(ctx: &AppCtx, path: String, into: String, dry_run: bool) -> Result<MarkdownReport> {
    let root = ctx.vault_path()?;
    let r = import::import_markdown(&root, std::path::Path::new(&path), &into, dry_run)?;
    if !dry_run {
        if let Some(db) = ctx.db.0.lock().unwrap().as_ref() {
            for p in &r.notes {
                let _ = cortex_core::index::index_file(&root, &root.join(p), db);
            }
        }
    }
    Ok(r)
}

/// Import a Notion export zip (or its unpacked folder); `dry_run` only reports.
pub fn import_notion(ctx: &AppCtx, path: String, into: String, dry_run: bool) -> Result<NotionReport> {
    let root = ctx.vault_path()?;
    let r = notion::import_notion(&root, std::path::Path::new(&path), &into, dry_run)?;
    if !dry_run {
        if let Some(db) = ctx.db.0.lock().unwrap().as_ref() {
            let rows = r.collections.iter().flat_map(|c| c.written.iter());
            for p in r.notes.iter().chain(rows).chain(r.report.iter()) {
                let _ = cortex_core::index::index_file(&root, &root.join(p), db);
            }
        }
    }
    Ok(r)
}

// ── From a served device ─────────────────────────────────────────────────────
// A browser has no path on this machine to give. It sends the file's bytes;
// they wait in the vault's gitignored cache (`.brain/uploads/<id>/<name>`) and
// the import commands take the handle, never a path the device chose.

/// The staged file behind an upload handle (`uploads/<hex id>/<name>`).
fn upload_path(root: &std::path::Path, upload: &str) -> Result<std::path::PathBuf> {
    let mut parts = upload.split('/');
    let ok = parts.next() == Some("uploads")
        && parts.next().is_some_and(|id| !id.is_empty() && id.chars().all(|c| c.is_ascii_hexdigit()))
        && parts.next().is_some_and(|name| !name.is_empty() && name != "." && name != "..")
        && parts.next().is_none();
    if !ok {
        return Err(AppError::Other(format!("not an upload: {upload}")));
    }
    Ok(root.join(".brain").join(upload))
}

/// Keep a file a served device sent for importing. Returns the upload handle.
pub fn upload_import_file(ctx: &AppCtx, name: String, data_base64: String) -> Result<String> {
    use base64::Engine as _;
    let root = ctx.vault_path()?;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data_base64.as_bytes())
        .map_err(|e| AppError::Other(format!("the upload isn't base64: {e}")))?;
    let cleaned: String = name
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_' | ' ') { c } else { '_' })
        .collect();
    let cleaned = cleaned.trim().trim_start_matches('.').to_string();
    let file = if cleaned.is_empty() { "upload".to_string() } else { cleaned };
    let id = crate::serve_config::new_token()[..16].to_string();
    let dir = root.join(".brain").join("uploads").join(&id);
    std::fs::create_dir_all(&dir)?;
    std::fs::write(dir.join(&file), bytes)?;
    Ok(format!("uploads/{id}/{file}"))
}

/// Forget an upload once it has been imported.
fn discard_upload(path: &std::path::Path) {
    if let Some(dir) = path.parent() {
        let _ = std::fs::remove_dir_all(dir);
    }
}

pub fn import_csv_plan_upload(ctx: &AppCtx, upload: String, collection: String, title_column: Option<String>, columns: Option<Vec<ColumnMap>>) -> Result<CsvPlan> {
    let path = upload_path(&ctx.vault_path()?, &upload)?;
    import_csv_plan(ctx, path.to_string_lossy().into_owned(), collection, title_column, columns)
}

pub fn import_csv_upload(ctx: &AppCtx, upload: String, collection: String, title_column: Option<String>, columns: Option<Vec<ColumnMap>>) -> Result<CsvReport> {
    let path = upload_path(&ctx.vault_path()?, &upload)?;
    let report = import_csv(ctx, path.to_string_lossy().into_owned(), collection, title_column, columns)?;
    discard_upload(&path);
    Ok(report)
}

pub fn import_notion_upload(ctx: &AppCtx, upload: String, into: String, dry_run: bool) -> Result<NotionReport> {
    let path = upload_path(&ctx.vault_path()?, &upload)?;
    let report = import_notion(ctx, path.to_string_lossy().into_owned(), into, dry_run)?;
    if !dry_run {
        discard_upload(&path);
    }
    Ok(report)
}

#[cfg(test)]
mod upload_tests {
    use super::upload_path;
    use std::path::Path;

    #[test]
    fn upload_handles_stay_in_the_cache() {
        let root = Path::new("/vault");
        assert_eq!(upload_path(root, "uploads/0af3/export.zip").unwrap(), Path::new("/vault/.brain/uploads/0af3/export.zip"));
        assert!(upload_path(root, "uploads/0af3/../../notes").is_err());
        assert!(upload_path(root, "uploads/zz/export.zip").is_err(), "the id is hex");
        assert!(upload_path(root, "/etc/passwd").is_err());
        assert!(upload_path(root, "uploads/0af3/a/b.csv").is_err(), "one level only");
    }
}
