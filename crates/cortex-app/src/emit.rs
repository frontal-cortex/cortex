//! Events out of the application layer.
//!
//! The watcher, the palette follower and the terminal announce what happened
//! (`vault://changed`, `theme://changed`, `terminal://data`, `terminal://exit`)
//! without knowing who is listening. The desktop app attaches an emitter that
//! forwards to its webview; a running server attaches one that feeds its event
//! stream. Both can be attached at once.

/// Somewhere events can go. Implementations must not block for long: emits
/// happen on the watcher's and the terminal's worker threads.
pub trait Emitter: Send + Sync {
    fn emit(&self, event: &str, payload: &serde_json::Value);
}
