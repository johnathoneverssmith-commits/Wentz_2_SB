/**
 * The two moves a front office makes on a contract it already owns.
 *
 * Both were buttons on Roster & Cap that said "Not available in this build
 * yet" — which left a GM with exactly one lever for cap trouble (cut the
 * player) and no way at all to keep someone they wanted. Real cap management
 * is mostly these two.
 */
import type { LeagueState, Player } from "@/domain";
import { contractValueFor } from "@/sim/MockSimulationService";
import { playerPriorities } from "@/sim/priorities";

const round1 = (n: number): number => Math.round(n * 10) / 10;

/** The league minimum; a restructure can never take a salary below it. */
const MIN_SALARY_M = 1;

/**
 * The most a restructure converts, as a share of this year's hit above the
 * minimum. The real rule is that base salary can be converted to bonus almost
 * without limit; the cap here is a stand-in for the part a player's agent
 * won't sign away, and it keeps a single restructure from being a magic wand.
 *
 * Free Agency + Contracts optimization pass (contracts.restructure).
 */
const CONVERTIBLE_SHARE = 0.75;

export interface ContractMoveResult {
  ok: boolean;
  reason?: string;
  /** cap freed this year, for the confirmation the screen shows */
  freed?: number | undefined;
}

/**
 * What a restructure converts and where it lands, without applying it.
 *
 * Shared by `previewRestructure` (reports `freed`) and `restructureContract`
 * (applies `hits`) so the two can never quietly disagree about how much this
 * year is actually relieved by — which independently re-deriving the same
 * rounding twice already once let happen (see the note on `othersChange`).
 */
function planRestructure(
  c: NonNullable<Player["contract"]>,
): { convertible: number; perYear: number; hits: number[] } {
  const years = c.years_remaining;
  const thisYear = c.cap_hit_by_year[0] ?? 0;
  const convertible = round1(Math.max(0, thisYear - MIN_SALARY_M) * CONVERTIBLE_SHARE);
  const perYear = convertible / years;

  // Round every later year first, then let this year absorb whatever their
  // independent rounding didn't take — otherwise rounding `perYear` onto
  // each year separately (rounding this year's cut by the same `perYear`
  // rounded the same way) can drift the total by a few cents' worth of
  // cap space that's supposed to only move, never appear or vanish.
  const hits = [...c.cap_hit_by_year];
  let othersChange = 0;
  for (let i = 1; i < years; i++) {
    const before = hits[i] ?? 0;
    const after = round1(before + perYear);
    hits[i] = after;
    othersChange += after - before;
  }
  hits[0] = round1((hits[0] ?? 0) - othersChange);
  return { convertible, perYear, hits };
}

/** What a restructure would do, without doing it. */
export function previewRestructure(p: Player, season: number): ContractMoveResult {
  const c = p.contract;
  if (!c) return { ok: false, reason: "He isn't under contract." };
  if (c.years_remaining < 2) {
    return {
      ok: false,
      reason: "A restructure pushes money into later years, and this deal has none left. Extend him first.",
    };
  }
  // exploit audit (contracts §3, "repeated restructure loop"): the 75%-of-
  // margin conversion cap is meant to apply once — without this gate, a GM
  // could click Restructure repeatedly in one sitting and, across three or
  // four clicks, convert nearly all of a contract's remaining value instead
  // of 75% of it (e.g. a $20M year-one hit: one restructure frees ~$14.3M;
  // three back-to-back restructures free ~$18.7M of the same contract).
  if (c.restructured_season === season) {
    return { ok: false, reason: "Already restructured this season. One restructure a year, same as real cap rules." };
  }
  const thisYear = c.cap_hit_by_year[0] ?? 0;
  const convertible = round1(Math.max(0, thisYear - MIN_SALARY_M) * CONVERTIBLE_SHARE);
  if (convertible < 0.5) {
    return { ok: false, reason: "He's already close enough to the minimum that there's nothing to convert." };
  }
  const { hits } = planRestructure(c);
  const freed = round1(thisYear - hits[0]!);
  return { ok: true, freed };
}

