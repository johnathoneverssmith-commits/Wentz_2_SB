/**
 * What a multiyear contract is worth to the team that signs it, year by year, and so how many years it should run.
 *
 * Until B2b a CPU front office chose a deal's length from the player's age and quality alone (`contractTermsFor`) and
 * its price from today's market (`expectedSalary`): neither the decline the game will really apply, nor the cap's yearly
 * rise (C1), nor what the team already owes in those years was looked at. This prices each year of a deal on its own:
 *
 *   net(t) = discount(t) x ( survival(t) x (what his projected rating would cost on the market that year - what he is paid)
 *                            - cap-flexibility penalty )
 *
 * - **His rating in year t** is the mean of the game's own aging model (`expectedAgingDelta`), from his own development and
 *   decline ages, not a position's table. A player past his decline age loses a point or more a year and the market curve
 *   is steep, so his later years go negative on their own.
 * - **What it would cost** is the market's price for that rating (`expectedSalary`; the curve is not changed) in that
 *   year's dollars: the cap rises about 7.5% a year (C1), so a flat salary buys more every year. That is what makes a long
 *   deal for a player in his prime worth more than a short one, and a long deal for a decliner worth less.
 * - **Survival** is the chance he is still playing (`retirementChance`, the review's own rule). A retired player's
 *   contract comes off the cap with nothing owed (`capUsedOf` skips him), so a year he will not play costs nothing and
 *   gives nothing. The cap-flexibility penalty is *not* weighted by it: how much room a team has left in a year is read as
 *   if everyone it owes were still there, so the evaluator never likes a deal *because* the player may retire.
 * - **Cap flexibility** is a soft penalty on money in a year the team has already committed most of its (projected) cap
 *   to. Only a deal that would take a future year past the whole projected cap is cut short of that year.
 * - **The team's window** sets how heavily later seasons count: a contender weights the next season or two, a rebuild
 *   looks further out (`discountRateFor`).
 *
 * The length is chosen by the *marginal* year, not the best total: each year added has to earn a small margin over its
 * pay, and the first that does not ends the term, so a long tail of near-zero or negative years cannot hide behind a big
 * early surplus.
 *
 * Plain numbers in, numbers out. Nothing here reads a league, draws a random number or changes anything.
 */
import type { Player, Position } from "@/domain";
import { expectedAgingDelta, retirementChance } from "@/sim/MockSimulationService";
import { CAP_GROWTH_MEAN, CAP_GROWTH_SPREAD } from "./capEconomy.ts";
import { expectedSalary } from "./freeAgencyValues.ts";

/** The longest deal there is. */
export const MAX_TERM_YEARS = 5;

/** What a year has to earn, as a share of its (discounted) pay, to be added to a term. */
export const YEAR_MARGIN = 0.02;
/** A year beyond the length the club would have offered anyway has to earn this many times as much. */
export const EXTRA_YEAR_MARGIN_FACTOR = 3;

/** The share of the projected cap a team can already owe in a year before more money there costs flexibility. */
export const FLEX_COMFORT = 0.85;
/** What money in a year at the projected cap costs, as a share of the money, once the comfort is used up. */
export const FLEX_RATE = 0.5;
/** The projected cap itself: a deal that would take a future year past it is cut short of that year. */
export const HARD_CAP_SHARE = 1;
/**
 * The cap's yearly rise that *room* is planned on: the low end of what C1 draws (5.5%), not its 7.5% mean. Prices are projected at the
 * mean, because a rating's value is an expectation; but a team that spends to the line of the average cap is over it in every
 * slow year (about one in four), and then cuts players and pays dead money for it.
 */
export const CAP_PLANNING_GROWTH = CAP_GROWTH_MEAN - CAP_GROWTH_SPREAD;

/** The discount on a later season for a team that looks a season ahead; see `discountRateFor`. */
export const DISCOUNT_BASE = 0.1;

/** The share of his ask an extension's total has to reach for the player to take it (`extendContract`). */
export const EXTENSION_ACCEPT = 0.96;

