import { describe, expect, it } from "vitest";

import { DEFAULT_CONFIG, fillRosterGaps } from "./seed.ts";
import { resolveTransition } from "./stageMachine.ts";
import { useStore } from "./store.ts";

/**
 * Things that happen every season have to be reset every season.
 *
 * Found by playing into a second year: the stage machine opens the trade
 * deadline only while `tradeDeadline` is empty, and the rollover never
 * emptied it — so every season after a league's first went straight from
 * week 9 to week 10 with no deadline and no midseason market. The existing
 * season tests all stop inside the first year.
 */
const s = () => useStore.getState();

describe("a second season", () => {
  it("has a trade deadline again", async () => {
    await useStore.getState().newLeague(14, { ...DEFAULT_CONFIG, humanGmCount: 1 });
    useStore.setState((d) => {
      d.gms[0]!.teamCode = "GB";
      fillRosterGaps(d as never);
      // last season's deadline, finished
      d.tradeDeadline = { order: [], round: 3, index: 0, active: null, resolved: [], drafts: {}, done: true } as never;
      d.stage = "offseasonDepthChart";
    });
    s().autoReadyNonViewers();
    s().setReady(s().viewerGmId, true);
    await useStore.getState().tryAdvance(); // the rollover
    expect(s().stage).toBe("preseason");
    expect(s().tradeDeadline, "last season's deadline survived the rollover").toBeNull();

    // and so, at the deadline week of the new season, the league stops there
    const atWeek9 = { ...s(), stage: "regularSeason" as const, week: 9 };
    expect(resolveTransition(atWeek9, {}).stage).toBe("tradeDeadline");
  }, 120_000);
});
