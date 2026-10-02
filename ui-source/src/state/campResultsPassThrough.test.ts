import { expect, it } from "vitest";

import { useStore } from "./store.ts";

/**
 * Camp results are a step inside training camp, and the results stage after
 * it put the same button on the same page — so the first press read as doing
 * nothing. One check-in now carries the league past both, as online does.
 */
it("one check-in at camp goes past the camp results stage", async () => {
  await useStore.getState().newLeague(777);
  const s0 = useStore.getState();
  s0.pickTeam(s0.viewerGmId, "GB");
  useStore.setState((s) => {
    s.stage = "trainingCamp";
  });
  useStore.getState().setReady(s0.viewerGmId, true);
  useStore.getState().autoReadyNonViewers();
  const res = await useStore.getState().tryAdvance();
  expect(res.moved).toBe(true);
  expect(useStore.getState().stage).not.toBe("trainingCampResults");
  expect(useStore.getState().stage).not.toBe("trainingCamp");
});
