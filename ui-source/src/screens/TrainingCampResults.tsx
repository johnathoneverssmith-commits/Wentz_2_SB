import { useMemo, useState } from "react";

import { Card, CardHeader, Footer, Ticker } from "@/components/primitives";
import { TEAMS_BY_CODE } from "@/data/teams";
import { POSITIONS } from "@/domain";
import { FOCUS_LABEL, planFor } from "@/state/trainingCamp";
import { viewerTeamCode } from "@/state/selectors";
import { useStore } from "@/state/store";
import { useLeagueActions } from "@/state/useLeagueActions";
import { millions } from "@/util/format";

/**
 * What camp did to the roster.
 *
 * Every player, grouped by position, with what he was and what he is now. The
 * delta is the point of the screen, so it is what gets the colour: a gain in
 * the positive colour with a plus, a loss in the negative one, and a player
 * who held steady as a plain 0 rather than a blank — "nothing happened" is a
 * real result and worth saying, because a missing row reads like a bug.
 *
 * The investments are shown as confirmation only. Camp never resolves an
 * event; the money bought odds for a season that has not started.
 */
const GROUPS: { label: string; positions: string[] }[] = [
  { label: "Offense", positions: ["QB", "RB", "WR", "TE", "OT", "OG", "C"] },
  { label: "Defense", positions: ["EDGE", "DT", "ILB", "OLB", "CB", "S"] },
  { label: "Special teams", positions: ["K", "P"] },
];

export function TrainingCampResults() {
  const s = useStore();
  const actions = useLeagueActions();
  const code = viewerTeamCode(s);
  const [busy, setBusy] = useState(false);

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
      </Card>
    );
  }

  return (
    <Card maxWidth={860}>
      <CardHeader
        badge={TEAMS_BY_CODE[code]!.abbr}
        title="Training Camp Results"
        subtitle={`${s.season} · ${improved} improved, ${declined} declined`}
      />
      <Ticker
        stats={[
          { label: "Improved", value: improved, className: "good" },
          { label: "Declined", value: declined, className: declined > 0 ? "bad" : undefined },
          { label: "Unchanged", value: results.length - improved - declined },
          {
            label: "Invested",
            value: millions(
              Math.round(((plan?.positiveInvestment ?? 0) + (plan?.negativeInvestment ?? 0)) * 10) / 10,
            ),
            className: "sm",
          },
        ]}
      />

      <div className="panel open">
        <div className="notice" role="status">
          <strong>Camp is done.</strong> You concentrated on{" "}
          {plan?.offensiveFocus ? FOCUS_LABEL[plan.offensiveFocus] : "—"} and{" "}
          {plan?.defensiveFocus ? FOCUS_LABEL[plan.defensiveFocus] : "—"}, and put{" "}
          {millions(plan?.positiveInvestment ?? 0)} toward good things and{" "}
          {millions(plan?.negativeInvestment ?? 0)} against bad ones. Those odds apply all season —
          nothing has been rolled yet.
        </div>

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
                      <th className="c" style={{ width: 52 }}>Was</th>
                      <th className="c" style={{ width: 62 }}>Change</th>
                      <th className="c" style={{ width: 52 }}>Now</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(({ p, r }) => (
                      <tr key={p.id}>
                        <td style={{ color: "var(--ink-faint)" }}>{p.position}</td>
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
        <button
          type="button"
          className="btn-primary"
          disabled={busy}
          onClick={() => {
            if (!confirm("Advance to the depth chart? You can't return to camp.")) return;
            setBusy(true);
            void actions.readyUp(true).finally(() => setBusy(false));
          }}
        >
          Advance to Re-order Depth Chart
        </button>
      </Footer>
    </Card>
  );
}
