import { describe, expect, it } from "vitest";

import {
  developmentsSeason,
  ensureHoodedFigureEncounters,
  ensureHoodedFigureState,
  isHoodedFigureUnavailable,
  leagueDevelopmentsFor,
} from "./hoodedFigure.ts";
import { DEFAULT_CONFIG, fillRosterGaps } from "./seed.ts";
import { useStore } from "./store.ts";

/**
 * A Hooded Figure bargain survives the season rollover it is struck before.
 *
 * The encounter is always before the year turns over (training camp →
 * encounter → depth chart → preseason, where the season number moves), and
 * the rollover used to clear every temporary effect — so a player "done for
 * the season" was back for week 1. And League Developments, shown after the
 * rollover, read the new year's encounters: "A quiet offseason around the
 * league" over a bargain the GM had just paid for. The acceptance tests
 * never crossed the rollover, which is where both broke.
 */
const s = () => useStore.getState();

describe("the Hooded Figure across the rollover", () => {
  it("keeps the bargain on the field and reports it in League Developments", async () => {
    await useStore.getState().newLeague(5, { ...DEFAULT_CONFIG, humanGmCount: 1 });
    useStore.setState((d) => {
      d.gms[0]!.teamCode = "GB";
      d.teams.GB!.controlledBy = { kind: "human", gmId: d.gms[0]!.id };
      fillRosterGaps(d as never);
      // two losing seasons running makes GB eligible (§4)
      ensureHoodedFigureState(d as never).losingStreaks.GB = 2;
      d.stage = "hoodedFigureEncounter";
      ensureHoodedFigureEncounters(d as never);
    });
    const struckIn = s().season;

    // a large payment, and a player sidelined for the season by it — set
    // directly so the test does not depend on which branch the seed rolls
    const res = useStore.getState().submitHoodedFigurePayment(6);
    expect(res.ok, res.reason).toBe(true);
    const victim = Object.values(s().players).find((p) => p.nfl_team === "DAL" && !p.retired)!;
    useStore.setState((d) => {
      d.hoodedFigure!.unavailable.push({ playerId: victim.id, untilWeek: null });
    });

    // on to the depth chart, then over the rollover into the preseason
    for (const want of ["offseasonDepthChart", "preseason"]) {
      s().autoReadyNonViewers();
      s().setReady(s().viewerGmId, true);
      await useStore.getState().tryAdvance();
      expect(s().stage).toBe(want);
    }
    expect(s().season, "the year turned over").toBe(struckIn + 1);

    // the bargain is still in force for the season it was bought for
    expect(isHoodedFigureUnavailable(s(), victim.id, 1), "cleared at the rollover").toBe(true);

    // and League Developments reports the offseason it happened in
    useStore.setState((d) => {
      d.stage = "leagueDevelopments";
    });
    expect(developmentsSeason(s())).toBe(struckIn);
    // (it names the team affected, never the GM who paid — §25)
    expect(leagueDevelopmentsFor(s()), "a quiet offseason over a paid bargain").toHaveLength(1);

    // the next offseason's encounter is where it finally ends
    useStore.setState((d) => {
      d.stage = "hoodedFigureEncounter";
      ensureHoodedFigureEncounters(d as never);
    });
    expect(isHoodedFigureUnavailable(s(), victim.id, 1)).toBe(false);
  }, 180_000);
});
