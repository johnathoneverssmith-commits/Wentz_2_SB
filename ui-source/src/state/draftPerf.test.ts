import { describe, expect, it } from "vitest";

import { bestAvailable, positionalNeed, useStore } from "./store.ts";

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

    // reference: the slow path, one pick at a time through the store
    st.startDraft("fantasy");
    const reference: string[] = [];
    for (let i = 0; i < 40; i++) {
      const id = bestAvailable(useStore.getState());
      if (!id) break;
      reference.push(id);
      useStore.getState().makePick(id);
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
    const scoreOf = (p: (typeof s.draftClass)[number]) =>
      p.collegeOverall + positionalNeed(s, team, p.position) * 0.6;
    const candidates = s.draftClass.filter((p) => !taken.has(p.id));
    const max = Math.max(...candidates.map(scoreOf));
    expect(id).toBe(candidates.find((p) => scoreOf(p) === max)!.id);
  });
});
