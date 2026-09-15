// ── Transport: how the app reaches its backend ───────────────────────────────
// Inside the desktop app, `invoke` and `listen` are Tauri's own. In a browser —
// the app served by `cortex serve` or by Settings → Serve to my devices — they
// are HTTP: `POST /api/invoke/<command>` with the same JSON arguments, and one
// shared Server-Sent Events stream on `/api/events` carrying the same event
// names. Everything else in the app imports from here and never needs to know
// which host it is running in.
//
// Two things keep the browser faithful to the desktop:
//
// - **Order.** The desktop runs a `sync` command on its main thread, one after
//   another, so two quick saves land in the order they were made. Over HTTP two
//   requests can overtake each other, so `sync` commands go through one queue
//   here and are sent only when the previous one has answered. `blocking`
//   commands (git, indexing, the network) run side by side, as on the desktop.
// - **Missed events.** A phone that sleeps loses its connection, and whatever
//   the vault did meanwhile is gone. After every reconnect listeners of
//   `vault://changed` get one event saying everything may have changed, so the
//   usual refresh runs.

import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { listen as tauriListen } from "@tauri-apps/api/event";

export type UnlistenFn = () => void;

export interface AppEvent<T> {
  event: string;
  id: number;
  payload: T;
}

/** True inside the desktop app. */
export function isDesktop(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** The browser's idea of the server: the page's own origin. */
const API = "/api";

type Mode = "sync" | "blocking";
interface CommandInfo {
  name: string;
  mode: Mode;
  exposure: "both" | "desktop" | "terminal";
}

let modes: Promise<Map<string, Mode>> | null = null;
function commandModes(): Promise<Map<string, Mode>> {
  if (!modes) {
    modes = fetch(`${API}/commands`, { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : []))
      .then((list: CommandInfo[]) => new Map(list.map((c) => [c.name, c.mode])))
      .catch(() => {
        modes = null; // try again next time
        return new Map();
      });
  }
  return modes;
}

/** Tell the app the server wants it to sign in (pair) before anything else. */
function announceAuth(status: number) {
  window.dispatchEvent(new CustomEvent("cortex:served-auth", { detail: { status } }));
}

async function httpInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${API}/invoke/${encodeURIComponent(cmd)}`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args ?? {}),
  });
  if (res.status === 401 || res.status === 403) {
    announceAuth(res.status);
  }
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  // Errors come back as the same string Tauri would have rejected with.
  if (!res.ok) throw typeof body === "string" ? body : `request failed (${res.status})`;
  return body as T;
}

let queue: Promise<unknown> = Promise.resolve();

export async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (isDesktop()) return tauriInvoke<T>(cmd, args);
  const mode = (await commandModes()).get(cmd) ?? "sync";
  if (mode === "blocking") return httpInvoke<T>(cmd, args);
  const run = queue.then(() => httpInvoke<T>(cmd, args));
  queue = run.catch(() => undefined);
  return run;
}

// ── Events ──────────────────────────────────────────────────────────────────

type Handler = (event: AppEvent<unknown>) => void;
const handlers = new Map<string, Set<Handler>>();
let source: EventSource | null = null;
let opened = false;
let nextId = 1;

/** Everything may have changed: what a reconnect has to assume. */
const EVERYTHING = { notes: [], removed: [], comments: [], dirs: true, config: true, git: true };

function deliver(name: string, payload: unknown) {
  const id = nextId++;
  for (const h of handlers.get(name) ?? []) h({ event: name, id, payload });
}

function attach(name: string) {
  source?.addEventListener(name, (e) => {
    const data = (e as MessageEvent<string>).data;
    let payload: unknown = null;
    try { payload = data ? JSON.parse(data) : null; } catch { payload = data; }
    deliver(name, payload);
  });
}

function connect() {
  if (source && source.readyState !== EventSource.CLOSED) return;
  source = new EventSource(`${API}/events`, { withCredentials: true });
  source.addEventListener("open", () => {
    if (opened) deliver("vault://changed", EVERYTHING);
    opened = true;
  });
  source.addEventListener("error", () => {
    // EventSource retries on its own; a closed one (auth refused) is re-made on
    // the next visibility change or listen.
    if (source?.readyState === EventSource.CLOSED) fetch(`${API}/commands`, { credentials: "same-origin" })
      .then((r) => { if (r.status === 401 || r.status === 403) announceAuth(r.status); })
      .catch(() => {});
  });
  for (const name of handlers.keys()) attach(name);
}

if (typeof document !== "undefined" && !isDesktop()) {
  // A backgrounded home-screen app loses its stream; come back to a live one.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && handlers.size > 0) connect();
  });
}

export async function listen<T>(event: string, handler: (event: AppEvent<T>) => void): Promise<UnlistenFn> {
  if (isDesktop()) return tauriListen<T>(event, handler);
  let set = handlers.get(event);
  const first = !set;
  if (!set) {
    set = new Set();
    handlers.set(event, set);
  }
  set.add(handler as Handler);
  if (!source || source.readyState === EventSource.CLOSED) connect();
  else if (first) attach(event);
  return () => { handlers.get(event)?.delete(handler as Handler); };
}

/** Forget the event stream so the next `listen` opens a fresh one — after
 *  pairing, when the old stream was refused. */
export function reconnectEvents() {
  source?.close();
  source = null;
  opened = false;
  if (handlers.size > 0) connect();
}
