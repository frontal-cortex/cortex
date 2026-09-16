//! The commands, one module per area. Each is a plain synchronous function
//! over `&AppCtx` returning `Result`; which thread runs it is the host's
//! decision (see `crate::dispatch`).

pub mod comments;
pub mod config;
pub mod data;
pub mod git;
pub mod import;
pub mod members;
pub mod notes;
pub mod packs;
pub mod preview;
pub mod publish;
pub mod recent;
pub mod schema;
pub mod tracker;
pub mod trash;
pub mod vault;

use cortex_core::error::Result;

/// Marks work the desktop app has always pushed off its main thread — an index
/// pass, git, the network. The commands here are synchronous, so this simply
/// runs the closure; the dispatch table records the same fact as the command's
/// mode, and each host picks the thread from that. Kept so the bodies read as
/// they did.
pub(crate) fn off_thread<T>(f: impl FnOnce() -> Result<T>) -> Result<T> {
    f()
}
