import { describe, expect, it } from "vitest";

import { applyPick, bestAvailable, positionalNeed, surplusPenalty } from "./rules.ts";
import { useStore } from "./store.ts";

/**
 * "Autopick remaining" used to run `bestAvailable` for every remaining pick
 * inside one immer producer — 640 picks x ~1,700 proxied players — and froze
 * the tab for over a minute. It now plans the picks on plain data first
 * (`planAutopicks`) and applies them in a single producer. These guard both
 * halves of that: it has to stay fast, and it has to pick exactly what the
 * one-at-a-time path picks.
 */
describe("draft autopick", () => {
  it("matches pick-by-pick bestAvailable exactly", () => {
    const st = useStore.getState();
    st.pickTeam(st.viewerGmId, "GB");

    // a fantasy pick reassigns nfl_team, so both runs have to start from the
    // same pool for the comparison to mean anything
    const teamsBefore = new Map(
      Object.values(useStore.getState().players).map((p) => [p.id, p.nfl_team]),
    );
    const restorePool = () =>
      useStore.setState((s) => {
        for (const p of Object.values(s.players)) p.nfl_team = teamsBefore.get(p.id)!;
      });

    // reference: the slow path, one pick at a time — applyPick directly
    // rather than the public `makePick` action, since `makePick` now sweeps
    // every subsequent AI turn on its own (the fix for issue 1/2 in the
    // playtest notes: a human's pick used to leave the very next AI team
    // dead on the clock). That sweep is exactly what `autopickRemaining`
    // also does, so driving picks through it here would just be comparing
    // the fast path against itself. This loop isolates what the test is
    // actually guarding: bestAvailable and planAutopicks score the same
    // slot the same way, one pick at a time vs. planned in one shot.
    // startDraft itself now sweeps any leading AI picks up to the first one
    // the viewer owes (the fix for issue 1: a draft that didn't open on a
    // human turn used to sit dead) — those picks are already in
    // `draft.results` before the loop below runs a single iteration, so they
    // have to seed `reference` too, or it would end up comparing against the
    // wrong slice of the fast path's results.
    st.startDraft("fantasy");
    const reference: string[] = useStore
      .getState()
      .draft!.results.map((r) => r.selectedId)
      .filter((id): id is string => id !== null);
    while (reference.length < 40) {
      const id = bestAvailable(useStore.getState());
      if (!id) break;
      reference.push(id);
      useStore.setState((s) => {
        applyPick(s, id);
      });
    }

    // same starting point, planned in one shot
    restorePool();
    useStore.getState().startDraft("fantasy");
    useStore.getState().autopickRemaining();
    const fast = useStore
      .getState()
      .draft!.results.slice(0, reference.length)
      .map((r) => r.selectedId);

    expect(reference).toHaveLength(40);
    expect(fast).toEqual(reference);
  });

  it("fills a full 20-round fantasy draft, fast", () => {
    const st = useStore.getState();
    st.startDraft("fantasy");
    const t0 = performance.now();
    useStore.getState().autopickRemaining();
    const ms = performance.now() - t0;
    const d = useStore.getState().draft!;
    expect(d.currentPickIndex).toBe(d.pickOrder.length);
    expect(d.results.length).toBe(d.pickOrder.length);
    expect(new Set(d.results.map((r) => r.selectedId)).size).toBe(d.results.length);
    expect(ms).toBeLessThan(3_000);
  });

  it("bestAvailable is a first-max scan: ties resolve to the earliest candidate", () => {
    const st = useStore.getState();
    st.startDraft("rookie");
    const s = useStore.getState();
    const id = bestAvailable(s)!;
    const taken = new Set(s.draft!.results.map((r) => r.selectedId));
    const team = s.draft!.pickOrder[s.draft!.currentPickIndex]!;
    const carriedAt = (pos: string) =>
      Object.values(s.players)
        .filter((x) => x.nfl_team === team && x.position === pos && !x.retired)
        .map((x) => x.overall);
    const scoreOf = (p: (typeof s.draftClass)[number]) =>
      p.collegeOverall +
      positionalNeed(s, team, p.position) * 0.6 -
      surplusPenalty(p.position, carriedAt(p.position), p.collegeOverall);
    const candidates = s.draftClass.filter((p) => !taken.has(p.id));
    const max = Math.max(...candidates.map(scoreOf));
    expect(id).toBe(candidates.find((p) => scoreOf(p) === max)!.id);
  });
});
