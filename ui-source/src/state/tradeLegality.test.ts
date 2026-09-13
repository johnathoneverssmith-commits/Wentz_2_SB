import { describe, expect, it } from "vitest";

import type { LeagueState, Player } from "@/domain";
import { OFFSEASON_ROSTER_SIZE } from "@/sim/roster-template.ts";

import { createLeague, DEFAULT_CONFIG, fillRosterGaps, recomputeTeamRatings } from "./seed.ts";
import { checkTrade } from "./store.ts";

/**
 * `applyTrade` only ever swapped team codes, so a trade was a free way around
 * every gate the rest of the app enforces: a GM with $2M of room could take
 * back a $40M contract, and a three-for-one put a team past the roster limit
 * with nothing to say about it. The cap can't be optional on the one screen
 * that moves the most money.
 */
function fixture(): { s: LeagueState; a: string; b: string } {
  const s = createLeague(21, DEFAULT_CONFIG);
  fillRosterGaps(s);
  recomputeTeamRatings(s);
  const [a, b] = Object.keys(s.teams);
  return { s, a: a!, b: b! };
}

function rosterOf(s: LeagueState, code: string): Player[] {
  return Object.values(s.players)
    .filter((p) => p.nfl_team === code && !p.retired && !p.free_agent)
    .sort((a, b) => (b.contract?.cap_hit_by_year[0] ?? 0) - (a.contract?.cap_hit_by_year[0] ?? 0));
}

function deal(from: string, to: string, give: string[], take: string[]) {
  return {
    fromTeam: from,
    toTeam: to,
    fromAssets: give.map((playerId) => ({ kind: "player" as const, playerId })),
    toAssets: take.map((playerId) => ({ kind: "player" as const, playerId })),
  };
}

describe("checkTrade", () => {
  it("passes a straight swap of comparable salary", () => {
    const { s, a, b } = fixture();
    const mine = rosterOf(s, a)[0]!;
    const theirs = rosterOf(s, b).find(
      (p) => Math.abs((p.contract?.cap_hit_by_year[0] ?? 0) - (mine.contract?.cap_hit_by_year[0] ?? 0)) < 2,
    );
    if (!theirs) return;
    expect(checkTrade(s, deal(a, b, [mine.id], [theirs.id])).ok).toBe(true);
  });

  it("refuses a deal that would put the buyer over the cap", () => {
    const { s, a, b } = fixture();
    const star = rosterOf(s, b)[0]!;
    const scrub = rosterOf(s, a).slice(-1)[0]!;
    s.teams[a]!.cap.total = s.teams[a]!.cap.used + 1; // $1M of room

    const result = checkTrade(s, deal(a, b, [scrub.id], [star.id]));
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/over the cap/i);
  });

  it("names the overage so the player knows what to send back", () => {
    const { s, a, b } = fixture();
    const star = rosterOf(s, b)[0]!;
    const scrub = rosterOf(s, a).slice(-1)[0]!;
    s.teams[a]!.cap.total = s.teams[a]!.cap.used;
    const result = checkTrade(s, deal(a, b, [scrub.id], [star.id]));
    expect(result.reason).toMatch(/\$\d+\.\dM over the cap/);
  });

  it("refuses a deal that would put a team over the roster limit", () => {
    const { s, a, b } = fixture();
    // fill `a` right up to the offseason ceiling, then take three for one
    s.stage = "offseasonFreeAgency";
    const spare = Object.values(s.players).filter((p) => p.free_agent && !p.retired);
    const need = OFFSEASON_ROSTER_SIZE - rosterOf(s, a).length;
    for (const p of spare.slice(0, need)) {
      p.free_agent = false;
      p.nfl_team = a;
      p.contract = {
        team_id: a, years_remaining: 1, total_value: 1, guaranteed: 0,
        cap_hit_by_year: [0], signing_bonus: 0,
      };
    }
    recomputeTeamRatings(s);

    const give = [rosterOf(s, a)[0]!.id];
    const take = rosterOf(s, b).slice(-3).map((p) => p.id);
    const result = checkTrade(s, deal(a, b, give, take));
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/man limit/i);
  });

  it("checks the selling side too, not just the team taking salary on", () => {
    const { s, a, b } = fixture();
    s.teams[b]!.cap.total = s.teams[b]!.cap.used - 20; // already $20M over
    const mine = rosterOf(s, a).slice(-1)[0]!;
    const theirs = rosterOf(s, b).slice(-1)[0]!;
    const result = checkTrade(s, deal(a, b, [mine.id], [theirs.id]));
    expect(result.ok).toBe(false);
  });
});
