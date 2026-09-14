import { useMemo } from "react";
import { useNavigate } from "react-router-dom";

import { TeamBadge } from "@/components/bits";
import { Card, CardHeader, Footer, Ticker } from "@/components/primitives";
import { ReadinessGate } from "@/components/ReadinessGate";
import { TEAMS_BY_CODE } from "@/data/teams";
import { useStore } from "@/state/store";
import { viewerTeamCode } from "@/state/selectors";
import { ordinal } from "@/util/format";

/** Starting-lineup overall rank (1 = best) → letter grade. */
function grade(rank: number, total: number): string {
  const pct = (rank - 1) / Math.max(1, total - 1); // 0 = best
  if (pct <= 0.1) return "A+";
  if (pct <= 0.2) return "A";
  if (pct <= 0.35) return "B+";
  if (pct <= 0.5) return "B";
  if (pct <= 0.65) return "C+";
  if (pct <= 0.8) return "C";
  if (pct <= 0.92) return "D";
  return "F";
}

export function FantasyDraftSummary() {
  const nav = useNavigate();
  const s = useStore();
  const code = viewerTeamCode(s);

  const rows = useMemo(
    () =>
      Object.values(s.teams)
        .map((t) => ({ code: t.code, r: t.ratings }))
        .sort((a, b) => a.r.overallRank - b.r.overallRank),
    [s.teams],
  );
  const total = rows.length;
  const mine = rows.find((r) => r.code === code)?.r;
  const maxStart = Math.max(...rows.map((r) => r.r.overall));
  const minStart = Math.min(...rows.map((r) => r.r.overall));

  return (
    <Card maxWidth={840}>
      <CardHeader
        badge={code ? TEAMS_BY_CODE[code]!.abbr : "FS"}
        title="Fantasy Draft Summary"
        subtitle={`${s.season} · how every team's draft graded out`}
      />
      <Ticker
        stats={[
          { label: "Starting lineup overall", value: mine?.overall ?? "—" },
          { label: "Starting lineup rank", value: mine ? ordinal(mine.overallRank) : "—", className: "accent" },
          { label: "Full roster overall", value: mine ? `${mine.rosterOverall} (${ordinal(mine.rosterOverallRank)})` : "—", className: "sm" },
          { label: "Draft grade", value: mine ? grade(mine.overallRank, total) : "—" },
        ]}
      />

      <div className="panel open">
        {mine && (
          <>
            <p className="subhead" style={{ marginTop: 0 }}>
              Your team — the numbers that matter
            </p>
            <div className="split-3" style={{ gap: 10, marginBottom: 8 }}>
              <UnitStat label="Starting offense" value={mine.offense} rank={mine.offenseRank} />
              <UnitStat label="Starting defense" value={mine.defense} rank={mine.defenseRank} />
              <UnitStat label="Starting special teams" value={mine.specialTeams} rank={mine.specialTeamsRank} />
            </div>

            <p className="subhead">Starting lineup overall — league</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 16 }}>
              {rows.map((row) => {
                const pct =
                  maxStart === minStart ? 100 : ((row.r.overall - minStart) / (maxStart - minStart)) * 100;
                const isMine = row.code === code;
                return (
                  <div key={row.code} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ width: 34, fontSize: 11, color: "var(--ink-faint)", textAlign: "right" }}>
                      {TEAMS_BY_CODE[row.code]!.abbr}
                    </span>
                    <div style={{ flex: 1, height: 12, background: "var(--panel-sunken)", borderRadius: 3, overflow: "hidden" }}>
                      <div
                        style={{
                          height: "100%",
                          width: `${Math.max(4, pct)}%`,
                          background: isMine ? "var(--team)" : "var(--panel-raised)",
                          borderRadius: 3,
                        }}
                      />
                    </div>
                    <span className="oswald" style={{ width: 26, fontSize: 12, fontWeight: 600, color: isMine ? "var(--team)" : "var(--ink-dim)" }}>
                      {row.r.overall}
                    </span>
                  </div>
                );
              })}
            </div>
          </>
        )}

        <p className="subhead">Every team</p>
        <div className="scroll-list short" style={{ overflowX: "auto" }}>
          <table className="stbl">
            <thead>
              <tr>
                <th style={{ width: 22 }} />
                <th>Team</th>
                <th className="c">Start OVR</th>
                <th className="c">Off</th>
                <th className="c">Def</th>
                <th className="c">ST</th>
                <th className="c">Roster</th>
                <th className="c">Grade</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={row.code} className={row.code === code ? "highlight" : ""}>
                  <td style={{ color: "var(--ink-faint)" }}>{i + 1}</td>
                  <td>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                      <TeamBadge code={row.code} size={20} />
                      {TEAMS_BY_CODE[row.code]!.label}
                    </span>
                  </td>
                  <td className="c" style={{ fontWeight: 600, color: "var(--ink)" }}>{row.r.overall}</td>
                  <td className="c">{ordinal(row.r.offenseRank)}</td>
                  <td className="c">{ordinal(row.r.defenseRank)}</td>
                  <td className="c">{ordinal(row.r.specialTeamsRank)}</td>
                  <td className="c">{row.r.rosterOverall}</td>
                  <td className="c" style={{ fontWeight: 700, color: i < total * 0.3 ? "var(--good)" : i < total * 0.75 ? "var(--ink)" : "var(--ink-faint)" }}>
                    {grade(row.r.overallRank, total)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Footer bordered={false}>
        <span style={{ flex: 1, fontSize: 11, color: "var(--ink-faint)", textAlign: "center" }}>
          Advancing takes every team into the coaching hiring window.
        </span>
      </Footer>

      <ReadinessGate title="Fantasy draft summary readiness" onAdvance={(r) => nav(r)} />
    </Card>
  );
}

function UnitStat({ label, value, rank }: { label: string; value: number; rank: number }) {
  return (
    <div style={{ background: "var(--panel-sunken)", border: "1px solid var(--line)", borderRadius: "var(--r-md)", padding: "12px 14px" }}>
      <p style={{ margin: 0, fontSize: 10.5, color: "var(--ink-faint)" }}>{label}</p>
      <p className="oswald" style={{ margin: "4px 0 0", fontSize: 18, fontWeight: 600 }}>
        {value} <span style={{ fontSize: 12, color: "var(--ink-dim)", fontWeight: 400 }}>· {ordinal(rank)}</span>
      </p>
    </div>
  );
}
