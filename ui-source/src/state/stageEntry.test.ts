import { describe, expect, it } from "vitest";

import { DEFAULT_CONFIG } from "./seed.ts";
import { useStore } from "./store.ts";

/**
 * A stage opens the same way whichever door the league comes through.
 *
 * There are two transition paths — `tryAdvance` for the gated stages and
 * `finishGameDay` for the in-season ones — and they used to carry different
 * halves of the stage-entry list. The trade deadline is reached from the
 * regular season, i.e. only ever through `finishGameDay`, so it got none of
 * its opening logic: a league arrived at the deadline to a screen reading
 * "The deadline hasn't opened yet" with no controls on it at all, and the
 * only way on was to abandon the save.
 *
 * `playthrough.test.ts` cannot catch this — despite its name it returns at
 * the first preseason and never plays an in-season stage, so nothing had
 * ever driven `finishGameDay` into a stage that owns state.
 */
describe("stage entry is the same through either door", () => {
  it("opens the trade deadline when the regular season reaches it", async () => {
    await useStore.getState().newLeague(3, { ...DEFAULT_CONFIG, humanGmCount: 1 });
    const me = useStore.getState().viewerGmId;
    useStore.getState().pickTeam(me, "GB");

    // park the league in the regular season, the way the preseason leaves it
    useStore.setState((s) => {
      s.stage = "regularSeason";
      s.week = 1;
      s.tradeDeadline = null;
    });

    // the in-season path: Game Day's "continue" is what moves the stage here
    await useStore.getState().finishGameDay();

    const s = useStore.getState();
    expect(s.stage, "the season should stop at the deadline on the way past week 9").toBe(
      "tradeDeadline",
    );
    expect(s.tradeDeadline, "the deadline opened with no turn order to show").toBeTruthy();
    expect(s.tradeDeadline!.order.length).toBe(Object.keys(s.teams).length);
    // and it has already run itself forward to whoever owes the first move
    expect(s.tradeDeadline!.round).toBeGreaterThanOrEqual(1);
  });
});
