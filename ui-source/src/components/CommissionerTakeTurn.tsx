import { useState } from "react";

import { TEAMS_BY_CODE } from "@/data/teams";
import { onlineSession } from "@/state/online";
import { useStore } from "@/state/store";
import { useLeagueActions } from "@/state/useLeagueActions";

/**
 * The commissioner's lever on a turn another GM is sitting on.
 *
 * A draft, a market or the deadline waits on whoever is on the clock, for as
 * long as a turn's clock runs — twelve hours by default, every turn. The only
 * control was forcing the whole stage past, which took everybody's remaining
 * turns too. This takes just the one turn, the way the clock would.
 */
export function CommissionerTakeTurn({ team }: { team: string | null | undefined }) {
  const actions = useLeagueActions();
  const gms = useStore((s) => s.gms);
  const viewer = useStore((s) => s.viewerGmId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const holder = team ? gms.find((g) => g.isHuman && g.teamCode === team) : undefined;
  if (!actions.online || !onlineSession()?.isCommissioner || !holder || holder.id === viewer) return null;
  const name = TEAMS_BY_CODE[team!]?.label ?? team;
  return (
    // a span, so it can sit inside the screens' own paragraphs
    <span style={{ display: "block", margin: "6px 0 0", fontSize: 12 }}>
      <button
        type="button"
        className="btnlink"
        disabled={busy}
        onClick={() => {
          if (!confirm(`Have ${name}'s staff take this turn for ${holder.name}? It's what their clock running out would do.`)) return;
          setBusy(true);
          setError(null);
          void actions
            .takeTurnForAbsent()
            .then((r) => {
              if (!r.ok) setError(r.reason ?? "Couldn't take the turn.");
            })
            .finally(() => setBusy(false));
        }}
      >
        {busy ? "Taking the turn…" : `Commissioner: have ${name}'s staff take this turn`}
      </button>
      {error && <span className="form-error" style={{ display: "block" }}>{error}</span>}
    </span>
  );
}
