import { describe, expect, it } from "vitest";

import type { GameResult, InjuryEvent, LeagueState, Player } from "@/domain";

import { applyInjuries, availableRoster, clearInjuries, healOneWeek } from "./injuries.ts";
import { createLeague, DEFAULT_CONFIG, fillRosterGaps } from "./seed.ts";

/**
 * The engine simulated injuries all along, but only the viewer's game carried
 * them back and nothing ever wrote one onto a player. The hub's Injuries tab
 * read "No injuries reported" for an entire dynasty, `injury_history` never
 * grew, and `injuryAgeReduction` — the part of the retirement model that
 * exists to shorten a battered career — had nothing to work with.
 */
function fixture(): { s: LeagueState; p: Player } {
  const s = createLeague(31, DEFAULT_CONFIG);
  fillRosterGaps(s);
  const p = Object.values(s.players).find((x) => !x.free_agent && !x.retired && x.nfl_team !== "FA")!;
  return { s, p };
}

function hurt(playerId: string, severity: InjuryEvent["severity"], weeks: [number, number]): GameResult {
  return {
    id: "g1", week: 1, phase: "REG", homeTeam: "KC", awayTeam: "BUF",
    played: true, homeScore: 20, awayScore: 17,
    injuries: [
      {
        team: "KC", playerId, player: "x", position: "WR", slot: "WR1",
        quarter: 2, clock: "4:11", bodyPart: "hamstring", suspectedType: "hamstring",
        severity, projectedWeeks: weeks, mechanism: "non-contact", onPlay: "", narrative: "",
      },
    ],
  } as GameResult;
}

describe("injuries", () => {
  it("puts a hurt player on the report, with a history entry for retirement to read", () => {
    const { s, p } = fixture();
    applyInjuries(s, [hurt(p.id, "moderate", [2, 4])], 2027);

    expect(p.injury_status).not.toBeNull();
    expect(p.injury_status!.description).toBe("hamstring");
    expect(p.injury_history.at(-1)).toMatchObject({ season: 2027, severity: "moderate" });
  });

  it("keeps the worse of two injuries — a knock doesn't shorten a broken leg", () => {
    const { s, p } = fixture();
    applyInjuries(s, [hurt(p.id, "severe", [8, 14])], 2027);
    applyInjuries(s, [hurt(p.id, "minor", [1, 1])], 2027);
    expect(p.injury_status!.weeks_out_est![1]).toBe(14);
  });

  it("heals a week at a time and clears when the weeks run out", () => {
    const { s, p } = fixture();
    applyInjuries(s, [hurt(p.id, "moderate", [2, 3])], 2027);
    healOneWeek(s);
    expect(p.injury_status!.weeks_out_est![1]).toBe(2);
    healOneWeek(s);
    healOneWeek(s);
    expect(p.injury_status).toBeNull();
  });

  it("never reports a player as out for zero more weeks", () => {
    const { s, p } = fixture();
    applyInjuries(s, [hurt(p.id, "significant", [4, 6])], 2027);
    for (let i = 0; i < 5; i++) {
      healOneWeek(s);
      if (!p.injury_status) break;
      const [lo, hi] = p.injury_status.weeks_out_est!;
      expect(lo).toBeGreaterThanOrEqual(1);
      expect(lo).toBeLessThanOrEqual(hi);
    }
  });

  it("an offseason clears everything", () => {
    const { s, p } = fixture();
    applyInjuries(s, [hurt(p.id, "season", [17, 17])], 2027);
    clearInjuries(s);
    expect(p.injury_status).toBeNull();
  });

  it("ignores an injury to a player who isn't in the league", () => {
    const { s } = fixture();
    expect(() => applyInjuries(s, [hurt("p_nobody", "minor", [1, 1])], 2027)).not.toThrow();
  });
});

describe("availableRoster", () => {
  function player(id: string, position: string, out: boolean): Player {
    return {
      id, position, name: id, age: 25, nfl_team: "KC", overall: 70,
      injury_status: out ? { status: "out", weeks_out_est: [3, 5], description: "knee" } : null,
    } as unknown as Player;
  }

  it("sits out whoever is out", () => {
    const roster = [player("a", "WR", false), player("b", "WR", true), player("c", "WR", false)];
    expect(availableRoster(roster).map((p) => p.id)).toEqual(["a", "c"]);
  });

  it("sends the least-hurt man out rather than field no quarterback at all", () => {
    // the engine builds its depth chart from what it's given; an empty
    // position is a crash, not a hardship
    const qb1 = player("qb1", "QB", true);
    qb1.injury_status!.weeks_out_est = [8, 12];
    const qb2 = player("qb2", "QB", true);
    qb2.injury_status!.weeks_out_est = [1, 2];
    const out = availableRoster([qb1, qb2, player("wr", "WR", false)]);
    expect(out.map((p) => p.id).sort()).toEqual(["qb2", "wr"]);
  });

  it("leaves a healthy roster alone", () => {
    const roster = [player("a", "QB", false), player("b", "WR", false)];
    expect(availableRoster(roster)).toHaveLength(2);
  });
});
