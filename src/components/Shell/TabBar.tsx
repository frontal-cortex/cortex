import { Tab } from "../../hooks/useNavHistory";
import { CloseIcon } from "./icons";
import styles from "./TabBar.module.css";

interface Props {
  tabs: Tab[];
  activeTab: number;
  canBack: boolean;
  canForward: boolean;
  onSwitch: (i: number) => void;
  onClose: (i: number) => void;
  onBack: () => void;
  onForward: () => void;
}

export function TabBar({ tabs, activeTab, canBack, canForward, onSwitch, onClose, onBack, onForward }: Props) {
  if (tabs.length === 0) return null;

  return (
    <div className={styles.bar}>
      <button
        className={styles.navBtn}
        onClick={onBack}
        disabled={!canBack}
        title="Go back (⌘[)"
        aria-label="Back"
      >
        ‹
      </button>
      <button
        className={styles.navBtn}
        onClick={onForward}
        disabled={!canForward}
        title="Go forward (⌘])"
        aria-label="Forward"
      >
        ›
      </button>

      <div className={styles.tabs}>
        {tabs.map((tab, i) => (
          <div
            key={i}
            className={`${styles.tab} ${i === activeTab ? styles.tabActive : ""}`}
          >
            <button
              className={styles.tabLabel}
              onClick={() => onSwitch(i)}
              title={tab.path}
            >
              {tab.title || tab.path.split("/").pop()?.replace(/\.md$/, "") || "Untitled"}
            </button>
            <button
              className={styles.tabClose}
              onClick={(e) => { e.stopPropagation(); onClose(i); }}
              title="Close tab"
              aria-label="Close"
            >
              <CloseIcon size={10} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
