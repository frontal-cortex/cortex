//! The served app: Cortex over HTTP for your own devices.
//!
//! The same frontend the desktop app bundles, on `127.0.0.1` only, with every
//! command from [`crate::dispatch`] behind `POST /api/invoke/<name>` and the
//! application's events on one Server-Sent Events stream. `tailscale serve`
//! puts it on the tailnet with a real HTTPS certificate and tells it who is
//! asking; nothing here ever listens on another address.
//!
//! What a served device may not do: pick or open vaults, touch paths outside
//! the vault, drive the desktop webview, or use the terminal unless this
//! machine switched it on. Those rules are enforced here, per request, not by
//! the frontend hiding buttons.

use std::net::SocketAddr;
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, RwLock};
use std::time::Duration;

use axum::body::{Body, Bytes};
use axum::extract::{DefaultBodyLimit, Path as UrlPath, State};
use axum::http::{header, HeaderMap, HeaderValue, StatusCode, Uri};
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde_json::{json, Value};
use tokio::sync::{broadcast, oneshot, Mutex as AsyncMutex};
use tokio_stream::wrappers::errors::BroadcastStreamRecvError;
use tokio_stream::wrappers::BroadcastStream;
use tokio_stream::StreamExt;

use cortex_core::error::{AppError, Result};

use crate::ctx::AppCtx;
use crate::dispatch::{self, Exposure, Mode};
use crate::emit::Emitter;
use crate::serve_config::{AuthMode, ServeConfig};

/// The cookie a paired browser presents.
pub const COOKIE: &str = "cortex_token";

/// Largest request body: room for an uploaded Notion export, sent as base64.
const BODY_LIMIT: usize = 96 * 1024 * 1024;

/// Mirrors the desktop app's CSP (`tauri.conf.json`), without the IPC origins.
const CSP: &str = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self'; media-src 'self' data: blob:; worker-src 'self' blob:; manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'; frame-src https:";

// ── The app bundle ────────────────────────────────────────────────────────────

/// Where the frontend's built files come from.
pub trait Assets: Send + Sync {
    /// The file at `path` (no leading slash), if the bundle has one.
    fn get(&self, path: &str) -> Option<Vec<u8>>;
}

/// A built `dist/` directory on disk.
pub struct DirAssets {
    root: PathBuf,
}

impl DirAssets {
    pub fn new(root: impl Into<PathBuf>) -> Self {
        DirAssets { root: root.into() }
    }
}

impl Assets for DirAssets {
    fn get(&self, path: &str) -> Option<Vec<u8>> {
        let rel = Path::new(path);
        if rel.components().any(|c| !matches!(c, Component::Normal(_))) {
            return None;
        }
        std::fs::read(self.root.join(rel)).ok()
    }
}

// ── Running it ────────────────────────────────────────────────────────────────

struct Inner {
    ctx: Arc<AppCtx>,
    config: RwLock<ServeConfig>,
    /// This machine's own Tailscale login: the default allow-list.
    host_login: Option<String>,
    events: broadcast::Sender<(String, Value)>,
    /// `sync` commands run one at a time, as on the desktop's main thread.
    serial: AsyncMutex<()>,
    assets: Arc<dyn Assets>,
}

type Shared = Arc<Inner>;

/// A running server. Dropping it stops serving.
pub struct Server {
    addr: SocketAddr,
    shutdown: Option<oneshot::Sender<()>>,
    inner: Shared,
    emitter: u64,
}

struct BroadcastEmitter(broadcast::Sender<(String, Value)>);

impl Emitter for BroadcastEmitter {
    fn emit(&self, event: &str, payload: &Value) {
        let _ = self.0.send((event.to_string(), payload.clone()));
    }
}

