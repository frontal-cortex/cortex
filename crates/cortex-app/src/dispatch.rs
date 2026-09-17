//! The command table: every command either host can run, in one place.
//!
//! Generated from the command inventory when the command layer moved out of
//! the desktop app; edit it by hand from here on. Arguments arrive as the
//! JSON object the frontend's `invoke` sends (camelCase keys, as Tauri
//! expects), and results leave as JSON.

use std::sync::Arc;

use serde::de::DeserializeOwned;
use serde_json::Value;

use cortex_core::error::{AppError, Result};

use crate::ctx::AppCtx;
#[allow(unused_imports)]
use crate::types::*;

/// Which thread a command expects.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    /// Quick and order-sensitive: the desktop app ran these on its main thread,
    /// one after another, so a host must not let two of them interleave.
    Sync,
    /// Scales with the vault, git or the network: run on a blocking pool.
    Blocking,
}

/// Which hosts may run a command.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Exposure {
    /// The desktop app and the server.
    Both,
    /// The desktop app only: host paths, vault switching, the webview.
    Desktop,
    /// The server only when its terminal is switched on; always on the desktop.
    Terminal,
}

#[derive(Debug, Clone, Copy, serde::Serialize)]
pub struct CommandInfo {
    pub name: &'static str,
    pub mode: Mode,
    pub exposure: Exposure,
}

