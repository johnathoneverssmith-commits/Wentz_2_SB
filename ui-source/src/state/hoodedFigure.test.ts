import { describe, expect, it } from "vitest";

import type { LeagueState, SeasonOutcome } from "@/domain";
import { createLeague, DEFAULT_CONFIG, fillRosterGaps } from "./seed.ts";
import {
  checkHoodedFigurePayment,
  clearHoodedFigureTemporaryEffects,
  determineHoodedFigureLosers,
  ensureHoodedFigureEncounters,
  ensureHoodedFigureState,
  filterHoodedFigureAvailable,
  hoodedFigureEncounterFor,
  hoodedFigureMaxPayment,
  isHoodedFigureEligible,
  leagueDevelopmentsFor,
  resolveHoodedFigureEncounter,
  updateHoodedFigureStreaks,
} from "./hoodedFigure.ts";

/**
 * The Hooded Figure catch-up mechanic (11_HOODED_FIGURE_FINAL_IMPLEMENTATION_SPEC.md).
 * Section numbers below match that spec's §31 acceptance-test list.
 */

function fixture(): LeagueState {
  const s = createLeague(9001, { ...DEFAULT_CONFIG, humanGmCount: 2 });
  fillRosterGaps(s);
  s.gms[0]!.teamCode = "KC";
  s.gms[0]!.isHuman = true;
  s.gms[1]!.teamCode = "BUF";
  s.gms[1]!.isHuman = true;
  return s;
}

function outcome(over: Partial<SeasonOutcome>): SeasonOutcome {
  return {
    season: 2026,
    gmId: "gm_you",
    teamCode: "KC",
    madePlayoffs: false,
    seed: 0,
    furthestRound: "none",
    wonSuperBowl: false,
    regularSeasonRecord: { wins: 4, losses: 13, ties: 0 },
    eliminationMargin: null,
    pointDifferential: -80,
    rivalsEliminated: [],
    ...over,
  };
}

