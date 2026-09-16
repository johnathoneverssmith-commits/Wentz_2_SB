import { useState } from "react";

import { Card, CardHeader, Footer, Ticker } from "@/components/primitives";
import { TEAMS_BY_CODE } from "@/data/teams";
import { COACH_POSITION_GROUPS } from "@/domain";
import { ratingOf } from "@/state/coachingDraft";
import {
  checkCampSubmission,
  DEFENSIVE_FOCUSES,
  FOCUS_LABEL,
  focusStrength,
  oddsMultiplier,
  OFFENSIVE_FOCUSES,
  type DefensiveFocus,
  type OffensiveFocus,
} from "@/state/trainingCamp";
import { viewerTeamCode } from "@/state/selectors";
import { useStore } from "@/state/store";
import { useLeagueActions } from "@/state/useLeagueActions";
import { millions } from "@/util/format";

/**
 * Two choices and two numbers, all four irreversible.
 *
 * The focuses are the interesting decision: a coordinator's attention makes
 * one group develop faster and decline slower for a season, and you get one
 * on each side of the ball. Picking is mandatory because declining to choose
 * would be strictly worse than any choice — there is no "spread it evenly"
 * option that would make abstaining sensible.
 *
 * The money is the other kind of decision. It comes off the cap permanently
 * and buys odds rather than outcomes, so it can never guarantee a good season
 * — which is why the screen shows the multiplier it buys rather than implying
 * a promise.
 */
export function TrainingCamp() {
  const s = useStore();
  const actions = useLeagueActions();
  const code = viewerTeamCode(s);

  const [offensiveFocus, setOffensive] = useState<OffensiveFocus | null>(null);
  const [defensiveFocus, setDefensive] = useState<DefensiveFocus | null>(null);
  const [positive, setPositive] = useState("0");
  const [negative, setNegative] = useState("0");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!code) {
    return (
      <Card>
        <CardHeader badge="TC" title="Training Camp" subtitle="No team" />
        <div className="panel open">
          <div className="emptystate">Pick a team first.</div>
        </div>
      </Card>
    );
  }

  const team = s.teams[code]!;
  const room = Math.round((team.cap.total - team.cap.used) * 10) / 10;
  const plan = {
    offensiveFocus,
    defensiveFocus,
    positiveInvestment: Number(positive),
    negativeInvestment: Number(negative),
    submitted: false,
  };
  const check = checkCampSubmission(s, code, plan);

  const coordinator = (role: "OC" | "DC"): number => {
    const c = Object.values(s.coaches).find((x) => x.team === code && x.role === role);
    return c ? ratingOf(c) : 72;
  };
  const offStrength = focusStrength(coordinator("OC"));
  const defStrength = focusStrength(coordinator("DC"));

  const submit = (): void => {
    setBusy(true);
    setError(null);
    void actions
      .submitTrainingCamp(plan)
      .then((res) => {
        if (!res.ok) setError(res.reason ?? "Camp didn't run.");
      })
      .finally(() => setBusy(false));
  };

  return (
    <Card maxWidth={820}>
      <CardHeader
        badge={TEAMS_BY_CODE[code]!.abbr}
        title="Training Camp"
        subtitle={`${s.season} · set your focuses and your budget`}
      />
      <Ticker
        stats={[
          { label: "Cap space", value: millions(room) },
          { label: "OC focus worth", value: `+${Math.round(offStrength * 100)}%`, className: "sm" },
          { label: "DC focus worth", value: `+${Math.round(defStrength * 100)}%`, className: "sm" },
          {
            label: "Spending",
            value: millions(Math.round((Number(positive) + Number(negative)) * 10) / 10),
            className: "sm",
          },
        ]}
      />

      {error && (
        <div className="notice bad" role="status">
          {error}
        </div>
      )}

      <div className="panel open">
        <p className="subhead" style={{ marginTop: 0 }}>
          Offensive focus
        </p>
        <p style={{ margin: "0 0 10px", fontSize: 11.5, color: "var(--ink-faint)" }}>
          Your coordinator concentrates on one group all camp. They develop{" "}
          {Math.round(offStrength * 100)}% harder and decline {Math.round(offStrength * 100)}% less
          this season.
        </p>
        <div className="rolefilter">
          {OFFENSIVE_FOCUSES.map((f) => (
            <button
              key={f}
              type="button"
              className={offensiveFocus === f ? "active" : ""}
              onClick={() => setOffensive(f)}
            >
              {FOCUS_LABEL[f]}
            </button>
          ))}
        </div>
        <p style={{ margin: "0 0 18px", fontSize: 11, color: "var(--ink-faint)" }}>
          {offensiveFocus
            ? `Covers ${COACH_POSITION_GROUPS[offensiveFocus].join(", ")}.`
            : "Pick one — it can't be left unselected."}
        </p>

        <p className="subhead">Defensive focus</p>
        <div className="rolefilter">
          {DEFENSIVE_FOCUSES.map((f) => (
            <button
              key={f}
              type="button"
              className={defensiveFocus === f ? "active" : ""}
              onClick={() => setDefensive(f)}
            >
              {FOCUS_LABEL[f]}
            </button>
          ))}
        </div>
        <p style={{ margin: "0 0 18px", fontSize: 11, color: "var(--ink-faint)" }}>
          {defensiveFocus
            ? `Covers ${COACH_POSITION_GROUPS[defensiveFocus].join(", ")}.`
            : "Pick one — it can't be left unselected."}
        </p>

        <p className="subhead">Season investments</p>
        <p style={{ margin: "0 0 12px", fontSize: 11.5, color: "var(--ink-faint)", lineHeight: 1.6 }}>
          Money spent here comes off your cap for the season and doesn&rsquo;t come back. It shifts
          the odds of things going your way — it can never guarantee a good season or rule out a
          bad one. Both can stay at 0.
        </p>
        <div className="lobby-form inline">
          <label>
            <span>Toward good things ($M)</span>
            <input
              type="number"
              min={0}
              step={0.1}
              value={positive}
              onChange={(e) => setPositive(e.target.value)}
            />
          </label>
          <label>
            <span>Against bad things ($M)</span>
            <input
              type="number"
              min={0}
              step={0.1}
              value={negative}
              onChange={(e) => setNegative(e.target.value)}
            />
          </label>
        </div>
        <p style={{ margin: "10px 0 0", fontSize: 11.5, color: "var(--ink-dim)" }}>
          Good events ×{oddsMultiplier(Number(positive) || 0).toFixed(2)} · bad events ÷
          {oddsMultiplier(Number(negative) || 0).toFixed(2)} on the odds.
        </p>

        {!check.ok && (
          <p style={{ margin: "12px 0 0", fontSize: 11.5, color: "var(--bad)" }}>{check.reason}</p>
        )}
      </div>

      <Footer>
        <span style={{ flex: 1, fontSize: 11.5, color: "var(--ink-faint)", alignSelf: "center" }}>
          Submitting runs camp and spends the money. None of it can be undone.
        </span>
        <button type="button" className="btn-primary" disabled={!check.ok || busy} onClick={submit}>
          {busy ? "Running camp…" : "Advance to End of Training Camp"}
        </button>
      </Footer>
    </Card>
  );
}
