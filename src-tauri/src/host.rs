//! The desktop app as a host of the application layer.
//!
//! Every command in `cortex_app::dispatch` reaches the webview through here:
//! the invoke handler looks the name up in the table and runs it the way the
//! desktop always has — a `sync` command inline on the thread the call arrived
//! on, a `blocking` one on the blocking pool. Anything the table doesn't know
//! (the updater, the Wayland clipboard, serving) falls through to the handlers
//! still defined in this crate.

use std::sync::Arc;

use cortex_app::ctx::AppCtx;
use cortex_app::dispatch::{self, Mode};
use cortex_app::emit::Emitter;
use serde_json::Value;
use tauri::ipc::{Invoke, InvokeBody, InvokeResolver};
use tauri::{AppHandle, Emitter as _, Manager, Runtime};

/// Forwards application events to the webview.
pub struct TauriEmitter(pub AppHandle);

impl Emitter for TauriEmitter {
    fn emit(&self, event: &str, payload: &Value) {
        let _ = self.0.emit(event, payload.clone());
    }
}

/// Run a table command. A name the table doesn't have comes back as `Err`,
/// untouched, for the desktop-only handlers.
pub fn route<R: Runtime>(invoke: Invoke<R>) -> Result<(), Invoke<R>> {
    let name = invoke.message.command().to_string();
    let Some(info) = dispatch::info(&name) else {
        return Err(invoke);
    };
    let ctx = invoke.message.webview().state::<Arc<AppCtx>>().inner().clone();
    let args = match invoke.message.payload() {
        InvokeBody::Json(v) => v.clone(),
        _ => Value::Null,
    };
    let resolver = invoke.resolver;
    match info.mode {
        Mode::Sync => respond(resolver, dispatch::dispatch(&ctx, &name, args)),
        Mode::Blocking => {
            tauri::async_runtime::spawn(async move {
                let result = tauri::async_runtime::spawn_blocking(move || dispatch::dispatch(&ctx, &name, args)).await;
                match result {
                    Ok(r) => respond(resolver, r),
                    Err(e) => resolver.reject(format!("background task failed: {e}")),
                }
            });
        }
    }
    Ok(())
}

fn respond<R: Runtime>(resolver: InvokeResolver<R>, result: Option<cortex_core::error::Result<Value>>) {
    match result {
        Some(Ok(value)) => resolver.resolve(value),
        Some(Err(err)) => resolver.reject(err),
        None => resolver.reject("unknown command"),
    }
}
