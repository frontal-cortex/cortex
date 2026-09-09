import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  /** What the boundary guards, for the message ("the Table view", "the editor"). */
  label?: string;
  /** Inline: a small panel where the content was. Otherwise a full-page notice. */
  inline?: boolean;
}

interface State { error: Error | null; stack: string }

/**
 * A render error anywhere below this point would otherwise unmount the whole
 * React tree and leave a blank window with no way to tell what happened. Show
 * the error where the content was, with a way to retry or reload.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, stack: "" };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ stack: info.componentStack ?? "" });
    console.error(`[cortex] render error in ${this.props.label ?? "the app"}:`, error, info.componentStack);
  }

  render() {
    const { error, stack } = this.state;
    if (!error) return this.props.children;
    const what = this.props.label ?? "this part of the app";
    const box: React.CSSProperties = this.props.inline
      ? { margin: "8px 0", padding: "12px 14px", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", background: "var(--bg-panel)", color: "var(--text-primary)", fontSize: "var(--text-sm)" }
      : { maxWidth: 640, margin: "15vh auto", padding: "20px 24px", color: "var(--text-primary)", fontSize: "var(--text-sm)" };
    return (
      <div style={box} role="alert">
        <div style={{ fontWeight: 600, marginBottom: 6 }}>Something broke while drawing {what}.</div>
        <div style={{ color: "var(--text-secondary)", marginBottom: 8, fontFamily: "var(--font-mono, monospace)", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
          {error.message || String(error)}
        </div>
        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          <button type="button" onClick={() => this.setState({ error: null, stack: "" })}
            style={{ font: "inherit", padding: "4px 10px", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)", background: "var(--bg-app)", color: "inherit", cursor: "pointer" }}>
            Try again
          </button>
          <button type="button" onClick={() => window.location.reload()}
            style={{ font: "inherit", padding: "4px 10px", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)", background: "var(--bg-app)", color: "inherit", cursor: "pointer" }}>
            Reload the app
          </button>
        </div>
        {stack && (
          <details>
            <summary style={{ cursor: "pointer", color: "var(--text-tertiary)" }}>Details</summary>
            <pre style={{ fontSize: 11, color: "var(--text-tertiary)", whiteSpace: "pre-wrap", maxHeight: 200, overflow: "auto", margin: "6px 0 0" }}>
              {(error.stack ?? "") + "\n" + stack}
            </pre>
          </details>
        )}
      </div>
    );
  }
}
