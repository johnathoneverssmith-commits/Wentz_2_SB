import { describe, expect, it } from "vitest";

import { createLeague, DEFAULT_CONFIG } from "./seed.ts";
import {
  aiControlledTeams,
  aiOfferForCoach,
  aiOfferForPlayer,
  bestAvailable,
  positionalNeed,
  rosterSchemeFit,
  weightedPick,
} from "./store.ts";
import type { Coach, LeagueState, Player } from "@/domain";

/**
 * AI GM decision-making (OQ-9): free-agency / coach-hiring offers should be
 * driven by roster need and scheme fit, not a uniformly random team and a
 * uniformly random dollar amount.
 */

function fixtureLeague(): LeagueState {
  return createLeague(1, DEFAULT_CONFIG);
}

describe("weightedPick", () => {
  it("favors higher-weighted items over many draws", () => {
    const rng = mulberryTest(1);
    const items = ["low", "high"];
    let highCount = 0;
    for (let i = 0; i < 2000; i++) {
      if (weightedPick(rng, items, [1, 9]) === "high") highCount++;
    }
    // ~90% expected; loose bound to keep this non-flaky
    expect(highCount / 2000).toBeGreaterThan(0.8);
  });

  it("falls back to uniform when all weights are zero", () => {
    const rng = mulberryTest(2);
    const items = ["a", "b"];
    let aCount = 0;
    for (let i = 0; i < 1000; i++) {
      if (weightedPick(rng, items, [0, 0]) === "a") aCount++;
    }
    expect(aCount / 1000).toBeGreaterThan(0.35);
    expect(aCount / 1000).toBeLessThan(0.65);
  });

  it("returns null for an empty item list", () => {
    expect(weightedPick(mulberryTest(3), [], [])).toBeNull();
  });
});

describe("positionalNeed", () => {
  it("is higher for a team with no one at the position than a team with a strong starter", () => {
    const s = fixtureLeague();
    const codes = Object.keys(s.teams);
    const [teamA, teamB] = codes;
    // clear all QBs from team A, give team B a 95-overall QB
    for (const p of Object.values(s.players)) {
      if (p.nfl_team === teamA && p.position === "QB") p.nfl_team = "FA";
    }
    const strongQb = Object.values(s.players).find((p) => p.nfl_team === teamB && p.position === "QB");
    if (strongQb) strongQb.overall = 95;

    const needA = positionalNeed(s, teamA!, "QB");
    const needB = positionalNeed(s, teamB!, "QB");
    expect(needA).toBeGreaterThan(needB);
  });
});

describe("rosterSchemeFit", () => {
  it("scores higher for a roster whose scheme_tags match the scheme", () => {
    const s = fixtureLeague();
    const [teamA] = Object.keys(s.teams);
    for (const p of Object.values(s.players)) {
      if (p.nfl_team === teamA) p.scheme_tags = ["west_coast", "play_action"];
    }
    const fitMatching = rosterSchemeFit(s, teamA!, "OC", "west_coast");
    const fitMismatched = rosterSchemeFit(s, teamA!, "OC", "power_run");
    expect(fitMatching).toBeGreaterThan(fitMismatched);
  });

  it("is 0 when the coach has no scheme", () => {
    const s = fixtureLeague();
    const [teamA] = Object.keys(s.teams);
    expect(rosterSchemeFit(s, teamA!, "OC", undefined)).toBe(0);
  });
});

describe("aiOfferForPlayer", () => {
  it("prefers a team that actually needs the position over many draws", () => {
    const s = fixtureLeague();
    for (const code of Object.keys(s.teams)) s.teams[code]!.controlledBy = { kind: "ai" };
    const codes = Object.keys(s.teams);
    const [needyTeam] = codes;
    for (const p of Object.values(s.players)) {
      if (p.nfl_team === needyTeam && p.position === "WR") p.nfl_team = "FA";
    }
    const freeAgent = { ...Object.values(s.players)[0]!, position: "WR" as const, overall: 80 };

    let toNeedy = 0;
    const trials = 500;
    for (let i = 0; i < trials; i++) {
      const offer = aiOfferForPlayer(mulberryTest(i), s, freeAgent as Player);
      if (offer.teamCode === needyTeam) toNeedy++;
    }
    // 32 teams uniformly would give ~3%; a real need should dominate that
    expect(toNeedy / trials).toBeGreaterThan(0.15);
  });

  it("bids more for a higher-overall player, on average", () => {
    const s = fixtureLeague();
    for (const code of Object.keys(s.teams)) s.teams[code]!.controlledBy = { kind: "ai" };
    const lo = { ...Object.values(s.players)[0]!, overall: 60 } as Player;
    const hi = { ...Object.values(s.players)[0]!, overall: 95 } as Player;
    const avg = (p: Player) => {
      let sum = 0;
      const n = 200;
      for (let i = 0; i < n; i++) sum += aiOfferForPlayer(mulberryTest(i), s, p).baseSalary;
      return sum / n;
    };
    expect(avg(hi)).toBeGreaterThan(avg(lo));
  });
});

