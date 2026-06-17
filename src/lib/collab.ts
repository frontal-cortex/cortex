// ── Collaboration layer (presence + real-time) ───────────────────────────────
//
// Everything here is EPHEMERAL session state carried over a Yjs websocket relay
// (`collab_url` in settings; self-host with `npx y-websocket-server`). The
// markdown files + git remain the durable source of truth: a live co-editing
// session serializes through the normal save pipeline, and the relay's only
// other job is nudging peers to sync sooner ("something changed → pull now").
// If the relay is down, the app degrades to exactly the offline git workflow.
//
// Three pieces:
//  1. Identity   — the current git user matched against the member roster.
//  2. Vault room — one shared Y.Doc per vault for data-change nudges; presence
//                  rides on its awareness protocol.
//  3. Note rooms — one Y.Doc per open note for BlockNote co-editing (created by
//                  the editor via `createNoteSession`).

import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";
import { commands } from "./commands";
import { cursorColor } from "./colors";

export interface CollabConfig {
  url: string;
  /** Room namespace, shared by all clones of this vault (the vault folder name). */
  roomPrefix: string;
  user: { name: string; color: string };
}

/** Resolve the collab config from settings + git identity + roster.
 *  Null when no relay is configured. */
export async function loadCollabConfig(vaultName: string): Promise<CollabConfig | null> {
  const settings = await commands.getSettings();
  const url = settings.collab_url.trim();
  if (!url) return null;
  const [user, members] = await Promise.all([
    commands.currentUser().catch(() => ({ name: "", email: "" })),
    commands.getMembers().catch(() => []),
  ]);
  const member = members.find(
    (m) => (!!user.email && m.email === user.email) || m.name === user.name,
  );
  const name = member?.name || user.name || "Anonymous";
  return {
    url,
    roomPrefix: vaultName,
    user: { name, color: cursorColor(member?.color ?? "blue") },
  };
}

/** A live Yjs session for one room. */
export interface CollabSession {
  doc: Y.Doc;
  provider: WebsocketProvider;
  destroy: () => void;
}

export function createNoteSession(config: CollabConfig, notePath: string): CollabSession {
  const doc = new Y.Doc();
  const provider = new WebsocketProvider(config.url, `${config.roomPrefix}/${notePath}`, doc);
  provider.awareness.setLocalStateField("user", config.user);
  return {
    doc,
    provider,
    destroy: () => { provider.destroy(); doc.destroy(); },
  };
}

// ── Vault room: data-change nudges between teammates ─────────────────────────
//
// Local mutations (commands.ts dispatches "cortex:local-data-changed") are
// broadcast via a Y.Map. Remote ones surface as "cortex:remote-data-changed" —
// the shell reacts by scheduling a sync, which pulls the actual file changes.

let vaultRoom: CollabSession | null = null;
let localListener: (() => void) | null = null;

export function startVaultRoom(config: CollabConfig): void {
  stopVaultRoom();
  const session = createNoteSession(config, "$vault");
  vaultRoom = session;
  const events = session.doc.getMap<{ by: string; ts: number }>("events");

  events.observe((_event, tx) => {
    if (tx.local) return;
    const change = events.get("dataChanged");
    window.dispatchEvent(new CustomEvent("cortex:remote-data-changed", { detail: change }));
  });

  localListener = () => {
    events.set("dataChanged", { by: config.user.name, ts: Date.now() });
  };
  window.addEventListener("cortex:local-data-changed", localListener);
}

export function stopVaultRoom(): void {
  if (localListener) {
    window.removeEventListener("cortex:local-data-changed", localListener);
    localListener = null;
  }
  vaultRoom?.destroy();
  vaultRoom = null;
}
