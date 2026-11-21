import { engineLabel, engineOf } from "@/sim/engineMode";
import { browserName, isVerifiedBrowser } from "@/sim/engineWorker";
import { useStore } from "@/state/store";

/**
 * Which simulator this dynasty is played on, always visible in League Settings. Chosen when the dynasty is created and
 * fixed afterwards; for a dynasty on the browser engine it also names the build, and for Firefox and Safari it says the
 * browser has not been checked.
 */
export function SimulatorStatus() {
  const mode = useStore((s) => engineOf(s));
  const version = useStore((s) => s.simEngineVersion);
  const verified = isVerifiedBrowser();
  const browser = browserName();
  return (
    <div data-testid="simulator-status">
      <strong>
        {mode === "engine" ? "Full game engine (runs in your browser)" : mode === "mock" ? engineLabel("mock") : engineLabel(undefined)}
      </strong>
      {mode === "engine" && version && (
        <span style={{ marginLeft: 8, opacity: 0.75 }}>
          build <code>{version.slice(0, 8)}</code>
        </span>
      )}
      {mode === "engine" && !verified && (
        <p role="note" style={{ margin: "6px 0 0", fontSize: 12.5 }}>
          You&rsquo;re on {browser}. This alpha is checked on Chrome and Edge; {browser} should work but is unverified.
        </p>
      )}
    </div>
  );
}
