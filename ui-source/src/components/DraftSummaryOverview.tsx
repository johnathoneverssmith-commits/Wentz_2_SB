import { useMemo, useState } from "react";
import { TeamBadge } from "@/components/bits";
import { IdentityMap } from "@/components/IdentityMap";
import { TEAMS_BY_CODE } from "@/data/teams";
import type { TeamState } from "@/domain";
import { useStore } from "@/state/store";
import { unitReport } from "@/state/unitReport";
import { bestValuePicks, strengthsAndWeaknesses } from "@/state/draftSummaryView";
import { ordinal, posLabel } from "@/util/format";
import "./draft-summary.css";

type Ratings = TeamState["ratings"];
interface Row { code: string; r: Ratings }

/**
 * The summary's front page. Grades and ranks are passed in, already computed
 * by the screen from the existing evaluation, so this component only lays
 * them out. Draft grade (how the draft graded) and roster quality (how good
 * the finished roster is) are shown as two separate things on purpose.
 */
export function DraftSummaryOverview({
  rows, code, humanTeams, grade, rookie,
}: {
  rows: Row[];
  code: string | undefined;
  humanTeams: string[];
  grade: (rank: number, total: number) => string;
  rookie: boolean;
}) {
  const s = useStore();
  const total = rows.length;
  const mine = rows.find((r) => r.code === code)?.r;
  const [openTeam, setOpenTeam] = useState<string | null>(null);
  const report = useMemo(
    () => (code ? unitReport({ players: s.players, depthChart: s.depthChart, teams: s.teams } as Parameters<typeof unitReport>[0], code) : null),
    [s.players, s.depthChart, s.teams, code],
  );
  const sw = report ? strengthsAndWeaknesses(report.units) : { strengths: [], weaknesses: [] };
  const value = !rookie && code && s.draft ? bestValuePicks(s.draft.results, s.players, code) : [];
  const small = total < 32 ? ` of ${total}` : "";

  return (
    <div className="dso">
      {mine && (
        <section className="dso-hero" aria-label="Your draft result">
          <div className="dso-grade" aria-label={`Draft grade ${grade(mine.overallRank, total)}`}>
            <small>{rookie ? "Class grade" : "Draft grade"}</small>
            <b>{grade(mine.overallRank, total)}</b>
          </div>
          <dl className="dso-facts">
            <div><dt>Starting lineup rank</dt><dd>{ordinal(mine.overallRank)}{small}</dd></div>
            <div><dt>Starting lineup OVR</dt><dd>{mine.overall}</dd></div>
            <div><dt>Full roster quality</dt><dd>{mine.rosterOverall} · {ordinal(mine.rosterOverallRank)}{small}</dd></div>
          </dl>
          <p className="dso-explain">
            The <strong>draft grade</strong> comes from where your starting lineup ranks right now. <strong>Roster quality</strong> counts every player on your roster, starters and depth. They can differ: a strong lineup on a thin roster grades well here, and a deep roster can still rank lower.
          </p>
        </section>
      )}

      {report && (
        <div className="dso-cols">
          <section aria-label="Strengths">
            <h3>Strengths</h3>
            <ul>{sw.strengths.map((u) => <li key={u.key}><b>{u.label}</b> <span>{ordinal(u.rank)} of {u.teams}</span></li>)}</ul>
          </section>
          <section aria-label="Weaknesses">
            <h3>Weaknesses</h3>
            <ul>{sw.weaknesses.map((u) => <li key={u.key} className="weak"><b>{u.label}</b> <span>{ordinal(u.rank)} of {u.teams}</span></li>)}</ul>
          </section>
          {!rookie && (
            <section aria-label="Best value selections">
              <h3>Best value picks</h3>
              {value.length === 0 ? <p className="dso-muted">No pick stands out as taken later than its rating.</p> : (
                <ul>{value.map((v) => <li key={v.id}><b>{v.name}</b> <span>{posLabel(v.position as never)} · OVR {v.overall} · pick #{v.pickNumber} (rated {ordinal(v.ovrRank)} of the draft)</span></li>)}</ul>
              )}
            </section>
          )}
        </div>
      )}

      <section aria-label="Team rankings">
        <h3>Every team, ranked by starting lineup</h3>
        <ol className="dso-ranks">
          {rows.map((row, i) => {
            const open = openTeam === row.code;
            const t = TEAMS_BY_CODE[row.code];
            return (
              <li key={row.code} className={`${row.code === code ? "me " : ""}${humanTeams.includes(row.code) ? "human" : ""}`}>
                <button type="button" aria-expanded={open} aria-controls={open ? `dso-${row.code}` : undefined} onClick={() => setOpenTeam(open ? null : row.code)}>
                  <span className="n">{i + 1}</span>
                  <TeamBadge code={row.code} size={22} />
                  <span className="t">{t?.label ?? row.code}{humanTeams.includes(row.code) && <em> · GM</em>}</span>
                  <span className="g">{grade(row.r.overallRank, total)}</span>
                  <span className="o">{row.r.overall}</span>
                </button>
                {open && (
                  <dl id={`dso-${row.code}`} className="dso-detail">
                    <div><dt>Offense</dt><dd>{row.r.offense} · {ordinal(row.r.offenseRank)}</dd></div>
                    <div><dt>Defense</dt><dd>{row.r.defense} · {ordinal(row.r.defenseRank)}</dd></div>
                    <div><dt>Special teams</dt><dd>{row.r.specialTeams} · {ordinal(row.r.specialTeamsRank)}</dd></div>
                    <div><dt>Full roster</dt><dd>{row.r.rosterOverall} · {ordinal(row.r.rosterOverallRank)}</dd></div>
                  </dl>
                )}
              </li>
            );
          })}
        </ol>
      </section>

      {code && (
        <details className="dso-method">
          <summary>Methodology and full numbers</summary>
          <p className="dso-muted">Each dot is a team, coloured by what its GM prioritizes. People sit in one group; their identity is private.</p>
          <IdentityMap code={code} />
        </details>
      )}
    </div>
  );
}
