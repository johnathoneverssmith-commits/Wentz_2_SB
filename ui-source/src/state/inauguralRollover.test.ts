import { describe, expect, it } from "vitest";

import { DEFAULT_CONFIG, fillRosterGaps } from "./seed.ts";
import { useStore } from "./store.ts";

/**
 * A new league's first rollover does not finalize a season nobody played.
 *
 * The rollover finalizes the season it closes — which, for a brand-new
 * league going from its opening offseason into its first preseason, is a
 * season with no games in it. That took a year off every contract the
 * fantasy draft had just signed (a two-year deal became one before a snap),
 * wrote a 0-0 season into history, and started every human team's Hooded
 * Figure losing streak off something that never happened.
 */
const s = () => useStore.getState();

describe("the inaugural rollover", () => {
  it("leaves contracts, history and losing streaks alone", async () => {
    await useStore.getState().newLeague(9, { ...DEFAULT_CONFIG, humanGmCount: 1 });
    useStore.setState((d) => {
      d.gms[0]!.teamCode = "GB";
      fillRosterGaps(d as never);
      d.stage = "offseasonDepthChart";
    });
    const signed = Object.values(s().players).filter((p) => p.nfl_team === "GB" && p.contract).slice(0, 5);
    const yearsBefore = signed.map((p) => p.contract!.years_remaining);

    s().autoReadyNonViewers();
    s().setReady(s().viewerGmId, true);
    await useStore.getState().tryAdvance();

    expect(s().stage).toBe("preseason");
    expect(s().season, "the first season played is 2027").toBe(2027);
    expect(signed.map((p) => s().players[p.id]!.contract!.years_remaining)).toEqual(yearsBefore);
    expect(s().history, "a phantom season was recorded").toHaveLength(0);
    expect(s().hoodedFigure?.losingStreaks?.GB ?? 0).toBe(0);
  }, 120_000);
});
