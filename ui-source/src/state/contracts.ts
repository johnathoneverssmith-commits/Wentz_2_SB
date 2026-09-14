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
 */
const CONVERTIBLE_SHARE = 0.8;

export interface ContractMoveResult {
  ok: boolean;
  reason?: string;
  /** cap freed this year, for the confirmation the screen shows */
  freed?: number;
}

/** What a restructure would do, without doing it. */
export function previewRestructure(p: Player): ContractMoveResult {
  const c = p.contract;
  if (!c) return { ok: false, reason: "He isn't under contract." };
  if (c.years_remaining < 2) {
    return {
      ok: false,
      reason: "A restructure pushes money into later years, and this deal has none left. Extend him first.",
    };
  }
  const thisYear = c.cap_hit_by_year[0] ?? 0;
  const convertible = round1(Math.max(0, thisYear - MIN_SALARY_M) * CONVERTIBLE_SHARE);
  if (convertible < 0.5) {
    return { ok: false, reason: "He's already close enough to the minimum that there's nothing to convert." };
  }
  // the converted money is spread across every remaining year, this one included
  const freed = round1(convertible - convertible / c.years_remaining);
  return { ok: true, freed };
}

/**
 * Converts base salary into a prorated signing bonus: this year gets cheaper,
 * every later year of the deal gets dearer by the same total.
 *
 * There is no dead money in this build, so the only cost of a restructure is
 * the one the real rule has too — the money doesn't go away, it just arrives
 * later, and it becomes guaranteed on the way.
 */
export function restructureContract(p: Player): ContractMoveResult {
  const check = previewRestructure(p);
  if (!check.ok) return check;
  const c = p.contract!;
  const years = c.years_remaining;
  const thisYear = c.cap_hit_by_year[0] ?? 0;
  const convertible = round1(Math.max(0, thisYear - MIN_SALARY_M) * CONVERTIBLE_SHARE);
  const perYear = convertible / years;

  const hits = [...c.cap_hit_by_year];
  hits[0] = round1((hits[0] ?? 0) - convertible + perYear);
  for (let i = 1; i < years; i++) hits[i] = round1((hits[i] ?? 0) + perYear);
  c.cap_hit_by_year = hits;
  c.signing_bonus = round1(c.signing_bonus + convertible);
  c.guaranteed = round1(c.guaranteed + convertible);
  // the converted money now sits on every year of the deal, and follows him
  // through an extension — otherwise restructuring and then extending would
  // make the bill disappear, which is the one thing proration never does
  c.prorated_per_year = round1((c.prorated_per_year ?? 0) + perYear);
  return { ok: true, freed: check.freed };
}

/** What the player is asking for to sign on for more years. */
export function extensionAsk(p: Player): { baseSalary: number; years: number; guaranteed: number } {
  const market = contractValueFor(p.overall, p.position);
  const want = playerPriorities(p);
  // an extension is negotiated a year early, so it is priced off what he is
  // worth now with a nod to what he'll be worth then — older players take a
  // discount, players still climbing want a premium
  const ageFactor = p.age >= 31 ? 0.82 : p.age <= 25 ? 1.12 : 1;
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
  if (offered < wanted * 0.92) {
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

  const thisYear = c.cap_hit_by_year[0] ?? 0;
  const carried = c.prorated_per_year ?? 0; // old restructure money, still owed
  c.years_remaining = 1 + offer.years;
  c.cap_hit_by_year = [
    thisYear,
    ...Array.from({ length: offer.years }, () => round1(offer.baseSalary + carried)),
  ];
  c.total_value = round1(thisYear + (offer.baseSalary + carried) * offer.years);
  c.guaranteed = round1(offer.guaranteed);
  return { ok: true };
}