describe("aiOfferForCoach", () => {
  it("never offers a team that already has that role filled", () => {
    const s = fixtureLeague();
    for (const code of Object.keys(s.teams)) s.teams[code]!.controlledBy = { kind: "ai" };
    const codes = Object.keys(s.teams);
    const filled = new Set(codes.slice(0, 10));
    let cid = 0;
    for (const code of filled) {
      const id = `c_existing_${++cid}`;
      s.coaches[id] = { id, name: "Existing OC", role: "OC", team: code, contract: null };
    }
    const candidate: Coach = { id: "c_new", name: "New OC", role: "OC", team: null, contract: null, scheme: "west_coast" };
    for (let i = 0; i < 200; i++) {
      const offer = aiOfferForCoach(mulberryTest(i), s, candidate);
      if (offer) expect(filled.has(offer.teamCode)).toBe(false);
    }
  });

  it("returns null when every AI team already has that role filled", () => {
    const s = fixtureLeague();
    for (const code of Object.keys(s.teams)) s.teams[code]!.controlledBy = { kind: "ai" };
    let cid = 0;
    for (const code of aiControlledTeams(s)) {
      const id = `c_existing_${++cid}`;
      s.coaches[id] = { id, name: "Existing DC", role: "DC", team: code, contract: null };
    }
    const candidate: Coach = { id: "c_new", name: "New DC", role: "DC", team: null, contract: null, scheme: "cover_3" };
    expect(aiOfferForCoach(mulberryTest(1), s, candidate)).toBeNull();
  });

  it("prefers a scheme-fitting team over many draws", () => {
    const s = fixtureLeague();
    for (const code of Object.keys(s.teams)) s.teams[code]!.controlledBy = { kind: "ai" };
    const codes = Object.keys(s.teams);
    const [fitTeam] = codes;
    for (const p of Object.values(s.players)) {
      if (p.nfl_team === fitTeam) p.scheme_tags = ["west_coast", "play_action"];
      else p.scheme_tags = ["power_run"];
    }
    const candidate: Coach = { id: "c_new", name: "New OC", role: "OC", team: null, contract: null, scheme: "west_coast" };
    let toFitTeam = 0;
    const trials = 500;
    for (let i = 0; i < trials; i++) {
      const offer = aiOfferForCoach(mulberryTest(i), s, candidate);
      if (offer?.teamCode === fitTeam) toFitTeam++;
    }
    expect(toFitTeam / trials).toBeGreaterThan(1 / codes.length);
  });
});

describe("bestAvailable (draft pick selection)", () => {
  it("tempers best-player-available with the picking team's positional need", () => {
    const s = fixtureLeague();
    const codes = Object.keys(s.teams);
    const [onTheClock] = codes;
    // strip onTheClock's QBs entirely (maximal need)
    for (const p of Object.values(s.players)) {
      if (p.nfl_team === onTheClock && p.position === "QB") p.nfl_team = "FA";
    }
    // fantasy-draft mode considers the whole undrafted pool, not just free
    // agents — pin two specific players' overalls so the intended gap is
    // exact and deterministic rather than hoping the random pool has it.
    const aQb = Object.values(s.players).find((p) => p.position === "QB")!;
    const aNonQb = Object.values(s.players).find((p) => p.position !== "QB" && p.id !== aQb.id)!;
    aQb.overall = 80;
    aNonQb.overall = 83; // higher overall, but not at a position onTheClock needs
    // make sure onTheClock isn't *also* thin at aNonQb's position by chance
    const existing = Object.values(s.players).find(
      (p) => p.nfl_team === onTheClock && p.position === aNonQb.position,
    );
    if (existing) existing.overall = 90;

    // mark every other player as already drafted so only the two candidates
    // above are eligible — otherwise bestAvailable is comparing against the
    // whole ~1600-player pool, which isn't what this test is isolating.
    const results = Object.keys(s.players)
      .filter((id) => id !== aQb.id && id !== aNonQb.id)
      .map((id) => ({ pickNumber: 1, round: 1, teamCode: onTheClock!, selectedId: id, selectedName: null, selectedPosition: null }));
    s.draft = {
      mode: "fantasy",
      year: s.season,
      order: "linear",
      pickOrder: [onTheClock!, ...codes.slice(1)],
      currentPickIndex: 0,
      results,
      targetsByGm: {},
    };
    expect(bestAvailable(s)).toBe(aQb.id);
  });

  it("falls back to pure best-overall when the gap is too large for need to close", () => {
    const s = fixtureLeague();
    const codes = Object.keys(s.teams);
    const [onTheClock] = codes;
    for (const p of Object.values(s.players)) {
      if (p.nfl_team === onTheClock && p.position === "QB") p.nfl_team = "FA";
    }
    const aQb = Object.values(s.players).find((p) => p.position === "QB")!;
    const aNonQb = Object.values(s.players).find((p) => p.position !== "QB" && p.id !== aQb.id)!;
    aQb.overall = 60;
    aNonQb.overall = 99; // a gap no realistic need weighting should close

    // mark every other player as already drafted so only the two candidates
    // above are eligible — otherwise bestAvailable is comparing against the
    // whole ~1600-player pool, which isn't what this test is isolating.
    const results = Object.keys(s.players)
      .filter((id) => id !== aQb.id && id !== aNonQb.id)
      .map((id) => ({ pickNumber: 1, round: 1, teamCode: onTheClock!, selectedId: id, selectedName: null, selectedPosition: null }));
    s.draft = {
      mode: "fantasy",
      year: s.season,
      order: "linear",
      pickOrder: [onTheClock!, ...codes.slice(1)],
      currentPickIndex: 0,
      results,
      targetsByGm: {},
    };
    expect(bestAvailable(s)).toBe(aNonQb.id);
  });
});

/** A small standalone deterministic rng for test inputs (independent of store.ts's private mulberry). */
function mulberryTest(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