impl Server {
    /// Listen on `127.0.0.1:<config.port>` (0 picks a free port) and serve
    /// `ctx` until dropped. Must be called inside a Tokio runtime.
    pub async fn start(
        ctx: Arc<AppCtx>,
        config: ServeConfig,
        host_login: Option<String>,
        assets: Arc<dyn Assets>,
    ) -> Result<Server> {
        let listener = tokio::net::TcpListener::bind(("127.0.0.1", config.port))
            .await
            .map_err(|e| AppError::Other(format!("could not listen on 127.0.0.1:{}: {e}", config.port)))?;
        let addr = listener.local_addr()?;
        let (events, _) = broadcast::channel(512);
        let emitter = ctx.add_emitter(Arc::new(BroadcastEmitter(events.clone())));
        let inner = Arc::new(Inner {
            ctx,
            config: RwLock::new(config),
            host_login,
            events,
            serial: AsyncMutex::new(()),
            assets,
        });
        let (tx, rx) = oneshot::channel::<()>();
        let app = router(inner.clone());
        tokio::spawn(async move {
            let _ = axum::serve(listener, app)
                .with_graceful_shutdown(async {
                    let _ = rx.await;
                })
                .await;
        });
        Ok(Server { addr, shutdown: Some(tx), inner, emitter })
    }

    pub fn addr(&self) -> SocketAddr {
        self.addr
    }

    /// Change who may connect and what they may do, without restarting. A new
    /// port needs a restart.
    pub fn set_config(&self, config: ServeConfig) {
        *self.inner.config.write().unwrap() = config;
    }
}

impl Drop for Server {
    fn drop(&mut self) {
        self.inner.ctx.remove_emitter(self.emitter);
        if let Some(tx) = self.shutdown.take() {
            let _ = tx.send(());
        }
    }
}

fn router(inner: Shared) -> Router {
    Router::new()
        .route("/api/invoke/{cmd}", post(invoke))
        .route("/api/events", get(events))
        .route("/api/commands", get(commands))
        .route("/api/capabilities", get(capabilities))
        .route("/api/pair", post(pair))
        .fallback(static_file)
        .layer(DefaultBodyLimit::max(BODY_LIMIT))
        .with_state(inner)
}

// ── Who is asking ─────────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Identity {
    /// The Tailscale login, when the request came through `tailscale serve`.
    pub login: Option<String>,
}

/// Decide whether a request may use the app. `Err` carries the status to
/// refuse with: 401 to sign in (pair), 403 for a login that isn't allowed.
pub fn authorize(
    cfg: &ServeConfig,
    host_login: Option<&str>,
    headers: &HeaderMap,
) -> std::result::Result<Identity, StatusCode> {
    let login = header_str(headers, "tailscale-user-login").map(str::to_string);
    let token_ok = presented_token(headers).is_some_and(|t| constant_eq(t.as_bytes(), cfg.token.as_bytes()));
    match cfg.auth {
        AuthMode::Tailscale => {
            // No identity header means the request didn't come through
            // `tailscale serve` from a tailnet user — including Funnel traffic.
            let Some(login) = login else { return Err(StatusCode::UNAUTHORIZED) };
            let allowed = if cfg.allow.is_empty() {
                host_login.is_some_and(|h| h.eq_ignore_ascii_case(&login))
            } else {
                cfg.allow.iter().any(|a| a.trim().eq_ignore_ascii_case(&login))
            };
            if !allowed {
                return Err(StatusCode::FORBIDDEN);
            }
            if !cfg.token.is_empty() && !token_ok {
                return Err(StatusCode::UNAUTHORIZED);
            }
            Ok(Identity { login: Some(login) })
        }
        AuthMode::Token => {
            if cfg.token.is_empty() || !token_ok {
                return Err(StatusCode::UNAUTHORIZED);
            }
            // Nothing vouches for the identity header here — anyone holding the
            // code could set it — so this device is nobody in particular, and
            // its commits are this machine's.
            let _ = login;
            Ok(Identity { login: None })
        }
    }
}

/// Whether a request came from the app itself rather than another site.
///
/// In Tailscale mode nothing the browser holds proves who is asking — the
/// identity header is attached by `tailscale serve` to every request the
/// browser makes to this address, including the ones another site sets off in
/// the background. Without this check any page a signed-in device visited
/// could write to the vault.
pub fn same_origin(headers: &HeaderMap) -> bool {
    // Browsers that send fetch metadata say it plainly: the app's own requests
    // ("same-origin") and ones the person started themselves ("none").
    if let Some(site) = header_str(headers, "sec-fetch-site") {
        return site == "same-origin" || site == "none";
    }
    // Otherwise an `Origin`, when there is one, must be this server.
    match (header_str(headers, "origin"), header_str(headers, "host")) {
        (Some(origin), Some(host)) => origin
            .split_once("://")
            .is_some_and(|(_, rest)| rest.eq_ignore_ascii_case(host)),
        (Some(_), None) => false,
        // A program rather than a browser (curl, the tests): no site to be from.
        (None, _) => true,
    }
}

