// ── Host: what the app is running inside, and what that host allows ─────────
// The desktop app can do everything. The served app — `cortex serve`, or
// Settings → Serve to my devices — reports what a browser may do through
// `/api/capabilities`, and whether this browser is signed in yet. The server
// enforces the same rules per request; this is so the interface can leave out
// what would only fail.

import { isDesktop } from "./transport";

export interface HostCapabilities {
  /** Running in a browser against a Cortex server. */
  served: boolean;
  /** This browser may use the app (Tailscale login allowed, pairing done). */
  authenticated: boolean;
  /** How the server decides who may connect. */
  auth: "tailscale" | "token";
  /** The server asks for a pairing code. */
  needsToken: boolean;
  /** The Tailscale login the server saw, once allowed. */
  login: string | null;
  /** The served vault's folder name, once allowed. */
  vault: string | null;
  /** The terminal (a shell on the serving machine) is switched on. */
  terminal: boolean;
  /** Folder pickers: open a vault, import a folder, publish into a folder. */
  folders: boolean;
  /** In-app updates. */
  updater: boolean;
  /** Reveal a note in the file manager. */
  reveal: boolean;
}

const DESKTOP: HostCapabilities = {
  served: false, authenticated: true, auth: "tailscale", needsToken: false, login: null, vault: null,
  terminal: true, folders: true, updater: true, reveal: true,
};

/** Until the server answers, assume the least. */
const SERVED_UNKNOWN: HostCapabilities = {
  served: true, authenticated: false, auth: "tailscale", needsToken: false, login: null, vault: null,
  terminal: false, folders: false, updater: false, reveal: false,
};

let current: HostCapabilities = isDesktop() ? DESKTOP : SERVED_UNKNOWN;

/** The last known capabilities, synchronously — for rendering. */
export function capabilities(): HostCapabilities {
  return current;
}

/** Ask the server (or return the desktop's). Throws when the server can't be reached. */
export async function loadCapabilities(): Promise<HostCapabilities> {
  if (isDesktop()) return DESKTOP;
  const res = await fetch("/api/capabilities", { credentials: "same-origin", cache: "no-store" });
  if (!res.ok) throw new Error(`capabilities: ${res.status}`);
  current = { ...SERVED_UNKNOWN, ...(await res.json()) };
  return current;
}

/** Trade a pairing code for this browser's sign-in cookie. */
export async function pair(code: string): Promise<boolean> {
  const res = await fetch("/api/pair", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: code.trim() }),
  });
  return res.ok;
}
