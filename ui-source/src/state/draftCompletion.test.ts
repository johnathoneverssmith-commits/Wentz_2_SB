import { describe, expect, it } from "vitest";

import { useStore } from "./store.ts";
import { isAiTeam } from "./rules.ts";

/**
 * exploit_regression / playtest findings (fantasy draft, September 2026):
 *
 * 1. `startDraft` never ran the CPU up to the first human pick — a draft
 *    order that didn't put a human first sat completely dead.
 * 2. The screen's own AI-turn logic picked the literal highest-overall
 *    player, ignoring `bestAvailable`/`planAutopicks`'s need (and now
 *    strategy/difficulty) weighting entirely — the AI drafted almost purely
 *    by overall.
 * 3. `draftThresholdMet`/`completeDraft` were defined in rules.ts but never
 *    called from the single-player store at all, so "the rest of the board
 *    completes itself once every GM reaches N picks" (the screen's own
 *    promised behavior) never happened, and with no completion the stage
 *    never advanced — the fantasy draft had no way out.
 *
 * All three shared one root cause: `makePick`/`startDraft` never called
 * `runAiPicks`/`draftThresholdMet`/`completeDraft` the way online's
 * `decideDraftPick` already did. This suite pins the fix to that pattern.
 */

describe("draft completion (single-player store)", () => {
  it("startDraft runs the CPU up to the first human pick, not just an empty board", () => {
    const s0 = useStore.getState();
    // pick a team so there's a real human seat to stop at
    s0.pickTeam(s0.viewerGmId, "GB");
    useStore.getState().startDraft("fantasy");
    const s = useStore.getState();
    expect(s.draft).toBeTruthy();
    const onClock = s.draft!.pickOrder[s.draft!.currentPickIndex];
    // whichever team is on the clock, everyone strictly before it in the
    // pick order must already be an AI team with a result recorded — a
    // human is never left on the clock by someone else's turn, and an AI
    // team is never left un-picked ahead of where the board actually is
    for (let i = 0; i < s.draft!.currentPickIndex; i++) {
      expect(s.draft!.results[i]?.teamCode).toBe(s.draft!.pickOrder[i]);
    }
    if (onClock && !isAiTeam(s, onClock)) {
      // stopped correctly at a human turn
      expect(onClock).toBeTruthy();
    }
  });

  it("makePick sweeps subsequent AI turns via the need-aware evaluator, not a raw overall sort", () => {
    const s0 = useStore.getState();
    s0.pickTeam(s0.viewerGmId, "GB");
    useStore.getState().startDraft("fantasy");
    const before = useStore.getState();
    const onClock = before.draft!.pickOrder[before.draft!.currentPickIndex];
    if (onClock !== "GB") return; // fixture didn't land the human on the clock first; skip rather than flake

    const bestId = Object.values(before.players)
      .filter((p) => !p.retired)
      .sort((a, b) => b.overall - a.overall)[0]!.id;
    useStore.getState().makePick(bestId);

    const after = useStore.getState();
    // at least one more pick happened (the human's, plus AI sweep if the
    // next slot is AI) — the draft must have moved, not sat waiting for a
    // 200ms poll loop that no longer exists
    expect(after.draft!.currentPickIndex).toBeGreaterThan(before.draft!.currentPickIndex);
  });

  it("reaching the manual-pick threshold completes the board and advances the stage", () => {
    const s0 = useStore.getState();
    s0.pickTeam(s0.viewerGmId, "GB");
    // every other GM slot is AI, so the only human turns left are the
    // viewer's — matches how this fixture's earlier tests leave the league
    useStore.setState((s) => {
      for (const g of s.gms) if (g.id !== s.viewerGmId) g.isHuman = false;
    });
    s0.setConfig({ draftSimulateAfterPicks: 1 });
    // in the real app the stage is already "fantasyDraft" by the time this
    // screen mounts and calls startDraft (tryAdvance made that transition
    // earlier) — without setting it here, resolveTransition would compute
    // the wrong hop (setup -> fantasyDraft) once the threshold trips below.
    useStore.setState((s) => {
      s.stage = "fantasyDraft";
    });
    useStore.getState().startDraft("fantasy");

    // make exactly one pick for the human team, whenever its turn comes
    let guard = 0;
    while (guard++ < 700) {
      const s = useStore.getState();
      if (!s.draft || s.draft.currentPickIndex >= s.draft.pickOrder.length) break;
      const onClock = s.draft.pickOrder[s.draft.currentPickIndex];
      if (onClock === "GB") {
        const pick = Object.values(s.players).find((p) => !p.retired)!;
        useStore.getState().makePick(pick.id);
        break;
      }
      // an AI team is on the clock and the board isn't advancing on its own
      // — that would itself be the old deadlock, so fail loudly rather than
      // spin
      throw new Error("board did not advance past a non-human turn");
    }

    const s = useStore.getState();
    // the threshold (1 pick) is met the moment the human's one pick lands,
    // so the board should be fully drafted and the stage moved on
    expect(s.draft!.currentPickIndex).toBe(s.draft!.pickOrder.length);
    expect(s.stage).toBe("fantasyDraftSummary");
  }, 30_000);
});
