import { describe, expect, it } from "vitest";

import type { LeagueState } from "@/domain";

import { stakeFor, waitingStakes } from "./stakes.ts";
import { createLeague, DEFAULT_CONFIG } from "./seed.ts";

function league(): LeagueState {
  const s = createLeague(21, { ...DEFAULT_CONFIG, humanGmCount: 2, fantasyDraft: false });
  s.gms[0]!.isHuman = true;
  s.gms[0]!.teamCode = "GB";
  s.gms[1]!.isHuman = true;
  s.gms[1]!.teamCode = "KC";
  return s;
}

const setRecord = (s: LeagueState, code: string, w: number, l: number) => {
  s.teams[code]!.wins = w;
  s.teams[code]!.losses = l;
  s.teams[code]!.ties = 0;
};

describe("what's at stake on a waiting screen", () => {
  it("a winless team at the deadline is already looking at next year's mock drafts", () => {
    const s = league();
    s.stage = "tradeDeadline";
    setRecord(s, "GB", 0, 8);
    expect(stakeFor(s, "GB")).toMatch(/0-8 and already looking at mock drafts for 2027\./);
  });

  it("names the Super Bowl favorite", () => {
    const s = league();
    s.stage = "tradeDeadline";
    for (const t of Object.values(s.teams)) t.ratings.overall = 70;
    s.teams.KC!.ratings.overall = 95;
    setRecord(s, "KC", 7, 1);
    expect(stakeFor(s, "KC")).toMatch(/favorite to win the Super Bowl/);
  });

  it("gives every human GM a line, in the offseason too", () => {
    const s = league();
    for (const stage of ["freeAgency", "fantasyDraft", "preseason", "endOfSeasonAnnounce"] as const) {
      s.stage = stage;
      const lines = waitingStakes(s);
      expect(lines.map((l) => l.teamCode).sort(), stage).toEqual(["GB", "KC"]);
      for (const l of lines) expect(l.line.length, `${stage} ${l.teamCode}`).toBeGreaterThan(10);
    }
  });

  it("calls out the team with the most cap room in a market", () => {
    const s = league();
    s.stage = "freeAgency";
    for (const t of Object.values(s.teams)) t.cap = { ...t.cap, used: t.cap.total - 5, dead: 0 };
    s.teams.KC!.cap = { ...s.teams.KC!.cap, used: 100, dead: 0 };
    expect(stakeFor(s, "KC")).toMatch(/most cap room in the league/);
  });
});

describe("what is at stake reads the situation it is in", () => {
  const play = (s: LeagueState, code: string, w: number, l: number) => {
    for (let i = 1; i <= w + l; i++) {
      const won = i <= w;
      s.games.push({ id: `${code}${i}`, week: i, phase: "REG", homeTeam: code, awayTeam: "ZZZ", played: true, homeScore: won ? 24 : 10, awayScore: won ? 10 : 24 } as never);
    }
    setRecord(s, code, w, l);
  };

  it("never calls an undefeated team a bubble team, whatever the odds say", () => {
    const s = league();
    s.stage = "regularSeason";
    play(s, "GB", 8, 0);
    const line = stakeFor(s, "GB");
    expect(line).not.toMatch(/bubble|needs help|fighting|miracle/);
    expect(line).toMatch(/8-0|perfect/);
  });

  it("a team with a losing record is never a contender or a hot start", () => {
    const s = league();
    s.stage = "regularSeason";
    play(s, "GB", 3, 6);
    expect(stakeFor(s, "GB")).not.toMatch(/contender|hot hand|favorite|perfect|unbeaten|threat/);
  });

  it("has real variety across situations and teams", () => {
    const s = league();
    s.stage = "regularSeason";
    const lines = new Set<string>();
    const records: [number, number][] = [[1, 7], [2, 6], [3, 5], [4, 4], [5, 3], [6, 2], [7, 1], [8, 0]];
    for (const code of ["GB", "KC", "CHI", "DET", "MIN", "BUF"]) {
      for (const [w, l] of records) {
        setRecord(s, code, w, l);
        lines.add(stakeFor(s, code).replace(/^.*?\)/, "").trim());
      }
    }
    expect(lines.size).toBeGreaterThan(14);
  });
});
