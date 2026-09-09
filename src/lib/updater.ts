// In-app updates. The check, the download and the signature check all run in
// Rust (tauri-plugin-updater) against the endpoint compiled into
// tauri.conf.json — a `latest.json` on the GitHub release. Nothing here runs
// on its own: the user asks, from the command palette or Settings, and
// confirms before anything is installed. A build with no endpoint or with the
// placeholder public key (every development build) reports "not configured"
// and never contacts the network.

import { check, Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { commands, UpdateConfig } from "./commands";

export type UpdateState =
  | { status: "idle"; config: UpdateConfig | null }
  | { status: "checking"; config: UpdateConfig | null }
  | { status: "unconfigured"; config: UpdateConfig }
  | { status: "current"; config: UpdateConfig }
  | { status: "available"; config: UpdateConfig; update: Update }
  | { status: "downloading"; config: UpdateConfig; update: Update; received: number; total: number | null }
  | { status: "restarting"; config: UpdateConfig }
  | { status: "error"; config: UpdateConfig | null; message: string };

export function errorMessage(e: unknown): string {
  if (typeof e === "string") return e;
  if (e && typeof e === "object" && "message" in e && typeof (e as { message: unknown }).message === "string") {
    return (e as { message: string }).message;
  }
  return String(e);
}

/** Ask the endpoint whether a newer version exists. Never throws. */
export async function checkForUpdate(): Promise<UpdateState> {
  let config: UpdateConfig | null = null;
  try {
    config = await commands.updateConfig();
  } catch (e) {
    return { status: "error", config: null, message: errorMessage(e) };
  }
  if (!config.configured) return { status: "unconfigured", config };
  try {
    const update = await check();
    return update ? { status: "available", config, update } : { status: "current", config };
  } catch (e) {
    return { status: "error", config, message: errorMessage(e) };
  }
}

/** Download, verify and install `update`, then relaunch into the new build.
 *  On Windows the installer quits the app itself, so the relaunch is a no-op
 *  there. Throws on failure so the caller can show the message. */
export async function installUpdate(
  update: Update,
  onProgress: (received: number, total: number | null) => void,
): Promise<void> {
  let received = 0;
  let total: number | null = null;
  await update.downloadAndInstall((ev) => {
    if (ev.event === "Started") { total = ev.data.contentLength ?? null; onProgress(0, total); }
    else if (ev.event === "Progress") { received += ev.data.chunkLength; onProgress(received, total); }
    else if (ev.event === "Finished") onProgress(total ?? received, total);
  });
  await relaunch();
}

export function formatBytes(n: number): string {
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
