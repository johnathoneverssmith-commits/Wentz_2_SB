import { describe, expect, it } from "vitest";

import {
  availableCoaches,
  beginCoachingDraft,
  coachingDraftComplete,
  runAiCoachingPicks,
  vacantRoles,
} from "./coachingDraft.ts";
import { useStore } from "./store.ts";

/**
 * Deployed multiplayer playtest finding 3 (September 2026): the coaching
 * draft board completed itself once the last job in the league was filled,
 * but nothing ever called `resolveTransition` from inside `draftCoach` — the
 * exact "defined in coachingDraft.ts, never called from the single-player
 * store" pattern this session already found once in the fantasy draft
 * (issue 1). Online's `decideCoachingPick` already did this; store.ts's
 * `draftCoach` didn't.
 */
describe("coaching draft completion (single-player store)", () => {
  it("draftCoach advances the stage once the last job in the league is filled", () => {
    const s0 = useStore.getState();
    s0.pickTeam(s0.viewerGmId, "GB");
    useStore.setState((s) => {
      for (const g of s.gms) if (g.id !== s.viewerGmId) g.isHuman = false;
      s.stage = "coachingDraft";
      beginCoachingDraft(s);
      const humans = new Set([s.gms.find((g) => g.id === s.viewerGmId)!.teamCode]);
      runAiCoachingPicks(s, humans);
    });

    let guard = 0;
    while (guard++ < 400) {
      const s = useStore.getState();
      if (!s.coachingDraft || coachingDraftComplete(s)) break;
      const onClock = s.coachingDraft.pickOrder[s.coachingDraft.currentPickIndex];
      if (onClock !== "GB") throw new Error("board did not sweep past a non-human turn");
      const open = vacantRoles(s, "GB");
      const coach = availableCoaches(s).find((c) => open.includes(c.role))!;
      const res = useStore.getState().draftCoach(coach.id);
      expect(res.ok).toBe(true);
    }

    const s = useStore.getState();
    expect(coachingDraftComplete(s)).toBe(true);
    expect(s.stage).toBe("coachingDraftSummary");
  });
});
