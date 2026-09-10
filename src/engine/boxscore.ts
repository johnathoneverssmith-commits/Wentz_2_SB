/**
 * Box score extraction (Phase A1).
 *
 * The `Game` object accumulates per-team stat counters and a drive log while it
 * runs; this pulls them into a flat, UI-friendly shape. Team index 0 is home.
 */

import type { DriveRecord, Game } from "./sim.js";

export interface TeamBox {
  team: string;
  points: number;
  totalYards: number;
  passYards: number;
  rushYards: number;
  passAtt: number;
  completions: number;
  rushAtt: number;
  sacksAllowed: number;
  firstDowns: number;
  /** [converted, attempted] */
  thirdDown: [number, number];
  fourthDown: [number, number];
  /** interceptions thrown + fumbles lost */
  turnovers: number;
  penalties: number;
  penaltyYards: number;
  /** [touchdowns, trips] */
  redZone: [number, number];
  explosivePlays: number;
  /** [made, attempted] */
  fieldGoals: [number, number];
  touchdowns: number;
  drives: number;
  possessionSeconds: number;
}

export interface BoxScore {
  week?: number;
  home: TeamBox;
  away: TeamBox;
  /** One row per drive; `team` is 0 (home) or 1 (away). */
  drives: DriveRecord[];
}

function teamBox(game: Game, side: 0 | 1, name: string): TeamBox {
  const s = game.teams[side].s;
  const n = (k: string) => s[k] ?? 0;
  const r = (k: string) => Math.round(n(k));
  // the sim counts `fourth_att` only for *failed* fourth downs (turnover on
  // downs); real attempts = conversions + failures.
  const fourthConv = r("fourth_conv");
  return {
    team: name,
    points: game.score[side],
    totalYards: r("pass_yards") + r("rush_yards"),
    passYards: r("pass_yards"),
    rushYards: r("rush_yards"),
    passAtt: r("pass_att"),
    completions: r("completion"),
    rushAtt: r("rush_att"),
    sacksAllowed: r("sack"),
    firstDowns: r("first_down"),
    thirdDown: [r("third_conv"), r("third_att")],
    fourthDown: [fourthConv, fourthConv + r("fourth_att")],
    turnovers: r("int_thrown") + r("fumble_lost"),
    penalties: r("penalty"),
    penaltyYards: r("penalty_yards"),
    redZone: [r("rz_td"), r("rz_trip")],
    explosivePlays: r("explosive_pass") + r("explosive_rush"),
    fieldGoals: [r("fg_made"), r("fg_att")],
    touchdowns: r("td"),
    drives: r("drives"),
    possessionSeconds: Math.round(n("top")),
  };
}

export function extractBoxScore(
  game: Game,
  homeTeam: string,
  awayTeam: string,
  week?: number,
): BoxScore {
  return {
    ...(week !== undefined ? { week } : {}),
    home: teamBox(game, 0, homeTeam),
    away: teamBox(game, 1, awayTeam),
    drives: game.drivesLog.map((d) => ({ ...d })),
  };
}

/** "mm:ss" from a second count. */
export function clock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const sec = Math.round(seconds % 60);
  return `${m}:${String(sec).padStart(2, "0")}`;
}