/** The player facts the evaluator reads. */
export interface TermSubject {
  position: Position;
  overall: number;
  /** his age in the first season of the deal */
  age: number;
  dev_age_threshold: number;
  decline_age_threshold: number;
  potential?: number | undefined;
  injury_history: Player["injury_history"];
}

/** The team and league the deal is made in. */
export interface TermContext {
  /** how far the cap has risen since the league began (`marketScale`): the price level of today */
  scale: number;
  /** the team's cap now, $M */
  capM: number;
  /** what the team already owes by season, $M: index 0 is the first season of the deal. Anything missing is 0. */
  committed: readonly number[];
  /** whole seasons of cap growth between now and the deal's first season: 0 in the offseason market, 1 when a team extends at season's end */
  growthYears: number;
  /** how much a later season is worth less than this one (`discountRateFor`) */
  discountRate: number;
  /** the cap's yearly rise to plan prices on */
  growth?: number;
  /** the cap's yearly rise to plan room on (`CAP_PLANNING_GROWTH`) */
  capGrowth?: number;
  /** what a rating costs on the market, $M a year (the default is the free-agent market's curve) */
  priceOf?: (rating: number, position: Position, scale: number) => number;
}

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));

/**
 * How much a team discounts a later season, from how far ahead it looks (`FaOutlook.horizon`: 0 for a contender, 1
 * in between, 2 for a rebuild): about 17% a year for a contender, 10% in between, 3% for a rebuild. A team with no recorded
 * window (a save from before it was kept) is in between.
 */
export function discountRateFor(horizon: number | null | undefined): number {
  if (horizon === null || horizon === undefined) return DISCOUNT_BASE;
  return clamp(DISCOUNT_BASE + 0.07 * (1 - horizon), 0.03, 0.17);
}

/** The rating he is expected to have in each season of the deal, from his own development and decline ages. */
export function projectRatings(
  p: TermSubject,
  years: number,
  /** whether the first season is one he is yet to age into (the offseason market, before camp), as opposed to the one being played */
  agedFirst = true,
): number[] {
  const out: number[] = [];
  let rating = p.overall;
  for (let t = 0; t < years; t++) {
    if (t > 0 || agedFirst) {
      const room = p.potential === undefined ? undefined : p.potential - rating;
      rating = clamp(rating + expectedAgingDelta(p.age + t, p.dev_age_threshold, p.decline_age_threshold, room), 40, 99);
    }
    out.push(rating);
  }
  return out;
}

/** The chance he is still playing in each season of the deal: 1 in the first, then through each end-of-season review. */
export function survivalByYear(p: TermSubject, ratings: readonly number[]): number[] {
  const out: number[] = [];
  let alive = 1;
  for (let t = 0; t < ratings.length; t++) {
    if (t > 0) {
      const { chance, eligible } = retirementChance({
        position: p.position,
        age: p.age + t - 1,
        overall: ratings[t - 1]!,
        decline_age_threshold: p.decline_age_threshold,
        injury_history: p.injury_history,
      });
      if (eligible) alive *= 1 - chance;
    }
    out.push(alive);
  }
  return out;
}

const marketPrice = (rating: number, position: Position, scale: number): number =>
  // the neutral age: the market's veteran discount stands in for decline, which is projected in the rating instead
  expectedSalary({ overall: rating, position, age: 26 } as Player, scale);

/** One length of deal, priced year by year. */
export interface TermPlan {
  years: number;
  /** $M a year this length would pay */
  salary: number;
  /** what each year adds, in $M of today's dollars (weighted by survival and the window, less the cap-flexibility penalty) */
  net: number[];
  /** the running total through each year */
  cumulative: number[];
  /** how many seasons of it fit under the projected cap: the first season the deal would take past it ends the count */
  fits: number;
}