describe("§31 Eligibility", () => {
  it("one losing season -> not eligible yet", () => {
    const s = fixture();
    s.history.push(outcome({ teamCode: "KC" }), outcome({ teamCode: "BUF", regularSeasonRecord: { wins: 12, losses: 5, ties: 0 } }));
    updateHoodedFigureStreaks(s);
    expect(isHoodedFigureEligible(s, "KC")).toBe(false);
  });

  it("two consecutive losing seasons -> eligible", () => {
    const s = fixture();
    for (let season = 2026; season <= 2027; season++) {
      s.season = season;
      s.history.push(
        outcome({ season, teamCode: "KC" }),
        outcome({ season, teamCode: "BUF", regularSeasonRecord: { wins: 12, losses: 5, ties: 0 } }),
      );
      updateHoodedFigureStreaks(s);
    }
    expect(isHoodedFigureEligible(s, "KC")).toBe(true);
  });

  it("a third consecutive losing season keeps it eligible", () => {
    const s = fixture();
    for (let season = 2026; season <= 2028; season++) {
      s.season = season;
      s.history.push(
        outcome({ season, teamCode: "KC" }),
        outcome({ season, teamCode: "BUF", regularSeasonRecord: { wins: 12, losses: 5, ties: 0 } }),
      );
      updateHoodedFigureStreaks(s);
    }
    expect(s.hoodedFigure!.losingStreaks["KC"]).toBe(3);
    expect(isHoodedFigureEligible(s, "KC")).toBe(true);
  });

  it("a broken streak resets it", () => {
    const s = fixture();
    s.season = 2026;
    s.history.push(outcome({ season: 2026, teamCode: "KC" }), outcome({ season: 2026, teamCode: "BUF", regularSeasonRecord: { wins: 12, losses: 5, ties: 0 } }));
    updateHoodedFigureStreaks(s);
    s.season = 2027;
    s.history.push(outcome({ season: 2027, teamCode: "KC" }), outcome({ season: 2027, teamCode: "BUF", regularSeasonRecord: { wins: 12, losses: 5, ties: 0 } }));
    updateHoodedFigureStreaks(s);
    expect(isHoodedFigureEligible(s, "KC")).toBe(true);

    // KC has a winning season this time — the streak breaks
    s.season = 2028;
    s.history.push(
      outcome({ season: 2028, teamCode: "KC", regularSeasonRecord: { wins: 11, losses: 6, ties: 0 } }),
      outcome({ season: 2028, teamCode: "BUF", regularSeasonRecord: { wins: 2, losses: 15, ties: 0 } }),
    );
    updateHoodedFigureStreaks(s);
    expect(s.hoodedFigure!.losingStreaks["KC"]).toBe(0);
    expect(isHoodedFigureEligible(s, "KC")).toBe(false);
  });

  it("tied worst human teams both count as losers", () => {
    const tied = [
      outcome({ teamCode: "KC", regularSeasonRecord: { wins: 4, losses: 13, ties: 0 } }),
      outcome({ teamCode: "BUF", regularSeasonRecord: { wins: 4, losses: 13, ties: 0 } }),
    ];
    expect(determineHoodedFigureLosers(tied).sort()).toEqual(["BUF", "KC"]);
  });

  it("CPU teams are never eligible (no streak tracked for them)", () => {
    const s = fixture();
    // CPU team SF never appears in s.history at all — createLeague never
    // tracks a streak for it, so it can never become eligible.
    expect(isHoodedFigureEligible(s, "SF")).toBe(false);
  });

  it("all human teams making the playoffs uses playoff elimination, not regular-season record", () => {
    const bothMadePlayoffs = [
      outcome({ teamCode: "KC", madePlayoffs: true, furthestRound: "DIV", regularSeasonRecord: { wins: 12, losses: 5, ties: 0 } }),
      outcome({ teamCode: "BUF", madePlayoffs: true, furthestRound: "WC", regularSeasonRecord: { wins: 9, losses: 8, ties: 0 } }),
    ];
    // BUF went further-back (WC < DIV) despite tying or beating KC's record —
    // BUF is the loser under §4.2, not whoever had the worse regular season.
    expect(determineHoodedFigureLosers(bothMadePlayoffs)).toEqual(["BUF"]);
  });

  it("all-playoffs tiebreak: larger elimination margin loses", () => {
    const sameRound = [
      outcome({ teamCode: "KC", madePlayoffs: true, furthestRound: "WC", eliminationMargin: 3 }),
      outcome({ teamCode: "BUF", madePlayoffs: true, furthestRound: "WC", eliminationMargin: 21 }),
    ];
    expect(determineHoodedFigureLosers(sameRound)).toEqual(["BUF"]);
  });
});

describe("§31 Payment", () => {
  it("default is $0 and $0 declines (no error)", () => {
    const s = fixture();
    expect(checkHoodedFigurePayment(s, "KC", 0).ok).toBe(true);
  });

  it("first valid amount is $1.0M, increments are $0.5M", () => {
    const s = fixture();
    s.teams["KC"]!.cap.total = 500;
    s.teams["KC"]!.cap.used = 0;
    expect(checkHoodedFigurePayment(s, "KC", 0.5).ok).toBe(false);
    expect(checkHoodedFigurePayment(s, "KC", 1.0).ok).toBe(true);
    expect(checkHoodedFigurePayment(s, "KC", 1.25).ok).toBe(false);
    expect(checkHoodedFigurePayment(s, "KC", 1.5).ok).toBe(true);
  });

  it("max is min($10M, cap space)", () => {
    const s = fixture();
    s.teams["KC"]!.cap.total = 500;
    s.teams["KC"]!.cap.used = 100; // 400 room
    expect(hoodedFigureMaxPayment(s, "KC")).toBe(10);

    s.teams["KC"]!.cap.used = 496.2; // 3.8 room
    expect(hoodedFigureMaxPayment(s, "KC")).toBe(3.5); // snapped down to the $0.5M grid
  });

  it("cap room under $1M means no qualifying payment", () => {
    const s = fixture();
    s.teams["KC"]!.cap.total = 500;
    s.teams["KC"]!.cap.used = 499.5; // $0.5M room
    expect(hoodedFigureMaxPayment(s, "KC")).toBe(0);
    expect(checkHoodedFigurePayment(s, "KC", 1).ok).toBe(false);
    expect(checkHoodedFigurePayment(s, "KC", 0).ok).toBe(true);
  });

  it("refuses a payment above the team's cap room", () => {
    const s = fixture();
    s.teams["KC"]!.cap.total = 500;
    s.teams["KC"]!.cap.used = 498; // $2M room
    expect(checkHoodedFigurePayment(s, "KC", 2).ok).toBe(true);
    expect(checkHoodedFigurePayment(s, "KC", 2.5).ok).toBe(false);
  });
});