/// Whether the body says it is JSON. A cross-site form, `no-cors` fetch or
/// image cannot set this, so a browser must ask permission first — and this
/// server grants none.
pub fn is_json(headers: &HeaderMap) -> bool {
    header_str(headers, "content-type")
        .is_some_and(|v| v.split(';').next().unwrap_or("").trim().eq_ignore_ascii_case("application/json"))
}

fn header_str<'a>(headers: &'a HeaderMap, name: &str) -> Option<&'a str> {
    headers.get(name).and_then(|v| v.to_str().ok()).map(str::trim).filter(|s| !s.is_empty())
}

/// The pairing token from the cookie a paired browser holds, or a header.
fn presented_token(headers: &HeaderMap) -> Option<String> {
    if let Some(t) = header_str(headers, "x-cortex-token") {
        return Some(t.to_string());
    }
    headers
        .get_all(header::COOKIE)
        .iter()
        .filter_map(|v| v.to_str().ok())
        .flat_map(|v| v.split(';'))
        .filter_map(|pair| pair.trim().split_once('='))
        .find(|(k, _)| *k == COOKIE)
        .map(|(_, v)| v.to_string())
}

fn constant_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() || a.is_empty() {
        return false;
    }
    a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

/// Argument keys that name a place in the vault. A served device may only
/// name places inside it: no absolute paths, no `..`.
const PATH_KEYS: &[&str] = &[
    "path", "paths", "relPath", "source", "target", "from", "fromPath", "into", "dest", "dir",
    "toDir", "newPath", "oldPath", "file", "logSource", "outDir", "upload", "template", "root",
];

/// Whether an argument names a place. The listed keys, plus anything a command
/// spells its own way — a name carrying "path", "dir", "file", "source",
/// "target" or "dest" is a place, whatever comes before it. Checking by shape
/// rather than by a list means a new command cannot quietly slip past.
fn names_a_place(key: &str) -> bool {
    if PATH_KEYS.iter().any(|p| p.eq_ignore_ascii_case(key)) {
        return true;
    }
    let k = key.to_ascii_lowercase();
    ["path", "dir", "file", "source", "target", "dest"].iter().any(|word| k.contains(word))
}

/// Refuse any argument that names a place outside the vault, however deeply
/// it is nested in the command's arguments.
pub fn check_paths(args: &Value) -> std::result::Result<(), String> {
    match args {
        Value::Object(obj) => {
            for (key, value) in obj {
                if names_a_place(key) {
                    inside_vault(key, value)?;
                } else {
                    check_paths(value)?;
                }
            }
            Ok(())
        }
        Value::Array(items) => items.iter().try_for_each(check_paths),
        _ => Ok(()),
    }
}

fn inside_vault(key: &str, value: &Value) -> std::result::Result<(), String> {
    match value {
        Value::String(s) if escapes_vault(s) => {
            Err(format!("`{key}` must be a path inside the vault, not {s:?}"))
        }
        Value::Array(items) => items.iter().try_for_each(|i| inside_vault(key, i)),
        _ => Ok(()),
    }
}

fn escapes_vault(p: &str) -> bool {
    let bytes = p.as_bytes();
    p.starts_with('/')
        || p.starts_with('\\')
        || (bytes.len() >= 2 && bytes[1] == b':')
        || p.split(['/', '\\']).any(|segment| segment == "..")
}

// ── Endpoints ─────────────────────────────────────────────────────────────────

fn error(status: StatusCode, message: impl Into<String>) -> Response {
    (status, Json(Value::String(message.into()))).into_response()
}

fn refuse(status: StatusCode) -> Response {
    let message = if status == StatusCode::FORBIDDEN {
        "This device's Tailscale login isn't allowed to use this Cortex."
    } else {
        "Sign in to this Cortex first."
    };
    error(status, message)
}

fn auth(inner: &Inner, headers: &HeaderMap) -> std::result::Result<Identity, StatusCode> {
    let cfg = inner.config.read().unwrap();
    authorize(&cfg, inner.host_login.as_deref(), headers)
}

