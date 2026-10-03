import { useMemo } from "react";
import { displaySeason } from "@/state/stageMachine";
import { useNavigate } from "react-router-dom";

import { Card, CardHeader, Footer, Ticker } from "@/components/primitives";
import { ReadinessGate } from "@/components/ReadinessGate";
import { TEAMS_BY_CODE } from "@/data/teams";
import { POSITIONS } from "@/domain";
import { FOCUS_LABEL, planFor } from "@/state/trainingCamp";
import { viewerTeamCode } from "@/state/selectors";
import { useStore } from "@/state/store";
import { posLabel } from "@/util/format";

/**
 * What camp did to the roster.
 *
 * Every player, grouped by position, with what he was and what he is now. The
 * delta is the point of the screen, so it is what gets the colour: a gain in
 * the positive colour with a plus, a loss in the negative one, and a player
 * who held steady as a plain 0 rather than a blank — "nothing happened" is a
 * real result and worth saying, because a missing row reads like a bug.
 */
const GROUPS: { label: string; positions: string[] }[] = [
  { label: "Offense", positions: ["QB", "RB", "WR", "TE", "OT", "OG", "C"] },
  { label: "Defense", positions: ["EDGE", "DT", "ILB", "OLB", "CB", "S"] },
  { label: "Special teams", positions: ["K", "P"] },
];

export function TrainingCampResults() {
  const s = useStore();
  const nav = useNavigate();
  const code = viewerTeamCode(s);

  const results = code ? (s.trainingCamp?.results[code] ?? []) : [];
  const plan = code ? planFor(s, code) : null;

  const byId = useMemo(() => new Map(results.map((r) => [r.playerId, r])), [results]);
  const improved = results.filter((r) => r.delta > 0).length;
  const declined = results.filter((r) => r.delta < 0).length;

  if (!code || results.length === 0) {
    return (
      <Card>
        <CardHeader badge="TC" title="Training Camp Results" subtitle="Nothing to show" />
        <div className="panel open">
          <div className="emptystate">Camp hasn&rsquo;t run yet.</div>
        </div>
        {/* a dead end otherwise: this screen is reachable by URL or a stale tab */}
        <Footer>
          <button type="button" className="btnlink" onClick={() => nav("/hub")}>
            Team hub
          </button>
          {s.stage === "trainingCamp" && (
            <button type="button" className="btn-primary" onClick={() => nav("/training-camp")}>
              Set up camp
            </button>
          )}
        </Footer>
      </Card>
    );
  }

  return (
    <Card maxWidth={860}>
      <CardHeader
        badge={TEAMS_BY_CODE[code]!.abbr}
        title="Training Camp Results"
        subtitle={`${displaySeason(s)} · ${improved} improved, ${declined} declined`}
      />
      <Ticker
        stats={[
          { label: "Improved", value: improved, className: "good" },
          { label: "Declined", value: declined, className: declined > 0 ? "bad" : undefined },
          { label: "Unchanged", value: results.length - improved - declined },
        ]}
      />

      <div className="panel open">
        <div className="notice" role="status">
          <strong>Camp is done.</strong> You concentrated on{" "}
          {plan?.offensiveFocus ? FOCUS_LABEL[plan.offensiveFocus] : "—"} and{" "}
          {plan?.defensiveFocus ? FOCUS_LABEL[plan.defensiveFocus] : "—"}.{" "}
          <strong>The change shown is the whole offseason&rsquo;s</strong> — a year of progression or decline for
          every player, with your camp focus and coaches shaping it — not just what happened in camp.
        </div>
        <details style={{ margin: "10px 0 16px", fontSize: 12.5, color: "var(--ink-dim)" }}>
          <summary style={{ cursor: "pointer", color: "var(--ink)" }}>How progression and regression work</summary>
          <ol style={{ margin: "8px 0 0", paddingLeft: 20, lineHeight: 1.55 }}>
            <li>
              <strong>Age and potential set the baseline.</strong> Each player has an age where he stops developing and
              one where he starts to decline. Before the first he tends to improve, faster the more room he has left
              under his potential; after the second he tends to slip. It&rsquo;s a tendency, not a promise — a player
              can land a point or two either side of it.
            </li>
            <li>
              <strong>The league keeps its balance.</strong> The baseline is nudged by position so no group of players
              steadily inflates or collapses across the league.
            </li>
            <li>
              <strong>Your position coach moves it.</strong> A good coach for that group adds to development and
              softens regression; a poor one does the opposite. His effect is shown on the Coaching Staff screen.
            </li>
            <li>
              <strong>Your coordinators&rsquo; focus amplifies it.</strong> Players in the offensive and defensive
              groups you chose develop harder and decline less, by an amount set by the coordinator&rsquo;s rating. A
              focused player always moves at least a point if his baseline moved.
            </li>
            <li>
              The result is capped between 0 and 99, and the same league always gives the same result for the same
              choices — reloading doesn&rsquo;t reroll it.
            </li>
          </ol>
        </details>

        {GROUPS.map((group) => {
          const rows = group.positions
            .flatMap((pos) =>
              Object.values(s.players)
                .filter(
                  (p) => p.nfl_team === code && !p.retired && !p.free_agent && p.position === pos,
                )
                .map((p) => ({ p, r: byId.get(p.id) }))
                .filter((x) => x.r),
            )
            .sort(
              (a, b) =>
                POSITIONS.indexOf(a.p.position) - POSITIONS.indexOf(b.p.position) ||
                b.p.overall - a.p.overall,
            );
          if (rows.length === 0) return null;

          return (
            <div key={group.label} style={{ marginBottom: 18 }}>
              <p className="subhead">{group.label}</p>
              <div style={{ overflowX: "auto" }}>
                <table className="stbl">
                  <thead>
                    <tr>
                      <th style={{ width: 46 }}>Pos</th>
                      <th>Player</th>
                      <th className="c" style={{ width: 62 }}>Last year</th>
                      <th className="c" style={{ width: 82 }}>Offseason change</th>
                      <th className="c" style={{ width: 52 }}>Now</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(({ p, r }) => (
                      <tr key={p.id}>
                        <td style={{ color: "var(--ink-faint)" }}>{posLabel(p.position)}</td>
                        <td className="name">{p.name}</td>
                        <td className="c" style={{ color: "var(--ink-dim)" }}>{r!.previous}</td>
                        <td
                          className="c"
                          style={{
                            fontWeight: 700,
                            color:
                              r!.delta > 0
                                ? "var(--good)"
                                : r!.delta < 0
                                  ? "var(--bad)"
                                  : "var(--ink-faint)",
                          }}
                        >
                          {r!.delta > 0 ? `+${r!.delta}` : r!.delta < 0 ? `${r!.delta}` : "0"}
                        </td>
                        <td className="c" style={{ fontWeight: 600 }}>{r!.next}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}
      </div>

      <Footer>
        <span style={{ flex: 1, fontSize: 11.5, color: "var(--ink-faint)", alignSelf: "center" }}>
          Advancing is final — you can&rsquo;t come back to camp.
        </span>
      </Footer>
      {/* the stage is still trainingCamp here (results is a step inside it),
          so its label would read "Advance to End of Training Camp" */}
      <ReadinessGate
        title="Camp results readiness"
        label="Advance to Re-order Depth Chart"
        onAdvance={(r) => nav(r)}
      />
    </Card>
  );
}
