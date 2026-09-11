import { describe, expect, it } from "vitest";

import type { ContractOffer, LeagueState, Player } from "@/domain";
import { playerPriorities } from "@/sim/priorities";

import { createLeague, DEFAULT_CONFIG } from "./seed.ts";
import { offerScore } from "./store.ts";

/**
 * Which competing free-agency/coach-hiring offer wins (OQ-9) — a player's
 * own stated priorities (already computed for the negotiation screen,
 * previously never fed into the outcome) should be able to tip a close call
 * toward an offer that actually satisfies them, without letting a small
 * priority match overpower a real dollar gap.
 */

function fixture(): LeagueState {
  return createLeague(1, DEFAULT_CONFIG);
}

function offer(teamCode: string, amount = 10): ContractOffer {
  return { teamCode, baseSalary: amount, signingBonus: 0, years: 1, guaranteed: 0 };
}

/** first player (from `s.players`) whose ranked priorities include `tag`. */
function findPlayerWithPriority(s: LeagueState, tag: string): Player | undefined {
  return Object.values(s.players).find((p) => playerPriorities(p).ranked.includes(tag));
}

describe("offerScore (which offer a free agent picks)", () => {
  it("favors a winning team for a player who prioritizes winning now, at equal dollars", () => {
    const s = fixture();
    const p = findPlayerWithPriority(s, "winning now");
    if (!p) return; // no player in this seed's pool ranks it top-3; skip rather than flake
    const codes = Object.keys(s.teams).filter((c) => c !== p.nfl_team);
    const byOverall = [...codes].sort((a, b) => s.teams[b]!.ratings.overall - s.teams[a]!.ratings.overall);
    const good = byOverall[0]!;
    const bad = byOverall[byOverall.length - 1]!;
    if (s.teams[good]!.ratings.overall === s.teams[bad]!.ratings.overall) return; // no spread this seed
    const goodScore = offerScore(offer(good), "players", p.id, s);
    const badScore = offerScore(offer(bad), "players", p.id, s);
    expect(goodScore).toBeGreaterThan(badScore);
  });

  it("favors a team with a real opening for a player who prioritizes a starting role", () => {
    const s = fixture();
    const p = findPlayerWithPriority(s, "a starting role");
    if (!p) return;
    const codes = Object.keys(s.teams).filter((c) => c !== p.nfl_team);
    const [needyTeam, stackedTeam] = codes;
    // needyTeam has no one at the position; stackedTeam has an elite starter there
    for (const other of Object.values(s.players)) {
      if (other.nfl_team === needyTeam && other.position === p.position) other.nfl_team = "FA";
    }
    const stackedStarter = Object.values(s.players).find(
      (o) => o.nfl_team === stackedTeam && o.position === p.position,
    );
    if (stackedStarter) stackedStarter.overall = 95;

    const needyScore = offerScore(offer(needyTeam!), "players", p.id, s);
    const stackedScore = offerScore(offer(stackedTeam!), "players", p.id, s);
    expect(needyScore).toBeGreaterThan(stackedScore);
  });

  it("a large enough dollar gap still wins regardless of priority fit", () => {
    const s = fixture();
    const p = findPlayerWithPriority(s, "winning now");
    if (!p) return;
    const codes = Object.keys(s.teams).filter((c) => c !== p.nfl_team);
    const byOverall = [...codes].sort((a, b) => s.teams[b]!.ratings.overall - s.teams[a]!.ratings.overall);
    const good = byOverall[0]!;
    const bad = byOverall[byOverall.length - 1]!;
    // the bad-fit team offers 3x the money
    const goodScore = offerScore(offer(good, 10), "players", p.id, s);
    const bigBadScore = offerScore(offer(bad, 30), "players", p.id, s);
    expect(bigBadScore).toBeGreaterThan(goodScore);
  });
});