/// Refuse anything a browser started on another site's behalf.
fn from_the_app(headers: &HeaderMap, json_body: bool) -> Option<Response> {
    if !same_origin(headers) || (json_body && !is_json(headers)) {
        return Some(error(StatusCode::FORBIDDEN, "This request didn't come from the Cortex app."));
    }
    None
}

async fn invoke(State(inner): State<Shared>, UrlPath(cmd): UrlPath<String>, headers: HeaderMap, body: Bytes) -> Response {
    if let Some(refusal) = from_the_app(&headers, true) {
        return refusal;
    }
    let identity = match auth(&inner, &headers) {
        Ok(identity) => identity,
        Err(status) => return refuse(status),
    };
    let Some(info) = dispatch::info(&cmd) else {
        return error(StatusCode::NOT_FOUND, format!("There is no command called {cmd}."));
    };
    let terminal = inner.config.read().unwrap().terminal;
    match info.exposure {
        Exposure::Both => {}
        Exposure::Terminal if terminal => {}
        Exposure::Terminal => return error(StatusCode::FORBIDDEN, "The terminal is switched off for served devices."),
        // A served device follows the vault's own palette setting, never a
        // path of its choosing on this machine.
        Exposure::Desktop if cmd == "watch_theme_file" => return theme_palette(&inner),
        Exposure::Desktop => return error(StatusCode::NOT_FOUND, format!("{cmd} is only available in the desktop app.")),
    }
    let args: Value = if body.is_empty() {
        Value::Null
    } else {
        match serde_json::from_slice(&body) {
            Ok(v) => v,
            Err(e) => return error(StatusCode::BAD_REQUEST, format!("The request body isn't JSON: {e}")),
        }
    };
    if let Err(message) = check_paths(&args) {
        return error(StatusCode::BAD_REQUEST, message);
    }
    // An edit made from a served device is committed with that person as the
    // author, when their Tailscale login is a member's email in
    // `.cortex/members.yaml`. Otherwise the commit is this machine's, as always.
    if cmd == "git_commit" {
        if let Some((name, email)) = identity.login.as_deref().and_then(|login| member_for(&inner.ctx, login)) {
            let message = args.get("message").and_then(|m| m.as_str()).unwrap_or("Update notes").to_string();
            let ctx = inner.ctx.clone();
            let done = tokio::task::spawn_blocking(move || -> Result<()> {
                let root = ctx.vault_path()?;
                let repo = git2::Repository::open(&root).map_err(AppError::Git)?;
                cortex_core::git::stage_all_and_commit_as(&repo, &message, Some((&name, &email)))
            })
            .await;
            return match done {
                Ok(Ok(())) => Json(Value::Null).into_response(),
                Ok(Err(err)) => error(StatusCode::BAD_REQUEST, err.to_string()),
                Err(e) => error(StatusCode::INTERNAL_SERVER_ERROR, format!("The command failed to run: {e}")),
            };
        }
    }
    let ctx = inner.ctx.clone();
    let name = cmd.clone();
    let run = move || dispatch::dispatch(&ctx, &name, args);
    let result = match info.mode {
        Mode::Sync => {
            let _one_at_a_time = inner.serial.lock().await;
            tokio::task::spawn_blocking(run).await
        }
        Mode::Blocking => tokio::task::spawn_blocking(run).await,
    };
    match result {
        Ok(Some(Ok(value))) => Json(value).into_response(),
        Ok(Some(Err(err))) => error(StatusCode::BAD_REQUEST, err.to_string()),
        Ok(None) => error(StatusCode::NOT_FOUND, format!("There is no command called {cmd}.")),
        Err(e) => error(StatusCode::INTERNAL_SERVER_ERROR, format!("The command failed to run: {e}")),
    }
}

/// The vault member a Tailscale login belongs to: the one whose email it is.
fn member_for(ctx: &AppCtx, login: &str) -> Option<(String, String)> {
    let root = ctx.vault_path().ok()?;
    cortex_core::members::load(&root)
        .into_iter()
        .find(|m| !m.email.is_empty() && m.email.eq_ignore_ascii_case(login))
        .map(|m| (m.name, m.email))
}

