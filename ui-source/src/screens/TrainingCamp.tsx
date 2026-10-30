import { stepOf } from "@/state/reveal";
import { DecisionError } from "@/components/decisions/DecisionWorkspace";
import { useRef, useState } from "react";
import { displaySeason } from "@/state/stageMachine";
import { useNavigate } from "react-router-dom";

import { Card, CardHeader, Footer, Ticker } from "@/components/primitives";
import { TEAMS_BY_CODE } from "@/data/teams";
import { COACH_POSITION_GROUPS } from "@/domain";
import { ratingOf } from "@/state/coachingDraft";
import {
  checkCampSubmission,
  DEFENSIVE_FOCUSES,
  FOCUS_LABEL,
  focusStrength,
  OFFENSIVE_FOCUSES,
  type DefensiveFocus,
  type OffensiveFocus,
} from "@/state/trainingCamp";
import { teamRoster, viewerTeamCode } from "@/state/selectors";
import { useStore } from "@/state/store";
import { useLeagueActions } from "@/state/useLeagueActions";
import { count } from "@/util/format";

/**
 * Two choices and two numbers, all four irreversible.
 *
 * The focuses are the interesting decision: a coordinator's attention makes
 * one group develop faster and decline slower for a season, and you get one
 * on each side of the ball. Picking is mandatory because declining to choose
 * would be strictly worse than any choice — there is no "spread it evenly"
 * option that would make abstaining sensible.
 *
 */
