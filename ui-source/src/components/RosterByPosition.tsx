import { useMemo } from "react";

import { TEAMS_BY_CODE } from "@/data/teams";
import { POSITIONS } from "@/domain";
import { useStore } from "@/state/store";

/**
 * A roster the way a depth chart reads: grouped by position, best first.
 *
 * Two callers want this and want slightly different things from it. The NFL
 * tab wants the plain version — position, name, age, rating — because it is
 * there so a GM can look up what somebody else ended up with. A GM's own team
 * gets `detailed`, which adds the contract, because on your own roster the
 * money is part of what you are looking at.
 *
 * Grouped rather than one long list on purpose: a roster sorted by rating
 * answers "who is my best player", which nobody is asking here. Sorted by
 * position it answers "what did I actually end up with at receiver", which is
 * the question a draft leaves you with.
 */
const GROUPS: { label: string; positions: string[] }[] = [
  { label: "Offense", positions: ["QB", "RB", "WR", "TE", "OT", "OG", "C"] },
  { label: "Defense", positions: ["EDGE", "DT", "ILB", "OLB", "CB", "S"] },
  { label: "Special teams", positions: ["K", "P"] },
];

export function RosterByPosition({
  teamCode,
  detailed = false,
}: {
  teamCode: string;
  detailed?: boolean;
}) {
  const players = useStore((s) => s.players);

  const roster = useMemo(
    () =>
      Object.values(players)
        .filter((p) => p.nfl_team === teamCode && !p.retired && !p.free_agent)
        .sort(
          (a, b) =>
            POSITIONS.indexOf(a.position) - POSITIONS.indexOf(b.position) ||
            b.overall - a.overall,
        ),
    [players, teamCode],
  );

  if (roster.length === 0) {
    return <div className="emptystate">No roster to show for {TEAMS_BY_CODE[teamCode]?.label ?? teamCode}.</div>;
  }

  return (
    <>
      <p className="subhead" style={{ marginTop: 0 }}>
        {TEAMS_BY_CODE[teamCode]?.label ?? teamCode} · {roster.length} players
      </p>

      {GROUPS.map((group) => {
        const inGroup = group.positions
          .map((pos) => ({ pos, men: roster.filter((p) => p.position === pos) }))
          .filter((g) => g.men.length > 0);
        if (inGroup.length === 0) return null;

        return (
          <div key={group.label} style={{ marginBottom: 18 }}>
            <p
              style={{
                margin: "0 0 8px",
                fontSize: 10.5,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                color: "var(--ink-faint)",
                fontWeight: 700,
              }}
            >
              {group.label}
            </p>
            <div style={{ overflowX: "auto" }}>
              <table className="stbl">
                <thead>
                  <tr>
                    <th style={{ width: 46 }}>Pos</th>
                    <th>Player</th>
                    <th className="c" style={{ width: 46 }}>
                      Age
                    </th>
                    <th className="c" style={{ width: 52 }}>
                      OVR
                    </th>
                    {detailed && <th className="c">Contract</th>}
                  </tr>
                </thead>
                <tbody>
                  {inGroup.flatMap(({ pos, men }) =>
                    men.map((p, i) => (
                      <tr key={p.id}>
                        <td style={{ color: i === 0 ? "var(--ink)" : "var(--ink-faint)", fontWeight: i === 0 ? 600 : 400 }}>
                          {pos}
                        </td>
                        <td className="name">{p.name}</td>
                        <td className="c">{p.age}</td>
                        <td className="c" style={{ fontWeight: 600 }}>
                          {p.overall}
                        </td>
                        {detailed && (
                          <td className="c" style={{ fontSize: 11.5, color: "var(--ink-dim)" }}>
                            {p.contract
                              ? `${p.contract.years_remaining}y · $${(p.contract.cap_hit_by_year[0] ?? 0).toFixed(1)}M`
                              : "—"}
                          </td>
                        )}
                      </tr>
                    )),
                  )}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </>
  );
}
