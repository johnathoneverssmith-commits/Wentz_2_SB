import { describe, expect, it } from "vitest";

import type { LeagueState, Stage } from "@/domain";
import { resolveTransition } from "@/state/stageMachine.ts";
import { createLeague, DEFAULT_CONFIG, fillRosterGaps } from "@/state/seed.ts";

/**
 * Change 9 — the midseason chain.
 *
 * The thing worth pinning down is the route, not the screens: the screens are
 * Change 4's, reused deliberately. What is new is that the season now pauses
 * twice between weeks 9 and 10, and a wrong edge here would either skip the
 * deadline entirely or loop the league back into it every week.
 */
function at(stage: Stage, week: number, patch: Partial<LeagueState> = {}): LeagueState {
  const s = createLeague(777, { ...DEFAULT_CONFIG, humanGmCount: 2 });
  fillRosterGaps(s);
  s.stage = stage;
  s.week = week;
  Object.assign(s, patch);
  return s;
}

describe("the midseason chain", () => {
  it("runs week 9 to week 10 through the deadline, free agency and the depth chart", () => {
    const route: Stage[] = [];
    let s = at("regularSeason", 9);
    for (let i = 0; i < 8; i++) {
      const t = resolveTransition(s);
      route.push(t.stage);
      s = at(t.stage, t.week, { tradeDeadline: s.tradeDeadline });
      // the deadline records itself as having happened, which is what stops
      // the league walking back into it
      if (t.stage === "tradeDeadline") {
        s.tradeDeadline = {
          order: [],
          round: 1,
          index: 0,
          active: null,
          resolved: [],
          drafts: {},
          done: true,
        };
      }
      if (t.stage === "regularSeason" && t.week > 9) break;
    }

    expect(route).toEqual([
      "tradeDeadline",
      "tradeDeadlineSummary",
      "midseasonFreeAgency",
      "midseasonFreeAgencySummary",
      "midseasonDepthChart",
      "regularSeason",
    ]);
  });

  it("does not stop at the deadline a second time", () => {
    const s = at("regularSeason", 10, {
      tradeDeadline: {
        order: [],
        round: 4,
        index: 0,
        active: null,
        resolved: [],
        drafts: {},
        done: true,
      },
    });
    expect(resolveTransition(s).stage).toBe("regularSeason");
    expect(resolveTransition(s).week).toBe(11);
  });

  it("still ends the season at the playoffs", () => {
    const s = at("regularSeason", 18, {
      tradeDeadline: {
        order: [],
        round: 4,
        index: 0,
        active: null,
        resolved: [],
        drafts: {},
        done: true,
      },
    });
    expect(resolveTransition(s).stage).toBe("playoffs");
  });
});
