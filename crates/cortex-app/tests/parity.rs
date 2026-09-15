//! Every command the frontend calls has a host, and the two hosts agree.
//!
//! The desktop app routes invoke calls through `cortex_app::dispatch` and falls
//! back to a short list of commands it defines itself; the server routes HTTP
//! through the same table. These tests keep the frontend, the table and that
//! list in step, so a command can't quietly exist on one side only.

use std::collections::BTreeSet;
use std::sync::Arc;

use cortex_app::ctx::{AppCtx, AppDirs};
use cortex_app::dispatch::{self, COMMANDS};

const COMMANDS_TS: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../src/lib/commands.ts");
const TAURI_LIB: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../src-tauri/src/lib.rs");

/// Command names in every `invoke<…>("name"` / `invoke("name"` call.
fn invoked_names(src: &str) -> BTreeSet<String> {
    let bytes = src.as_bytes();
    let mut out = BTreeSet::new();
    let mut i = 0;
    while let Some(off) = src[i..].find("invoke") {
        let mut j = i + off + "invoke".len();
        i = j;
        if bytes.get(j) == Some(&b'<') {
            let mut depth = 0;
            while j < bytes.len() {
                match bytes[j] {
                    b'<' => depth += 1,
                    b'>' => {
                        depth -= 1;
                        if depth == 0 {
                            j += 1;
                            break;
                        }
                    }
                    _ => {}
                }
                j += 1;
            }
        }
        if bytes.get(j) != Some(&b'(') {
            continue;
        }
        j += 1;
        while bytes.get(j).is_some_and(|b| b.is_ascii_whitespace()) {
            j += 1;
        }
        if bytes.get(j) != Some(&b'"') {
            continue;
        }
        let start = j + 1;
        if let Some(end) = src[start..].find('"') {
            out.insert(src[start..start + end].to_string());
        }
    }
    out
}

/// The commands the desktop app registers itself, read from its handler list.
fn desktop_app_only() -> BTreeSet<String> {
    let lib = std::fs::read_to_string(TAURI_LIB).expect("read src-tauri/src/lib.rs");
    let start = lib.find("generate_handler![").expect("a generate_handler! list");
    let end = start + lib[start..].find(']').expect("the list ends");
    lib[start..end]
        .split(',')
        .filter_map(|item| item.trim().rsplit("::").next())
        .map(|name| name.trim().trim_start_matches("generate_handler![").trim().to_string())
        .filter(|name| !name.is_empty() && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_'))
        .collect()
}

#[test]
fn every_command_the_frontend_calls_has_a_host() {
    let src = std::fs::read_to_string(COMMANDS_TS).expect("read src/lib/commands.ts");
    let called = invoked_names(&src);
    assert!(called.len() > 100, "the parser found only {} commands", called.len());
    let table: BTreeSet<String> = COMMANDS.iter().map(|c| c.name.to_string()).collect();
    let desktop = desktop_app_only();
    let missing: Vec<&String> = called.iter().filter(|n| !table.contains(*n) && !desktop.contains(*n)).collect();
    assert!(missing.is_empty(), "the frontend calls commands no host defines: {missing:?}");
}

#[test]
fn the_table_and_the_desktop_list_do_not_overlap() {
    let desktop = desktop_app_only();
    assert!(desktop.contains("update_config") && desktop.contains("serve_set"), "read the desktop list: {desktop:?}");
    let both: Vec<&str> = COMMANDS.iter().map(|c| c.name).filter(|n| desktop.contains(*n)).collect();
    assert!(both.is_empty(), "defined twice: {both:?}");
}

#[test]
fn command_names_are_unique() {
    let mut seen = BTreeSet::new();
    for c in COMMANDS {
        assert!(seen.insert(c.name), "{} is in the table twice", c.name);
    }
}

#[test]
fn every_table_entry_dispatches() {
    // No vault, no directories: each command either refuses its (missing)
    // arguments, reports there's no vault, or answers something read-only.
    // What it must never do is fall through as an unknown name.
    let ctx = AppCtx::new(AppDirs::default());
    for c in COMMANDS {
        assert!(
            dispatch::dispatch(&ctx, c.name, serde_json::Value::Null).is_some(),
            "{} is listed but has no dispatch arm",
            c.name
        );
    }
    assert!(dispatch::dispatch(&Arc::clone(&ctx), "no_such_command", serde_json::Value::Null).is_none());
}
