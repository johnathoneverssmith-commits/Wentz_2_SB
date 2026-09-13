/**
 * Catches a crash in one screen so it stays one screen.
 *
 * Without this, a single bad value took the whole app down: a coordinator's
 * salary came back from localStorage as `null` (a NaN that went through
 * JSON), `millions()` called `.toFixed` on it, React unmounted the tree, and
 * the player was left staring at a white page with no way back — a reload
 * returns to the same screen, because the stage is persisted too.
 *
 * The formatters no longer throw on bad numbers, but the next unhandled
 * value shouldn't cost the session either. The boundary keeps the shell and
 * its navigation on screen and offers the way out.
 */
import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  /** Remounts the boundary when this changes, so navigating away clears it. */
  resetKey: string;
  children: ReactNode;
}

export class ScreenBoundary extends Component<Props, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error("screen crashed", error, info.componentStack);
  }

  componentDidUpdate(prev: Props): void {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="card" style={{ maxWidth: 620, margin: "0 auto" }}>
        <div className="panel open">
          <p className="sectionlabel">This screen hit a problem</p>
          <p style={{ fontSize: 13, color: "var(--ink-dim)", lineHeight: 1.6 }}>
            The rest of the league is fine — your save is untouched. Pick another screen from the
            sidebar, or head back to the current stage.
          </p>
          <pre
            style={{
              margin: "14px 0 0",
              padding: 12,
              overflowX: "auto",
              fontSize: 11,
              color: "var(--ink-faint)",
              background: "var(--panel-sunken)",
              borderRadius: "var(--r-md)",
            }}
          >
            {error.message}
          </pre>
          <div className="actions" style={{ marginTop: 16 }}>
            <button
              className="btn-primary"
              onClick={() => {
                window.location.hash = "#/";
                this.setState({ error: null });
              }}
            >
              Back to the current stage
            </button>
          </div>
        </div>
      </div>
    );
  }
}
