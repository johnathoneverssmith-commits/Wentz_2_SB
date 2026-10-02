import { expect, it } from "vitest";

import { useStore } from "./store.ts";

/**
 * A readiness gate advances on its own once everyone is in; a press landing
 * in the same moment ran the move a second time from the same starting
 * point. Out of the depth chart that rolled the season over twice.
 */
it("two overlapping advances move the league once", async () => {
  await useStore.getState().newLeague(31);
  const s0 = useStore.getState();
  s0.pickTeam(s0.viewerGmId, "GB");
  useStore.setState((s) => {
    s.stage = "offseasonDepthChart";
  });
  const season = useStore.getState().season;
  const g = useStore.getState();
  g.setReady(g.viewerGmId, true);
  g.autoReadyNonViewers();
  const [a, b] = await Promise.all([g.tryAdvance(), g.tryAdvance()]);
  expect(a).toEqual(b);
  const s = useStore.getState();
  expect(s.stage).toBe("preseason");
  expect(s.season).toBe(season + 1);
});
