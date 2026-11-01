/**
 * How a contract's money is spread over its years.
 *
 * Until now every deal a team signed was flat: the same cap hit in every
 * year. A real front office chooses — a backloaded deal costs less now and
 * more later, a frontloaded one the reverse — and the choice has to be a
 * financial one, not a relabelled column. So the same total buys the same
 * player either way, and what changes is *when the cap is charged* and what it
 * costs to leave.
 *
 * The model, deliberately small:
 *
 *  - **Total value is fixed by the structure.** Every structure of a given
 *    (average salary, years) pays the same total. Nothing is gained on the
 *    total by shaping it.
 *  - **Shape.** Base salary in year i is the average times a weight that runs
 *    linearly from `1 - STRUCTURE_TILT` to `1 + STRUCTURE_TILT` (backloaded),
 *    the reverse (frontloaded), or 1 (even). The tilt is capped at 25%, so a
 *    four-year backloaded deal charges ~20% less in year one and ~20% more in
 *    year four than a flat one — real, but not a way to hide a salary.
 *  - **Bonus.** `STRUCTURE_BONUS_SHARE` of the total is a signing bonus,
 *    prorated evenly over the years. It is paid and guaranteed: releasing the
 *    player accelerates whatever is left of it onto this year's cap
 *    (`releasePenalty`). It is also what stops a restructure/extension from
 *    erasing a bill.
 *  - **Leaving.** A structured deal's release cost is the greater of the
 *    accelerated bonus and the league's usual 22%-a-year-left rule *applied to
 *    the deal's average hit*, not this year's. Without that, a backloaded
 *    year-one hit would also be a cheap exit from the expensive years — the
 *    exploit the structure would otherwise create.
 *  - **Compatibility.** The three fields on `Contract` are optional. A deal
 *    without them, or whose pieces no longer add up to its hits, is read
 *    exactly as before.
 */
import type { Player } from "@/domain";

type Contract = NonNullable<Player["contract"]>;

export type ContractStructure = "even" | "backloaded" | "frontloaded";
export const CONTRACT_STRUCTURES: readonly ContractStructure[] = ["even", "backloaded", "frontloaded"];

/** The most a year's base salary may sit above or below the average. */
export const STRUCTURE_TILT = 0.25;
/** The share of a structured deal's total that is a prorated signing bonus. */
export const STRUCTURE_BONUS_SHARE = 0.15;
/** Below two years there is nothing to shape. */
export const MIN_STRUCTURE_YEARS = 2;

const r1 = (n: number): number => Math.round(n * 10) / 10;

export function isStructure(x: unknown): x is ContractStructure {
  return x === "even" || x === "backloaded" || x === "frontloaded";
}

/** Year weights for a structure: they always sum to `years`. */
export function structureWeights(years: number, structure: ContractStructure, tilt = STRUCTURE_TILT): number[] {
  if (years < MIN_STRUCTURE_YEARS || structure === "even") return Array.from({ length: years }, () => 1);
  const dir = structure === "backloaded" ? 1 : -1;
  return Array.from({ length: years }, (_, i) => 1 + dir * tilt * ((2 * i) / (years - 1) - 1));
}

export interface Schedule {
  cap_hit_by_year: number[];
  salary_by_year: number[];
  guaranteed_by_year: number[];
  signing_bonus: number;
  total_value: number;
  guaranteed: number;
  structure: ContractStructure;
}

/**
 * The year-by-year money for a deal of `salary` a year for `years`.
 *
 * `bonus` defaults to `STRUCTURE_BONUS_SHARE` of the total. If the shaped first
 * year would fall under `minSalary`, the tilt is eased until it does not, so no
 * year is ever cheaper than the league minimum.
 */
export function buildSchedule(o: {
  salary: number;
  years: number;
  structure: ContractStructure;
  bonus?: number | undefined;
  minSalary?: number | undefined;
}): Schedule {
  const years = Math.max(1, Math.floor(o.years));
  const total = r1(o.salary * years);
  // a bonus that splits into whole tenths per year, so an even deal's hits are exactly flat
  const rawBonus = Math.min(total, Math.max(0, o.bonus ?? total * STRUCTURE_BONUS_SHARE));
  const bonus = r1(Math.round((rawBonus / years) * 10) / 10 * years);
  const cashTotal = total - bonus;
  const floor = o.minSalary ?? 0;
  let tilt = o.structure === "even" || years < MIN_STRUCTURE_YEARS ? 0 : STRUCTURE_TILT;
  const weights = (): number[] => structureWeights(years, o.structure, tilt);
  const hitsAt = (w: number[]): number => (cashTotal / years) * Math.min(...w) + bonus / years;
  while (tilt > 0 && hitsAt(weights()) < floor) tilt = Math.max(0, Math.round((tilt - 0.05) * 100) / 100);
  const w = weights();

  const bonusPer = Array.from({ length: years }, () => r1(bonus / years));
  const salary = w.map((x) => r1((cashTotal / years) * x));
  // rounding drift goes to the last year, so the deal adds up to its total exactly
  bonusPer[years - 1] = r1(bonus - bonusPer.slice(0, -1).reduce((a, b) => a + b, 0));
  salary[years - 1] = r1(cashTotal - salary.slice(0, -1).reduce((a, b) => a + b, 0));
  const hits = salary.map((x, i) => r1(x + bonusPer[i]!));
  return {
    cap_hit_by_year: hits,
    salary_by_year: salary,
    guaranteed_by_year: bonusPer,
    signing_bonus: bonus,
    total_value: r1(hits.reduce((a, b) => a + b, 0)),
    guaranteed: bonus,
    structure: o.structure,
  };
}

