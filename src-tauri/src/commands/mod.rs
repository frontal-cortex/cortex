//! The commands only the desktop app can run. Everything else lives in
//! `cortex_app` and reaches the webview through `crate::host`.

pub mod clipboard;
pub mod serve;
pub mod updates;
