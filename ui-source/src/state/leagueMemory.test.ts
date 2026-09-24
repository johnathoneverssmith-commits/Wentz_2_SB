import { describe, expect, it } from "vitest";

import type { GameResult } from "@/domain";

import { rookieSlotSalary } from "./rules.ts";
import { inductHallOfFame, recordSeason, scoringCommittee } from "./seasonAwards.ts";
import { createLeague, DEFAULT_CONFIG } from "./seed.ts";
import { recomputeStandings } from "./standings.ts";

const league = () => createLeague(8, { ...DEFAULT_CONFIG, fantasyDraft: false });

describe("league memory", () => {
  it("keeps records only when they are beaten, and an All-Pro team once a season", () => {
    const s = league();
    const qb = Object.values(s.players).find((p) => p.position === "QB" && s.teams[p.nfl_team])!;
    qb.season_stats = { gamesPlayed: 17, passYds: 5200, passTd: 45 };
    for (const p of Object.values(s.players)) if (s.teams[p.nfl_team] && !p.season_stats) p.season_stats = { gamesPlayed: 16 };
    recordSeason(s);
    expect(s.records!.find((r) => r.stat === "passYds")).toMatchObject({ value: 5200, playerId: qb.id });
    const allPro = s.allPro!.filter((a) => a.season === s.season);
    expect(allPro.filter((a) => a.position === "WR")).toHaveLength(3);
    recordSeason(s);
    expect(s.allPro!.filter((a) => a.season === s.season)).toHaveLength(allPro.length);

    // a lesser season the next year does not replace it
    s.season += 1;
    qb.season_stats = { gamesPlayed: 17, passYds: 4000 };
    recordSeason(s);
    expect(s.records!.find((r) => r.stat === "passYds")!.value).toBe(5200);
  });

  it("inducts a decorated veteran, and not a journeyman", () => {
    const s = league();
    const [star, journeyman] = Object.values(s.players).filter((p) => s.teams[p.nfl_team]);
    star!.career = { seasons: 9, gamesPlayed: 150, peak: 90 };
    journeyman!.career = { seasons: 9, gamesPlayed: 150, peak: 80 };
    s.awards = [{ season: s.season, award: "MVP", playerId: star!.id, name: star!.name, position: star!.position, team: star!.nfl_team, line: "" }];
    // an MVP needs two All-Pro years alongside it
    s.allPro = [s.season, s.season - 1].map((season) => ({ season, playerId: star!.id, name: star!.name, position: star!.position, team: star!.nfl_team }));
    const inducted = inductHallOfFame(s, [star!.id, journeyman!.id]);
    expect(inducted.map((h) => h.playerId)).toEqual([star!.id]);
    expect(inductHallOfFame(s, [star!.id])).toEqual([]); // once
  });
});

describe("team seasons and Coach of the Year", () => {
  it("records every team's season and names the biggest turnaround", () => {
    const s = league();
    for (const c of Object.keys(s.teams)) {
      s.teams[c]!.wins = 8;
      s.teams[c]!.losses = 9;
    }
    recordSeason(s);
    expect(s.teamSeasons!.filter((r) => r.season === s.season)).toHaveLength(32);
    s.season += 1;
    for (const c of Object.keys(s.teams)) {
      s.teams[c]!.wins = 9;
      s.teams[c]!.losses = 8;
    }
    s.teams.NYJ!.wins = 14;
    s.teams.NYJ!.losses = 3;
    recordSeason(s);
    const coy = s.awards!.find((a) => a.season === s.season && a.award === "COY")!;
    expect(coy.team).toBe("NYJ");
    expect(coy.line).toBe("8-9 to 14-3");
  });
});

describe("scoring committee", () => {
  it("nudges a low-scoring league's offense up, a little at a time, within bounds", () => {
    const s = league();
    s.games = Array.from({ length: 100 }, (_, i) => ({
      id: `g${i}`, week: 1, phase: "REG" as const, homeTeam: "KC", awayTeam: "LV", played: true, homeScore: 17, awayScore: 19,
    }));
    scoringCommittee(s);
    expect(s.offenseAdjust).toBeCloseTo(0.08, 5); // capped step
    for (let i = 0; i < 20; i++) scoringCommittee(s);
    expect(s.offenseAdjust).toBe(0.5); // capped total
    s.games = s.games.map((g) => ({ ...g, homeScore: 30, awayScore: 32 }));
    scoringCommittee(s);
    expect(s.offenseAdjust!).toBeLessThan(0.5);
  });
});

describe("standings tiebreakers", () => {
  it("breaks a tie on head-to-head before point differential", () => {
    const s = league();
    const game = (home: string, away: string, hs: number, as: number, week: number): GameResult => ({
      id: `${home}-${away}-${week}`, week, phase: "REG", homeTeam: home, awayTeam: away, played: true, homeScore: hs, awayScore: as,
    });
    // KC and LV both 1-1; LV beat KC, KC has the far better point differential
    s.games = [game("KC", "LV", 10, 13, 1), game("KC", "DEN", 50, 0, 2), game("LV", "DEN", 0, 3, 2)];
    recomputeStandings(s);
    expect(s.teams.LV!.divisionRank).toBeLessThan(s.teams.KC!.divisionRank);
  });
});

describe("rookie wage scale", () => {
  it("pays by pick: the first overall pick about double the thirty-second", () => {
    expect(rookieSlotSalary(1)).toBeGreaterThan(10);
    expect(rookieSlotSalary(1) / rookieSlotSalary(32)).toBeGreaterThan(2);
    expect(rookieSlotSalary(250)).toBe(0.9);
  });
});
