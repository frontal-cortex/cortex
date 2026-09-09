// ── Check for updates ─────────────────────────────────────────────────────────
// "Check for updates…" in the palette opens this; Settings → Updates shows the
// same checker inline. One component, one state machine (lib/updater.ts):
// nothing downloads until the user confirms, and a build with no update
// channel says so instead of failing.

import { useCallback, useEffect, useRef, useState } from "react";
import { UpdateState, checkForUpdate, installUpdate, errorMessage, formatBytes } from "../../lib/updater";
import { commands } from "../../lib/commands";
import { CloseIcon, DownloadIcon } from "./icons";
import styles from "./UpdateModal.module.css";

export function UpdateChecker({ autoCheck = false }: { autoCheck?: boolean }) {
  const [state, setState] = useState<UpdateState>({ status: "idle", config: null });
  const stateRef = useRef(state);
  stateRef.current = state;

  const runCheck = useCallback(async () => {
    setState((s) => ({ status: "checking", config: s.config }));
    setState(await checkForUpdate());
  }, []);

  useEffect(() => {
    if (autoCheck) { runCheck(); return; }
    commands.updateConfig().then((config) => setState((s) => (s.status === "idle" ? { status: "idle", config } : s))).catch(() => {});
  }, [autoCheck, runCheck]);

  // Free the Rust-side update handle when the checker goes away.
  useEffect(() => () => {
    const s = stateRef.current;
    if (s.status === "available") s.update.close().catch(() => {});
  }, []);

  const install = useCallback(async () => {
    const s = stateRef.current;
    if (s.status !== "available") return;
    const { config, update } = s;
    setState({ status: "downloading", config, update, received: 0, total: null });
    try {
      await installUpdate(update, (received, total) => setState({ status: "downloading", config, update, received, total }));
      setState({ status: "restarting", config });
    } catch (e) {
      setState({ status: "error", config, message: errorMessage(e) });
    }
  }, []);

  const version = state.config?.current_version;
  const busy = state.status === "checking" || state.status === "downloading" || state.status === "restarting";

  return (
    <div className={styles.checker}>
      <div className={styles.status}>
        {state.status === "idle" && <span>{version ? `Cortex ${version}` : "Cortex"}</span>}
        {state.status === "checking" && <span>Checking for updates…</span>}
        {state.status === "unconfigured" && (
          <span>
            This build has no update channel — it was built from source, or the release is unsigned. Cortex {version}.
          </span>
        )}
        {state.status === "current" && <span>You're on the latest version, Cortex {version}.</span>}
        {state.status === "available" && (
          <span>
            <strong>Cortex {state.update.version}</strong> is available (you have {version}).
            {state.update.body && <span className={styles.notes}>{state.update.body}</span>}
          </span>
        )}
        {state.status === "downloading" && (
          <span>
            Downloading {state.update.version}…{" "}
            {state.total ? `${formatBytes(state.received)} of ${formatBytes(state.total)}` : formatBytes(state.received)}
          </span>
        )}
        {state.status === "restarting" && <span>Installed. Restarting…</span>}
        {state.status === "error" && <span className={styles.error}>Update check failed: {state.message}</span>}
      </div>
      <div className={styles.actions}>
        {state.status === "available" ? (
          <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={install} autoFocus>
            <DownloadIcon size={12} /> Install and restart
          </button>
        ) : (
          <button className={styles.btn} onClick={runCheck} disabled={busy || state.status === "unconfigured"}>
            <DownloadIcon size={12} /> Check for updates
          </button>
        )}
        {state.config?.endpoint && (
          <span className={styles.source} title={state.config.endpoint}>from {hostOf(state.config.endpoint)}</span>
        )}
      </div>
    </div>
  );
}

function hostOf(url: string): string {
  try { return new URL(url).host; } catch { return url; }
}

export function UpdateModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return (
    <div className={styles.backdrop} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={styles.modal} role="dialog" aria-label="Check for updates">
        <div className={styles.head}>
          <DownloadIcon size={15} />
          <span className={styles.title}>Updates</span>
          <span className={styles.hint}>Esc close</span>
          <button className={styles.close} onClick={onClose} title="Close (Esc)"><CloseIcon size={15} /></button>
        </div>
        <div className={styles.body}>
          <UpdateChecker autoCheck />
        </div>
      </div>
    </div>
  );
}
