pub mod comments;
/// Run blocking work on Tauri's blocking pool and await it. A synchronous
/// command runs on the main thread and freezes the window for as long as it
/// takes; anything that indexes, hashes, talks to git or the network goes
/// through here.
pub(crate) async fn off_thread<T: Send + 'static>(
    f: impl FnOnce() -> cortex_core::error::Result<T> + Send + 'static,
) -> cortex_core::error::Result<T> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| cortex_core::error::AppError::Other(format!("background task failed: {e}")))?
}

pub mod config;
pub mod data;
pub mod git;
pub mod import;
pub mod members;
pub mod notes;
pub mod recent;
pub mod schema;
pub mod trash;
pub mod vault;
pub mod publish;
pub mod packs;
pub mod tracker;
pub mod preview;
pub mod clipboard;
pub mod updates;
