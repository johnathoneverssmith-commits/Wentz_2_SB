import { describe, expect, it } from "vitest";

import type { LeagueState, Player } from "@/domain";
import { ROSTER_SIZE, ROSTER_TEMPLATE } from "@/sim/roster-template.ts";

import {
  createLeague,
  DEFAULT_CONFIG,
  fillRosterGaps,
  recomputeTeamRatings,
  trimRosters,
} from "./seed.ts";

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

  it("leaves every team room to actually sign someone", () => {
    // The fill used to buy the best starter it could afford at every hole and
    // park all 32 teams on exactly $255.0M. Legal, and unplayable: free agency
    // is the offseason's headline feature and nobody could make a signing.
    const s = fixture();
    fillRosterGaps(s);
    for (const code of Object.keys(s.teams)) {
      const room = s.teams[code]!.cap.total - capUsed(s, code);
      expect(room, `${code} has working cap room`).toBeGreaterThan(5);
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

/**
 * A fantasy-drafted player kept `free_agent: true` — `applyPick` set only his
 * team code. He then counted twice: once as a rostered player and once as
 * market supply. The roster fill would "sign" a man the team already had,
 * push a duplicate into its working roster, read that as a filled spot, and
 * stop one real body short — eight teams reached kickoff with 52 players and
 * two quarterbacks where the template asks for three.
 */
describe("roster bookkeeping", () => {
  it("never counts a player as rostered and available at the same time", () => {
    const s = fixture();
    fillRosterGaps(s);
    const confused = Object.values(s.players).filter(
      (p) => !p.retired && p.free_agent && p.nfl_team !== "FA",
    );
    expect(confused.map((p) => `${p.id}@${p.nfl_team}`)).toEqual([]);
  });

  it("fills to exactly the template at every position", () => {
    const s = fixture();
    fillRosterGaps(s);
    for (const code of Object.keys(s.teams)) {
      const roster = rosterOf(s, code);
      for (const { pos, count } of ROSTER_TEMPLATE) {
        expect(roster.filter((p) => p.position === pos).length, `${code} ${pos}`).toBe(count);
      }
    }
  });
});

/**
 * Signing a draft class puts a team tens of millions over the cap, and the
 * trim that follows has to fix that without dismantling the roster. It used
 * to cut whoever was expendable — and after a draft almost every real player
 * is the best at his position, so "expendable" meant camp bodies. One team
 * shed 38 players at $1M each and walked into free agency with 22.
 */
describe("getting cap-compliant after a draft class", () => {
  function signedDraftClass(s: LeagueState, code: string): void {
    let n = 0;
    for (const salary of [7, 6, 5, 4, 3, 2, 1]) {
      const id = `p_rook_${code}_${++n}`;
      s.players[id] = {
        ...Object.values(s.players).find((p) => p.nfl_team === code)!,
        id,
        nfl_team: code,
        free_agent: false,
        overall: 70,
        contract: {
          team_id: code,
          years_remaining: 4,
          total_value: salary * 4,
          guaranteed: salary * 4,
          cap_hit_by_year: [salary, salary, salary, salary],
          signing_bonus: salary,
        },
      };
    }
  }

  it("pays for it with contracts, not by gutting the roster", () => {
    const s = fixture();
    fillRosterGaps(s);
    const code = Object.keys(s.teams)[0]!;
    // spend up to the line first, the way a team arrives at its draft
    s.teams[code]!.cap.total = capUsed(s, code);
    const before = rosterOf(s, code).length;
    signedDraftClass(s, code);

    trimRosters(s);

    const after = rosterOf(s, code);
    expect(capUsed(s, code)).toBeLessThanOrEqual(s.teams[code]!.cap.total);
    // a $28M overage is a handful of contracts, not three dozen bodies
    expect(before + 7 - after.length).toBeLessThan(12);
  });

  it("keeps free agency reachable — the roster it hands over is still a team", () => {
    const s = fixture();
    fillRosterGaps(s);
    const code = Object.keys(s.teams)[0]!;
    s.teams[code]!.cap.total = capUsed(s, code);
    signedDraftClass(s, code);

    trimRosters(s);

    // enough bodies left that the position minimums are within reach
    expect(rosterOf(s, code).length).toBeGreaterThan(40);
  });
});