pub const COMMANDS: &[CommandInfo] = &[
    CommandInfo { name: "detect_agents", mode: Mode::Sync, exposure: Exposure::Both },
    CommandInfo { name: "list_comments", mode: Mode::Sync, exposure: Exposure::Both },
    CommandInfo { name: "add_comment", mode: Mode::Sync, exposure: Exposure::Both },
    CommandInfo { name: "reply_comment", mode: Mode::Sync, exposure: Exposure::Both },
    CommandInfo { name: "resolve_comment", mode: Mode::Sync, exposure: Exposure::Both },
    CommandInfo { name: "delete_comment", mode: Mode::Sync, exposure: Exposure::Both },
    CommandInfo { name: "get_settings", mode: Mode::Sync, exposure: Exposure::Both },
    CommandInfo { name: "set_settings", mode: Mode::Sync, exposure: Exposure::Both },
    CommandInfo { name: "get_favorites", mode: Mode::Sync, exposure: Exposure::Both },
    CommandInfo { name: "set_favorites", mode: Mode::Sync, exposure: Exposure::Both },
    CommandInfo { name: "run_view", mode: Mode::Sync, exposure: Exposure::Both },
    CommandInfo { name: "list_collections", mode: Mode::Sync, exposure: Exposure::Both },
    CommandInfo { name: "parse_view_spec", mode: Mode::Sync, exposure: Exposure::Both },
    CommandInfo { name: "parse_view_doc", mode: Mode::Sync, exposure: Exposure::Both },
    CommandInfo { name: "serialize_view_doc", mode: Mode::Sync, exposure: Exposure::Both },
    CommandInfo { name: "serialize_view_spec", mode: Mode::Sync, exposure: Exposure::Both },
    CommandInfo { name: "run_chart", mode: Mode::Sync, exposure: Exposure::Both },
    CommandInfo { name: "run_stats", mode: Mode::Sync, exposure: Exposure::Both },
    CommandInfo { name: "set_cell", mode: Mode::Sync, exposure: Exposure::Both },
    CommandInfo { name: "add_row", mode: Mode::Sync, exposure: Exposure::Both },
    CommandInfo { name: "export_to_file", mode: Mode::Sync, exposure: Exposure::Desktop },
    CommandInfo { name: "ensure_row", mode: Mode::Sync, exposure: Exposure::Both },
    CommandInfo { name: "list_row_templates", mode: Mode::Sync, exposure: Exposure::Both },
    CommandInfo { name: "add_row_from_template", mode: Mode::Sync, exposure: Exposure::Both },
    CommandInfo { name: "save_row_as_template", mode: Mode::Sync, exposure: Exposure::Both },
    CommandInfo { name: "duplicate_row", mode: Mode::Sync, exposure: Exposure::Both },
    CommandInfo { name: "delete_row", mode: Mode::Sync, exposure: Exposure::Both },
    CommandInfo { name: "git_status", mode: Mode::Sync, exposure: Exposure::Both },
    CommandInfo { name: "git_commit", mode: Mode::Blocking, exposure: Exposure::Both },
    CommandInfo { name: "git_sync", mode: Mode::Blocking, exposure: Exposure::Both },
    CommandInfo { name: "git_conflicts", mode: Mode::Sync, exposure: Exposure::Both },
    CommandInfo { name: "git_resolve_conflict", mode: Mode::Sync, exposure: Exposure::Both },
    CommandInfo { name: "git_complete_merge", mode: Mode::Sync, exposure: Exposure::Both },
    CommandInfo { name: "git_abort_merge", mode: Mode::Sync, exposure: Exposure::Both },
    CommandInfo { name: "git_log", mode: Mode::Sync, exposure: Exposure::Both },
    CommandInfo { name: "git_diff", mode: Mode::Sync, exposure: Exposure::Both },
    CommandInfo { name: "note_history", mode: Mode::Sync, exposure: Exposure::Both },
    CommandInfo { name: "note_authorship", mode: Mode::Sync, exposure: Exposure::Both },
    CommandInfo { name: "note_at", mode: Mode::Sync, exposure: Exposure::Both },
    CommandInfo { name: "restore_note", mode: Mode::Sync, exposure: Exposure::Both },
    CommandInfo { name: "list_agent_branches", mode: Mode::Sync, exposure: Exposure::Both },
    CommandInfo { name: "agent_branch_diff", mode: Mode::Sync, exposure: Exposure::Both },
    CommandInfo { name: "apply_agent_branch", mode: Mode::Sync, exposure: Exposure::Both },
    CommandInfo { name: "discard_agent_branch", mode: Mode::Sync, exposure: Exposure::Both },
    CommandInfo { name: "import_csv_plan", mode: Mode::Sync, exposure: Exposure::Desktop },
    CommandInfo { name: "import_csv", mode: Mode::Sync, exposure: Exposure::Desktop },
    CommandInfo { name: "import_markdown", mode: Mode::Sync, exposure: Exposure::Desktop },
    CommandInfo { name: "import_notion", mode: Mode::Sync, exposure: Exposure::Desktop },
    CommandInfo { name: "get_members", mode: Mode::Sync, exposure: Exposure::Both },
    CommandInfo { name: "set_members", mode: Mode::Sync, exposure: Exposure::Both },
    CommandInfo { name: "current_user", mode: Mode::Sync, exposure: Exposure::Both },
    CommandInfo { name: "list_notes", mode: Mode::Sync, exposure: Exposure::Both },
    CommandInfo { name: "list_tags", mode: Mode::Sync, exposure: Exposure::Both },
    CommandInfo { name: "read_note", mode: Mode::Sync, exposure: Exposure::Both },
    CommandInfo { name: "resolve_ref", mode: Mode::Sync, exposure: Exposure::Both },
    CommandInfo { name: "write_note", mode: Mode::Sync, exposure: Exposure::Both },
    CommandInfo { name: "create_note", mode: Mode::Sync, exposure: Exposure::Both },
    CommandInfo { name: "create_note_from_template", mode: Mode::Sync, exposure: Exposure::Both },
    CommandInfo { name: "delete_note", mode: Mode::Sync, exposure: Exposure::Both },
    CommandInfo { name: "search_notes", mode: Mode::Blocking, exposure: Exposure::Both },
    CommandInfo { name: "delete_folder", mode: Mode::Sync, exposure: Exposure::Both },
    CommandInfo { name: "rename_note", mode: Mode::Sync, exposure: Exposure::Both },
    CommandInfo { name: "title_changed", mode: Mode::Sync, exposure: Exposure::Both },
    CommandInfo { name: "resolve_note", mode: Mode::Sync, exposure: Exposure::Both },
    CommandInfo { name: "duplicate_note", mode: Mode::Sync, exposure: Exposure::Both },
    CommandInfo { name: "reveal_path", mode: Mode::Sync, exposure: Exposure::Desktop },
    CommandInfo { name: "move_note", mode: Mode::Sync, exposure: Exposure::Both },
    CommandInfo { name: "convert_note_to_database", mode: Mode::Sync, exposure: Exposure::Both },
    CommandInfo { name: "create_database_from_items", mode: Mode::Sync, exposure: Exposure::Both },
    CommandInfo { name: "convert_database_to_note", mode: Mode::Sync, exposure: Exposure::Both },
    CommandInfo { name: "create_folder", mode: Mode::Sync, exposure: Exposure::Both },
    CommandInfo { name: "list_vault_dirs", mode: Mode::Sync, exposure: Exposure::Both },
    CommandInfo { name: "save_asset", mode: Mode::Sync, exposure: Exposure::Both },
    CommandInfo { name: "read_asset", mode: Mode::Sync, exposure: Exposure::Both },
    CommandInfo { name: "get_all_links", mode: Mode::Sync, exposure: Exposure::Both },
    CommandInfo { name: "get_backlinks", mode: Mode::Sync, exposure: Exposure::Both },
    CommandInfo { name: "get_unlinked_mentions", mode: Mode::Sync, exposure: Exposure::Both },
    CommandInfo { name: "link_mentions", mode: Mode::Sync, exposure: Exposure::Both },
    CommandInfo { name: "list_templates", mode: Mode::Sync, exposure: Exposure::Both },
    CommandInfo { name: "read_template", mode: Mode::Sync, exposure: Exposure::Both },
    CommandInfo { name: "packs_catalog", mode: Mode::Blocking, exposure: Exposure::Both },
    CommandInfo { name: "packs_show", mode: Mode::Blocking, exposure: Exposure::Both },
    CommandInfo { name: "packs_install", mode: Mode::Blocking, exposure: Exposure::Both },
    CommandInfo { name: "packs_update", mode: Mode::Blocking, exposure: Exposure::Both },
    CommandInfo { name: "packs_remove", mode: Mode::Blocking, exposure: Exposure::Both },
    CommandInfo { name: "packs_preview", mode: Mode::Blocking, exposure: Exposure::Both },
    CommandInfo { name: "packs_export", mode: Mode::Blocking, exposure: Exposure::Desktop },
    CommandInfo { name: "fetch_link_preview", mode: Mode::Sync, exposure: Exposure::Both },
    CommandInfo { name: "resolve_embed", mode: Mode::Sync, exposure: Exposure::Both },
    CommandInfo { name: "allow_embed_frame", mode: Mode::Sync, exposure: Exposure::Desktop },
    CommandInfo { name: "publish_preview", mode: Mode::Sync, exposure: Exposure::Both },
    CommandInfo { name: "publish_to_dir", mode: Mode::Blocking, exposure: Exposure::Desktop },
    CommandInfo { name: "publish_gh_pages", mode: Mode::Blocking, exposure: Exposure::Desktop },
    CommandInfo { name: "publish_write_github_action", mode: Mode::Sync, exposure: Exposure::Both },
    CommandInfo { name: "get_recent_vaults", mode: Mode::Sync, exposure: Exposure::Desktop },
    CommandInfo { name: "forget_recent", mode: Mode::Sync, exposure: Exposure::Desktop },
    CommandInfo { name: "get_recent_notes", mode: Mode::Sync, exposure: Exposure::Both },
    CommandInfo { name: "record_recent_note", mode: Mode::Sync, exposure: Exposure::Both },
    CommandInfo { name: "get_schema", mode: Mode::Sync, exposure: Exposure::Both },
    CommandInfo { name: "get_schema_for_note", mode: Mode::Sync, exposure: Exposure::Both },
    CommandInfo { name: "set_schema", mode: Mode::Sync, exposure: Exposure::Both },
    CommandInfo { name: "upsert_property", mode: Mode::Sync, exposure: Exposure::Both },
    CommandInfo { name: "rename_property", mode: Mode::Sync, exposure: Exposure::Both },
    CommandInfo { name: "delete_property", mode: Mode::Sync, exposure: Exposure::Both },
    CommandInfo { name: "run_tracker", mode: Mode::Sync, exposure: Exposure::Both },
    CommandInfo { name: "tracker_toggle", mode: Mode::Sync, exposure: Exposure::Both },
    CommandInfo { name: "list_trackers", mode: Mode::Sync, exposure: Exposure::Both },
    CommandInfo { name: "list_trash", mode: Mode::Sync, exposure: Exposure::Both },
    CommandInfo { name: "restore_trashed", mode: Mode::Sync, exposure: Exposure::Both },
    CommandInfo { name: "delete_trashed", mode: Mode::Sync, exposure: Exposure::Both },
    CommandInfo { name: "empty_trash", mode: Mode::Sync, exposure: Exposure::Both },
    CommandInfo { name: "trash_collection", mode: Mode::Sync, exposure: Exposure::Both },
    CommandInfo { name: "open_vault", mode: Mode::Blocking, exposure: Exposure::Desktop },
    CommandInfo { name: "create_vault_from_template", mode: Mode::Blocking, exposure: Exposure::Desktop },
    CommandInfo { name: "close_vault", mode: Mode::Sync, exposure: Exposure::Desktop },
    CommandInfo { name: "get_vault_info", mode: Mode::Sync, exposure: Exposure::Both },
    CommandInfo { name: "terminal_spawn", mode: Mode::Sync, exposure: Exposure::Terminal },
    CommandInfo { name: "terminal_write", mode: Mode::Sync, exposure: Exposure::Terminal },
    CommandInfo { name: "terminal_resize", mode: Mode::Sync, exposure: Exposure::Terminal },
    CommandInfo { name: "terminal_kill", mode: Mode::Sync, exposure: Exposure::Terminal },
    CommandInfo { name: "detect_desktop_theme", mode: Mode::Sync, exposure: Exposure::Both },
    CommandInfo { name: "watch_theme_file", mode: Mode::Sync, exposure: Exposure::Desktop },
    CommandInfo { name: "export_text", mode: Mode::Blocking, exposure: Exposure::Both },
    CommandInfo { name: "upload_import_file", mode: Mode::Blocking, exposure: Exposure::Both },
    CommandInfo { name: "import_csv_plan_upload", mode: Mode::Blocking, exposure: Exposure::Both },
    CommandInfo { name: "import_csv_upload", mode: Mode::Blocking, exposure: Exposure::Both },
    CommandInfo { name: "import_notion_upload", mode: Mode::Blocking, exposure: Exposure::Both },
];

