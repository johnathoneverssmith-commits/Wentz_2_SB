/**
 * The salary cap's growth and the market that grows with it.
 *
 * The cap used to be $255M for ever while every price in the game was a fixed number of dollars. The cap now rises
 * once a year (`growCap`, in the season rollover both the single-player store and the online server share), and
 * `marketScale` is how far it has risen since the league began: the factor on what a contract *issued today* costs.
 *
 * It scales current market prices only: what a free agent asks, a rookie slot, the league minimum, and the working
 * room a front office keeps (a share of the cap, not a number of dollars). It never touches what is already on the
 * books: a contract signed last year, its guarantees and the dead money from a release stay the dollars they were.
 * That is what makes an old deal a bargain as the cap rises, and the old contracts roll off as the market catches up.
 *
 * A league that has not grown (a save from before this) has no `capScale`: the scale is 1 and nothing moves.
 */
import type { LeagueState } from "@/domain";
import { deterministicNoiseUnit } from "./aiDifficulty.ts";

/** The cap a league starts with ($M). */
export const BASE_CAP_M = 255;
/** The cap's average yearly growth, and how far a year's growth strays from it: 5.5% to 9.5%. */
export const CAP_GROWTH_MEAN = 0.075;
export const CAP_GROWTH_SPREAD = 0.02;

/** League minimum, practice-squad and fill-deal prices at a scale of 1 ($M). */
export const BASE_MIN_SALARY_M = 1;

const round1 = (n: number): number => Math.round(n * 10) / 10;

/** How far the cap has risen since the league began (1 for a league that has not grown). */
export function marketScale(s: { capScale?: number | undefined }): number {
  const k = s.capScale;
  return typeof k === "number" && Number.isFinite(k) && k > 0 ? k : 1;
}

/** One league-wide growth rate for the year after `season`: the same on every client, every reload, every team. */
export function capGrowthRate(seed: number | undefined, season: number): number {
  return CAP_GROWTH_MEAN + CAP_GROWTH_SPREAD * deterministicNoiseUnit("league", season, "cap_growth", String(seed ?? 0));
}

/** Raise every team's cap, and the market scale, for the new league year. Returns the rate (0 if this season's rise has already been made). */
export function growCap(s: LeagueState): number {
  if (s.capGrowthSeason === s.season) return 0;
  s.capGrowthSeason = s.season;
  const rate = capGrowthRate(s.seed, s.season);
  s.capScale = marketScale(s) * (1 + rate);
  for (const t of Object.values(s.teams)) t.cap.total = round1(t.cap.total * (1 + rate));
  return rate;
}

/** A dollar amount at today's prices, to a tenth of a million. */
export const scaledM = (baseM: number, s: { capScale?: number | undefined }): number => round1(baseM * marketScale(s));

/** The league minimum salary today ($M). */
export const minSalaryM = (s: { capScale?: number | undefined }): number => scaledM(BASE_MIN_SALARY_M, s);