describe("§31 Determinism", () => {
  it("thresholds are stable across repeated encounter creation (no reroll on re-entry)", () => {
    const s = fixture();
    s.hoodedFigure = { losingStreaks: { KC: 2 }, firstNegativeConsumed: false, encountersBySeason: {}, unavailable: [] };
    ensureHoodedFigureEncounters(s);
    const first = hoodedFigureEncounterFor(s, "KC")!.thresholds;
    ensureHoodedFigureEncounters(s); // "re-entering" the stage
    const second = hoodedFigureEncounterFor(s, "KC")!.thresholds;
    expect(second).toEqual(first);
  });

  it("resolving the same team/season/payment on two independent league copies gives the same result", () => {
    const s = fixture();
    s.hoodedFigure = { losingStreaks: { KC: 2 }, firstNegativeConsumed: true, encountersBySeason: {}, unavailable: [] };
    ensureHoodedFigureEncounters(s);
    const a = structuredClone(s);
    const b = structuredClone(s);
    resolveHoodedFigureEncounter(a, "KC", 6);
    resolveHoodedFigureEncounter(b, "KC", 6);
    const ea = hoodedFigureEncounterFor(a, "KC")!;
    const eb = hoodedFigureEncounterFor(b, "KC")!;
    expect(ea.swindle).toBe(eb.swindle);
    expect(ea.branch).toBe(eb.branch);
    expect(ea.tier).toBe(eb.tier);
    expect(ea.outcome?.eventId).toBe(eb.outcome?.eventId);
  });

  it("thresholds strictly increase and stay inside [0, 10]", () => {
    const s = fixture();
    s.hoodedFigure = { losingStreaks: { KC: 2, BUF: 2 }, firstNegativeConsumed: false, encountersBySeason: {}, unavailable: [] };
    ensureHoodedFigureEncounters(s);
    for (const code of ["KC", "BUF"]) {
      const th = hoodedFigureEncounterFor(s, code)!.thresholds;
      expect(th.t1).toBeLessThan(th.t2);
      expect(th.t2).toBeLessThan(th.t3);
      expect(th.t1).toBeGreaterThanOrEqual(0);
      expect(th.t3).toBeLessThanOrEqual(10);
    }
  });
});

