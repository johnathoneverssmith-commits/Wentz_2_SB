import { useState } from "react";

import { useStore } from "@/state/store";
import { useLeagueActions } from "@/state/useLeagueActions";

const COPY = {
  freeAgency: {
    label: "Skip free agency",
    hint: "Your own turns are passed for you. Everyone else still plays it.",
  },
  tradeDeadline: {
    label: "Skip the trade deadline",
    hint: "Your own turns are passed for you. Offers other teams make to you still come through and wait for your answer.",
  },
} as const;

/**
 * "Sit this stage out": the GM's own steps in it are passed automatically.
 *
 * It is a choice about *this GM alone* — the rest of the league plays on — and
 * it stays until it is switched off, so a GM who never wants the deadline sets
 * it once.
 */
export function SkipToggle({ kind }: { kind: "freeAgency" | "tradeDeadline" }) {
  const actions = useLeagueActions();
  const on = useStore((s) => !!s.gms.find((g) => g.id === s.viewerGmId)?.skips?.[kind]);
  const [busy, setBusy] = useState(false);
  const copy = COPY[kind];
  return (
    <label
      className="notice"
      style={{ display: "flex", gap: 10, alignItems: "flex-start", cursor: busy ? "wait" : "pointer", margin: "8px 0" }}
    >
      <input
        type="checkbox"
        checked={on}
        disabled={busy}
        style={{ marginTop: 3 }}
        onChange={(e) => {
          setBusy(true);
          void actions.setSkip(kind, e.target.checked).finally(() => setBusy(false));
        }}
      />
      <span>
        <strong>{copy.label}</strong>
        <span style={{ display: "block", fontSize: 12, color: "var(--ink-dim)" }}>{copy.hint}</span>
      </span>
    </label>
  );
}
