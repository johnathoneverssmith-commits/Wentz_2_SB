import { describe, expect, it } from "vitest";

import { createLeague, DEFAULT_CONFIG, fillRosterGaps, recomputeTeamRatings } from "./seed.ts";
import { useStore } from "./store.ts";

/**
 * A day of the window used to pick uniformly at random out of the whole
 * market, so a 96-overall quarterback was no likelier to sign than the last
 * camp body on the board. Five days closed with Josh Allen and Lamar Jackson
 * unsigned among 452 free agents — the AI looked inert and the preseason
 * roster fill quietly hoovered up the stars instead.
 */
function leagueWithBigMarket(): void {
  useStore.setState(() => createLeague(17, DEFAULT_CONFIG) as never);
  useStore.setState((d) => {
    d.stage = "offseasonFreeAgency";
    fillRosterGaps(d);
    // put a broad slice of the league back on the market
    const rostered = Object.values(d.players).filter((p) => !p.free_agent && !p.retired);
    for (const p of rostered.slice(0, 300)) {
      p.free_agent = true;
      p.nfl_team = "FA";
      p.contract = null;
    }
    recomputeTeamRatings(d);
  });
}

function market(): { id: string; overall: number }[] {
  return Object.values(useStore.getState().players)
    .filter((p) => p.free_agent && !p.retired)
    .map((p) => ({ id: p.id, overall: p.overall }));
}

describe("the free agency window", () => {
  it("signs the best players available, not a random slice", () => {
    leagueWithBigMarket();
    useStore.getState().startBidding("players");
    const before = market();
    const topBefore = [...before].sort((a, b) => b.overall - a.overall).slice(0, 25);

    for (let d = 0; d < 5; d++) useStore.getState().advanceBiddingDay("players");

    const stillFree = new Set(market().map((p) => p.id));
    const topSigned = topBefore.filter((p) => !stillFree.has(p.id)).length;
    // A good share of the twenty-five best should be gone by the time it
    // closes. Not all of them: cap room is the real limit on who can be
    // bought, and a market this deep outruns the money in the league.
    expect(topSigned).toBeGreaterThanOrEqual(10);
  });

  it("leaves the bottom of the board for the roster fill", () => {
    leagueWithBigMarket();
    useStore.getState().startBidding("players");
    const before = market();
    const worstBefore = [...before].sort((a, b) => a.overall - b.overall).slice(0, 25);

    for (let d = 0; d < 5; d++) useStore.getState().advanceBiddingDay("players");

    const stillFree = new Set(market().map((p) => p.id));
    const worstSigned = worstBefore.filter((p) => !stillFree.has(p.id)).length;
    const topBefore = [...before].sort((a, b) => b.overall - a.overall).slice(0, 25);
    const topSigned = topBefore.filter((p) => !stillFree.has(p.id)).length;
    expect(topSigned).toBeGreaterThan(worstSigned);
  });

  it("closes into the standing market after five days", () => {
    leagueWithBigMarket();
    useStore.getState().startBidding("players");
    for (let d = 0; d < 5; d++) useStore.getState().advanceBiddingDay("players");
    expect(useStore.getState().freeAgency!.mode).toBe("standing");
  });

  it("never signs a team past its cap or its roster limit", () => {
    leagueWithBigMarket();
    useStore.getState().startBidding("players");
    for (let d = 0; d < 5; d++) useStore.getState().advanceBiddingDay("players");

    const s = useStore.getState();
    for (const code of Object.keys(s.teams)) {
      const roster = Object.values(s.players).filter(
        (p) => p.nfl_team === code && !p.retired && !p.free_agent,
      );
      const used = roster.reduce((n, p) => n + (p.contract?.cap_hit_by_year[0] ?? 0), 0);
      expect(Math.round(used * 10) / 10, `${code} cap`).toBeLessThanOrEqual(s.teams[code]!.cap.total);
      expect(roster.length, `${code} roster`).toBeLessThanOrEqual(65);
    }
  });
});

/**
 * An elite free agent costs more than any team ever holds in reserve — a
 * 96-overall quarterback is worth $51M a year and the richest team in this
 * league carried $29M — so the two best quarterbacks in football went
 * unsigned through an entire free agency and into the next season. Real teams
 * don't sit that out: they clear the room and take the roster hit.
 */
describe("signing a star nobody can afford", () => {
  it("clears the room rather than leaving him on the board", () => {
    leagueWithBigMarket();
    // One obvious superstar, no money anywhere, and — the part the fixture
    // has to supply — contracts worth cutting. Clearing room means releasing
    // expensive players who are not the best at their position; a league of
    // minimum-salary depth has nothing to clear, and the rule would have
    // nothing to demonstrate.
    const starId = Object.values(useStore.getState().players)
      .filter((p) => p.free_agent && !p.retired)
      .sort((a, b) => b.overall - a.overall)[0]!.id;
    useStore.setState((d) => {
      const star = d.players[starId]!;
      star.overall = 99;
      star.position = "QB";
      for (const code of Object.keys(d.teams)) {
        const roster = Object.values(d.players).filter(
          (p) => p.nfl_team === code && !p.retired && !p.free_agent,
        );
        // the back half of each roster on real money, so there is fat to cut
        const byOverall = [...roster].sort((a, b) => b.overall - a.overall);
        for (const p of byOverall.slice(Math.ceil(byOverall.length / 2))) {
          if (p.contract) p.contract.cap_hit_by_year[0] = 12;
        }
        const used = roster.reduce((n, p) => n + (p.contract?.cap_hit_by_year[0] ?? 0), 0);
        d.teams[code]!.cap.used = Math.round(used * 10) / 10;
        d.teams[code]!.cap.total = d.teams[code]!.cap.used + 5;
      }
    });

    useStore.getState().startBidding("players");
    for (let d = 0; d < 5; d++) useStore.getState().advanceBiddingDay("players");

    const star = useStore.getState().players[starId]!;
    expect(star.free_agent).toBe(false);
    expect(star.nfl_team).not.toBe("FA");
  });

  it("pays for him with depth, not with the best player at a position", () => {
    leagueWithBigMarket();
    useStore.setState((d) => {
      const star = Object.values(d.players).find((p) => p.free_agent && !p.retired)!;
      star.overall = 96;
      star.position = "QB";
      for (const code of Object.keys(d.teams)) d.teams[code]!.cap.total = d.teams[code]!.cap.used + 5;
    });
    // The claim is about quality, not identity. Four of Arizona's tackles are
    // rated 74, so "its best OT" does not name a player — cutting any one of
    // them leaves the team exactly as good at the position, which is what the
    // rule is actually protecting. Asserting on an id made the test fail on a
    // tie-break rather than on anything going wrong.
    const bestOtOf = (code: string): number => {
      const roster = Object.values(useStore.getState().players).filter(
        (p) => p.nfl_team === code && !p.retired && !p.free_agent && p.position === "OT",
      );
      return roster.reduce((n, p) => Math.max(n, p.overall), 0);
    };
    const before = new Map(
      Object.keys(useStore.getState().teams).map((code) => [code, bestOtOf(code)]),
    );

    useStore.getState().startBidding("players");
    for (let d = 0; d < 5; d++) useStore.getState().advanceBiddingDay("players");

    for (const [code, was] of before) {
      if (was === 0) continue;
      // greater-or-equal, not equal: a team is free to come out of free
      // agency better at the position than it went in
      expect(bestOtOf(code), `${code} is no worse at OT than it was`).toBeGreaterThanOrEqual(was);
    }
  });
});
