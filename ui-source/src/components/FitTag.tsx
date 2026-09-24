import type { Fit } from "@/state/unitReport";

/** What a candidate adds to your starting units, as the engine reads them. */
export function FitTag({ fit }: { fit: Fit }) {
  const color = fit.tone === "good" ? "var(--good)" : fit.tone === "neutral" ? "var(--ink-dim)" : "var(--ink-faint)";
  return (
    <span
      title={`Adds ${fit.gain.toFixed(2)} weighted unit points to your starters`}
      style={{
        fontSize: 10.5,
        fontWeight: 600,
        color,
        border: `1px solid ${color}`,
        borderRadius: 999,
        padding: "1px 7px",
        marginLeft: 8,
        whiteSpace: "nowrap",
        verticalAlign: "middle",
      }}
    >
      {fit.label}
    </span>
  );
}