fn theme_palette(inner: &Inner) -> Response {
    let palette = crate::commands::config::get_settings(&inner.ctx)
        .ok()
        .and_then(|s| crate::theme::palette_for_setting(&s.theme_file));
    Json(palette).into_response()
}

/// What a device is told when it has missed events: everything may have changed.
fn everything() -> Value {
    json!({ "notes": [], "removed": [], "comments": [], "dirs": true, "config": true, "git": true })
}

async fn events(State(inner): State<Shared>, headers: HeaderMap) -> Response {
    if let Some(refusal) = from_the_app(&headers, false) {
        return refusal;
    }
    if let Err(status) = auth(&inner, &headers) {
        return refuse(status);
    }
    let shared = inner.clone();
    let stream = BroadcastStream::new(inner.events.subscribe()).filter_map(move |item| match item {
        Ok((name, payload)) => {
            // Read the setting per event, so switching the terminal off reaches
            // streams that are already open.
            if !shared.config.read().unwrap().terminal && name.starts_with("terminal://") {
                return None;
            }
            Some(Ok::<Event, std::convert::Infallible>(Event::default().event(name).data(payload.to_string())))
        }
        // The device fell behind — asleep, or a slow link — and events were
        // dropped. Say so, rather than leaving it with a stale vault until it
        // next reconnects.
        Err(BroadcastStreamRecvError::Lagged(_)) => Some(Ok(Event::default()
            .event(crate::watcher::CHANGED_EVENT)
            .data(everything().to_string()))),
    });
    Sse::new(stream)
        .keep_alive(KeepAlive::new().interval(Duration::from_secs(15)))
        .into_response()
}

async fn commands(State(inner): State<Shared>, headers: HeaderMap) -> Response {
    if let Some(refusal) = from_the_app(&headers, false) {
        return refusal;
    }
    if let Err(status) = auth(&inner, &headers) {
        return refuse(status);
    }
    Json(dispatch::COMMANDS).into_response()
}

/// What the frontend needs before anything else: that it is served, whether
/// this browser is signed in, and what this host lets it do.
async fn capabilities(State(inner): State<Shared>, headers: HeaderMap) -> Response {
    if let Some(refusal) = from_the_app(&headers, false) {
        return refusal;
    }
    let cfg = inner.config.read().unwrap().clone();
    let identity = authorize(&cfg, inner.host_login.as_deref(), &headers).ok();
    let signed_in = identity.is_some();
    let vault = if signed_in {
        inner
            .ctx
            .vault_path()
            .ok()
            .and_then(|p| p.file_name().map(|n| n.to_string_lossy().into_owned()))
    } else {
        None
    };
    Json(json!({
        "served": true,
        "authenticated": signed_in,
        "auth": cfg.auth,
        "needsToken": !cfg.token.is_empty(),
        "login": identity.and_then(|i| i.login),
        "vault": vault,
        "terminal": signed_in && cfg.terminal,
        "folders": false,
        "updater": false,
        "reveal": false,
    }))
    .into_response()
}

/// Exchange the pairing token for a cookie, so the event stream (which can't
/// send headers) and every request after it carry it.
async fn pair(State(inner): State<Shared>, headers: HeaderMap, body: Bytes) -> Response {
    if let Some(refusal) = from_the_app(&headers, true) {
        return refusal;
    }
    let cfg = inner.config.read().unwrap().clone();
    let token = serde_json::from_slice::<Value>(&body)
        .ok()
        .and_then(|v| v.get("token").and_then(|t| t.as_str()).map(|t| t.trim().to_string()))
        .unwrap_or_default();
    if cfg.token.is_empty() || !constant_eq(token.as_bytes(), cfg.token.as_bytes()) {
        return error(StatusCode::FORBIDDEN, "That pairing code isn't right.");
    }
    let secure = header_str(&headers, "x-forwarded-proto") == Some("https");
    let cookie = format!(
        "{COOKIE}={}; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000{}",
        cfg.token,
        if secure { "; Secure" } else { "" }
    );
    let mut res = StatusCode::NO_CONTENT.into_response();
    if let Ok(value) = HeaderValue::from_str(&cookie) {
        res.headers_mut().insert(header::SET_COOKIE, value);
    }
    res
}