/**
 * Converts base salary into a prorated signing bonus: this year gets cheaper,
 * every later year of the deal gets dearer by the same total.
 *
 * The cost is the one the real rule has: the money doesn't go away, it just
 * arrives later, and it becomes guaranteed on the way — releasing him after
 * accelerates it onto this year's cap as dead money (`releasePenalty`).
 */
export function restructureContract(p: Player, season: number): ContractMoveResult {
  const check = previewRestructure(p, season);
  if (!check.ok) return check;
  const c = p.contract!;
  const { convertible, perYear, hits } = planRestructure(c);
  c.cap_hit_by_year = hits;
  c.signing_bonus = round1(c.signing_bonus + convertible);
  c.guaranteed = round1(c.guaranteed + convertible);
  // the converted money now sits on every year of the deal, and follows him
  // through an extension — otherwise restructuring and then extending would
  // make the bill disappear, which is the one thing proration never does
  c.prorated_per_year = round1((c.prorated_per_year ?? 0) + perYear);
  c.restructured_season = season;
  return { ok: true, freed: check.freed };
}

/** What the player is asking for to sign on for more years. */
export function extensionAsk(p: Player): { baseSalary: number; years: number; guaranteed: number } {
  const market = contractValueFor(p.overall, p.position);
  const want = playerPriorities(p);
  // an extension is negotiated a year early, so it is priced off what he is
  // worth now with a nod to what he'll be worth then — older players take a
  // discount, players still climbing want a premium
  // contracts.extension: young/veteran factors from the optimization pass.
  const ageFactor = p.age >= 31 ? 0.88 : p.age <= 25 ? 1.08 : 1;
  const baseSalary = round1(Math.max(MIN_SALARY_M, market * ageFactor));
  const years = Math.max(1, Math.min(5, want.expectation.years + 1));
  return { baseSalary, years, guaranteed: round1(baseSalary * years * 0.45) };
}

/**
 * Adds years to a deal at a newly negotiated rate.
 *
 * The extension replaces everything from next season on: this year's hit
 * stands (it's already been budgeted for), and the new term runs from there.
 * A player takes it if the offer is at least as good as what he'd expect on
 * the open market — `extensionAsk` is that number, and the screen shows it
 * before anyone commits.
 */
export function extendContract(
  state: LeagueState,
  p: Player,
  offer: { baseSalary: number; years: number; guaranteed: number },
): ContractMoveResult {
  const c = p.contract;
  if (!c) return { ok: false, reason: "He isn't under contract." };
  if (offer.years < 1) return { ok: false, reason: "An extension has to add at least a year." };

  const ask = extensionAsk(p);
  const offered = offer.baseSalary * offer.years + offer.guaranteed;
  const wanted = ask.baseSalary * ask.years + ask.guaranteed;
  // contracts.extension.accept_fraction.
  if (offered < wanted * 0.96) {
    return {
      ok: false,
      reason: `He turned it down. ${p.name} is looking for about $${ask.baseSalary.toFixed(1)}M a year over ${ask.years} years.`,
    };
  }

  const team = state.teams[p.nfl_team];
  if (team) {
    // the extension years have to fit under the cap in the first of them
    const capNextYear =
      team.cap.used - (c.cap_hit_by_year[1] ?? 0) + offer.baseSalary + (c.prorated_per_year ?? 0);
    if (capNextYear > team.cap.total) {
      const over = round1(capNextYear - team.cap.total);
      return {
        ok: false,
        reason: `That deal puts next year's cap $${over.toFixed(1)}M over. Lower the salary, or clear room first.`,
      };
    }
  }

  applyExtension(p, offer);
  return { ok: true };
}

/** Rewrite a deal as extended — the part of `extendContract` after the checks. */
export function applyExtension(p: Player, offer: { baseSalary: number; years: number; guaranteed: number }): void {
  const c = p.contract;
  if (!c) return;
  const thisYear = c.cap_hit_by_year[0] ?? 0;
  const carried = c.prorated_per_year ?? 0; // old restructure money, still owed
  c.years_remaining = 1 + offer.years;
  c.cap_hit_by_year = [
    thisYear,
    ...Array.from({ length: offer.years }, () => round1(offer.baseSalary + carried)),
  ];
  c.total_value = round1(thisYear + (offer.baseSalary + carried) * offer.years);
  c.guaranteed = round1(offer.guaranteed);
}
