import { useMemo } from "react";
import { useNavigate } from "react-router-dom";

import { OvrPill } from "@/components/bits";
import { extensionAsk } from "@/state/contracts";
import { useStore } from "@/state/store";
import { millions } from "@/util/format";

/**
 * Who walks at the end of this season unless the GM acts.
 *
 * A deal that runs out sends the player to the open market the moment the
 * season is finalized, and nothing said so: a GM who never opened Roster &
 * Cap lost his starters one contract year at a time. The CPU teams re-sign
 * their core (`resignAiCore`); this is the same information for the human,
 * with the price each player is asking, while there is still time to act.
 */
export function ExpiringContracts({ teamCode }: { teamCode: string }) {
  const nav = useNavigate();
  const players = useStore((s) => s.players);
  const expiring = useMemo(
    () =>
      Object.values(players)
        .filter(
          (p) =>
            p.nfl_team === teamCode &&
            !p.retired &&
            !p.free_agent &&
            p.contract &&
            p.contract.years_remaining <= 1 &&
            p.overall >= 70,
        )
        .sort((a, b) => b.overall - a.overall),
    [players, teamCode],
  );
  if (expiring.length === 0) return null;
  const shown = expiring.slice(0, 5);

  return (
    <div className="notice" role="status" style={{ marginBottom: 16 }}>
      <strong>
        {expiring.length === 1 ? "1 contract expires" : `${expiring.length} contracts expire`} after this season.
      </strong>{" "}
      Anyone not extended by then goes to free agency.
      <div style={{ display: "grid", gap: 6, marginTop: 10 }}>
        {shown.map((p) => (
          <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12 }}>
            <OvrPill value={p.overall} />
            <span style={{ fontWeight: 600 }}>{p.name}</span>
            <span style={{ color: "var(--ink-faint)" }}>
              {p.position} · age {p.age} · asking {millions(extensionAsk(p).baseSalary)}/yr
            </span>
          </div>
        ))}
        {expiring.length > shown.length && (
          <span style={{ fontSize: 11, color: "var(--ink-faint)" }}>and {expiring.length - shown.length} more</span>
        )}
      </div>
      <button className="btn-ghost" style={{ marginTop: 10, fontSize: 11.5 }} onClick={() => nav("/roster")}>
        Extend on Roster &amp; Cap
      </button>
    </div>
  );
}
