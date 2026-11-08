import { stepOf } from "@/state/reveal";
import { DecisionError } from "@/components/decisions/DecisionWorkspace";
import { useRef, useState } from "react";
import { displaySeason } from "@/state/stageMachine";
import { useNavigate } from "react-router-dom";

import { Footer, Ticker } from "@/components/primitives";
import { StagePage } from "@/components/stages/StagePage";
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
      <StagePage code={null} kicker="Training Camp" heading="No team" sub="Pick a team first.">
        <div className="emptystate">Pick a team first.</div>
      </StagePage>
    );
  }

  // This GM's own camp already ran — most often a refresh or a reconnect
  // after a successful submission that never got acknowledged locally, or a
  // league saved before this screen learned to move on by itself. Camp is
  // not resubmittable (the server rejects a second run outright), so there
  // is nothing to do here but go see the result that already exists.
  if (s.trainingCamp?.plans[code]?.submitted) {
    return (
      <StagePage code={code} kicker="Training Camp" sub="Already run">
        <div className="emptystate">You already ran camp this season. Opening results will not run it again.</div>
        <DecisionError message={error}/>
        <Footer>
          <button type="button" className="btn-primary" disabled={busy} onClick={() => void openResults()}>
            See Your Results
          </button>
        </Footer>
      </StagePage>
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

  const picker = (
    label: string,
    blurb: string,
    focuses: readonly (OffensiveFocus | DefensiveFocus)[],
    chosen: OffensiveFocus | DefensiveFocus | null,
    choose: (f: never) => void,
  ) => (
    <section className="stage-block">
      <h2 className="stage-h">{label}</h2>
      <p className="stage-text">{blurb}</p>
      <div className="rolefilter stage-picks">
        {focuses.map((f) => (
          <button
            key={f}
            type="button"
            className={chosen === f ? "active" : ""}
            aria-pressed={chosen === f}
            onClick={() => choose(f as never)}
          >
            {FOCUS_LABEL[f]}
            <span className="stage-pick-note">{groupNote(f)}</span>
          </button>
        ))}
      </div>
      <p className="stage-note">
        {chosen ? `Covers ${COACH_POSITION_GROUPS[chosen].join(", ")}.` : "Pick one — it can't be left unselected."}
      </p>
    </section>
  );

  return (
    <StagePage code={code} kicker="Training Camp" sub={`${displaySeason(s)} · set your focuses`}>
      <Ticker
        stats={[
          { label: "OC base focus", value: `+${Math.round(offStrength * 100)}%` },
          { label: "DC base focus", value: `+${Math.round(defStrength * 100)}%`, className: "sm" },
        ]}
      />

      <DecisionError message={error}/>

      <div className="stage-body camp-focus">
        <p className="notice">Coordinator numbers below are base strengths. Repeating the same focus in consecutive seasons reduces its effect; choosing a different group avoids that repeat reduction.</p>
        {picker(
          "Offensive focus",
          `Before repeat reductions, your coordinator concentrates on one group all camp. They develop ${Math.round(offStrength * 100)}% harder and decline ${Math.round(offStrength * 100)}% less this season.`,
          OFFENSIVE_FOCUSES,
          offensiveFocus,
          setOffensive,
        )}
        {picker(
          "Defensive focus",
          `Before repeat reductions, your defensive coordinator does the same for one group: ${Math.round(defStrength * 100)}% harder development and ${Math.round(defStrength * 100)}% less decline.`,
          DEFENSIVE_FOCUSES,
          defensiveFocus,
          setDefensive,
        )}

        {!check.ok && <p className="stage-note stage-note--bad">{check.reason}</p>}
      </div>

      <Footer>
        <span className="stage-foot-note">Submitting runs camp. It can't be undone.</span>
        <button type="button" className="btn-primary" disabled={!check.ok || busy} onClick={submit}>
          {busy ? "Running camp…" : "Advance to End of Training Camp"}
        </button>
      </Footer>
    </StagePage>
  );
}
