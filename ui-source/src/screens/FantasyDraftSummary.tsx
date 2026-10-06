import { useMemo, useState } from "react";
import { IdentityMap } from "@/components/IdentityMap";
import { displaySeason } from "@/state/stageMachine";
import { useNavigate } from "react-router-dom";

import { GradePill, TeamBadge } from "@/components/bits";
import { Card, CardHeader, Footer, Panel, Tabs, Ticker, useTabs } from "@/components/primitives";
import { ReadinessGate } from "@/components/ReadinessGate";
import { TEAMS_BY_CODE } from "@/data/teams";
import { useStore } from "@/state/store";
import { RosterByPosition } from "@/components/RosterByPosition";
import { viewerTeamCode } from "@/state/selectors";
import { ordinal, posLabel } from "@/util/format";
import { isHumansOnly } from "@/state/leagueFormat";

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

/**
 * How everybody's draft graded out.
 *
 * Change 13 reuses this for the rookie draft, which is the same screen with
 * a different title and a different thing on the far side of the button —
 * the league-wide comparison table, the per-GM tabs and the NFL roster tab
 * are all the same question about a different draft.
 */
export function FantasyDraftSummary({
  title = "Fantasy Draft Summary",
  advanceLabel = "Advance to Coaching",
  onAdvance,
  rookie = false,
}: {
  title?: string;
  /** The rookie draft: grade the classes themselves and list your picks. */
  rookie?: boolean;
  advanceLabel?: string;
  /**
   * Overrides the default checkpoint commit, for a summary that steps this
   * GM alone into the next screen rather than holding the league at a
   * shared gate (the rookie draft summary into Rookie Signings).
   */
  /** Resolves to a reason when it couldn't advance, shown under the button. */
  onAdvance?: () => Promise<string | void>;
} = {}) {
  const nav = useNavigate();
  const [committing, setCommitting] = useState(false);
  const [advanceError, setAdvanceError] = useState<string | null>(null);
  const s = useStore();
  const code = viewerTeamCode(s);
  const humanTeams = s.gms.filter((g) => g.isHuman && g.teamCode).map((g) => g.teamCode);
  const { active, setActive } = useTabs(code ?? "league");
  const [nflTeam, setNflTeam] = useState<string>(code ?? Object.keys(s.teams)[0] ?? "KC");

  const rows = useMemo(
    () =>
      Object.values(s.teams)
        .map((t) => ({ code: t.code, r: t.ratings }))
        .sort((a, b) => a.r.overallRank - b.r.overallRank),
    [s.teams],
  );
  const total = rows.length;
  const mine = rows.find((r) => r.code === code)?.r;

  // Rookie draft: what each team took, and a grade for the class itself —
  // the roster rank the fantasy grade uses barely moves for a rookie class,
  // and a whole draft's worth of picks appeared nowhere on this screen.
  const classes = useMemo(() => {
    if (!rookie || !s.draft) return new Map<string, { round: number; pick: number; p: (typeof s.draftClass)[number] }[]>();
    const byId = new Map(s.draftClass.map((p) => [p.id, p]));
    const out = new Map<string, { round: number; pick: number; p: (typeof s.draftClass)[number] }[]>();
    s.draft.results.forEach((r, i) => {
      const p = r.selectedId ? byId.get(r.selectedId) : undefined;
      if (!p) return;
      const l = out.get(r.teamCode) ?? [];
      l.push({ round: r.round, pick: i + 1, p });
      out.set(r.teamCode, l);
    });
    return out;
  }, [rookie, s.draft, s.draftClass]);
  const classRank = useMemo(() => {
    // value over each slot, averaged: a pick is judged against what that
    // slot usually yields (the class generator's own curve), so a team that
    // simply held more picks no longer grades better than one that drafted well
    const score = (t: string) => {
      // kickers and punters come out of college graded far below the slot
      // curve, so one late specialist sank an otherwise good class to an F
      const all = classes.get(t) ?? [];
      const nonSpecialists = all.filter((x) => x.p.position !== "K" && x.p.position !== "P");
      const picks = nonSpecialists.length > 0 ? nonSpecialists : all;
      if (picks.length === 0) return -Infinity;
      return picks.reduce((n, x) => n + (x.p.collegeOverall - (92 - x.pick * 0.14)), 0) / picks.length;
    };
    return [...Object.keys(s.teams)].sort((a, b) => score(b) - score(a));
  }, [classes, s.teams]);

  return (
    <Card maxWidth={840}>
      <CardHeader
        badge={code ? TEAMS_BY_CODE[code]!.abbr : "FS"}
        title={title}
        subtitle={`${displaySeason(s)} · how every team's draft graded out`}
      />
      <Ticker
        stats={[
          { label: "Starting lineup overall", value: mine?.overall ?? "—" },
          // "of 4" in a small league: "3rd" alone reads like the top tenth
          { label: "Starting lineup rank", value: mine ? `${ordinal(mine.overallRank)}${total < 32 ? ` of ${total}` : ""}` : "—", className: "accent" },
          { label: "Full roster overall", value: mine ? `${mine.rosterOverall} (${ordinal(mine.rosterOverallRank)}${total < 32 ? ` of ${total}` : ""})` : "—", className: "sm" },
          {
            label: rookie ? "Class grade" : "Draft grade",
            value: rookie
              ? code && classes.size
                ? grade(classRank.indexOf(code) + 1, total)
                : "—"
              : mine
                ? grade(mine.overallRank, total)
                : "—",
          },
        ]}
      />

      <Tabs
        tabs={[
          // your own team's tab first, then the other GMs'
          ...[...humanTeams].sort((a, b) => Number(b === code) - Number(a === code)).map((t) => ({
            id: t,
            // another GM's team reads as theirs, not as a bare team code
            label:
              t === code
                ? "Your Team"
                : `${s.gms.find((g) => g.teamCode === t)?.name ?? "GM"} · ${TEAMS_BY_CODE[t]?.abbr ?? t}`,
          })),
          { id: "league", label: "Every Team" },
          { id: "nfl", label: isHumansOnly(s) ? "Any Team" : "NFL" },
        ]}
        active={active}
        onChange={setActive}
        label="Draft summary"
      />

      {humanTeams.map((t) => (
        <Panel key={t} id={t} open={active === t}>
          {rookie && (classes.get(t)?.length ?? 0) > 0 && (
            <div style={{ marginBottom: 18 }}>
              <p className="subhead" style={{ marginTop: 0 }}>
                Draft class ({classes.get(t)!.length}) · grade {grade(classRank.indexOf(t) + 1, total)}
              </p>
              <table className="stbl">
                <thead>
                  <tr>
                    <th>Pick</th>
                    <th>Player</th>
                    <th className="c">Pos</th>
                    <th className="c">College Grade</th>
                  </tr>
                </thead>
                <tbody>
                  {classes.get(t)!.map((x) => (
                    <tr key={x.p.id}>
                      <td>
                        R{x.round} · #{x.pick}
                      </td>
                      <td>
                        {x.p.name}
                        <span style={{ display: "block", fontSize: 10.5, color: "var(--ink-faint)" }}>{x.p.school}</span>
                      </td>
                      <td className="c">{posLabel(x.p.position)}</td>
                      <td className="c"><GradePill value={x.p.collegeOverall} short /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <RosterByPosition teamCode={t} detailed />
        </Panel>
      ))}

      <Panel id="nfl" open={active === "nfl"}>
        <label className="lobby-form inline" style={{ marginBottom: 14 }}>
          <span>Team</span>
          <select value={nflTeam} onChange={(e) => setNflTeam(e.target.value)}>
            {Object.keys(s.teams)
              .sort((a, b) =>
                (TEAMS_BY_CODE[a]?.label ?? a).localeCompare(TEAMS_BY_CODE[b]?.label ?? b),
              )
              .map((t) => (
                <option key={t} value={t}>
                  {TEAMS_BY_CODE[t]?.label ?? t}
                </option>
              ))}
          </select>
        </label>
        <RosterByPosition teamCode={nflTeam} />
      </Panel>

      <Panel id="league" open={active === "league"}>
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

            <p className="subhead">How every team was built</p>
            <p style={{ margin: "-6px 0 10px", fontSize: 11.5, color: "var(--ink-faint)" }}>
              Each dot is a team, coloured by what its GM prioritizes. Below, each identity&rsquo;s teams ranked against each other, with the
              units that group built stronger than the league. People sit in one group; their identity is private.
            </p>
            <IdentityMap code={code} />
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
      </Panel>

      <Footer bordered={false}>
        <span style={{ flex: 1, fontSize: 11, color: "var(--ink-faint)", textAlign: "center" }}>
          {rookie
            ? "Next: sign your draft class, then free agency."
            : "Advancing takes every team into the coaching hiring window."}
        </span>
      </Footer>

      <Footer>
        <span style={{ flex: 1, fontSize: 11.5, color: "var(--ink-faint)", alignSelf: "center" }}>
          Take as long as you like. Advancing is final — you can&rsquo;t come back to this summary.
        </span>
        {onAdvance && (
          <button
            type="button"
            className="btn-primary"
            disabled={committing}
            onClick={() => {
              if (!confirm(`${advanceLabel}? You can't return to this summary.`)) return;
              setCommitting(true);
              setAdvanceError(null);
              void onAdvance()
                .then((reason) => setAdvanceError(reason ?? null))
                .finally(() => setCommitting(false));
            }}
          >
            {committing ? "Advancing…" : advanceLabel}
          </button>
        )}
      </Footer>
      {advanceError && (
        <p className="form-error" role="status" style={{ margin: "0 26px 12px", textAlign: "right" }}>
          {advanceError}
        </p>
      )}

      {!onAdvance && (
        <ReadinessGate title="Draft summary readiness" label={advanceLabel} onAdvance={(r) => nav(r)} />
      )}
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