describe("§31 First outcome / branching", () => {
  it("the first successful (non-swindle) bargain in the league is forced negative", () => {
    const s = fixture();
    s.teams["KC"]!.cap.total = 500;
    s.teams["KC"]!.cap.used = 0;
    s.hoodedFigure = { losingStreaks: { KC: 2 }, firstNegativeConsumed: false, encountersBySeason: {}, unavailable: [] };
    ensureHoodedFigureEncounters(s);
    // try enough payments to find one that isn't a swindle
    let found = false;
    for (let payment = 1; payment <= 10 && !found; payment += 0.5) {
      const clone = structuredClone(s);
      const e = resolveHoodedFigureEncounter(clone, "KC", payment);
      if (!e.swindle) {
        expect(e.branch).toBe("negative");
        found = true;
      }
    }
    expect(found).toBe(true);
  });

  it("a swindle does not consume the first-negative guarantee", () => {
    const s = fixture();
    s.teams["KC"]!.cap.total = 500;
    s.teams["KC"]!.cap.used = 0;
    s.hoodedFigure = { losingStreaks: { KC: 2 }, firstNegativeConsumed: false, encountersBySeason: {}, unavailable: [] };
    ensureHoodedFigureEncounters(s);
    let sawSwindle = false;
    for (let payment = 1; payment <= 10; payment += 0.5) {
      const clone = structuredClone(s);
      const e = resolveHoodedFigureEncounter(clone, "KC", payment);
      if (e.swindle) {
        sawSwindle = true;
        expect(clone.hoodedFigure!.firstNegativeConsumed).toBe(false);
      }
    }
    // not asserting one is guaranteed to appear in this small a sample —
    // just that whichever ones did swindle left the guarantee untouched
    void sawSwindle;
  });

  it("no negative outcome ever targets a human-controlled team", () => {
    const s = fixture();
    s.teams["KC"]!.cap.total = 500;
    s.teams["KC"]!.cap.used = 0;
    s.hoodedFigure = { losingStreaks: { KC: 2 }, firstNegativeConsumed: true, encountersBySeason: {}, unavailable: [] };
    ensureHoodedFigureEncounters(s);
    for (let payment = 1; payment <= 10; payment += 0.5) {
      const clone = structuredClone(s);
      const e = resolveHoodedFigureEncounter(clone, "KC", payment);
      if (e.branch === "negative" && e.outcome?.targetTeam) {
        expect(["KC", "BUF"]).not.toContain(e.outcome.targetTeam);
      }
    }
  });
});

describe("§31 Rollover", () => {
  it("clears temporary unavailability but nothing else", () => {
    const s = fixture();
    ensureHoodedFigureState(s).unavailable.push({ playerId: "p1", untilWeek: 3 }, { playerId: "p2", untilWeek: null });
    clearHoodedFigureTemporaryEffects(s);
    expect(s.hoodedFigure!.unavailable).toHaveLength(0);
  });

  it("filterHoodedFigureAvailable excludes only currently-sidelined players", () => {
    const s = fixture();
    const roster = Object.values(s.players).filter((p) => p.nfl_team === "KC").slice(0, 3);
    ensureHoodedFigureState(s).unavailable.push({ playerId: roster[0]!.id, untilWeek: 3 }, { playerId: roster[1]!.id, untilWeek: null });
    const week1 = filterHoodedFigureAvailable(s, roster, 1);
    expect(week1.map((p) => p.id)).not.toContain(roster[0]!.id);
    expect(week1.map((p) => p.id)).not.toContain(roster[1]!.id);
    expect(week1.map((p) => p.id)).toContain(roster[2]!.id);

    const week4 = filterHoodedFigureAvailable(s, roster, 4);
    expect(week4.map((p) => p.id)).toContain(roster[0]!.id); // the fixed-duration one has returned
    expect(week4.map((p) => p.id)).not.toContain(roster[1]!.id); // the season-long one hasn't
  });
});

describe("§31 Results screen", () => {
  it("never reveals tier/payment/branch for a non-swindle outcome, and shows the exact swindle amount for a swindle", () => {
    const s = fixture();
    s.teams["KC"]!.cap.total = 500;
    s.teams["KC"]!.cap.used = 0;
    s.hoodedFigure = { losingStreaks: { KC: 2 }, firstNegativeConsumed: true, encountersBySeason: {}, unavailable: [] };
    ensureHoodedFigureEncounters(s);
    resolveHoodedFigureEncounter(s, "KC", 3);
    const entries = leagueDevelopmentsFor(s);
    for (const e of entries) {
      expect(e).not.toHaveProperty("payment");
      expect(e).not.toHaveProperty("thresholds");
      if (e.kind === "swindle") {
        const encounter = hoodedFigureEncounterFor(s, "KC")!;
        expect(e.swindlePayment).toBe(encounter.payment);
      }
    }
  });

  it("declining (payment 0) never appears in the public reveal", () => {
    const s = fixture();
    s.hoodedFigure = { losingStreaks: { KC: 2 }, firstNegativeConsumed: true, encountersBySeason: {}, unavailable: [] };
    ensureHoodedFigureEncounters(s);
    resolveHoodedFigureEncounter(s, "KC", 0);
    expect(leagueDevelopmentsFor(s)).toHaveLength(0);
  });
});
