//! Cortex's application layer.
//!
//! Everything the app does to a vault — the commands, the watcher that follows
//! the folder, the palette follower, the terminal — lives here as plain Rust
//! over one [`ctx::AppCtx`]. Two hosts drive it: the desktop app routes its
//! webview's invoke calls through [`dispatch`], and `cortex serve` routes HTTP
//! requests through the same function. So a command exists on both or on
//! neither, by construction, and desktop behaviour is the code that was
//! already there.

extern crate self as cortex_app;

pub mod agents;
pub mod commands;
pub mod ctx;
pub mod dispatch;
pub mod emit;
pub mod lock;
pub mod serve_config;
#[cfg(feature = "server")]
pub mod server;
pub mod tailscale;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub mod terminal;
pub mod theme;
pub mod types;
pub mod watcher;
