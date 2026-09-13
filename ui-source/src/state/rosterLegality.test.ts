import { describe, expect, it } from "vitest";

import type { LeagueState, Player } from "@/domain";
import { ROSTER_SIZE } from "@/sim/roster-template.ts";

import { createLeague, DEFAULT_CONFIG, fillRosterGaps, recomputeTeamRatings } from "./seed.ts";

/**
 * `fillRosterGaps` used to only ever *add* players. That was fine right after
 * a fantasy draft, but by the second offseason a team arrives at the preseason
 * gate holding 57 players and $31M over the cap — seven draft picks signed on
 * top of a roster that was already full and already near the line, with
 * nothing anywhere in the app taking anyone off. The human GM then hit a dead
 * end: free agency refuses every signing for lack of room and no screen
 * offered a way to create any.
 *
 * It now cuts to a legal roster before filling up to one, so no team can take
 * the field over 53 or over the cap.
 */
function fixture(): LeagueState {
  return createLeague(7, DEFAULT_CONFIG);
}

function rosterOf(s: LeagueState, code: string): Player[] {
  return Object.values(s.players).filter((p) => p.nfl_team === code && !p.retired);
}

/** Rounded to $0.1M, the precision the cap is quoted at everywhere in the UI. */
function capUsed(s: LeagueState, code: string): number {
  const raw = rosterOf(s, code).reduce((n, p) => n + (p.contract?.cap_hit_by_year[0] ?? 0), 0);
  return Math.round(raw * 10) / 10;
}

/**
 * Stacks `code` past both limits the way signing a draft class does: seven
 * extra bodies on an already-full roster, on deals a first round costs.
 */
function overloadTeam(s: LeagueState, code: string): void {
  const spares = Object.values(s.players).filter((p) => p.free_agent && !p.retired).slice(0, 7);
  for (const p of spares) {
    p.free_agent = false;
    p.nfl_team = code;
    p.contract = {
      team_id: code,
      years_remaining: 4,
      total_value: 32,
      guaranteed: 16,
      cap_hit_by_year: [8],
      signing_bonus: 0,
    };
  }
}

describe("roster legality", () => {
  it("brings an over-53, over-cap team back under both limits", () => {
    const s = fixture();
    fillRosterGaps(s); // everyone starts from a full, legal roster
    const code = Object.keys(s.teams)[0]!;
    overloadTeam(s, code);
    expect(rosterOf(s, code).length).toBeGreaterThan(ROSTER_SIZE);
    expect(capUsed(s, code)).toBeGreaterThan(s.teams[code]!.cap.total);

    fillRosterGaps(s);

    expect(rosterOf(s, code).length).toBe(ROSTER_SIZE);
    expect(capUsed(s, code)).toBeLessThanOrEqual(s.teams[code]!.cap.total);
  });

  it("leaves every team season-legal, not just the one that was over", () => {
    const s = fixture();
    fillRosterGaps(s);
    for (const code of Object.keys(s.teams)) {
      expect(rosterOf(s, code).length).toBe(ROSTER_SIZE);
      expect(capUsed(s, code)).toBeLessThanOrEqual(s.teams[code]!.cap.total);
    }
  });

  it("cuts the depth, not the stars — the best player survives a purge", () => {
    const s = fixture();
    fillRosterGaps(s);
    const code = Object.keys(s.teams)[0]!;
    const best = rosterOf(s, code).reduce((a, b) => (b.overall > a.overall ? b : a));
    overloadTeam(s, code);

    fillRosterGaps(s);

    expect(s.players[best.id]!.nfl_team).toBe(code);
  });

  it("every cut player lands on the standing market rather than vanishing", () => {
    const s = fixture();
    fillRosterGaps(s);
    const code = Object.keys(s.teams)[0]!;
    overloadTeam(s, code);
    const before = new Set(rosterOf(s, code).map((p) => p.id));

    fillRosterGaps(s);

    const after = new Set(rosterOf(s, code).map((p) => p.id));
    const cut = [...before].filter((id) => !after.has(id));
    expect(cut.length).toBeGreaterThan(0);
    for (const id of cut) {
      const p = s.players[id]!;
      // either released outright, or signed on somewhere else off the market
      if (p.free_agent) expect(s.standingFreeAgents).toContain(id);
      else expect(p.nfl_team).not.toBe(code);
    }
  });

  it("the cap figure the UI reads agrees with the contracts on the roster", () => {
    const s = fixture();
    fillRosterGaps(s);
    recomputeTeamRatings(s);
    for (const code of Object.keys(s.teams)) {
      expect(s.teams[code]!.cap.used).toBeCloseTo(capUsed(s, code), 0);
      expect(s.teams[code]!.cap.used).toBeLessThanOrEqual(s.teams[code]!.cap.total);
    }
  });
});
