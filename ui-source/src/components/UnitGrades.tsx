import { useMemo } from "react";

import { OvrPill } from "@/components/bits";
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

const gradeColor = (g: string): string =>
  g.startsWith("A") ? "var(--good)" : g === "D" || g === "F" ? "var(--bad)" : "var(--ink)";

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

  return (
    <div>
      <p className="sectionlabel" style={{ marginBottom: 4 }}>
        Unit grades
      </p>
      <p style={{ margin: "0 0 14px", fontSize: 11, color: "var(--ink-faint)" }}>
        Games are decided unit against unit. Each grade ranks your starters as a group against the
        league, and a group plays closer to its weakest starter than its average.
      </p>

      <div role="table" aria-label="Unit grades">
        {rows.map((u) => (
          <div
            key={u.key}
            role="row"
            style={{
              display: "grid",
              gridTemplateColumns: "34px 1fr auto",
              alignItems: "center",
              gap: 12,
              padding: "9px 4px",
              borderBottom: "1px solid var(--line)",
              opacity: u.weight < 0.05 ? 0.6 : 1,
            }}
          >
            <span
              className="oswald"
              role="cell"
              aria-label={`Grade ${u.grade}`}
              style={{ fontSize: 18, fontWeight: 600, color: gradeColor(u.grade), textAlign: "center" }}
            >
              {u.grade}
            </span>
            <div role="cell" style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>
                {u.label}
                <span style={{ fontWeight: 400, fontSize: 11, color: "var(--ink-faint)", marginLeft: 8 }}>
                  {ordinal(u.rank)} of {u.teams}
                  {u.weight < 0.05 ? " · little effect on games" : ""}
                </span>
              </div>
              <div style={{ fontSize: 11, color: "var(--ink-dim)", marginTop: 3, display: "flex", flexWrap: "wrap", gap: "2px 10px" }}>
                {u.starters.map((p, i) => (
                  <span
                    key={`${p.id ?? "v"}-${i}`}
                    style={u.weakLink && p === u.weakLink ? { color: "var(--bad)", fontWeight: 600 } : undefined}
                  >
                    {p.name} {p.overall}
                  </span>
                ))}
              </div>
              {u.weakLink && (
                <div style={{ fontSize: 11, color: "var(--bad)", marginTop: 2 }}>
                  Weak link: {u.weakLink.id ? u.weakLink.name : `no starting ${u.weakLink.position}`}
                </div>
              )}
            </div>
            <span role="cell">
              <OvrPill value={Math.round(u.strength)} />
            </span>
          </div>
        ))}
        <div
          role="row"
          style={{ display: "grid", gridTemplateColumns: "34px 1fr auto", alignItems: "center", gap: 12, padding: "9px 4px" }}
        >
          <span
            className="oswald"
            role="cell"
            style={{ fontSize: 18, fontWeight: 600, color: gradeColor(report.pairing.grade), textAlign: "center" }}
          >
            {report.pairing.grade}
          </span>
          <div role="cell">
            <div style={{ fontSize: 13, fontWeight: 600 }}>
              QB–WR1 connection
              <span style={{ fontWeight: 400, fontSize: 11, color: "var(--ink-faint)", marginLeft: 8 }}>
                {ordinal(report.pairing.rank)} of {rows[0]?.teams ?? 32}
              </span>
            </div>
            <div style={{ fontSize: 11, color: "var(--ink-dim)", marginTop: 3 }}>
              {report.pairing.qb?.name ?? "No QB"} → {report.pairing.wr?.name ?? "no WR"} · each caps the other
            </div>
          </div>
          <span role="cell">
            <OvrPill value={report.pairing.value} />
          </span>
        </div>
      </div>

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
  const who = low.id ? `${low.name} (${low.overall})` : `an empty ${low.position} spot`;
  return u.upgradeRank < u.rank
    ? `Replacing ${who} with an 80 would lift this unit from ${ordinal(u.rank)} to ${ordinal(u.upgradeRank)} in the league.`
    : `Replacing ${who} with an 80 would firm up the weakest spot in this unit.`;
}

function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${s}`;
}
