import { useMemo, useState } from "react";
import { useLeagueActions } from "@/state/useLeagueActions";
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
  const actions = useLeagueActions();
  const [note, setNote] = useState<Record<string, string>>({});
  // an extended player stops expiring, so his row disappeared the moment it
  // worked — with nothing to say it had
  const [done, setDone] = useState<string[]>([]);
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
  if (expiring.length === 0 && done.length === 0) return null;
  const shown = expiring.slice(0, 5);

  return (
    <div className="notice" role="status" style={{ marginBottom: 16 }}>
      {done.map((line) => (
        <p key={line} style={{ margin: "0 0 8px", fontSize: 12, color: "var(--good)" }}>
          {line}
        </p>
      ))}
      {expiring.length > 0 && (
        <>
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
                  {p.position} · age {p.age} · asking {millions(extensionAsk(p).baseSalary)}/yr × {extensionAsk(p).years}
                </span>
                {note[p.id] ? (
                  <span style={{ color: "var(--ink-dim)" }}>{note[p.id]}</span>
                ) : (
                  <button
                    type="button"
                    className="btn-ghost"
                    style={{ fontSize: 11, padding: "3px 8px", marginLeft: "auto" }}
                    // five identical "Extend at his ask" buttons, to a screen reader
                    aria-label={`Extend ${p.name} at his ask`}
                    onClick={() => {
                      const ask = extensionAsk(p);
                      // years of money in one click: say how much first
                      if (
                        !confirm(
                          `Extend ${p.name} for ${ask.years} more year${ask.years === 1 ? "" : "s"} at ${millions(ask.baseSalary)}/yr (${millions(Math.round(ask.baseSalary * ask.years * 10) / 10)} in all)?`,
                        )
                      ) {
                        return;
                      }
                      void actions.extend(p.id, ask).then((r) => {
                        setNote((n) => ({ ...n, [p.id]: r.ok ? "Extended" : (r.reason ?? "He turned it down.") }));
                        if (r.ok) {
                          setDone((d) => [
                            ...d,
                            `${p.name} extended: ${ask.years} more year${ask.years === 1 ? "" : "s"} at ${millions(ask.baseSalary)}/yr.`,
                          ]);
                        }
                      });
                    }}
                  >
                    Extend at his ask
                  </button>
                )}
              </div>
            ))}
            {expiring.length > shown.length && (
              <span style={{ fontSize: 11, color: "var(--ink-faint)" }}>and {expiring.length - shown.length} more</span>
            )}
          </div>
        </>
      )}
      <button className="btn-ghost" style={{ marginTop: 10, fontSize: 11.5 }} onClick={() => nav("/roster")}>
        Extend on Roster &amp; Cap
      </button>
    </div>
  );
}
