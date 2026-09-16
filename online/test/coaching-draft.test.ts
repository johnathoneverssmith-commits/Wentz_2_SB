import { describe, expect, it } from "vitest";

import type { LeagueState } from "@/domain";
import { COACH_ROLES } from "@/domain";
import { createLeague, DEFAULT_CONFIG, fillRosterGaps } from "@/state/seed.ts";
import { beginDraft } from "@/state/rules.ts";
import {
  applyCoachingPick,
  beginCoachingDraft,
  bestCoachingPick,
  buildCoachingOrder,
  checkCoachingPick,
  coachingDraftComplete,
  coachingOnTheClock,
  COACHING_ROUNDS,
  runAiCoachingPicks,
  vacantRoles,
} from "@/state/coachingDraft.ts";

/**
 * Change 3 — the coaching draft's order and rules.
 *
 * The reversal is the part worth pinning hardest. Coaching round 1 is the
 * exact reverse of player-draft round 1, so drafting first among the players
 * costs you the first coach. If that ever silently became "same order" the
 * draft would still run, still finish, and quietly stop meaning anything.
 */
function leagueAfterPlayerDraft(): LeagueState {
  const s = createLeague(8642, { ...DEFAULT_CONFIG, humanGmCount: 2 });
  fillRosterGaps(s);
  s.gms[0]!.teamCode = "KC";
  s.gms[0]!.isHuman = true;
  s.gms[1]!.teamCode = "BUF";
  s.gms[1]!.isHuman = true;
  s.stage = "fantasyDraft";
  beginDraft(s, "fantasy");
  s.stage = "coachingDraft";
  return s;
}

describe("the coaching draft order", () => {
  it("opens with the exact reverse of player-draft round one", () => {
    const playerRound1 = ["A", "B", "C", "D"];
    const order = buildCoachingOrder(playerRound1);
    expect(order.slice(0, 4)).toEqual(["D", "C", "B", "A"]);
  });

  it("snakes after that", () => {
    const order = buildCoachingOrder(["A", "B", "C", "D"]);
    expect(order.slice(0, 4)).toEqual(["D", "C", "B", "A"]);
    expect(order.slice(4, 8)).toEqual(["A", "B", "C", "D"]);
    expect(order.slice(8, 12)).toEqual(["D", "C", "B", "A"]);
  });

  it("runs twelve rounds — one per staff job", () => {
    const order = buildCoachingOrder(["A", "B", "C", "D"]);
    expect(COACHING_ROUNDS).toBe(COACH_ROLES.length);
    expect(COACHING_ROUNDS).toBe(12);
    expect(order).toHaveLength(4 * 12);
  });

  it("gives every team exactly twelve picks", () => {
    const order = buildCoachingOrder(["A", "B", "C", "D"]);
    for (const team of ["A", "B", "C", "D"]) {
      expect(order.filter((t) => t === team), team).toHaveLength(12);
    }
  });

  it("reverses the real league's player draft when it opens", () => {
    const s = leagueAfterPlayerDraft();
    const teams = Object.keys(s.teams).length;
    const playerFirst = s.draft!.pickOrder[0]!;
    beginCoachingDraft(s);
    // whoever picked first among players picks last in coaching round 1
    expect(s.coachingDraft!.pickOrder[teams - 1]).toBe(playerFirst);
    expect(coachingOnTheClock(s)).toBe(s.draft!.pickOrder[teams - 1]);
  });
});

describe("making a coaching pick", () => {
  it("refuses a team that isn't on the clock", () => {
    const s = leagueAfterPlayerDraft();
    beginCoachingDraft(s);
    const onClock = coachingOnTheClock(s)!;
    const other = Object.keys(s.teams).find((t) => t !== onClock)!;
    const someone = Object.values(s.coaches).find((c) => c.team === null)!;
    const check = checkCoachingPick(s, other, someone.id);
    expect(check.ok).toBe(false);
    expect(check.reason).toMatch(/isn't your pick/i);
  });

  it("refuses a coach somebody already has", () => {
    const s = leagueAfterPlayerDraft();
    beginCoachingDraft(s);
    const onClock = coachingOnTheClock(s)!;
    const taken = Object.values(s.coaches).find((c) => c.team === null)!;
    applyCoachingPick(s, onClock, taken.id);
    const next = coachingOnTheClock(s)!;
    const check = checkCoachingPick(s, next, taken.id);
    expect(check.ok).toBe(false);
    expect(check.reason).toMatch(/already taken/i);
  });

  it("refuses a role the team has already filled", () => {
    const s = leagueAfterPlayerDraft();
    beginCoachingDraft(s);
    const team = coachingOnTheClock(s)!;
    const first = Object.values(s.coaches).find((c) => c.team === null && c.role === "QB")!;
    applyCoachingPick(s, team, first.id);
    // force the same team back on the clock
    s.coachingDraft!.pickOrder[s.coachingDraft!.currentPickIndex] = team;
    const second = Object.values(s.coaches).find((c) => c.team === null && c.role === "QB")!;
    const check = checkCoachingPick(s, team, second.id);
    expect(check.ok).toBe(false);
    expect(check.reason).toMatch(/already filled/i);
  });

  it("lets a team take any vacant role, not a fixed one per round", () => {
    const s = leagueAfterPlayerDraft();
    beginCoachingDraft(s);
    const team = coachingOnTheClock(s)!;
    expect(vacantRoles(s, team)).toHaveLength(12);
    const med = Object.values(s.coaches).find((c) => c.team === null && c.role === "MED")!;
    // taking the trainer first is legal; the draft is best-available
    expect(checkCoachingPick(s, team, med.id).ok).toBe(true);
  });
});

describe("running the board", () => {
  it("fills every job on every team when it finishes", () => {
    const s = leagueAfterPlayerDraft();
    beginCoachingDraft(s);
    // nobody human — let the AI take the whole board
    const made = runAiCoachingPicks(s, new Set());
    expect(coachingDraftComplete(s)).toBe(true);
    expect(made).toBe(s.coachingDraft!.pickOrder.length);

    for (const team of Object.keys(s.teams)) {
      const staff = Object.values(s.coaches).filter((c) => c.team === team);
      expect(staff.map((c) => c.role).sort(), team).toEqual([...COACH_ROLES].sort());
    }
  }, 120_000);

  it("stops on a human team rather than picking for them", () => {
    const s = leagueAfterPlayerDraft();
    beginCoachingDraft(s);
    runAiCoachingPicks(s, new Set(["KC", "BUF"]));
    const onClock = coachingOnTheClock(s);
    expect(["KC", "BUF"]).toContain(onClock);
  }, 120_000);

  it("never gives one coach to two teams", () => {
    const s = leagueAfterPlayerDraft();
    beginCoachingDraft(s);
    runAiCoachingPicks(s, new Set());
    const ids = s.coachingDraft!.results.map((r) => r.coachId);
    expect(new Set(ids).size).toBe(ids.length);
  }, 120_000);

  it("takes the best available rather than filling roles in order", () => {
    const s = leagueAfterPlayerDraft();
    beginCoachingDraft(s);
    const team = coachingOnTheClock(s)!;
    const pick = bestCoachingPick(s, team)!;
    const chosen = s.coaches[pick]!;
    // nobody available at any of this team's open jobs rates higher
    const open = new Set(vacantRoles(s, team));
    for (const c of Object.values(s.coaches)) {
      if (c.team !== null || !open.has(c.role)) continue;
      const rating = c.overall ?? 0;
      expect(rating).toBeLessThanOrEqual(chosen.overall ?? 999);
    }
  });
});
