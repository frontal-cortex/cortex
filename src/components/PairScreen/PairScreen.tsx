// ── The served app's front door ──────────────────────────────────────────────
// What a browser sees before the vault: why it can't get in yet, and the one
// thing to do about it. Three situations — this browser isn't signed in, the
// server can't be reached, or the server has no vault open.

import { FormEvent, useEffect, useState } from "react";
import { HostCapabilities, loadCapabilities, pair } from "../../lib/host";
import { reconnectEvents } from "../../lib/transport";
import styles from "./PairScreen.module.css";

export type ServedGate = "pair" | "unreachable" | "no-vault";

export function PairScreen({ gate, onRetry }: { gate: ServedGate; onRetry: () => void }) {
  const [caps, setCaps] = useState<HostCapabilities | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [wrong, setWrong] = useState(false);

  useEffect(() => {
    if (gate === "pair") loadCapabilities().then(setCaps).catch(() => setCaps(null));
  }, [gate]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!code.trim()) return;
    setBusy(true);
    setWrong(false);
    const ok = await pair(code).catch(() => false);
    setBusy(false);
    if (!ok) {
      setWrong(true);
      return;
    }
    reconnectEvents();
    onRetry();
  };

  const host = typeof location !== "undefined" ? location.host : "";

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <img className={styles.logo} src="/icons/icon-192.png" alt="" width={56} height={56} />
        {gate === "unreachable" && (
          <>
            <h1 className={styles.title}>Can't reach Cortex</h1>
            <p className={styles.body}>
              The machine serving it may be asleep, or this device is off the tailnet. Your notes stay on that
              machine, so there is nothing to show until it answers.
            </p>
            <button className={styles.primary} onClick={onRetry}>Try again</button>
          </>
        )}

        {gate === "no-vault" && (
          <>
            <h1 className={styles.title}>No vault is open</h1>
            <p className={styles.body}>
              Cortex is running on {host}, but it has no vault open. Open one in the desktop app on that machine,
              then try again.
            </p>
            <button className={styles.primary} onClick={onRetry}>Try again</button>
          </>
        )}

        {gate === "pair" && (
          <>
            <h1 className={styles.title}>Sign in to this Cortex</h1>
            {caps?.needsToken || caps?.auth === "token" ? (
              <form className={styles.form} onSubmit={submit}>
                <p className={styles.body}>
                  Enter the pairing code shown in Settings → Serve to my devices on the machine running Cortex.
                  This browser remembers it.
                </p>
                <input
                  className={styles.input}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="Pairing code"
                  autoComplete="one-time-code"
                  autoCapitalize="off"
                  spellCheck={false}
                  autoFocus
                />
                {wrong && <p className={styles.error}>That code isn't right.</p>}
                <button className={styles.primary} type="submit" disabled={busy || !code.trim()}>
                  {busy ? "Checking…" : "Pair this device"}
                </button>
              </form>
            ) : (
              <>
                <p className={styles.body}>
                  This Cortex only opens for devices on its tailnet, signed in with an allowed Tailscale account,
                  and reached at the machine's Tailscale address — the one ending in <code>.ts.net</code>.
                </p>
                <p className={styles.body}>
                  If that's how you got here, the owner can add your Tailscale login in Settings → Serve to my
                  devices.
                </p>
                <button className={styles.primary} onClick={onRetry}>Try again</button>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