async fn static_file(State(inner): State<Shared>, uri: Uri) -> Response {
    let path = uri.path().trim_start_matches('/');
    if path.starts_with("api/") {
        return error(StatusCode::NOT_FOUND, "There is no such endpoint.");
    }
    let wanted = if path.is_empty() { "index.html" } else { path };
    let (bytes, file) = match inner.assets.get(wanted) {
        Some(bytes) => (bytes, wanted),
        // A path with no extension is one of the app's own routes: the shell.
        None if !wanted.rsplit('/').next().unwrap_or("").contains('.') => match inner.assets.get("index.html") {
            Some(bytes) => (bytes, "index.html"),
            None => return error(StatusCode::NOT_FOUND, "The app bundle has no index.html — build the frontend first."),
        },
        None => return (StatusCode::NOT_FOUND, "not found").into_response(),
    };
    let mut res = Response::new(Body::from(bytes));
    let h = res.headers_mut();
    h.insert(header::CONTENT_TYPE, HeaderValue::from_static(mime_for(file)));
    let cache = if file.starts_with("assets/") { "public, max-age=31536000, immutable" } else { "no-cache" };
    h.insert(header::CACHE_CONTROL, HeaderValue::from_static(cache));
    h.insert(header::CONTENT_SECURITY_POLICY, HeaderValue::from_static(CSP));
    h.insert("x-content-type-options", HeaderValue::from_static("nosniff"));
    h.insert(header::REFERRER_POLICY, HeaderValue::from_static("no-referrer"));
    res
}

