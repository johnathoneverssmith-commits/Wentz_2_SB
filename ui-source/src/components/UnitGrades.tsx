import { posLabel } from "@/util/format";
import { useMemo, useState } from "react";
import type { Position } from "@/domain";
import "./unit-cards.css";

import { useStore } from "@/state/store";
import { unitReport, type UnitRow } from "@/state/unitReport";

/**
 * Offense first, then defense — the order a depth chart reads in. Outside
 * linebacker is left out: it is not a lineup slot in the engine, so every
 * team's would read "vacant" and first in the league.
 */
const ORDER = [
  "quarterback",
  "receivers",
  "runningBack",
  "tightEnd",
  "offensiveLine",
  "passRush",
  "interior",
  "linebackers",
  "corners",
  "safeties",
];

/**
 * The roster as the game engine reads it: unit by unit. A great unit with
 * one weak starter plays closer to that starter than its average says, and
 * two strong units that work together (a quarterback and his receiver, the
 * line and the back) are worth more than the ratings add up to.
 */
export function UnitGrades({ teamCode }: { teamCode: string }) {
  const players = useStore((s) => s.players);
  const depthChart = useStore((s) => s.depthChart);
  const teams = useStore((s) => s.teams);
  const report = useMemo(
    () => unitReport({ players, depthChart, teams } as Parameters<typeof unitReport>[0], teamCode),
    [players, depthChart, teams, teamCode],
  );
  const rows = ORDER.map((k) => report.units.find((u) => u.key === k)).filter((u): u is UnitRow => !!u);
  const top = report.priorities.slice(0, 3);
  const [open, setOpen] = useState<string | null>(null);
  /** Reserves behind the starters at the unit's positions, straight from the depth chart. */
  const depthFor = (u: UnitRow): { id: string; name: string; position: string; overall: number }[] => {
    const starterIds = new Set(u.starters.map((p) => p.id).filter(Boolean));
    const seen = new Set<string>();
    const out: { id: string; name: string; position: string; overall: number }[] = [];
    for (const pos of new Set(u.starters.map((p) => p.position))) {
      for (const id of depthChart?.[teamCode]?.[pos as Position] ?? []) {
        const p = players[id];
        if (!p || starterIds.has(id) || seen.has(id) || p.nfl_team !== teamCode) continue;
        seen.add(id);
        out.push({ id, name: p.name, position: p.position, overall: p.overall });
      }
    }
    return out.slice(0, 6);
  };

  return (
    <div className="unit-cards">
      <p className="sectionlabel" style={{ marginBottom: 4 }}>
        Unit scorecards
      </p>
      <p className="unit-cards-note">
        Games are decided unit against unit. Each card ranks your starters as a group against the
        league, and a group plays closer to its weakest starter than its average.
      </p>

      <ul className="unit-grid" aria-label="Unit scorecards">
        {rows.map((u) => {
          const expanded = open === u.key;
          const depth = expanded ? depthFor(u) : [];
          return (
            <li key={u.key} className={`unit-card${u.weight < 0.05 ? " minor" : ""}${expanded ? " open" : ""}`}>
              <div className="unit-card-top">
                <span className="unit-name">{u.label}</span>
                <span className={`unit-grade g-${u.grade.charAt(0)}`} aria-label={`Grade ${u.grade}`}>{u.grade}</span>
              </div>
              <div className="unit-card-num">
                <b>{Math.round(u.strength)}</b>
                <span>rating</span>
              </div>
              <div className="unit-card-rank">
                <b>{ordinal(u.rank)}</b> of {u.teams} teams
                {u.weight < 0.05 ? <em> · little effect on games</em> : null}
              </div>
              {u.weakLink && (
                <div className="unit-card-weak">
                  Weak link: {u.weakLink.id ? `${u.weakLink.name} (${u.weakLink.overall})` : `no starting ${posLabel(u.weakLink.position)}`}
                </div>
              )}
              <button
                type="button"
                className="unit-card-toggle"
                aria-expanded={expanded}
                aria-controls={`unit-detail-${u.key}`}
                onClick={() => setOpen(expanded ? null : u.key)}
              >
                {expanded ? "Hide starters & depth" : "Starters & depth"}
              </button>
              {expanded && (
                <div id={`unit-detail-${u.key}`} className="unit-card-detail">
                  <table>
                    <caption className="sr-only">{u.label} starters and depth</caption>
                    <thead><tr><th scope="col">Player</th><th scope="col">Pos</th><th scope="col">OVR</th><th scope="col">Role</th></tr></thead>
                    <tbody>
                      {u.starters.map((p, i) => (
                        <tr key={`${p.id ?? "v"}-${i}`} className={u.weakLink && p === u.weakLink ? "weak" : undefined}>
                          <td>{p.id ? p.name : "Vacant"}</td><td>{posLabel(p.position)}</td><td>{p.id ? p.overall : "—"}</td><td>Starter</td>
                        </tr>
                      ))}
                      {depth.map((p) => (
                        <tr key={p.id}><td>{p.name}</td><td>{posLabel(p.position)}</td><td>{p.overall}</td><td>Depth</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </li>
          );
        })}
        <li className="unit-card pair">
          <div className="unit-card-top">
            <span className="unit-name">QB–WR1 connection</span>
            <span className={`unit-grade g-${report.pairing.grade.charAt(0)}`} aria-label={`Grade ${report.pairing.grade}`}>{report.pairing.grade}</span>
          </div>
          <div className="unit-card-num"><b>{report.pairing.value}</b><span>rating</span></div>
          <div className="unit-card-rank"><b>{ordinal(report.pairing.rank)}</b> of {rows[0]?.teams ?? 32} teams</div>
          <div className="unit-card-weak" style={{ color: "var(--ink-dim)" }}>
            {report.pairing.qb?.name ?? "No QB"} → {report.pairing.wr?.name ?? "no WR"} · each caps the other
          </div>
        </li>
      </ul>

      {top.length > 0 && (
        <>
          <p className="sectionlabel" style={{ margin: "20px 0 8px" }}>
            Where an upgrade pays most
          </p>
          {top.map((u) => (
            <div
              key={u.key}
              style={{
                display: "flex",
                gap: 12,
                padding: "10px 4px 10px 14px",
                borderLeft: "2px solid var(--accent, var(--good))",
                marginBottom: 8,
                background: "var(--panel-sunken)",
                borderRadius: "0 var(--r-sm) var(--r-sm) 0",
              }}
            >
              <span style={{ fontSize: 13, fontWeight: 600, minWidth: 130 }}>{u.label}</span>
              <span style={{ fontSize: 12, color: "var(--ink-dim)" }}>
                {upgradeReason(u)}
              </span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

function upgradeReason(u: UnitRow): string {
  const low = u.starters.reduce((a, b) => (b.overall < a.overall ? b : a));
  const who = low.id ? `${low.name} (${low.overall})` : `an empty ${posLabel(low.position)} spot`;
  return u.upgradeRank < u.rank
    ? `Replacing ${who} with an 80 would lift this unit from ${ordinal(u.rank)} to ${ordinal(u.upgradeRank)} in the league.`
    : `Replacing ${who} with an 80 would firm up the weakest spot in this unit.`;
}

function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${s}`;
}
