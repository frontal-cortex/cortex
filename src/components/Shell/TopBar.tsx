import { VaultStatus } from "../../lib/commands";
import { SearchIcon, GraphIcon, SyncIcon, TodayIcon } from "./icons";
import styles from "./TopBar.module.css";

interface Props {
  vaultName: string;
  status: VaultStatus | null;
  syncing: boolean;
  hasRemote: boolean;
  onSync: () => void;
  onOpenGraph: () => void;
  onOpenSwitcher: () => void;
  onToday: () => void;
}

export function TopBar({
  vaultName, status, syncing, hasRemote, onSync, onOpenGraph, onOpenSwitcher, onToday,
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
      <div className={styles.identity} data-tauri-drag-region>
        <span className={styles.vaultName}>{vaultName}</span>
      </div>

      <div className={styles.spacer} data-tauri-drag-region />

      <div className={styles.actions}>
        <button className={styles.action} onClick={onToday} title="Today's note">
          <TodayIcon size={15} />
        </button>
        <button className={styles.action} onClick={onOpenSwitcher} title="Quick switcher (⌘K)">
          <SearchIcon size={15} />
        </button>
        <button className={styles.action} onClick={onOpenGraph} title="Graph view (⌘G)">
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
      </div>
    </header>
  );
}
