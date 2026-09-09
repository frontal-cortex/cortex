//! cortex-core — everything that understands a vault, with no UI attached.
//!
//! A vault is a directory of Markdown notes with YAML frontmatter that is also
//! a git repository. This crate owns that model: parsing and serialising notes
//! (`note`), the rebuildable SQLite index (`db`, `index`), collections and
//! views over frontmatter (`data`, `schema`), the team roster (`members`),
//! settings (`settings`), git operations (`git`), importers (`import`), vault discovery (`vault`),
//! and which agent CLIs are installed (`agents`). The Tauri app and the `cortex` CLI are both thin layers over it,
//! so an agent driving the CLI sees exactly the semantics the user sees.

pub mod agents;
pub mod data;
pub mod db;
pub mod error;
pub mod formula;
pub mod git;
pub mod import;
pub mod index;
pub mod marketplace;
pub mod members;
pub mod note;
pub mod placeholders;
pub mod publish;
pub mod recurrence;
pub mod schema;
pub mod settings;
pub mod template;
pub mod tracker;
pub mod vault;