/** Price a deal of `years` years at `salary` a year. */
export function planTerm(p: TermSubject, ctx: TermContext, years: number, salary: number): TermPlan {
  const growth = ctx.growth ?? CAP_GROWTH_MEAN;
  const capGrowth = ctx.capGrowth ?? CAP_PLANNING_GROWTH;
  const price = ctx.priceOf ?? marketPrice;
  const ratings = projectRatings(p, years);
  const survival = survivalByYear(p, ratings);
  const net: number[] = [];
  const cumulative: number[] = [];
  let fits = years;
  let total = 0;
  for (let t = 0; t < years; t++) {
    const level = (1 + growth) ** (ctx.growthYears + t);
    const fair = price(ratings[t]!, p.position, ctx.scale * level);
    const cap = ctx.capM * (1 + capGrowth) ** (ctx.growthYears + t);
    const owed = (ctx.committed[t] ?? 0) + salary;
    if (fits === years && owed > cap * HARD_CAP_SHARE) fits = t;
    const flex = FLEX_RATE * salary * clamp((owed / cap - FLEX_COMFORT) / (HARD_CAP_SHARE - FLEX_COMFORT), 0, 1);
    const weight = 1 / (1 + ctx.discountRate) ** t;
    const year = weight * (survival[t]! * (fair - salary) - flex);
    net.push(year);
    total += year;
    cumulative.push(total);
  }
  return { years, salary, net, cumulative, fits };
}

export interface TermChoice {
  years: number;
  /** the plan for the length chosen */
  plan: TermPlan;
  /** every length that was priced, shortest first: the evidence for the choice */
  considered: TermPlan[];
}

/**
 * The length a deal should run. Scans from one year, adding a year while the *last year added* earns at least its margin
 * (more beyond `usual`, the length the club would have offered without this evaluator), the deal as a whole is not under
 * water, and the cap allows it; the first year that fails ends the term. `salaryAt` is what a deal of that length pays a
 * year (a free-agent offer pays the same at any length).
 */
export function chooseTerm(
  p: TermSubject,
  ctx: TermContext,
  salaryAt: (years: number) => number,
  usual: number,
  maxYears = MAX_TERM_YEARS,
): TermChoice {
  const top = clamp(usual + 1, 1, maxYears);
  const considered: TermPlan[] = [];
  let years = 1;
  let prev = 0;
  for (let n = 1; n <= top; n++) {
    const plan = planTerm(p, ctx, n, salaryAt(n));
    considered.push(plan);
    const total = plan.cumulative[n - 1]!;
    if (n > 1) {
      const marginal = total - prev;
      const margin = YEAR_MARGIN * plan.salary * (1 / (1 + ctx.discountRate) ** (n - 1)) * (n > usual ? EXTRA_YEAR_MARGIN_FACTOR : 1);
      if (marginal < margin || total < 0 || plan.fits < n) break;
      years = n;
    }
    prev = total;
  }
  return { years, plan: considered[years - 1]!, considered };
}

/**
 * The length a club offers a free agent: its usual length (`contractTermsFor`, which keeps each club's own lean) moved
 * toward what the evaluator would choose by how far the GM plans ahead (`longTermWeight`: an Expert takes all of it, a
 * Casual under half), never below a year or above five.
 */
export function offerYears(
  p: TermSubject,
  ctx: TermContext,
  salary: number,
  usual: number,
  longTermWeight: number,
  /** the longest to offer: `usual` for a signing that may be shortened but not stretched (the roster fill's depth) */
  maxYears = MAX_TERM_YEARS,
): number {
  const choice = chooseTerm(p, ctx, () => salary, usual, maxYears).years;
  return clamp(Math.round(usual + clamp(longTermWeight, 0, 1) * (choice - usual)), 1, MAX_TERM_YEARS);
}

/** What an extension for `years` pays a year when he asked for `askYears` at `askSalary`: the same, or more for fewer years. */
export function extensionSalaryAt(askSalary: number, askYears: number, years: number): number {
  if (years >= askYears) return askSalary;
  // rounded up: a tenth short of the acceptance rule's 96% would be a deal he turns down
  return Math.ceil(Math.max(askSalary, (EXTENSION_ACCEPT * askSalary * askYears) / years) * 10 - 1e-9) / 10;
}

