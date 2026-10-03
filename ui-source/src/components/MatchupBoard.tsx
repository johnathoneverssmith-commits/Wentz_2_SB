import { TeamBadge } from "@/components/bits";
import { TEAMS_BY_CODE } from "@/data/teams";
import { ordinal } from "@/util/format";

import { UnitMatchups } from "./UnitMatchups";

interface Side {
  code: string;
  record: string;
  site: "home" | "away";
}

interface Metric {
  label: string;
  a: number;
  b: number;
  /** a lower number is better (ranks) */
  rank?: boolean;
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
}: {
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
          {me.site === "home" ? "Hosting" : "On the road"}
        </div>
        {sides.map(({ side, team }) => (
          <div key={side.code} className="mteam">
            <TeamBadge code={side.code} size={44} />
            <strong>{team.abbr}</strong>
            <small>
              {side.record} · {side.site}
            </small>
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
            <div key={m.label} className="mrow mgrid">
              <span className="mlabel">{m.label}</span>
              <span className={`mval ${aFav ? "fav" : ""}`}>{fmt(m.a)}</span>
              <span className={`mval ${bFav ? "fav" : ""}`}>{fmt(m.b)}</span>
            </div>
          );
        })}
      </div>

      <UnitMatchups teamCode={me.code} oppCode={them.code} />
    </div>
  );
}
