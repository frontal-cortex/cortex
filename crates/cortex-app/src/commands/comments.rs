//! Comment threads — thin wrappers over `cortex_core::comments`. Every write
//! lands in the note's `.comments.yaml` sidecar and returns the full thread
//! list, so the panel never has to merge.


use crate::ctx::AppCtx;
use cortex_core::comments::{self, Anchor, Thread};
use cortex_core::error::Result;

pub fn list_comments(ctx: &AppCtx, path: String) -> Result<Vec<Thread>> {
    comments::load(&ctx.vault_path()?, &path)
}

/// Open a thread; `anchor` is the selected passage (none = the whole note).
pub fn add_comment(ctx: &AppCtx, path: String, text: String, anchor: Option<Anchor>) -> Result<Vec<Thread>> {
    let root = ctx.vault_path()?;
    comments::add(&root, &path, anchor, &text, None)?;
    comments::load(&root, &path)
}
pub fn reply_comment(ctx: &AppCtx, path: String, id: String, text: String) -> Result<Vec<Thread>> {
    let root = ctx.vault_path()?;
    comments::reply(&root, &path, &id, &text, None)?;
    comments::load(&root, &path)
}
pub fn resolve_comment(ctx: &AppCtx, path: String, id: String, resolved: bool) -> Result<Vec<Thread>> {
    let root = ctx.vault_path()?;
    comments::resolve(&root, &path, &id, resolved)?;
    comments::load(&root, &path)
}
pub fn delete_comment(ctx: &AppCtx, path: String, id: String) -> Result<Vec<Thread>> {
    let root = ctx.vault_path()?;
    comments::delete(&root, &path, &id)?;
    comments::load(&root, &path)
}