pub fn mime_for(path: &str) -> &'static str {
    match path.rsplit('.').next().unwrap_or("") {
        "html" => "text/html; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" | "map" => "application/json",
        "webmanifest" => "application/manifest+json",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "ico" => "image/x-icon",
        "woff2" => "font/woff2",
        "woff" => "font/woff",
        "ttf" => "font/ttf",
        "otf" => "font/otf",
        "wasm" => "application/wasm",
        "txt" => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn headers(pairs: &[(&'static str, &str)]) -> HeaderMap {
        let mut h = HeaderMap::new();
        for (k, v) in pairs {
            h.append(*k, HeaderValue::from_str(v).unwrap());
        }
        h
    }

    #[test]
    fn tailscale_mode_needs_an_allowed_login() {
        let cfg = ServeConfig::default();
        let host = Some("owner@example.com");
        assert_eq!(authorize(&cfg, host, &headers(&[])), Err(StatusCode::UNAUTHORIZED), "no identity — not through tailscale serve");
        assert_eq!(authorize(&cfg, host, &headers(&[("tailscale-user-login", "stranger@example.com")])), Err(StatusCode::FORBIDDEN));
        assert_eq!(
            authorize(&cfg, host, &headers(&[("tailscale-user-login", "Owner@Example.com")])).unwrap().login.as_deref(),
            Some("Owner@Example.com"),
            "the machine's own login, case aside"
        );
        assert_eq!(authorize(&cfg, None, &headers(&[("tailscale-user-login", "owner@example.com")])), Err(StatusCode::FORBIDDEN), "no allow-list and no known owner lets nobody in");

        let listed = ServeConfig { allow: vec!["friend@example.com".into()], ..Default::default() };
        assert!(authorize(&listed, host, &headers(&[("tailscale-user-login", "friend@example.com")])).is_ok());
        assert_eq!(authorize(&listed, host, &headers(&[("tailscale-user-login", "owner@example.com")])), Err(StatusCode::FORBIDDEN), "an allow-list replaces the default");
    }

    #[test]
    fn a_token_is_a_second_check_in_tailscale_mode_and_the_only_one_in_token_mode() {
        let with_token = ServeConfig { token: "abc123".into(), ..Default::default() };
        let host = Some("owner@example.com");
        let login = ("tailscale-user-login", "owner@example.com");
        assert_eq!(authorize(&with_token, host, &headers(&[login])), Err(StatusCode::UNAUTHORIZED));
        assert!(authorize(&with_token, host, &headers(&[login, ("cookie", "theme=dark; cortex_token=abc123")])).is_ok());

        let token_mode = ServeConfig { auth: AuthMode::Token, token: "abc123".into(), ..Default::default() };
        assert!(authorize(&token_mode, None, &headers(&[("x-cortex-token", "abc123")])).is_ok());
        assert_eq!(authorize(&token_mode, None, &headers(&[("x-cortex-token", "abc124")])), Err(StatusCode::UNAUTHORIZED));
        let no_token = ServeConfig { auth: AuthMode::Token, ..Default::default() };
        assert_eq!(authorize(&no_token, None, &headers(&[("x-cortex-token", "")])), Err(StatusCode::UNAUTHORIZED), "token mode with no token set lets nobody in");
    }

    #[test]
    fn served_devices_only_name_places_inside_the_vault() {
        assert!(check_paths(&json!({ "path": "notes/ideas/second-brain.md" })).is_ok());
        assert!(check_paths(&json!({ "source": "collections/habits", "logSource": "collections/habit-log" })).is_ok());
        assert!(check_paths(&json!({ "path": "/etc/passwd" })).is_err());
        assert!(check_paths(&json!({ "path": "notes/../../secret" })).is_err());
        assert!(check_paths(&json!({ "relPath": "..\\outside" })).is_err());
        assert!(check_paths(&json!({ "outDir": "C:\\Users" })).is_err());
        assert!(check_paths(&json!({ "paths": ["notes/a.md", "../b.md"] })).is_err());
        assert!(check_paths(&json!({ "title": "../not a path key" })).is_ok());
        // Whatever a command calls it, and however deeply it is buried.
        assert!(check_paths(&json!({ "themeFile": "/etc/shadow" })).is_err());
        assert!(check_paths(&json!({ "attachmentDir": "../../elsewhere" })).is_err());
        assert!(check_paths(&json!({ "options": { "outputPath": "/tmp/x" } })).is_err());
        assert!(check_paths(&json!({ "rows": [{ "sourceFile": "../x" }] })).is_err());
        assert!(check_paths(&json!({ "content": "see /etc/passwd and ../elsewhere" })).is_ok(), "prose is not a place");
    }

    #[test]
    fn only_the_app_itself_may_ask() {
        assert!(same_origin(&headers(&[])), "a program with no site to be from");
        assert!(same_origin(&headers(&[("sec-fetch-site", "same-origin")])));
        assert!(same_origin(&headers(&[("sec-fetch-site", "none")])), "typed into the address bar");
        assert!(!same_origin(&headers(&[("sec-fetch-site", "cross-site")])), "another site, in the background");
        assert!(!same_origin(&headers(&[("sec-fetch-site", "same-site")])));
        assert!(same_origin(&headers(&[("origin", "https://box.tailnet.ts.net:8443"), ("host", "box.tailnet.ts.net:8443")])));
        assert!(!same_origin(&headers(&[("origin", "https://evil.example"), ("host", "box.tailnet.ts.net:8443")])));

        assert!(is_json(&headers(&[("content-type", "application/json")])));
        assert!(is_json(&headers(&[("content-type", "application/json; charset=utf-8")])));
        assert!(!is_json(&headers(&[("content-type", "text/plain;charset=UTF-8")])), "what a cross-site fetch may send");
        assert!(!is_json(&headers(&[])), "a form post carries no JSON type");
    }

    #[test]
    fn a_device_that_missed_events_is_told_everything_changed() {
        let payload = everything();
        assert_eq!(payload["dirs"], json!(true));
        assert_eq!(payload["config"], json!(true));
        assert_eq!(payload["git"], json!(true));
        assert_eq!(payload["notes"], json!([]));
    }

    #[test]
    fn content_types_for_the_bundle() {
        assert_eq!(mime_for("index.html"), "text/html; charset=utf-8");
        assert_eq!(mime_for("assets/index-abc.js"), "text/javascript; charset=utf-8");
        assert_eq!(mime_for("manifest.webmanifest"), "application/manifest+json");
        assert_eq!(mime_for("icons/icon-192.png"), "image/png");
    }

    #[test]
    fn bundle_paths_cannot_leave_the_bundle() {
        let dir = std::env::temp_dir().join(format!("cortex-assets-{}", std::process::id()));
        std::fs::create_dir_all(dir.join("assets")).unwrap();
        std::fs::write(dir.join("index.html"), "<html>").unwrap();
        let assets = DirAssets::new(&dir);
        assert_eq!(assets.get("index.html").as_deref(), Some(&b"<html>"[..]));
        assert!(assets.get("../etc/passwd").is_none());
        assert!(assets.get("/etc/passwd").is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
