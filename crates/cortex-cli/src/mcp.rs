//! `cortex mcp` — the vault as an MCP server over stdio.
//!
//! The same operations as the CLI (see `ops.rs`), exposed as tools so an
//! agent gets typed, discoverable access to a vault without shelling out.
//! Results are JSON text. Writes land on disk immediately and the app
//! follows them; anything meant for the user's review goes through
//! `propose`, which packages changes as an `agent/*` branch.

use crate::ops::{NewNote, Vault};
use rmcp::handler::server::wrapper::Parameters;
use rmcp::model::*;
use rmcp::{schemars, tool, tool_handler, tool_router, ErrorData as McpError, ServerHandler, ServiceExt};
use std::collections::BTreeMap;
use std::sync::Arc;

const INSTRUCTIONS: &str = "\
This is a Cortex vault: a folder of Markdown notes with YAML frontmatter that is also a git \
repository. Notes live under notes/ (organised freely into folders); collections/<name>/ holds \
database rows (one note per row, properties in frontmatter); templates/ holds note templates. \
Notes link to each other with [[Title]] wiki links. Frontmatter keys are kept sorted so diffs \
stay clean — use the tools rather than rewriting files by hand.

Reading: list_notes, search, read_note, links, backlinks, list_collections, query_collection, \
get_schema. Writing: create_note, write_note, set_properties. Writes are visible in the app \
immediately. Configuration: get_settings / set_settings edit .cortex/settings.yaml (the app reloads \
it live); list_agents says which agent CLIs are installed for the terminal_command setting. \
Templates: list_packs / install_pack / update_pack / remove_pack manage template packs (plain Markdown + YAML) \
from the marketplace; installing is fine when the user asks for a template or a database of some kind. \
Trackers: a collection with a tracker view (habits, plants, medication) logs items per day in a log \
collection; `tracker` reads the grid with streaks and scores, `track` ticks one item for a day — the \
way to log \"I ran today\". run_view runs any cortex-view spec (a table over a collection or CSV). \
Publishing: list_published shows which notes the user has marked public (publish: true or the `public` \
tag); set that flag only when asked, and never build or push a site — that is the user's own act. When a change is meant for the user's review rather than applied directly, call \
propose with the changed paths: it moves them onto an agent/<name> branch the user reviews \
(diff, then Apply or Discard) in the app.";

#[derive(Clone)]
pub struct CortexMcp {
    vault: Arc<Vault>,
}

fn err(e: impl std::fmt::Display) -> McpError {
    McpError::internal_error(e.to_string(), None)
}

fn json<T: serde::Serialize>(value: &T) -> Result<CallToolResult, McpError> {
    let text = serde_json::to_string_pretty(value).map_err(err)?;
    Ok(CallToolResult::success(vec![ContentBlock::text(text)]))
}

