import { VaultStatus } from "../../lib/commands";
import { SearchIcon, GraphIcon, SyncIcon, TodayIcon, ChevronLeftIcon, ChevronRightIcon, PanelLeftIcon, TerminalIcon, MonkIcon } from "./icons";
import { shortcutFor } from "../../lib/keymap";
import styles from "./TopBar.module.css";

interface Props {
  vaultName: string;
  status: VaultStatus | null;
  syncing: boolean;
  hasRemote: boolean;
  canBack: boolean;
  canForward: boolean;
  onBack: () => void;
  onForward: () => void;
  onSync: () => void;
  onOpenGraph: () => void;
  onOpenSwitcher: () => void;
  onToday: () => void;
  leftOpen: boolean;
  rightOpen: boolean;
  onToggleLeft: () => void;
  onToggleRight: () => void;
  onToggleMonk: () => void;
}

export function TopBar({
  vaultName, status, syncing, hasRemote, canBack, canForward, onBack, onForward,
  onSync, onOpenGraph, onOpenSwitcher, onToday,
  leftOpen, rightOpen, onToggleLeft, onToggleRight, onToggleMonk,
}: Props) {
  const ahead = status?.ahead ?? 0;
  const behind = status?.behind ?? 0;
  const unsynced = ahead + behind > 0;

  const syncTitle = !hasRemote
    ? "No remote configured"
    : syncing
      ? "Syncing…"
      : unsynced
        ? `Sync — ${ahead} to push, ${behind} to pull`
        : "Sync (up to date)";

  return (
    <header className={styles.bar} data-tauri-drag-region>
      <div className={styles.nav}>
        <button className={`${styles.action} ${leftOpen ? styles.actionOn : ""}`} onClick={onToggleLeft} title={`Toggle sidebar (${shortcutFor("toggle-sidebar")})`}>
          <PanelLeftIcon size={15} />
        </button>
        <button className={styles.action} onClick={onBack} disabled={!canBack} title={`Back (${shortcutFor("back")})`}>
          <ChevronLeftIcon size={16} />
        </button>
        <button className={styles.action} onClick={onForward} disabled={!canForward} title={`Forward (${shortcutFor("forward")})`}>
          <ChevronRightIcon size={16} />
        </button>
      </div>

      <div className={`${styles.identity} ${styles.phoneHidden}`} data-tauri-drag-region>
        <span className={styles.vaultName}>{vaultName}</span>
      </div>

      <div className={styles.spacer} data-tauri-drag-region />

      <div className={styles.actions}>
        <button className={styles.action} onClick={onToday} title={`Today's note (${shortcutFor("today")})`}>
          <TodayIcon size={15} />
        </button>
        <button className={styles.action} onClick={onOpenSwitcher} title={`Quick switcher (${shortcutFor("quick-switcher")})`}>
          <SearchIcon size={15} />
        </button>
        <button className={`${styles.action} ${styles.phoneHidden}`} onClick={onOpenGraph} title={`Graph view (${shortcutFor("graph")})`}>
          <GraphIcon size={15} />
        </button>
        <button
          className={`${styles.action} ${unsynced ? styles.actionUnsynced : ""}`}
          onClick={onSync}
          disabled={!hasRemote || syncing}
          title={syncTitle}
        >
          <span className={syncing ? styles.spin : undefined}><SyncIcon size={15} /></span>
          {unsynced && (
            <span className={styles.syncCounts}>
              {ahead > 0 && <span>{ahead}↑</span>}
              {behind > 0 && <span>{behind}↓</span>}
            </span>
          )}
        </button>
        <button className={`${styles.action} ${rightOpen ? styles.actionOn : ""}`} onClick={onToggleRight} title={`Toggle terminal (${shortcutFor("toggle-terminal")})`}>
          <TerminalIcon size={15} />
        </button>
        <button className={`${styles.action} ${styles.phoneHidden}`} onClick={onToggleMonk} title={`Monk mode — just the page (${shortcutFor("monk-mode")})`}>
          <MonkIcon size={15} />
        </button>
      </div>
    </header>
  );
}
