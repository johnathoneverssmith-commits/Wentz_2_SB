import { TeamBadge } from "@/components/bits";
import { GmLine } from "./GmIdentity";
import { TEAMS_BY_CODE } from "@/data/teams";
import { ordinal } from "@/util/format";

import { UnitMatchups } from "./UnitMatchups";

interface Side {
  code: string;
  record: string;
  site: "home" | "away" | "neutral";
}

/** One figure under a unit's rank: the value for each team, and where it ranks in the league. */
export interface SubMetric {
  label: string;
  a: number | null;
  b: number | null;
  aRank?: number | null;
  bRank?: number | null;
  /** which way is better, so the favoured side can be marked */
  better: "high" | "low";
  fmt: (n: number) => string;
  /** says what the figure is, when the label can't */
  hint?: string;
}

interface Metric {
  label: string;
  a: number;
  b: number;
  /** a lower number is better (ranks) */
  rank?: boolean;
  /** the figures behind this rank, shown indented beneath it */
  subs?: SubMetric[];
}

/**
 * This week's game on one grid: the two teams across the top, and every
 * number below sits directly under the team it belongs to. The favoured side
 * of each row is marked, the win probability is a bar rather than a pair of
 * numbers in a corner, and the unit matchups share the same columns.
 */
export function MatchupBoard({
  when,
  me,
  them,
  winProb,
  metrics,
  note,
  names,
}: {
  /** Replaces "Hosting" / "On the road" under the round or week. */
  note?: string | undefined;
  /** Both teams' names, for a game that isn't the viewer's: "ATL pass rush", not "your". */
  names?: [string, string];
  when: string;
  me: Side;
  them: Side;
  winProb: number;
  metrics: Metric[];
}) {
  const mine = TEAMS_BY_CODE[me.code]!;
  const theirs = TEAMS_BY_CODE[them.code]!;
  const sides = [
    { side: me, team: mine },
    { side: them, team: theirs },
  ];
  return (
    <div>
      <div className="mhead mgrid">
        <div className="mwhen">
          <b>{when}</b>
          {note ?? (me.site === "home" ? "Hosting" : me.site === "away" ? "On the road" : "Neutral site")}
        </div>
        {sides.map(({ side, team }) => (
          <div key={side.code} className="mteam">
            <TeamBadge code={side.code} size={44} />
            <strong>{team.abbr}</strong>
            <small>
              {side.record} · {side.site}
            </small>
            <GmLine code={side.code} style={{ display: "block", marginTop: 2 }} />
          </div>
        ))}
      </div>

      <div className="mbar" role="img" aria-label={`${mine.abbr} ${winProb}%, ${theirs.abbr} ${100 - winProb}%`}>
        <span style={{ width: `${winProb}%`, background: mine.color }} />
        <span style={{ width: `${100 - winProb}%`, background: theirs.color, opacity: 0.85 }} />
      </div>
      <div className="mbarlabels">
        <span>
          <span className="oswald">{winProb}%</span> {mine.abbr}
        </span>
        <span>win probability</span>
        <span>
          {theirs.abbr} <span className="oswald">{100 - winProb}%</span>
        </span>
      </div>

      <div className="msection" style={{ marginTop: 14 }}>
        How they compare
      </div>
      <div>
        {metrics.map((m) => {
          const aFav = m.rank ? m.a < m.b : m.a > m.b;
          const bFav = m.rank ? m.b < m.a : m.b > m.a;
          const fmt = (n: number) => (m.rank ? ordinal(n) : String(n));
          return (
            <div key={m.label}>
              <div className="mrow mgrid">
                <span className="mlabel">{m.label}</span>
                <span className={`mval ${aFav ? "fav" : ""}`}>{fmt(m.a)}</span>
                <span className={`mval ${bFav ? "fav" : ""}`}>{fmt(m.b)}</span>
              </div>
              {m.subs?.map((x) => {
                const both = x.a !== null && x.b !== null;
                const aWins = both && (x.better === "high" ? x.a! > x.b! : x.a! < x.b!);
                const bWins = both && (x.better === "high" ? x.b! > x.a! : x.b! < x.a!);
                const cell = (v: number | null, rank: number | null | undefined, win: boolean) => (
                  <span className={`mval msubval ${win ? "fav" : ""}`}>
                    {v === null ? "—" : x.fmt(v)}
                    {v !== null && rank != null && <small>{ordinal(rank)}</small>}
                  </span>
                );
                return (
                  <div key={x.label} className="mrow msub mgrid" title={x.hint}>
                    <span className="mlabel">{x.label}</span>
                    {cell(x.a, x.aRank, aWins)}
                    {cell(x.b, x.bRank, bWins)}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      <UnitMatchups teamCode={me.code} oppCode={them.code} {...(names ? { names } : {})} />
    </div>
  );
}
