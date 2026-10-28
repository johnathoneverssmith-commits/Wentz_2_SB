/**
 * The league-facing side of the contract evaluator (`contractValue.ts`): the cap, prices and commitments of a real team,
 * read into the evaluator's plain numbers. Free agency, the legacy bidding path and the CPU re-signing all build their
 * context here, so a club prices a free agent and a player it already has the same way.
 */
import type { LeagueState, Player } from "@/domain";

import { marketScale } from "./capEconomy.ts";
import { type TermContext, discountRateFor, extensionSalaryAt, extensionTerms, offerYears, termSubject } from "./contractValue.ts";
import { contractValueFor } from "@/sim/MockSimulationService";

export interface CpuTermOptions {
  /** what the team owes by season from the current one (`commitmentsOf`), where the caller already has it */
  commitments?: readonly number[] | undefined;
  /** how far ahead the team looks (`FaOutlook.horizon`), where it has a recorded window */
  horizon?: number | null | undefined;
  /** never longer than the club's usual length: for signings that fill a roster rather than choose a player */
  shortenOnly?: boolean;
  /** seasons of cap growth before the deal's first season: 0 in the offseason market, 1 when extending at a season's end */
  growthYears?: number;
  /** the market's price for a rating, where it is not the free-agent curve */
  priceOf?: TermContext["priceOf"];
  /** drop this many seasons from the front of the commitments: an extension's first season is next season's */
  skip?: number;
}

export function termContext(s: LeagueState, teamCode: string, o: CpuTermOptions = {}): TermContext {
  const skip = o.skip ?? 0;
  const ctx: TermContext = {
    scale: marketScale(s),
    capM: s.teams[teamCode]?.cap.total ?? 0,
    committed: (o.commitments ?? []).slice(skip),
    growthYears: o.growthYears ?? 0,
    discountRate: discountRateFor(o.horizon),
  };
  if (o.priceOf) ctx.priceOf = o.priceOf;
  return ctx;
}

/** The length of free-agent deal this club offers: its usual one (`contractTermsFor`) moved toward what the evaluator finds the player worth. */
export function cpuOfferYears(
  s: LeagueState,
  teamCode: string,
  p: Player,
  salary: number,
  usualYears: number,
  longTermWeight: number,
  o: CpuTermOptions = {},
): number {
  return offerYears(termSubject(p), termContext(s, teamCode, o), salary, usualYears, longTermWeight, o.shortenOnly ? usualYears : undefined);
}

/**
 * The extension this club would make a player it already has, or null if the market would not pay for what he will be.
 * `ask` is his ask (`extensionAsk`); the terms are never more years than he asked for, and a shorter deal pays what the
 * acceptance rule (`extendContract`) needs, so a person's staff can propose exactly this.
 */
export function cpuExtension(
  s: LeagueState,
  teamCode: string,
  p: Player,
  ask: { baseSalary: number; years: number; guaranteed: number },
  longTermWeight: number,
  o: CpuTermOptions = {},
): { baseSalary: number; years: number; guaranteed: number } | null {
  // he plays the deal's first season a year older than he is at season's end
  const ctx = termContext(s, teamCode, { growthYears: 1, skip: 1, priceOf: contractValueFor, ...o });
  const best = extensionTerms(termSubject(p, p.age + 1), ctx, ask);
  if (!best) return null;
  // the GM's planning horizon decides how far toward the evaluator's length the deal moves from the one he asked for
  const blend = Math.max(0, Math.min(1, longTermWeight));
  const years = Math.max(1, Math.min(ask.years, Math.round(ask.years + blend * (best.years - ask.years))));
  const baseSalary = extensionSalaryAt(ask.baseSalary, ask.years, years);
  // guaranteed money keeps the share of the deal's total he asked for
  const share = ask.guaranteed / Math.max(0.1, ask.baseSalary * ask.years);
  return { baseSalary, years, guaranteed: Math.round(baseSalary * years * share * 10) / 10 };
}
