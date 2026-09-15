// ── Settings → Serve to my devices ───────────────────────────────────────────
// The desktop app serving its open vault to this machine's own devices over
// Tailscale: the switch, the one command that puts it on the tailnet, the
// address and a QR code for the phone, and who may sign in. Everything here
// is saved in this machine's config directory, never in the vault.

import { useCallback, useEffect, useState } from "react";
import { commands, ServeConfig, ServeStatus } from "../../lib/commands";
import styles from "./ServeSettings.module.css";

export function ServeSettings() {
  const [status, setStatus] = useState<ServeStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [allowDraft, setAllowDraft] = useState("");
  const [portDraft, setPortDraft] = useState("");
  const [copied, setCopied] = useState(false);

  const take = useCallback((s: ServeStatus) => {
    setStatus(s);
    setAllowDraft(s.config.allow.join("\n"));
    setPortDraft(String(s.config.port));
  }, []);

  useEffect(() => {
    commands.serveStatus().then(take).catch(() => {});
  }, [take]);

  const save = async (patch: Partial<ServeConfig>) => {
    if (!status) return;
    setBusy(true);
    try {
      take(await commands.serveSet({ ...status.config, ...patch }));
    } finally {
      setBusy(false);
    }
  };

  const newCode = async () => {
    setBusy(true);
    try { take(await commands.serveNewToken()); } finally { setBusy(false); }
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* the command is on screen to select by hand */ }
  };

  if (!status) return <div className={styles.muted}>Checking…</div>;

  const { config, tailscale } = status;
  const ownLogin = tailscale?.login ?? null;
  const tailnetUp = !!tailscale?.running;

  return (
    <div className={styles.wrap}>
      <label className={styles.switchRow}>
        <input
          type="checkbox"
          checked={config.enabled}
          disabled={busy}
          onChange={(e) => save({ enabled: e.target.checked })}
        />
        <span>
          <strong>Serve this vault to my devices</strong>
          <span className={styles.muted}> — open it from your phone or another computer on your tailnet. The notes stay on this machine.</span>
        </span>
      </label>

      {status.error && <p className={styles.error}>{status.error}</p>}

      {config.enabled && status.running && (
        <div className={styles.steps}>
          <p className={styles.muted}>Serving on this machine at <code>{status.local_url}</code>.</p>

          {!tailnetUp && <p className={styles.warn}>Tailscale isn't running on this machine. Start it to reach Cortex from your devices.</p>}
          {tailnetUp && tailscale && !tailscale.https && (
            <p className={styles.warn}>
              Turn on HTTPS certificates in the Tailscale admin console (DNS → HTTPS Certificates). Installing the app on a
              phone needs HTTPS.
            </p>
          )}

          <div className={styles.step}>
            <span className={styles.stepNo}>1</span>
            <div className={styles.stepBody}>
              <div>Put it on your tailnet — run this once in a terminal:</div>
              <div className={styles.commandRow}>
                <code className={styles.command}>{status.tailscale_command}</code>
                <button className={styles.button} onClick={() => copy(status.tailscale_command)}>{copied ? "Copied" : "Copy"}</button>
              </div>
            </div>
          </div>

          <div className={styles.step}>
            <span className={styles.stepNo}>2</span>
            <div className={styles.stepBody}>
              {status.tailnet_url ? (
                <>
                  <div>Open <code>{status.tailnet_url}</code> on your phone, or scan:</div>
                  {status.qr_svg && (
                    <img
                      className={styles.qr}
                      alt={`QR code for ${status.tailnet_url}`}
                      src={`data:image/svg+xml;utf8,${encodeURIComponent(status.qr_svg)}`}
                    />
                  )}
                </>
              ) : (
                <div>Open this machine's Tailscale address (…<code>.ts.net</code>) on your phone.</div>
              )}
            </div>
          </div>

          <div className={styles.step}>
            <span className={styles.stepNo}>3</span>
            <div className={styles.stepBody}>
              Add it to the home screen: on iPhone, Share → Add to Home Screen; on Android, the install prompt or ⋮ → Install app.
            </div>
          </div>
        </div>
      )}

      <div className={styles.group}>
        <div className={styles.groupTitle}>Who can sign in</div>
        <select
          className={styles.select}
          value={config.auth}
          disabled={busy}
          onChange={(e) => save({ auth: e.target.value as ServeConfig["auth"] })}
        >
          <option value="tailscale">Tailscale accounts</option>
          <option value="token">Anyone with the pairing code</option>
        </select>

        {config.auth === "tailscale" && (
          <label className={styles.field}>
            <span className={styles.muted}>
              Tailscale logins allowed in, one per line. Empty means only you{ownLogin ? ` (${ownLogin})` : ""}.
            </span>
            <textarea
              className={styles.textarea}
              rows={3}
              value={allowDraft}
              placeholder={ownLogin ?? "you@example.com"}
              spellCheck={false}
              onChange={(e) => setAllowDraft(e.target.value)}
              onBlur={() => {
                const allow = allowDraft.split(/[\n,]/).map((l) => l.trim()).filter(Boolean);
                if (allow.join("\n") !== config.allow.join("\n")) void save({ allow });
              }}
            />
          </label>
        )}

        <div className={styles.field}>
          <span className={styles.muted}>
            {config.auth === "token"
              ? "Devices enter this code once to pair."
              : "Optional second check: when set, devices also enter this code once."}
          </span>
          <div className={styles.commandRow}>
            <code className={styles.command}>{config.token || "No pairing code"}</code>
            <button className={styles.button} disabled={busy} onClick={newCode}>{config.token ? "New code" : "Create code"}</button>
            {config.token && config.auth === "tailscale" && (
              <button className={styles.button} disabled={busy} onClick={() => save({ token: "" })}>Remove</button>
            )}
          </div>
        </div>
      </div>

      <div className={styles.group}>
        <label className={styles.switchRow}>
          <input type="checkbox" checked={config.terminal} disabled={busy} onChange={(e) => save({ terminal: e.target.checked })} />
          <span>
            Let devices use the terminal
            <span className={styles.muted}> — anyone signed in can run commands on this machine.</span>
          </span>
        </label>
        <label className={styles.inlineField}>
          <span className={styles.muted}>Port on this machine</span>
          <input
            className={styles.port}
            inputMode="numeric"
            value={portDraft}
            disabled={busy}
            onChange={(e) => setPortDraft(e.target.value.replace(/[^0-9]/g, ""))}
            onBlur={() => {
              const port = Number(portDraft);
              if (port > 0 && port < 65536 && port !== config.port) void save({ port });
              else setPortDraft(String(config.port));
            }}
          />
        </label>
      </div>
    </div>
  );
}
