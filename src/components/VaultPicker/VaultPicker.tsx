import styles from "./VaultPicker.module.css";

interface Props {
  onOpen: () => void;
  error: string | null;
}

export function VaultPicker({ onOpen, error }: Props) {
  return (
    <div className={styles.root}>
      <div className={styles.card}>
        <div className={styles.logo}>
          <BrainIcon />
        </div>
        <h1 className={styles.title}>Second Brain</h1>
        <p className={styles.subtitle}>
          Your notes live in a plain git repository.
          <br />
          Open an existing vault or create a new directory to get started.
        </p>
        <button className={styles.button} onClick={onOpen}>
          Open vault
        </button>
        {error && <p className={styles.error}>{error}</p>}
        <p className={styles.hint}>
          Any local folder works — the app will initialize it as a git repo if needed.
        </p>
      </div>
    </div>
  );
}

function BrainIcon() {
  return (
    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96-.46 2.5 2.5 0 0 1-1.98-3 2.5 2.5 0 0 1-1.32-4.24 3 3 0 0 1 .34-5.58 2.5 2.5 0 0 1 1.96-3.12A2.5 2.5 0 0 1 9.5 2Z"/>
      <path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96-.46 2.5 2.5 0 0 0 1.98-3 2.5 2.5 0 0 0 1.32-4.24 3 3 0 0 0-.34-5.58 2.5 2.5 0 0 0-1.96-3.12A2.5 2.5 0 0 0 14.5 2Z"/>
    </svg>
  );
}
