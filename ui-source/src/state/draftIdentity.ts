import type { LeagueState, Player } from "@/domain";

import { aiGmOf } from "./aiGms.ts";
import { AI_SEASON_STRATEGIES, type AiSeasonStrategy } from "./aiStrategy.ts";

/**
 * How the fantasy draft's teams compare, by what their GM built them to be.
 *
 * Ranking 32 teams on one number says who is best and nothing about how: the
 * trenches-first team and the pass-heavy one with the same total are different
 * rosters. So the teams are grouped by GM identity and ranked inside their
 * group as well as overall, and each group is described by the units it is
 * stronger at than the league. A person's identity is private, so every person
 * sits in one group of their own.
 */
export type UnitKey = "QB" | "RB" | "WR" | "TE" | "OL" | "DL" | "LB" | "DB";

export const UNIT_LABEL: Record<UnitKey, string> = {
  QB: "Quarterback",
  RB: "Running backs",
  WR: "Receivers",
  TE: "Tight ends",
  OL: "Offensive line",
  DL: "Defensive line",
  LB: "Linebackers",
  DB: "Secondary",
};

const UNITS: Record<UnitKey, { positions: string[]; n: number }> = {
  QB: { positions: ["QB"], n: 1 },
  RB: { positions: ["RB"], n: 1 },
  WR: { positions: ["WR"], n: 3 },
  TE: { positions: ["TE"], n: 1 },
  OL: { positions: ["OT", "OG", "C"], n: 5 },
  DL: { positions: ["EDGE", "DT"], n: 4 },
  LB: { positions: ["ILB", "OLB"], n: 2 },
  DB: { positions: ["CB", "S"], n: 4 },
};

/** The average overall of a team's starters at each unit. */
export function unitAverages(players: Player[], teamCode: string): Record<UnitKey, number> {
  const mine = players.filter((p) => p.nfl_team === teamCode && !p.retired && !p.free_agent);
  const out = {} as Record<UnitKey, number>;
  for (const [unit, { positions, n }] of Object.entries(UNITS) as [UnitKey, { positions: string[]; n: number }][]) {
    const top = mine
      .filter((p) => positions.includes(p.position))
      .map((p) => p.overall)
      .sort((a, b) => b - a)
      .slice(0, n);
    out[unit] = top.length ? top.reduce((a, b) => a + b, 0) / top.length : 0;
  }
  return out;
}

export interface IdentityTeam {
  code: string;
  gm: string;
  overall: number;
  offense: number;
  defense: number;
  overallRank: number;
  /** 1 = best in this group */
  groupRank: number;
}

export interface IdentityGroup {
  key: AiSeasonStrategy | "human";
  teams: IdentityTeam[];
  average: number;
  /** the units this group is built stronger than the league at, biggest first (points of overall) */
  signature: { unit: UnitKey; delta: number }[];
}

export function identityGroups(s: LeagueState): IdentityGroup[] {
  const players = Object.values(s.players);
  const teams = Object.keys(s.teams);
  const units = new Map(teams.map((c) => [c, unitAverages(players, c)]));
  const leagueMean = {} as Record<UnitKey, number>;
  for (const u of Object.keys(UNITS) as UnitKey[]) leagueMean[u] = teams.reduce((n, c) => n + units.get(c)![u], 0) / Math.max(1, teams.length);

  const keyOf = (code: string): IdentityGroup["key"] => {
    if (s.gms.some((g) => g.isHuman && g.teamCode === code)) return "human";
    return aiGmOf(s, code)?.strategy ?? "balanced";
  };
  const gmName = (code: string): string => s.gms.find((g) => g.isHuman && g.teamCode === code)?.name ?? aiGmOf(s, code)?.name ?? "";
  const byKey = new Map<IdentityGroup["key"], string[]>();
  for (const c of teams) byKey.set(keyOf(c), [...(byKey.get(keyOf(c)) ?? []), c]);

  const groups: IdentityGroup[] = [];
  for (const [key, codes] of byKey) {
    const rows: IdentityTeam[] = codes
      .map((code) => ({
        code,
        gm: gmName(code),
        overall: s.teams[code]!.ratings.overall,
        offense: s.teams[code]!.ratings.offense,
        defense: s.teams[code]!.ratings.defense,
        overallRank: s.teams[code]!.ratings.overallRank,
        groupRank: 0,
      }))
      .sort((a, b) => b.overall - a.overall || a.overallRank - b.overallRank);
    rows.forEach((r, i) => (r.groupRank = i + 1));
    const mean = (u: UnitKey): number => codes.reduce((n, c) => n + units.get(c)![u], 0) / codes.length;
    const signature = (Object.keys(UNITS) as UnitKey[])
      .map((unit) => ({ unit, delta: Math.round((mean(unit) - leagueMean[unit]) * 10) / 10 }))
      .filter((x) => x.delta >= 0.8)
      .sort((a, b) => b.delta - a.delta)
      .slice(0, 2);
    groups.push({ key, teams: rows, average: Math.round((rows.reduce((n, r) => n + r.overall, 0) / rows.length) * 10) / 10, signature });
  }
  // the CPU identities in their usual order, then the people
  const order = (k: IdentityGroup["key"]): number => (k === "human" ? 99 : AI_SEASON_STRATEGIES.indexOf(k));
  return groups.sort((a, b) => order(a.key) - order(b.key));
}
