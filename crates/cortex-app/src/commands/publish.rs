//! Publishing commands — thin wrappers over `cortex_core::publish`. Every one
//! of these is invoked from an explicit user action in the Publish dialog;
//! nothing in the app calls them on save, sync, or a timer.


use crate::ctx::AppCtx;
use cortex_core::error::Result;
use cortex_core::publish::{self, PagesPush, PublishEntry, Report};


/// The notes that would be published, without writing anything.
pub fn publish_preview(ctx: &AppCtx) -> Result<Vec<PublishEntry>> {
    publish::preview(&ctx.vault_path()?)
}

/// Build the site into a folder the user picked.
pub fn publish_to_dir(ctx: &AppCtx, dir: String, force: bool) -> Result<Report> {
    let root = ctx.vault_path()?;
    super::off_thread(move || publish::build(&root, std::path::Path::new(&dir), force))
}

/// Build and force-push the site as an orphan branch on the vault's remote.
pub fn publish_gh_pages(ctx: &AppCtx, remote: String, branch: String) -> Result<PagesPush> {
    let root = ctx.vault_path()?;
    super::off_thread(move || publish::push_gh_pages(&root, &remote, &branch))
}

/// Write the manual-trigger GitHub Pages workflow into the vault.
pub fn publish_write_github_action(ctx: &AppCtx) -> Result<String> {
    Ok(publish::write_github_action(&ctx.vault_path()?)?.to_string_lossy().into_owned())
}