export function TrainingCamp() {
  const nav = useNavigate();
  const s = useStore();
  const actions = useLeagueActions();
  const code = viewerTeamCode(s);

  const [offensiveFocus, setOffensive] = useState<OffensiveFocus | null>(null);
  const [defensiveFocus, setDefensive] = useState<DefensiveFocus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const acting = useRef(false);
  const visitResults = async (): Promise<void> => {
    const current = useStore.getState();
    // Reopening an old camp is read-only. Never overwrite a later personal step.
    if (current.stage === "trainingCamp" && stepOf(current,current.viewerGmId) !== "trainingCampResults") {
      const res = await actions.stepForward("trainingCampResults");
      if (!res.ok) { setError(res.reason ?? "Camp ran, but the results step could not be saved. Try opening your results again."); return; }
    }
    nav("/training-camp-results");
  };
  const openResults = async (): Promise<void> => {
    if (acting.current) return;
    acting.current = true; setBusy(true); setError(null);
    try { await visitResults(); }
    catch (err) { setError(err instanceof Error ? err.message : "Results could not be opened. Try again."); }
    finally { acting.current = false; setBusy(false); }
  };

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

  // This GM's own camp already ran — most often a refresh or a reconnect
  // after a successful submission that never got acknowledged locally, or a
  // league saved before this screen learned to move on by itself. Camp is
  // not resubmittable (the server rejects a second run outright), so there
  // is nothing to do here but go see the result that already exists.
  if (s.trainingCamp?.plans[code]?.submitted) {
    return (
      <Card>
        <CardHeader badge="TC" title="Training Camp" subtitle="Already run" />
        <div className="panel open">
          <div className="emptystate">You already ran camp this season. Opening results will not run it again.</div>
          <DecisionError message={error}/>
        </div>
        <Footer>
          <button type="button" className="btn-primary" disabled={busy} onClick={() => void openResults()}>
            See Your Results
          </button>
        </Footer>
      </Card>
    );
  }

  const plan = {
    offensiveFocus,
    defensiveFocus,
    submitted: false,
  };
  const check = checkCampSubmission(plan);

  const coordinator = (role: "OC" | "DC"): number => {
    const c = Object.values(s.coaches).find((x) => x.team === code && x.role === role);
    return c ? ratingOf(c) : 72;
  };
  const offStrength = focusStrength(coordinator("OC"));
  const defStrength = focusStrength(coordinator("DC"));
  // something to choose on: who in each group is still growing and who is
  // on the way down — the focus does most for those two
  const roster = teamRoster(s, code);
  const groupNote = (f: OffensiveFocus | DefensiveFocus): string => {
    const inGroup = roster.filter((p) => (COACH_POSITION_GROUPS[f] as readonly string[]).includes(p.position));
    const young = inGroup.filter((p) => p.age <= 25).length;
    const vets = inGroup.filter((p) => p.age >= 30).length;
    // the size first: "1 young · 0 vets" on its own read as a one-man line
    return `${count(inGroup.length, "player")} · ${young} young · ${vets} vet${vets === 1 ? "" : "s"}`;
  };

  const submit = async (): Promise<void> => {
    if (acting.current) return;
    acting.current = true; setBusy(true); setError(null);
    try {
      const res = await actions.submitTrainingCamp(plan);
      if (!res.ok) { setError(res.reason ?? "Camp didn't run."); return; }
      // A saved camp and a saved personal step are separate acknowledgements.
      // Keep the recoverable already-run screen if opening results is refused.
      await visitResults();
    } catch (err) { setError(err instanceof Error ? err.message : "Camp could not be completed. Check your connection and try again."); }
    finally { acting.current = false; setBusy(false); }
  };

  return (
    <Card maxWidth={820}>
      <CardHeader
        badge={TEAMS_BY_CODE[code]!.abbr}
        title="Training Camp"
        subtitle={`${displaySeason(s)} · set your focuses`}
      />
      <Ticker
        stats={[
          { label: "OC base focus", value: `+${Math.round(offStrength * 100)}%` },
          { label: "DC base focus", value: `+${Math.round(defStrength * 100)}%`, className: "sm" },
        ]}
      />

      <DecisionError message={error}/>

      <div className="panel open camp-focus">
        <p className="notice">Coordinator numbers below are base strengths. Repeating the same focus in consecutive seasons reduces its effect; choosing a different group avoids that repeat reduction.</p>
        <p className="subhead" style={{ marginTop: 0 }}>
          Offensive focus
        </p>
        <p style={{ margin: "0 0 10px", fontSize: 11.5, color: "var(--ink-faint)" }}>
          Before repeat reductions, your coordinator concentrates on one group all camp. They develop{" "}
          {Math.round(offStrength * 100)}% harder and decline {Math.round(offStrength * 100)}% less
          this season.
        </p>
        <div className="rolefilter">
          {OFFENSIVE_FOCUSES.map((f) => (
            <button
              key={f}
              type="button"
              className={offensiveFocus === f ? "active" : ""}
              aria-pressed={offensiveFocus === f}
              onClick={() => setOffensive(f)}
            >
              {FOCUS_LABEL[f]}
              <span style={{ display: "block", fontSize: 10, opacity: 0.7 }}>{groupNote(f)}</span>
            </button>
          ))}
        </div>
        <p style={{ margin: "0 0 18px", fontSize: 11, color: "var(--ink-faint)" }}>
          {offensiveFocus
            ? `Covers ${COACH_POSITION_GROUPS[offensiveFocus].join(", ")}.`
            : "Pick one — it can't be left unselected."}
        </p>

        <p className="subhead">Defensive focus</p>
        <p style={{ margin: "0 0 10px", fontSize: 11.5, color: "var(--ink-faint)" }}>
          Before repeat reductions, your defensive coordinator does the same for one group: {Math.round(defStrength * 100)}% harder
          development and {Math.round(defStrength * 100)}% less decline.
        </p>
        <div className="rolefilter">
          {DEFENSIVE_FOCUSES.map((f) => (
            <button
              key={f}
              type="button"
              className={defensiveFocus === f ? "active" : ""}
              aria-pressed={defensiveFocus === f}
              onClick={() => setDefensive(f)}
            >
              {FOCUS_LABEL[f]}
              <span style={{ display: "block", fontSize: 10, opacity: 0.7 }}>{groupNote(f)}</span>
            </button>
          ))}
        </div>
        <p style={{ margin: "0 0 18px", fontSize: 11, color: "var(--ink-faint)" }}>
          {defensiveFocus
            ? `Covers ${COACH_POSITION_GROUPS[defensiveFocus].join(", ")}.`
            : "Pick one — it can't be left unselected."}
        </p>

        {!check.ok && (
          <p style={{ margin: "12px 0 0", fontSize: 11.5, color: "var(--bad)" }}>{check.reason}</p>
        )}
      </div>

      <Footer>
        <span style={{ flex: 1, fontSize: 11.5, color: "var(--ink-faint)", alignSelf: "center" }}>
          Submitting runs camp. It can't be undone.
        </span>
        <button type="button" className="btn-primary" disabled={!check.ok || busy} onClick={submit}>
          {busy ? "Running camp…" : "Advance to End of Training Camp"}
        </button>
      </Footer>
    </Card>
  );
}
