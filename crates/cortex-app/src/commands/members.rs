//! Tauri command layer for team members + current-user identity.


use crate::ctx::AppCtx;
use cortex_core::error::Result;
use cortex_core::members::{CurrentUser, Member};

pub fn get_members(ctx: &AppCtx) -> Result<Vec<Member>> {
    Ok(cortex_core::members::load(&ctx.vault_path()?))
}
pub fn set_members(ctx: &AppCtx, members: Vec<Member>) -> Result<()> {
    cortex_core::members::save(&ctx.vault_path()?, &members)
}

/// The current user's git identity — used to highlight "me" and key per-user
/// daily notes.
pub fn current_user(ctx: &AppCtx) -> Result<CurrentUser> {
    Ok(cortex_core::members::current_user(&ctx.vault_path()?))
}