/**
 * The extension a club makes, or null for none. Its terms stay ones the player's acceptance rule takes (`extendContract`
 * wants at least 96% of the ask's total), so a person's staff can propose exactly this, and are never more years than he
 * asked for. A shorter deal costs more a year (`extensionSalaryAt`), so the choice is between the deal he asked for and
 * a shorter one at its higher price: from the full length down, the first whose *last* year earns its margin at its own
 * price and whose total does not lose more than a quarter of a year's pay. Null when none does: a contract the market
 * would not pay for what he will be.
 */
export function extensionTerms(
  p: TermSubject,
  ctx: TermContext,
  ask: { baseSalary: number; years: number },
): { years: number; baseSalary: number } | null {
  for (let n = clamp(ask.years, 1, MAX_TERM_YEARS); n >= 1; n--) {
    const salary = extensionSalaryAt(ask.baseSalary, ask.years, n);
    const plan = planTerm(p, ctx, n, salary);
    if (plan.fits < n) continue;
    const margin = n > 1 ? YEAR_MARGIN * salary * (1 / (1 + ctx.discountRate) ** (n - 1)) : -Infinity;
    if (plan.net[n - 1]! >= margin && plan.cumulative[n - 1]! >= -0.25 * salary) return { years: n, baseSalary: salary };
  }
  return null;
}

/**
 * What the rest of a player's contract is worth to a team that holds it, $M: each remaining year, the market price of the rating
 * he is projected to have that year (in that year's dollars, the cap rising as C1 draws it) less what he is paid, weighted by the
 * chance he is still playing and discounted. Negative for a veteran whose pay outlasts his play. It is the same projection a
 * contract is signed on (`planTerm`), so a deal and its trade value are judged alike.
 */
export function contractSurplusM(
  p: Player,
  o: {
    /** how far the cap has risen since the league began */
    scale: number;
    /** the share of this season still to be played (1 in the offseason) */
    firstYearShare: number;
    /** whether he is yet to age into the first season (the offseason) or is playing it */
    agedFirst: boolean;
    growth?: number;
    discountRate?: number;
  },
): number {
  const c = p.contract;
  if (!c || p.retired) return 0;
  const years = Math.min(c.years_remaining, MAX_TERM_YEARS + 1);
  if (years <= 0) return 0;
  // a schedule shorter than the years left (an old save, a hand-built deal) repeats its last hit
  const hits = c.cap_hit_by_year;
  const payIn = (t: number): number => hits[t] ?? hits[hits.length - 1] ?? 0;
  const sub = termSubject(p);
  const ratings = projectRatings(sub, years, o.agedFirst);
  const alive = survivalByYear(sub, ratings);
  const growth = o.growth ?? CAP_GROWTH_MEAN;
  const rate = o.discountRate ?? DISCOUNT_BASE;
  let total = 0;
  for (let t = 0; t < years; t++) {
    const fair = marketPrice(ratings[t]!, p.position, o.scale * (1 + growth) ** t);
    const share = t === 0 ? o.firstYearShare : 1;
    total += (share * alive[t]! * (fair - payIn(t))) / (1 + rate) ** t;
  }
  return total;
}

/** What each team owes, by season from the current one, in $M: its rostered players' cap hits for the years they have left. */
export function commitmentsOf(players: Iterable<Player>, years = MAX_TERM_YEARS + 1): Map<string, number[]> {
  const out = new Map<string, number[]>();
  for (const p of players) {
    if (p.retired || p.free_agent || !p.contract) continue;
    let row = out.get(p.nfl_team);
    if (!row) out.set(p.nfl_team, (row = new Array<number>(years).fill(0)));
    const c = p.contract;
    for (let t = 0; t < years && t < c.years_remaining; t++) row[t]! += c.cap_hit_by_year[t] ?? 0;
  }
  return out;
}

/** A player as the evaluator reads him, `age` being his age in the first season of the deal. */
export function termSubject(p: Player, age: number = p.age): TermSubject {
  return {
    position: p.position,
    overall: p.overall,
    age,
    dev_age_threshold: p.dev_age_threshold,
    decline_age_threshold: p.decline_age_threshold,
    potential: p.potential,
    injury_history: p.injury_history,
  };
}
