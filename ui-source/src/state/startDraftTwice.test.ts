import { expect, it } from "vitest";

import { useStore } from "./store.ts";

/**
 * The draft room starts the draft from an effect, and React runs effects
 * twice in development. The second `startDraft` rebuilt the board with no
 * results while the first one's AI picks stayed on their new teams — eight
 * quarterbacks rostered by teams that never drafted them, and still on the
 * board as available.
 */
it("a second startDraft leaves the running draft alone", async () => {
  await useStore.getState().newLeague(4242);
  const s0 = useStore.getState();
  s0.pickTeam(s0.viewerGmId, "GB");
  useStore.getState().setReady(s0.viewerGmId, true);
  useStore.getState().autoReadyNonViewers();
  await useStore.getState().tryAdvance();
  expect(useStore.getState().stage).toBe("fantasyDraft");

  useStore.getState().startDraft("fantasy");
  const first = useStore.getState().draft!.results.map((r) => r.selectedId);
  useStore.getState().startDraft("fantasy");
  const s = useStore.getState();

  expect(s.draft!.results.map((r) => r.selectedId)).toEqual(first);
  const taken = new Set(first);
  const undraftedOnTeams = Object.values(s.players).filter((p) => !p.free_agent && !p.retired && !taken.has(p.id));
  expect(undraftedOnTeams.map((p) => `${p.name}/${p.nfl_team}`)).toEqual([]);
});
