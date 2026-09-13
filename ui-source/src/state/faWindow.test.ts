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
    // one obvious superstar, and no money anywhere
    const starId = Object.values(useStore.getState().players).find(
      (p) => p.free_agent && !p.retired,
    )!.id;
    useStore.setState((d) => {
      const star = d.players[starId]!;
      star.overall = 96;
      star.position = "QB";
      for (const code of Object.keys(d.teams)) d.teams[code]!.cap.total = d.teams[code]!.cap.used + 5;
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
    const bestBefore = new Map<string, string>();
    for (const code of Object.keys(useStore.getState().teams)) {
      const roster = Object.values(useStore.getState().players).filter(
        (p) => p.nfl_team === code && !p.retired && !p.free_agent && p.position === "OT",
      );
      if (roster.length > 0) {
        bestBefore.set(code, roster.reduce((a, b) => (b.overall > a.overall ? b : a)).id);
      }
    }

    useStore.getState().startBidding("players");
    for (let d = 0; d < 5; d++) useStore.getState().advanceBiddingDay("players");

    for (const [code, id] of bestBefore) {
      expect(useStore.getState().players[id]!.nfl_team, `${code} kept its best OT`).toBe(code);
    }
  });
});
