// Publish — the one place the app puts notes on the internet, and only when
// the user presses the button. It shows exactly which notes will go (the ones
// marked `publish: true` or tagged `public`), lets the user pick where — a
// folder for any static host, or the vault's git remote as a `gh-pages`
// branch — and reports what happened. Nothing here runs on save or sync.

import { useEffect, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { commands, PublishEntry, PublishReport, PagesPush, VaultInfo } from "../../lib/commands";
import { CloseIcon, FolderIcon, SyncIcon, GlobeIcon } from "./icons";
import styles from "./PublishModal.module.css";

interface Props {
  vault: VaultInfo;
  onClose: () => void;
  onOpenNote: (path: string) => void;
}

type Target = "folder" | "gh-pages";

type Outcome =
  | { kind: "folder"; report: PublishReport }
  | { kind: "gh-pages"; push: PagesPush }
  | { kind: "error"; message: string };

export function PublishModal({ vault, onClose, onOpenNote }: Props) {
  const [entries, setEntries] = useState<PublishEntry[] | null>(null);
  const [target, setTarget] = useState<Target>("folder");
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [actionWritten, setActionWritten] = useState<string | null>(null);

  useEffect(() => {
    commands.publishPreview().then(setEntries).catch((e) => setOutcome({ kind: "error", message: String(e) }));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const publish = async () => {
    setOutcome(null);
    if (target === "folder") {
      const dir = await openDialog({ directory: true, multiple: false, title: "Publish site into…" });
      if (!dir || typeof dir !== "string") return;
      setBusy(true);
      try {
        setOutcome({ kind: "folder", report: await commands.publishToDir(dir, false) });
      } catch (e) {
        const msg = String(e);
        // A folder the app did not write before: ask, then force.
        if (msg.includes("--force") && window.confirm(`${dir} is not empty and was not written by a previous publish.\n\nWrite the site into it anyway? Files that are not part of the site are left alone.`)) {
          try { setOutcome({ kind: "folder", report: await commands.publishToDir(dir, true) }); }
          catch (e2) { setOutcome({ kind: "error", message: String(e2) }); }
        } else {
          setOutcome({ kind: "error", message: msg });
        }
      } finally { setBusy(false); }
    } else {
      if (!window.confirm("Build the site and force-push it as the gh-pages branch of origin?\n\nOnly the site goes to that branch — never the vault's history.")) return;
      setBusy(true);
      try { setOutcome({ kind: "gh-pages", push: await commands.publishGhPages("origin", "gh-pages") }); }
      catch (e) { setOutcome({ kind: "error", message: String(e) }); }
      finally { setBusy(false); }
    }
  };

  const writeAction = async () => {
    try { setActionWritten(await commands.publishWriteGithubAction()); }
    catch (e) { setOutcome({ kind: "error", message: String(e) }); }
  };

  const count = entries?.length ?? 0;

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} role="dialog" aria-label="Publish" onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <span className={styles.headIcon}><GlobeIcon size={15} /></span>
          <span className={styles.title}>Publish</span>
          <button className={styles.closeBtn} onClick={onClose} title="Close (Esc)"><CloseIcon size={15} /></button>
        </div>

        <div className={styles.body}>
          <p className={styles.lead}>
            Notes marked <code>publish: true</code> (or tagged <code>public</code>) become a static site. Nothing is
            published until you press the button; links to unpublished notes turn into plain text.
          </p>

          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>
              {entries === null ? "Checking…" : count === 0 ? "Nothing is marked for publishing" : `${count} note${count === 1 ? "" : "s"} will be published`}
            </h3>
            {entries && count === 0 && (
              <p className={styles.hint}>
                Open a note and run <strong>Make this note public</strong> from the command palette, or add
                <code>publish: true</code> to its frontmatter.
              </p>
            )}
            {entries && count > 0 && (
              <ul className={styles.list}>
                {entries.map((e) => (
                  <li key={e.path}>
                    <button className={styles.note} onClick={() => { onOpenNote(e.path); onClose(); }} title={e.path}>
                      <span className={styles.noteTitle}>{e.title}</span>
                      <span className={styles.noteUrl}>/{e.url}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>Where</h3>
            <div className={styles.targets}>
              <label className={`${styles.target} ${target === "folder" ? styles.targetOn : ""}`}>
                <input type="radio" name="target" checked={target === "folder"} onChange={() => setTarget("folder")} />
                <span className={styles.targetIcon}><FolderIcon size={14} /></span>
                <span className={styles.targetText}>
                  <span className={styles.targetLabel}>A folder</span>
                  <span className={styles.targetHint}>Plain HTML for any static host — Netlify, Cloudflare Pages, your own server.</span>
                </span>
              </label>
              <label className={`${styles.target} ${target === "gh-pages" ? styles.targetOn : ""} ${!vault.has_remote ? styles.targetOff : ""}`}>
                <input type="radio" name="target" disabled={!vault.has_remote} checked={target === "gh-pages"} onChange={() => setTarget("gh-pages")} />
                <span className={styles.targetIcon}><SyncIcon size={14} /></span>
                <span className={styles.targetText}>
                  <span className={styles.targetLabel}>GitHub Pages</span>
                  <span className={styles.targetHint}>
                    {vault.has_remote
                      ? "Push the site as the gh-pages branch of origin. Enable Pages for that branch once in the repo's settings."
                      : "Needs a git remote: git remote add origin <url>."}
                  </span>
                </span>
              </label>
            </div>
          </section>

          {outcome && (
            <section className={`${styles.section} ${styles.outcome} ${outcome.kind === "error" ? styles.outcomeError : styles.outcomeOk}`}>
              {outcome.kind === "error" && <p>{outcome.message}</p>}
              {outcome.kind === "folder" && (
                <p>
                  Published {outcome.report.pages.length} page{outcome.report.pages.length === 1 ? "" : "s"} and {outcome.report.assets.length} asset{outcome.report.assets.length === 1 ? "" : "s"} to{" "}
                  <code>{outcome.report.out_dir}</code>
                  {outcome.report.removed.length > 0 && ` (${outcome.report.removed.length} stale file${outcome.report.removed.length === 1 ? "" : "s"} removed)`}.
                  Open <code>index.html</code> there to preview.
                </p>
              )}
              {outcome.kind === "gh-pages" && (
                <p>
                  Pushed {outcome.push.report.pages.length} page{outcome.push.report.pages.length === 1 ? "" : "s"} to the <code>{outcome.push.branch}</code> branch of{" "}
                  <code>{outcome.push.remote_url}</code>.
                  {outcome.push.url
                    ? <> Once Pages is enabled for that branch, the site is at <a href={outcome.push.url} target="_blank" rel="noreferrer">{outcome.push.url}</a>.</>
                    : " Point your static host at that branch."}
                </p>
              )}
            </section>
          )}

          <p className={styles.fine}>
            Prefer a workflow? {actionWritten
              ? <>Wrote <code>{actionWritten}</code>. Enable Pages (Source: GitHub Actions), then run it from the Actions tab whenever you want to publish.</>
              : <><button className={styles.link} onClick={writeAction}>Add a GitHub Action</button> that publishes when you press Run workflow — never on its own.</>}
          </p>
        </div>

        <div className={styles.footer}>
          <span className={styles.footHint}>
            {target === "folder" ? "You'll pick the folder next." : "This replaces the gh-pages branch."}
          </span>
          <button className={styles.cancel} onClick={onClose}>Cancel</button>
          <button className={styles.primary} disabled={busy || !entries || count === 0} onClick={publish}>
            {busy ? "Publishing…" : count > 0 ? `Publish ${count} note${count === 1 ? "" : "s"}` : "Publish"}
          </button>
        </div>
      </div>
    </div>
  );
}