/// A command's entry, if the table has one.
pub fn info(name: &str) -> Option<&'static CommandInfo> {
    COMMANDS.iter().find(|c| c.name == name)
}

fn parse<T: DeserializeOwned>(name: &str, args: Value) -> Result<T> {
    let args = if args.is_null() { Value::Object(Default::default()) } else { args };
    serde_json::from_value(args).map_err(|e| AppError::Other(format!("invalid arguments for {name}: {e}")))
}

fn json<T: serde::Serialize>(result: Result<T>) -> Result<Value> {
    serde_json::to_value(result?).map_err(|e| AppError::Other(format!("could not encode the result: {e}")))
}

/// Run `name` with `args`. `None` means the table has no such command; the
/// caller decides what exposure it allows before calling.
pub fn dispatch(ctx: &Arc<AppCtx>, name: &str, args: Value) -> Option<Result<Value>> {
    let _ = &args;
    Some(match name {
        "detect_agents" => json(Ok(crate::agents::detect_agents())),
        "list_comments" => (|| {
            #[derive(serde::Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Args { path: String, }
            let a: Args = parse("list_comments", args)?;
            json(crate::commands::comments::list_comments(ctx, a.path))
        })(),
        "add_comment" => (|| {
            #[derive(serde::Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Args { path: String, text: String, anchor: Option<Anchor>, }
            let a: Args = parse("add_comment", args)?;
            json(crate::commands::comments::add_comment(ctx, a.path, a.text, a.anchor))
        })(),
        "reply_comment" => (|| {
            #[derive(serde::Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Args { path: String, id: String, text: String, }
            let a: Args = parse("reply_comment", args)?;
            json(crate::commands::comments::reply_comment(ctx, a.path, a.id, a.text))
        })(),
        "resolve_comment" => (|| {
            #[derive(serde::Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Args { path: String, id: String, resolved: bool, }
            let a: Args = parse("resolve_comment", args)?;
            json(crate::commands::comments::resolve_comment(ctx, a.path, a.id, a.resolved))
        })(),
        "delete_comment" => (|| {
            #[derive(serde::Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Args { path: String, id: String, }
            let a: Args = parse("delete_comment", args)?;
            json(crate::commands::comments::delete_comment(ctx, a.path, a.id))
        })(),
        "get_settings" => json(crate::commands::config::get_settings(ctx)),
        "set_settings" => (|| {
            #[derive(serde::Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Args { settings: Settings, }
            let a: Args = parse("set_settings", args)?;
            json(crate::commands::config::set_settings(ctx, a.settings))
        })(),
        "get_favorites" => json(crate::commands::config::get_favorites(ctx)),
        "set_favorites" => (|| {
            #[derive(serde::Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Args { paths: Vec<String>, }
            let a: Args = parse("set_favorites", args)?;
            json(crate::commands::config::set_favorites(ctx, a.paths))
        })(),
        "run_view" => (|| {
            #[derive(serde::Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Args { spec: String, }
            let a: Args = parse("run_view", args)?;
            json(crate::commands::data::run_view(ctx, a.spec))
        })(),
        "list_collections" => json(crate::commands::data::list_collections(ctx)),
        "parse_view_spec" => (|| {
            #[derive(serde::Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Args { spec: String, }
            let a: Args = parse("parse_view_spec", args)?;
            json(crate::commands::data::parse_view_spec(a.spec))
        })(),
        "parse_view_doc" => (|| {
            #[derive(serde::Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Args { spec: String, }
            let a: Args = parse("parse_view_doc", args)?;
            json(crate::commands::data::parse_view_doc(a.spec))
        })(),
        "serialize_view_doc" => (|| {
            #[derive(serde::Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Args { doc: ViewDoc, }
            let a: Args = parse("serialize_view_doc", args)?;
            json(crate::commands::data::serialize_view_doc(a.doc))
        })(),
        "serialize_view_spec" => (|| {
            #[derive(serde::Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Args { spec: StructuredSpec, }
            let a: Args = parse("serialize_view_spec", args)?;
            json(crate::commands::data::serialize_view_spec(a.spec))
        })(),
        "run_chart" => (|| {
            #[derive(serde::Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Args { spec: String, }
            let a: Args = parse("run_chart", args)?;
            json(crate::commands::data::run_chart(ctx, a.spec))
        })(),
        "run_stats" => (|| {
            #[derive(serde::Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Args { spec: String, }
            let a: Args = parse("run_stats", args)?;
            json(crate::commands::data::run_stats(ctx, a.spec))
        })(),
        "set_cell" => (|| {
            #[derive(serde::Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Args { source: String, row_id: String, field: String, value: String, ty: String, }
            let a: Args = parse("set_cell", args)?;
            json(crate::commands::data::set_cell(ctx, a.source, a.row_id, a.field, a.value, a.ty))
        })(),
        "add_row" => (|| {
            #[derive(serde::Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Args { source: String, id: String, fields: std::collections::HashMap<String, String>, }
            let a: Args = parse("add_row", args)?;
            json(crate::commands::data::add_row(ctx, a.source, a.id, a.fields))
        })(),
        "export_to_file" => (|| {
            #[derive(serde::Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Args { kind: String, target: String, dest: String, }
            let a: Args = parse("export_to_file", args)?;
            json(crate::commands::data::export_to_file(ctx, a.kind, a.target, a.dest))
        })(),
        "ensure_row" => (|| {
            #[derive(serde::Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Args { source: String, id: String, fields: std::collections::HashMap<String, String>, }
            let a: Args = parse("ensure_row", args)?;
            json(crate::commands::data::ensure_row(ctx, a.source, a.id, a.fields))
        })(),
        "list_row_templates" => (|| {
            #[derive(serde::Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Args { source: String, }
            let a: Args = parse("list_row_templates", args)?;
            json(crate::commands::data::list_row_templates(ctx, a.source))
        })(),
        "add_row_from_template" => (|| {
            #[derive(serde::Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Args { source: String, id: String, template: String, fields: std::collections::HashMap<String, String>, }
            let a: Args = parse("add_row_from_template", args)?;
            json(crate::commands::data::add_row_from_template(ctx, a.source, a.id, a.template, a.fields))
        })(),
        "save_row_as_template" => (|| {
            #[derive(serde::Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Args { source: String, row_id: String, name: String, }
            let a: Args = parse("save_row_as_template", args)?;
            json(crate::commands::data::save_row_as_template(ctx, a.source, a.row_id, a.name))
        })(),
        "duplicate_row" => (|| {
            #[derive(serde::Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Args { source: String, row_id: String, new_id: String, created: String, }
            let a: Args = parse("duplicate_row", args)?;
            json(crate::commands::data::duplicate_row(ctx, a.source, a.row_id, a.new_id, a.created))
        })(),
        "delete_row" => (|| {
            #[derive(serde::Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Args { source: String, row_id: String, }
            let a: Args = parse("delete_row", args)?;
            json(crate::commands::data::delete_row(ctx, a.source, a.row_id))
        })(),
        "git_status" => json(crate::commands::git::git_status(ctx)),
        "git_commit" => (|| {
            #[derive(serde::Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Args { message: String, }
            let a: Args = parse("git_commit", args)?;
            json(crate::commands::git::git_commit(ctx, a.message))
        })(),
        "git_sync" => json(crate::commands::git::git_sync(ctx)),
        "git_conflicts" => json(crate::commands::git::git_conflicts(ctx)),
        "git_resolve_conflict" => (|| {
            #[derive(serde::Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Args { file: String, side: String, }
            let a: Args = parse("git_resolve_conflict", args)?;
            json(crate::commands::git::git_resolve_conflict(ctx, a.file, a.side))
        })(),
        "git_complete_merge" => json(crate::commands::git::git_complete_merge(ctx)),
        "git_abort_merge" => json(crate::commands::git::git_abort_merge(ctx)),
        "git_log" => (|| {
            #[derive(serde::Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Args { limit: usize, }
            let a: Args = parse("git_log", args)?;
            json(crate::commands::git::git_log(ctx, a.limit))
        })(),
        "git_diff" => (|| {
            #[derive(serde::Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Args { hash: String, }
            let a: Args = parse("git_diff", args)?;
            json(crate::commands::git::git_diff(ctx, a.hash))
        })(),
        "note_history" => (|| {
            #[derive(serde::Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Args { path: String, limit: usize, }
            let a: Args = parse("note_history", args)?;
            json(crate::commands::git::note_history(ctx, a.path, a.limit))
        })(),
        "note_authorship" => (|| {
            #[derive(serde::Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Args { path: String, }
            let a: Args = parse("note_authorship", args)?;
            json(crate::commands::git::note_authorship(ctx, a.path))
        })(),
        "note_at" => (|| {
            #[derive(serde::Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Args { path: String, hash: String, }
            let a: Args = parse("note_at", args)?;
            json(crate::commands::git::note_at(ctx, a.path, a.hash))
        })(),
        "restore_note" => (|| {
            #[derive(serde::Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Args { path: String, hash: String, }
            let a: Args = parse("restore_note", args)?;
            json(crate::commands::git::restore_note(ctx, a.path, a.hash))
        })(),
        "list_agent_branches" => json(crate::commands::git::list_agent_branches(ctx)),
        "agent_branch_diff" => (|| {
            #[derive(serde::Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Args { branch_name: String, }
            let a: Args = parse("agent_branch_diff", args)?;
            json(crate::commands::git::agent_branch_diff(ctx, a.branch_name))
        })(),
        "apply_agent_branch" => (|| {
            #[derive(serde::Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Args { branch_name: String, }
            let a: Args = parse("apply_agent_branch", args)?;
            json(crate::commands::git::apply_agent_branch(ctx, a.branch_name))
        })(),
        "discard_agent_branch" => (|| {
            #[derive(serde::Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Args { branch_name: String, }
            let a: Args = parse("discard_agent_branch", args)?;
            json(crate::commands::git::discard_agent_branch(ctx, a.branch_name))
        })(),
        "import_csv_plan" => (|| {
            #[derive(serde::Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Args { path: String, collection: String, title_column: Option<String>, columns: Option<Vec<ColumnMap>>, }
            let a: Args = parse("import_csv_plan", args)?;
            json(crate::commands::import::import_csv_plan(ctx, a.path, a.collection, a.title_column, a.columns))
        })(),
        "import_csv" => (|| {
            #[derive(serde::Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Args { path: String, collection: String, title_column: Option<String>, columns: Option<Vec<ColumnMap>>, }
            let a: Args = parse("import_csv", args)?;
            json(crate::commands::import::import_csv(ctx, a.path, a.collection, a.title_column, a.columns))
        })(),
        "import_markdown" => (|| {
            #[derive(serde::Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Args { path: String, into: String, dry_run: bool, }
            let a: Args = parse("import_markdown", args)?;
            json(crate::commands::import::import_markdown(ctx, a.path, a.into, a.dry_run))
        })(),
        "import_notion" => (|| {
            #[derive(serde::Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Args { path: String, into: String, dry_run: bool, }
            let a: Args = parse("import_notion", args)?;
            json(crate::commands::import::import_notion(ctx, a.path, a.into, a.dry_run))
        })(),
        "get_members" => json(crate::commands::members::get_members(ctx)),
        "set_members" => (|| {
            #[derive(serde::Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Args { members: Vec<Member>, }
            let a: Args = parse("set_members", args)?;
            json(crate::commands::members::set_members(ctx, a.members))
        })(),
        "current_user" => json(crate::commands::members::current_user(ctx)),
        "list_notes" => json(crate::commands::notes::list_notes(ctx)),
        "list_tags" => json(crate::commands::notes::list_tags(ctx)),
        "read_note" => (|| {
            #[derive(serde::Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Args { path: String, }
            let a: Args = parse("read_note", args)?;
            json(crate::commands::notes::read_note(ctx, a.path))
        })(),
        "resolve_ref" => (|| {
            #[derive(serde::Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Args { target: String, }
            let a: Args = parse("resolve_ref", args)?;
            json(crate::commands::notes::resolve_ref(ctx, a.target))
        })(),
        "write_note" => (|| {
            #[derive(serde::Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Args { path: String, note: Note, }
            let a: Args = parse("write_note", args)?;
            json(crate::commands::notes::write_note(ctx, a.path, a.note))
        })(),
        "create_note" => (|| {
            #[derive(serde::Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Args { path: String, title: String, created: String, }
            let a: Args = parse("create_note", args)?;
            json(crate::commands::notes::create_note(ctx, a.path, a.title, a.created))
        })(),
        "create_note_from_template" => (|| {
            #[derive(serde::Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Args { template: String, path: String, vars: std::collections::HashMap<String, String>, }
            let a: Args = parse("create_note_from_template", args)?;
            json(crate::commands::notes::create_note_from_template(ctx, a.template, a.path, a.vars))
        })(),
        "delete_note" => (|| {
            #[derive(serde::Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Args { path: String, }
            let a: Args = parse("delete_note", args)?;
            json(crate::commands::notes::delete_note(ctx, a.path))
        })(),
        "search_notes" => (|| {
            #[derive(serde::Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Args { query: String, }
            let a: Args = parse("search_notes", args)?;
            json(crate::commands::notes::search_notes(ctx, a.query))
        })(),
        "delete_folder" => (|| {
            #[derive(serde::Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Args { path: String, }
            let a: Args = parse("delete_folder", args)?;
            json(crate::commands::notes::delete_folder(ctx, a.path))
        })(),
        "rename_note" => (|| {
            #[derive(serde::Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Args { old_path: String, new_path: String, title: Option<String>, }
            let a: Args = parse("rename_note", args)?;
            json(crate::commands::notes::rename_note(ctx, a.old_path, a.new_path, a.title))
        })(),
        "title_changed" => (|| {
            #[derive(serde::Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Args { path: String, old_title: String, new_title: String, }
            let a: Args = parse("title_changed", args)?;
            json(crate::commands::notes::title_changed(ctx, a.path, a.old_title, a.new_title))
        })(),
        "resolve_note" => (|| {
            #[derive(serde::Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Args { target: String, }
            let a: Args = parse("resolve_note", args)?;
            json(crate::commands::notes::resolve_note(ctx, a.target))
        })(),
        "duplicate_note" => (|| {
            #[derive(serde::Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Args { path: String, }
            let a: Args = parse("duplicate_note", args)?;
            json(crate::commands::notes::duplicate_note(ctx, a.path))
        })(),
        "reveal_path" => (|| {
            #[derive(serde::Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Args { path: String, }
            let a: Args = parse("reveal_path", args)?;
            json(crate::commands::notes::reveal_path(ctx, a.path))
        })(),
        "move_note" => (|| {
            #[derive(serde::Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Args { from_path: String, to_dir: String, }
            let a: Args = parse("move_note", args)?;
            json(crate::commands::notes::move_note(ctx, a.from_path, a.to_dir))
        })(),
        "convert_note_to_database" => (|| {
            #[derive(serde::Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Args { path: String, date: String, }
            let a: Args = parse("convert_note_to_database", args)?;
            json(crate::commands::notes::convert_note_to_database(ctx, a.path, a.date))
        })(),
        "create_database_from_items" => (|| {
            #[derive(serde::Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Args { name: String, items: Vec<TodoItem>, date: String, }
            let a: Args = parse("create_database_from_items", args)?;
            json(crate::commands::notes::create_database_from_items(ctx, a.name, a.items, a.date))
        })(),
        "convert_database_to_note" => (|| {
            #[derive(serde::Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Args { name: String, }
            let a: Args = parse("convert_database_to_note", args)?;
            json(crate::commands::notes::convert_database_to_note(ctx, a.name))
        })(),
        "create_folder" => (|| {
            #[derive(serde::Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Args { path: String, }
            let a: Args = parse("create_folder", args)?;
            json(crate::commands::notes::create_folder(ctx, a.path))
        })(),
        "list_vault_dirs" => json(crate::commands::notes::list_vault_dirs(ctx)),
        "save_asset" => (|| {
            #[derive(serde::Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Args { name: String, data_base64: String, }
            let a: Args = parse("save_asset", args)?;
            json(crate::commands::notes::save_asset(ctx, a.name, a.data_base64))
        })(),
        "read_asset" => (|| {
            #[derive(serde::Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Args { rel_path: String, }
            let a: Args = parse("read_asset", args)?;
            json(crate::commands::notes::read_asset(ctx, a.rel_path))
        })(),
        "get_all_links" => json(crate::commands::notes::get_all_links(ctx)),
        "get_backlinks" => (|| {
            #[derive(serde::Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Args { path: String, }
            let a: Args = parse("get_backlinks", args)?;
            json(crate::commands::notes::get_backlinks(ctx, a.path))
        })(),
        "get_unlinked_mentions" => (|| {
            #[derive(serde::Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Args { path: String, }
            let a: Args = parse("get_unlinked_mentions", args)?;
            json(crate::commands::notes::get_unlinked_mentions(ctx, a.path))
        })(),
        "link_mentions" => (|| {
            #[derive(serde::Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Args { source: String, path: String, }
            let a: Args = parse("link_mentions", args)?;
            json(crate::commands::notes::link_mentions(ctx, a.source, a.path))
        })(),
        "list_templates" => json(crate::commands::notes::list_templates(ctx)),
        "read_template" => (|| {
            #[derive(serde::Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Args { name: String, }
            let a: Args = parse("read_template", args)?;
            json(crate::commands::notes::read_template(ctx, a.name))
        })(),
        "packs_catalog" => (|| {
            #[derive(serde::Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Args { refresh: bool, }
            let a: Args = parse("packs_catalog", args)?;
            json(crate::commands::packs::packs_catalog(ctx, a.refresh))
        })(),
        "packs_show" => (|| {
            #[derive(serde::Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Args { id: String, force: bool, }
            let a: Args = parse("packs_show", args)?;
            json(crate::commands::packs::packs_show(ctx, a.id, a.force))
        })(),
        "packs_install" => (|| {
            #[derive(serde::Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Args { id: String, force: bool, }
            let a: Args = parse("packs_install", args)?;
            json(crate::commands::packs::packs_install(ctx, a.id, a.force))
        })(),
        "packs_update" => (|| {
            #[derive(serde::Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Args { id: String, }
            let a: Args = parse("packs_update", args)?;
            json(crate::commands::packs::packs_update(ctx, a.id))
        })(),
        "packs_remove" => (|| {
            #[derive(serde::Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Args { id: String, }
            let a: Args = parse("packs_remove", args)?;
            json(crate::commands::packs::packs_remove(ctx, a.id))
        })(),
        "packs_preview" => (|| {
            #[derive(serde::Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Args { id: String, }
            let a: Args = parse("packs_preview", args)?;
            json(crate::commands::packs::packs_preview(ctx, a.id))
        })(),
        "packs_export" => (|| {
            #[derive(serde::Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Args { id: String, from: String, out_dir: String, }
            let a: Args = parse("packs_export", args)?;
            json(crate::commands::packs::packs_export(ctx, a.id, a.from, a.out_dir))
        })(),
        "fetch_link_preview" => (|| {
            #[derive(serde::Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Args { url: String, refresh: bool, }
            let a: Args = parse("fetch_link_preview", args)?;
            json(crate::commands::preview::fetch_link_preview(ctx, a.url, a.refresh))
        })(),
        "resolve_embed" => (|| {
            #[derive(serde::Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Args { url: String, }
            let a: Args = parse("resolve_embed", args)?;
            json(Ok(crate::commands::preview::resolve_embed(a.url)))
        })(),
        "allow_embed_frame" => (|| {
            #[derive(serde::Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Args { url: String, }
            let a: Args = parse("allow_embed_frame", args)?;
            json(crate::commands::preview::allow_embed_frame(ctx, a.url))
        })(),
        "publish_preview" => json(crate::commands::publish::publish_preview(ctx)),
        "publish_to_dir" => (|| {
            #[derive(serde::Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Args { dir: String, force: bool, }
            let a: Args = parse("publish_to_dir", args)?;
            json(crate::commands::publish::publish_to_dir(ctx, a.dir, a.force))
        })(),
        "publish_gh_pages" => (|| {
            #[derive(serde::Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Args { remote: String, branch: String, }
            let a: Args = parse("publish_gh_pages", args)?;
            json(crate::commands::publish::publish_gh_pages(ctx, a.remote, a.branch))
        })(),
        "publish_write_github_action" => json(crate::commands::publish::publish_write_github_action(ctx)),
        "get_recent_vaults" => json(crate::commands::recent::get_recent_vaults(ctx)),
        "forget_recent" => (|| {
            #[derive(serde::Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Args { path: String, }
            let a: Args = parse("forget_recent", args)?;
            json(crate::commands::recent::forget_recent(ctx, a.path))
        })(),
        "get_recent_notes" => json(crate::commands::recent::get_recent_notes(ctx)),
        "record_recent_note" => (|| {
            #[derive(serde::Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Args { path: String, }
            let a: Args = parse("record_recent_note", args)?;
            json(crate::commands::recent::record_recent_note(ctx, a.path))
        })(),
        "get_schema" => (|| {
            #[derive(serde::Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Args { key: String, }
            let a: Args = parse("get_schema", args)?;
            json(crate::commands::schema::get_schema(ctx, a.key))
        })(),
        "get_schema_for_note" => (|| {
            #[derive(serde::Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Args { path: String, note_type: Option<String>, }
            let a: Args = parse("get_schema_for_note", args)?;
            json(crate::commands::schema::get_schema_for_note(ctx, a.path, a.note_type))
        })(),
        "set_schema" => (|| {
            #[derive(serde::Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Args { key: String, schema: TypeSchema, }
            let a: Args = parse("set_schema", args)?;
            json(crate::commands::schema::set_schema(ctx, a.key, a.schema))
        })(),
        "upsert_property" => (|| {
            #[derive(serde::Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Args { key: String, property: PropertyDef, }
            let a: Args = parse("upsert_property", args)?;
            json(crate::commands::schema::upsert_property(ctx, a.key, a.property))
        })(),
        "rename_property" => (|| {
            #[derive(serde::Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Args { key: String, old: String, new: String, }
            let a: Args = parse("rename_property", args)?;
            json(crate::commands::schema::rename_property(ctx, a.key, a.old, a.new))
        })(),
        "delete_property" => (|| {
            #[derive(serde::Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Args { key: String, name: String, }
            let a: Args = parse("delete_property", args)?;
            json(crate::commands::schema::delete_property(ctx, a.key, a.name))
        })(),
        "run_tracker" => (|| {
            #[derive(serde::Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Args { spec: String, anchor: Option<String>, }
            let a: Args = parse("run_tracker", args)?;
            json(crate::commands::tracker::run_tracker(ctx, a.spec, a.anchor))
        })(),
        "tracker_toggle" => (|| {
            #[derive(serde::Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Args { log_source: String, date_field: String, done_field: String, date: String, item: String, on: Option<bool>, }
            let a: Args = parse("tracker_toggle", args)?;
            json(crate::commands::tracker::tracker_toggle(ctx, a.log_source, a.date_field, a.done_field, a.date, a.item, a.on))
        })(),
        "list_trackers" => json(crate::commands::tracker::list_trackers(ctx)),
        "list_trash" => json(crate::commands::trash::list_trash(ctx)),
        "restore_trashed" => (|| {
            #[derive(serde::Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Args { id: String, }
            let a: Args = parse("restore_trashed", args)?;
            json(crate::commands::trash::restore_trashed(ctx, a.id))
        })(),
        "delete_trashed" => (|| {
            #[derive(serde::Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Args { id: String, }
            let a: Args = parse("delete_trashed", args)?;
            json(crate::commands::trash::delete_trashed(ctx, a.id))
        })(),
        "empty_trash" => json(crate::commands::trash::empty_trash(ctx)),
        "trash_collection" => (|| {
            #[derive(serde::Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Args { name: String, }
            let a: Args = parse("trash_collection", args)?;
            json(crate::commands::trash::trash_collection(ctx, a.name))
        })(),
        "open_vault" => (|| {
            #[derive(serde::Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Args { path: String, }
            let a: Args = parse("open_vault", args)?;
            json(crate::commands::vault::open_vault(ctx, a.path))
        })(),
        "create_vault_from_template" => (|| {
            #[derive(serde::Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Args { path: String, template: Option<String>, }
            let a: Args = parse("create_vault_from_template", args)?;
            json(crate::commands::vault::create_vault_from_template(a.path, a.template))
        })(),
        "close_vault" => json(crate::commands::vault::close_vault(ctx)),
        "get_vault_info" => json(crate::commands::vault::get_vault_info(ctx)),
        #[cfg(not(any(target_os = "android", target_os = "ios")))]
        "terminal_spawn" => (|| {
            #[derive(serde::Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Args { cwd: Option<String>, cols: u16, rows: u16, }
            let a: Args = parse("terminal_spawn", args)?;
            json(crate::terminal::terminal_spawn(ctx, a.cwd, a.cols, a.rows))
        })(),
        #[cfg(not(any(target_os = "android", target_os = "ios")))]
        "terminal_write" => (|| {
            #[derive(serde::Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Args { id: u32, data: String, }
            let a: Args = parse("terminal_write", args)?;
            json(crate::terminal::terminal_write(ctx, a.id, a.data))
        })(),
        #[cfg(not(any(target_os = "android", target_os = "ios")))]
        "terminal_resize" => (|| {
            #[derive(serde::Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Args { id: u32, cols: u16, rows: u16, }
            let a: Args = parse("terminal_resize", args)?;
            json(crate::terminal::terminal_resize(ctx, a.id, a.cols, a.rows))
        })(),
        #[cfg(not(any(target_os = "android", target_os = "ios")))]
        "terminal_kill" => (|| {
            #[derive(serde::Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Args { id: u32, }
            let a: Args = parse("terminal_kill", args)?;
            json(crate::terminal::terminal_kill(ctx, a.id))
        })(),
        "detect_desktop_theme" => json(Ok(crate::theme::detect_desktop_theme())),
        "watch_theme_file" => (|| {
            #[derive(serde::Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Args { path: String, }
            let a: Args = parse("watch_theme_file", args)?;
            json(crate::theme::watch_theme_file(ctx, a.path))
        })(),
        "export_text" => (|| {
            #[derive(serde::Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Args { kind: String, target: String, }
            let a: Args = parse("export_text", args)?;
            json(crate::commands::data::export_text(ctx, a.kind, a.target))
        })(),
        "upload_import_file" => (|| {
            #[derive(serde::Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Args { name: String, data_base64: String, }
            let a: Args = parse("upload_import_file", args)?;
            json(crate::commands::import::upload_import_file(ctx, a.name, a.data_base64))
        })(),
        "import_csv_plan_upload" => (|| {
            #[derive(serde::Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Args { upload: String, collection: String, title_column: Option<String>, columns: Option<Vec<ColumnMap>>, }
            let a: Args = parse("import_csv_plan_upload", args)?;
            json(crate::commands::import::import_csv_plan_upload(ctx, a.upload, a.collection, a.title_column, a.columns))
        })(),
        "import_csv_upload" => (|| {
            #[derive(serde::Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Args { upload: String, collection: String, title_column: Option<String>, columns: Option<Vec<ColumnMap>>, }
            let a: Args = parse("import_csv_upload", args)?;
            json(crate::commands::import::import_csv_upload(ctx, a.upload, a.collection, a.title_column, a.columns))
        })(),
        "import_notion_upload" => (|| {
            #[derive(serde::Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Args { upload: String, into: String, dry_run: bool, }
            let a: Args = parse("import_notion_upload", args)?;
            json(crate::commands::import::import_notion_upload(ctx, a.upload, a.into, a.dry_run))
        })(),
        _ => return None,
    })
}