/** The persisted split, if the contract has one and it still adds up. Otherwise null: read it as a flat legacy deal. */
export function scheduleOf(c: Contract | null | undefined): { salary: number[]; bonus: number[] } | null {
  if (!c || !c.salary_by_year || !c.guaranteed_by_year) return null;
  const n = c.cap_hit_by_year.length;
  if (n === 0 || c.salary_by_year.length !== n || c.guaranteed_by_year.length !== n) return null;
  for (let i = 0; i < n; i++) {
    if (Math.abs(c.salary_by_year[i]! + c.guaranteed_by_year[i]! - c.cap_hit_by_year[i]!) > 0.06) return null;
  }
  return { salary: c.salary_by_year, bonus: c.guaranteed_by_year };
}

/** Write a built schedule onto a contract, replacing its money fields. */
export function writeSchedule(c: Contract, s: Schedule): void {
  c.cap_hit_by_year = s.cap_hit_by_year;
  c.salary_by_year = s.salary_by_year;
  c.guaranteed_by_year = s.guaranteed_by_year;
  c.signing_bonus = s.signing_bonus;
  c.total_value = s.total_value;
  c.guaranteed = s.guaranteed;
  c.structure = s.structure;
}

/** Forget the split, leaving a plain flat-schedule contract (for code that rewrites the hits wholesale). */
export function dropSchedule(c: Contract): void {
  delete c.structure;
  delete c.salary_by_year;
  delete c.guaranteed_by_year;
}

/** A year passes: the split steps forward with the hits, or is dropped if it did not line up. */
export function advanceSchedule(c: Contract, shifted: boolean): void {
  if (!shifted) return;
  c.salary_by_year?.shift();
  c.guaranteed_by_year?.shift();
}

/** Bonus money still to be accelerated if he is released now. 0 for a legacy deal. */
export function remainingBonus(c: Contract | null | undefined): number {
  const sch = scheduleOf(c);
  return sch ? r1(sch.bonus.reduce((a, b) => a + b, 0)) : 0;
}

/** The average of a deal's remaining hits: what "annual value" means once the years differ. */
export function averageHit(c: Contract): number {
  const hits = c.cap_hit_by_year.slice(0, Math.max(1, c.years_remaining));
  return hits.length ? hits.reduce((a, b) => a + b, 0) / hits.length : 0;
}

/**
 * The cap hits an extension of `offer` would write for its new years, with old
 * bonus money rolled into them — the unamortized bonus of the years it replaces
 * does not disappear because the deal was extended.
 */
export function planExtension(
  c: Contract,
  offer: { baseSalary: number; years: number; structure?: ContractStructure | undefined },
  minSalary = 0,
): { hits: number[]; schedule: Schedule | null; rolledPerYear: number; carriedPerYear: number } {
  const old = scheduleOf(c);
  const rolled = old ? old.bonus.slice(1).reduce((a, b) => a + b, 0) : 0;
  const rolledPerYear = r1(rolled / Math.max(1, offer.years));
  // The persisted split already holds any restructure money (`restructureContract` adds it to both the split and
  // `prorated_per_year`), so with a split it is the one authority; without one, the legacy proration is.
  const carriedPerYear = old ? rolledPerYear : r1(c.prorated_per_year ?? 0);
  if (!offer.structure) {
    return { hits: Array.from({ length: offer.years }, () => r1(offer.baseSalary + carriedPerYear)), schedule: null, rolledPerYear, carriedPerYear };
  }
  const schedule = buildSchedule({ salary: offer.baseSalary, years: offer.years, structure: offer.structure, minSalary });
  return { hits: schedule.cap_hit_by_year.map((h) => r1(h + carriedPerYear)), schedule, rolledPerYear, carriedPerYear };
}