// ── Parameters ───────────────────────────────────────────────────────────────

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct ListArgs {
    /// Only notes under this folder, e.g. "notes/work"
    pub dir: Option<String>,
    /// Only notes whose frontmatter `type` matches
    #[serde(rename = "type")]
    pub note_type: Option<String>,
    /// Only notes carrying this tag
    pub tag: Option<String>,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct SearchArgs {
    /// Words to match in titles and bodies (prefix match per word)
    pub query: String,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct TargetArgs {
    /// A note: its vault-relative path, exact title, or filename stem
    pub target: String,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct CreateArgs {
    pub title: String,
    /// Folder to create in (default "notes")
    pub dir: Option<String>,
    /// Frontmatter `type` (default from vault settings)
    #[serde(rename = "type")]
    pub note_type: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    /// Seed from templates/<name>.md
    pub template: Option<String>,
    /// Markdown body
    pub body: Option<String>,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct WriteArgs {
    /// A note: path, title, or filename stem
    pub target: String,
    /// New Markdown body (frontmatter is kept)
    pub body: String,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct SetArgs {
    /// A note: path, title, or filename stem
    pub target: String,
    /// Frontmatter keys to merge; a null value removes the key
    pub properties: BTreeMap<String, serde_json::Value>,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct QueryArgs {
    /// Collection name (the folder under collections/)
    pub collection: String,
    /// e.g. "status == active and priority > 2"
    pub filter: Option<String>,
    /// Fields to sort by; append " desc" for descending
    #[serde(default)]
    pub sort: Vec<String>,
    /// Columns to include (default: all)
    pub columns: Option<Vec<String>>,
    pub limit: Option<usize>,
    /// Summary row, field → function: count, sum, avg, min, max, percent_checked, empty, not_empty
    #[serde(default)]
    pub summary: std::collections::BTreeMap<String, String>,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct SchemaArgs {
    /// Collection name or note type
    pub key: String,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct ProposeArgs {
    /// Short human name, e.g. "Summarise week 36" → branch agent/summarise-week-36
    pub name: String,
    /// Commit message (default: the name)
    pub message: Option<String>,
    /// Vault-relative paths to include (files you changed or created)
    #[serde(default)]
    pub paths: Vec<String>,
    /// Include every change in the working tree instead of listing paths
    #[serde(default)]
    pub all: bool,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct ProposalArgs {
    /// Proposal name — "agent/x" or just "x"
    pub name: String,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct PackArgs {
    /// Pack id, e.g. `tasks` (see list_packs).
    pub id: String,
    /// Overwrite templates that exist and are not from this pack (default false).
    #[serde(default)]
    pub force: bool,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct PackIdArgs {
    pub id: String,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct RunViewArgs {
    /// A cortex-view YAML spec: `source: collections/<name>` plus optional filter, sort, columns, limit, summary ({field: sum, …})
    pub spec: String,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct TrackerArgs {
    /// Collection with a tracker view, e.g. "habits"
    pub collection: String,
    /// today | week | month | year (default: the view's own)
    pub range: Option<String>,
    /// Anchor date (YYYY-MM-DD; default today)
    pub at: Option<String>,
    /// Which tracker view (default: the first)
    pub view: Option<String>,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct TrackArgs {
    /// Collection with a tracker view, e.g. "habits"
    pub collection: String,
    /// Item title (a unique prefix will do)
    pub item: String,
    /// Day to log for (YYYY-MM-DD; default today)
    pub date: Option<String>,
    /// true to tick, false to untick (default: flip)
    pub done: Option<bool>,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct SettingsArgs {
    /// Settings to change, key → value. Values are typed per key (booleans, numbers,
    /// strings; `keybindings` takes an object of id → keys, or use `keybindings.<id>`
    /// with a string, empty/null to remove). Unknown keys are rejected with the valid list.
    pub properties: BTreeMap<String, serde_json::Value>,
}

// ── Tools ────────────────────────────────────────────────────────────────────

#[tool_router]
impl CortexMcp {
    pub fn new(vault: Vault) -> Self {
        Self { vault: Arc::new(vault) }
    }

    #[tool(description = "List notes, newest first. Optionally filter by folder, type, or tag.")]
    fn list_notes(&self, Parameters(a): Parameters<ListArgs>) -> Result<CallToolResult, McpError> {
        json(&self.vault.list(a.dir.as_deref(), a.note_type.as_deref(), a.tag.as_deref()))
    }

    #[tool(description = "Full-text search over note titles and bodies.")]
    fn search(&self, Parameters(a): Parameters<SearchArgs>) -> Result<CallToolResult, McpError> {
        json(&self.vault.search(&a.query).map_err(err)?)
    }

    #[tool(description = "Read a note: its path, frontmatter (properties), and Markdown body.")]
    fn read_note(&self, Parameters(a): Parameters<TargetArgs>) -> Result<CallToolResult, McpError> {
        json(&self.vault.read(&a.target).map_err(err)?)
    }

    #[tool(description = "Create a note. Returns the note, including the path chosen for it.")]
    fn create_note(&self, Parameters(a): Parameters<CreateArgs>) -> Result<CallToolResult, McpError> {
        let note = self.vault.create(NewNote {
            title: a.title, dir: a.dir, note_type: a.note_type, tags: a.tags, template: a.template, body: a.body,
        }).map_err(err)?;
        json(&note)
    }

    #[tool(description = "Replace a note's Markdown body, keeping its frontmatter.")]
    fn write_note(&self, Parameters(a): Parameters<WriteArgs>) -> Result<CallToolResult, McpError> {
        json(&self.vault.write_body(&a.target, &a.body).map_err(err)?)
    }

    #[tool(description = "Merge properties into a note's frontmatter (typed JSON values; null removes a key).")]
    fn set_properties(&self, Parameters(a): Parameters<SetArgs>) -> Result<CallToolResult, McpError> {
        json(&self.vault.set_properties(&a.target, a.properties).map_err(err)?)
    }

    #[tool(description = "Outgoing [[wiki links]] of a note, each resolved to a path where one exists.")]
    fn links(&self, Parameters(a): Parameters<TargetArgs>) -> Result<CallToolResult, McpError> {
        json(&self.vault.links(&a.target).map_err(err)?)
    }

    #[tool(description = "Notes that link to this one.")]
    fn backlinks(&self, Parameters(a): Parameters<TargetArgs>) -> Result<CallToolResult, McpError> {
        json(&self.vault.backlinks(&a.target).map_err(err)?)
    }

    #[tool(description = "List collections (databases). Each is a folder of row notes under collections/.")]
    fn list_collections(&self) -> Result<CallToolResult, McpError> {
        json(&self.vault.collections())
    }

    #[tool(description = "Query a collection like the app's table view: filter, sort, columns, limit, and an optional summary (field → count | sum | avg | min | max | percent_checked | empty | not_empty). Returns columns, rows and the summary values.")]
    fn query_collection(&self, Parameters(a): Parameters<QueryArgs>) -> Result<CallToolResult, McpError> {
        let summary: Vec<(String, String)> = a.summary.into_iter().collect();
        json(&self.vault.view(&a.collection, a.filter.as_deref(), &a.sort, a.columns.as_deref(), a.limit, &summary).map_err(err)?)
    }

    #[tool(description = "Run a cortex-view YAML spec (source: collections/<name> or data/<file>.csv, plus filter / sort / columns / limit / summary) and return its columns and rows — the same query the app's views run, summary values included.")]
    fn run_view(&self, Parameters(a): Parameters<RunViewArgs>) -> Result<CallToolResult, McpError> {
        json(&cortex_core::data::resolve_view(&self.vault.root, &a.spec).map_err(err)?)
    }

    #[tool(description = "A collection's tracker view (habits and the like): items × days for the range, each item's current and longest streak, this week's count against its target, and per-day done/expected with perfect days. Computed on read; nothing is stored.")]
    fn tracker(&self, Parameters(a): Parameters<TrackerArgs>) -> Result<CallToolResult, McpError> {
        json(&self.vault.tracker(&a.collection, a.view.as_deref(), a.range.as_deref(), a.at.as_deref()).map_err(err)?)
    }

    #[tool(description = "Tick or untick one tracker item for a day — log \"I ran today\" as track {collection: habits, item: Exercise}. Writes one line in that day's log row (created from its template if the day has no file) and returns the item's streak afterwards.")]
    fn track(&self, Parameters(a): Parameters<TrackArgs>) -> Result<CallToolResult, McpError> {
        json(&self.vault.track(&a.collection, &a.item, a.date.as_deref(), a.done).map_err(err)?)
    }

    #[tool(description = "The property schema for a collection or note type: typed properties and their options.")]
    fn get_schema(&self, Parameters(a): Parameters<SchemaArgs>) -> Result<CallToolResult, McpError> {
        json(&self.vault.schema(&a.key).map_err(err)?)
    }

    #[tool(description = "The vault's settings (.cortex/settings.yaml) with every key present, plus a description of each key.")]
    fn get_settings(&self) -> Result<CallToolResult, McpError> {
        let settings = self.vault.settings().map_err(err)?;
        let describe: BTreeMap<&str, &str> = cortex_core::settings::describe().into_iter().collect();
        json(&serde_json::json!({ "settings": settings, "describe": describe }))
    }

    #[tool(description = "Change settings: merge the given keys into .cortex/settings.yaml (typed per key; see get_settings for the keys). Returns the full settings. The app applies them live.")]
    fn set_settings(&self, Parameters(a): Parameters<SettingsArgs>) -> Result<CallToolResult, McpError> {
        json(&self.vault.merge_settings(a.properties).map_err(err)?)
    }

    #[tool(description = "Known agent CLIs (claude, hermes, openclaw, codex, …) and whether each is installed on this machine, with its path. Use a found one's `command` as the terminal_command setting.")]
    fn list_agents(&self) -> Result<CallToolResult, McpError> {
        json(&self.vault.agents())
    }

    #[tool(description = "Template packs available to this vault (bundled official packs plus the configured marketplace indexes): id, name, kind, tier, version, installed version, whether an update is available. Packs are Markdown + YAML — templates, schemas, database views, seed rows.")]
    fn list_packs(&self) -> Result<CallToolResult, McpError> {
        json(&self.vault.packs_catalog(false).map_err(err)?.entries)
    }

    #[tool(description = "Install a template pack into the vault by id. Writes ordinary files (templates/, .cortex/schemas/, collections/<name>/) and records them in .cortex/packs.yaml; never overwrites the user's files unless force, merges into an existing collection's schema. Returns what was written, merged and skipped.")]
    fn install_pack(&self, Parameters(a): Parameters<PackArgs>) -> Result<CallToolResult, McpError> {
        let pack = self.vault.packs_resolve(&a.id).map_err(err)?;
        json(&self.vault.packs_install(&pack, a.force).map_err(err)?)
    }

    #[tool(description = "Update an installed pack to the newest version the indexes offer. Files the user edited are kept and reported.")]
    fn update_pack(&self, Parameters(a): Parameters<PackIdArgs>) -> Result<CallToolResult, McpError> {
        json(&self.vault.packs_update(Some(&a.id)).map_err(err)?)
    }

    #[tool(description = "Remove an installed pack: deletes only the files it installed that are unchanged; rows the user added to its collection are never touched.")]
    fn remove_pack(&self, Parameters(a): Parameters<PackIdArgs>) -> Result<CallToolResult, McpError> {
        json(&cortex_core::marketplace::remove(&self.vault.root, &a.id).map_err(err)?)
    }

    #[tool(description = "Notes marked for publishing (publish: true or the `public` tag) and the URL each would get. Read-only: publishing itself is done by the user with `cortex publish` or the app.")]
    fn list_published(&self) -> Result<CallToolResult, McpError> {
        json(&self.vault.publish_preview().map_err(err)?)
    }

    #[tool(description = "Git state: changed files, sync counts, recent commits, pending proposals.")]
    fn status(&self) -> Result<CallToolResult, McpError> {
        json(&self.vault.status().map_err(err)?)
    }

    #[tool(description = "Package your changes as a proposal for the user to review: commits the given paths onto a new agent/<name> branch and restores them in the working tree. Returns the branch name.")]
    fn propose(&self, Parameters(a): Parameters<ProposeArgs>) -> Result<CallToolResult, McpError> {
        let branch = self.vault.propose(&a.name, a.message.as_deref(), &a.paths, a.all).map_err(err)?;
        json(&serde_json::json!({ "branch": branch }))
    }

    #[tool(description = "List pending proposals (agent/* branches, local or on origin).")]
    fn list_proposals(&self) -> Result<CallToolResult, McpError> {
        json(&self.vault.proposals().map_err(err)?)
    }

    #[tool(description = "The diff a proposal would apply.")]
    fn proposal_diff(&self, Parameters(a): Parameters<ProposalArgs>) -> Result<CallToolResult, McpError> {
        json(&self.vault.diff(&a.name).map_err(err)?)
    }
}

#[tool_handler]
impl ServerHandler for CortexMcp {
    fn get_info(&self) -> ServerInfo {
        ServerInfo::new(ServerCapabilities::builder().enable_tools().build())
            .with_server_info(Implementation::new("cortex", env!("CARGO_PKG_VERSION")))
            .with_instructions(INSTRUCTIONS.to_string())
    }
}

/// Serve over stdio until the client disconnects.
pub async fn serve(vault: Vault) -> crate::ops::Result<()> {
    let service = CortexMcp::new(vault).serve(rmcp::transport::stdio()).await?;
    service.waiting().await?;
    Ok(())
}
