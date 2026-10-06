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
      reason: `He turned it down. ${p.name} is looking for about $${ask.baseSalary.toFixed(1)}M a year over ${ask.years} year${ask.years === 1 ? "" : "s"}.`,
    };
  }

  const team = state.teams[p.nfl_team];
  if (team) {
    // the extension years have to fit under the cap in the first of them:
    // next year's commitments (every deal that runs past this one), with his
    // new salary in place of whatever he was due. This used to start from this
    // year's payroll, which in season sits a few million under the cap, so a
    // person could almost never extend a star while the CPU teams, budgeting
    // against next year as here (`planCoreResign`), always could.
    const capNextYear =
      nextYearCommitments(state, p.nfl_team) - (c.years_remaining >= 2 ? (c.cap_hit_by_year[1] ?? 0) : 0) + offer.baseSalary + (c.prorated_per_year ?? 0);
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

/** What a team already owes next season: every contract that runs past this one. */
export function nextYearCommitments(state: LeagueState, teamCode: string): number {
  let n = 0;
  for (const x of Object.values(state.players)) {
    if (x.nfl_team !== teamCode || x.retired || x.free_agent || !x.contract) continue;
    if ((x.contract.years_remaining ?? 0) >= 2) n += x.contract.cap_hit_by_year[1] ?? 0;
  }
  return Math.round(n * 10) / 10;
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
  // paid: a new deal ends a holdout, and replaces any tag or option
  delete p.holdout;
  delete c.franchise_tag_season;
  delete c.franchise_tag_price;
  c.option_exercised = true;
}

// ---- the franchise tag and the fifth-year option ---------------------------

const capHit = (p: Player): number => p.contract?.cap_hit_by_year[0] ?? 0;

/**
 * What a tag costs: the average of the five biggest cap hits at his position
 * — the real tender's formula — and never less than 120% of what he makes
 * now, which is what makes a second and third tag expensive.
 */
export function franchiseTagPrice(state: LeagueState, p: Player): number {
  const top = Object.values(state.players)
    .filter((x) => x.position === p.position && x.contract && !x.retired && !x.free_agent)
    .map(capHit)
    .sort((a, b) => b - a)
    .slice(0, 5);
  const avg = top.length ? top.reduce((a, b) => a + b, 0) / top.length : contractValueFor(p.overall, p.position);
  return round1(Math.max(avg, capHit(p) * 1.2, MIN_SALARY_M));
}

/**
 * The fifth-year option's price, tiered as the real one is: a star (the
 * multiple-Pro-Bowl tier) costs the tag; a very good player the average of
 * the 3rd-20th biggest cap hits at his position; anyone else the 3rd-25th.
 * A flat fraction of the tag priced a backup quarterback's option at $48M.
 */
export function fifthYearPrice(state: LeagueState, p: Player): number {
  if (p.overall >= 90) return franchiseTagPrice(state, p);
  const hits = Object.values(state.players)
    .filter((x) => x.position === p.position && x.contract && !x.retired && !x.free_agent)
    .map(capHit)
    .sort((a, b) => b - a);
  // the real ranks are out of 32 teams; a smaller league scales them down
  const scale = Math.min(1, Object.keys(state.teams).length / 32);
  const lo = Math.max(0, Math.round(2 * scale));
  const hi = Math.max(lo + 1, Math.round((p.overall >= 84 ? 20 : 25) * scale));
  const band = hits.slice(lo, hi);
  const avg = band.length ? band.reduce((a, b) => a + b, 0) / band.length : contractValueFor(p.overall, p.position);
  return round1(Math.max(avg, capHit(p) * 1.1, MIN_SALARY_M));
}

/** Next year's cap with this player's next-year hit replaced by `price`. */
function fitsNextYear(state: LeagueState, p: Player, price: number): ContractMoveResult {
  const team = state.teams[p.nfl_team];
  const c = p.contract;
  if (!team || !c) return { ok: true };
  const capNextYear = team.cap.used - (c.cap_hit_by_year[1] ?? 0) + price;
  if (capNextYear > team.cap.total) {
    return {
      ok: false,
      reason: `That puts next year's cap $${round1(capNextYear - team.cap.total).toFixed(1)}M over. Clear room first.`,
    };
  }
  return { ok: true };
}

/**
 * Can this player be tagged, and for how much.
 *
 * In his final contract year, one player a team a season. The tag keeps him
 * off the market for one more year at the tender; it is how a team keeps a
 * star it can't agree terms with, and why it is dear.
 */
export function previewFranchiseTag(state: LeagueState, p: Player): ContractMoveResult & { price?: number } {
  const c = p.contract;
  if (!c || p.free_agent || p.retired) return { ok: false, reason: "He isn't under contract." };
  if (c.years_remaining !== 1) return { ok: false, reason: "Only a player in the last year of his deal can be tagged." };
  if (c.franchise_tag_season === state.season) return { ok: false, reason: "He's already tagged for next season." };
  const taken = Object.values(state.players).find(
    (x) => x.nfl_team === p.nfl_team && x.id !== p.id && x.contract?.franchise_tag_season === state.season,
  );
  if (taken) return { ok: false, reason: `One tag a season, and ${taken.name} already has it.` };
  const price = franchiseTagPrice(state, p);
  const fits = fitsNextYear(state, p, price);
  return fits.ok ? { ok: true, price } : { ...fits, price };
}

export function franchiseTag(state: LeagueState, p: Player): ContractMoveResult {
  const check = previewFranchiseTag(state, p);
  if (!check.ok) return check;
  const c = p.contract!;
  c.franchise_tag_season = state.season;
  c.franchise_tag_price = check.price!;
  return { ok: true };
}

/**
 * Turns a tag into next year's deal as the contract runs out. Called from
 * `expireContracts` for a deal that just reached zero years.
 */
export function applyTagIfAny(p: Player, season: number): boolean {
  const c = p.contract;
  if (!c || c.franchise_tag_season !== season || !c.franchise_tag_price) return false;
  const price = c.franchise_tag_price;
  p.contract = {
    team_id: c.team_id,
    years_remaining: 1,
    total_value: price,
    guaranteed: price,
    cap_hit_by_year: [price],
    signing_bonus: 0,
    tag_count: (c.tag_count ?? 0) + 1,
  };
  return true;
}

/** A first-rounder in the last year of his rookie deal, option not yet used. */
export function fifthYearEligible(p: Player): boolean {
  const c = p.contract;
  if (!c || p.free_agent || p.retired || c.option_exercised) return false;
  if (p.draft_info?.round !== 1) return false;
  return c.years_remaining === 1 && (c.rookie_deal === true || p.years_pro <= 3);
}

export function previewFifthYearOption(state: LeagueState, p: Player): ContractMoveResult & { price?: number } {
  if (!fifthYearEligible(p)) {
    return { ok: false, reason: "Only a first-round pick in the last year of his rookie deal has a fifth-year option." };
  }
  const price = fifthYearPrice(state, p);
  const fits = fitsNextYear(state, p, price);
  return fits.ok ? { ok: true, price } : { ...fits, price };
}

/** Pick up the option: one more year, fully guaranteed, at the tender. */
export function exerciseFifthYearOption(state: LeagueState, p: Player): ContractMoveResult {
  const check = previewFifthYearOption(state, p);
  if (!check.ok) return check;
  const c = p.contract!;
  const price = check.price!;
  c.years_remaining += 1;
  c.cap_hit_by_year = [...c.cap_hit_by_year.slice(0, 1), price];
  c.total_value = round1(c.total_value + price);
  c.guaranteed = round1(c.guaranteed + price);
  c.option_exercised = true;
  return { ok: true };
}

// ---- holdouts ----------------------------------------------------------------

function hashStr(s: string): number {
  let h = 0x811c9dc5;
  for (let k = 0; k < s.length; k++) {
    h ^= s.charCodeAt(k);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Is he badly enough underpaid to stay away from camp?
 *
 * A star (good enough, young enough, with his market worth nearly double
 * what he makes), and not every one of them: about two in five actually do
 * it, the rest grumble and report. Seeded on player and season, so it is the
 * same answer on every client and every reload.
 */
export function wouldHoldOut(p: Player, season: number): boolean {
  const c = p.contract;
  if (!c || p.free_agent || p.retired || c.years_remaining < 1) return false;
  if (p.overall < 86 || p.age > 30) return false;
  if (c.tag_count) return false; // a tagged player has been paid the tender
  const market = contractValueFor(p.overall, p.position);
  if (market < 2.2 * Math.max(1, capHit(p))) return false;
  return hashStr(`${p.id}|holdout|${season}`) % 100 < 25;
}

/**
 * Camp opens: the underpaid stars decide whether to show up.
 *
 * A CPU front office pays him (the extension he asks for, if it fits); a
 * human GM has a decision to make, and until they make it he sits, every
 * preseason and regular-season game, until he is extended or traded, or
 * reports at the trade deadline, as real holdouts do so the season still
 * counts toward free agency. Returns the holdouts, for the news feed.
 */
export function startHoldouts(state: LeagueState, humanTeams: Set<string>): Player[] {
  const out: Player[] = [];
  const teamsWithOne = new Set<string>();
  // what each CPU team has already promised for next year, so two
  // extensions can't each fit the cap alone and break it together
  const committed = new Map<string, number>();
  const nextYear = (team: string): number => {
    let v = committed.get(team);
    if (v === undefined) {
      v = Object.values(state.players)
        .filter((x) => x.nfl_team === team && !x.retired && (x.contract?.years_remaining ?? 0) >= 2)
        .reduce((n, x) => n + (x.contract!.cap_hit_by_year[1] ?? 0), 0);
      committed.set(team, v);
    }
    return v;
  };
  const candidates = Object.values(state.players)
    .filter((p) => !p.holdout && wouldHoldOut(p, state.season))
    .sort((a, b) => b.overall - a.overall);
  for (const p of candidates) {
    // one a team: a locker room with two stars staying away is a story, not a rule
    if (teamsWithOne.has(p.nfl_team)) continue;
    if (!humanTeams.has(p.nfl_team)) {
      // a CPU front office pays him if the budget allows; if it doesn't, he
      // reports unhappy rather than costing a CPU team its star for half a season
      const ask = extensionAsk(p);
      const team = state.teams[p.nfl_team];
      const budget = (team?.cap.total ?? 0) - 12;
      if (team && nextYear(p.nfl_team) - (p.contract?.cap_hit_by_year[1] ?? 0) + ask.baseSalary <= budget) {
        if (extendContract(state, p, ask).ok) {
          committed.set(p.nfl_team, nextYear(p.nfl_team) + ask.baseSalary);
          teamsWithOne.add(p.nfl_team);
        }
      }
      continue;
    }
    p.holdout = p.nfl_team;
    teamsWithOne.add(p.nfl_team);
    out.push(p);
  }
  return out;
}

/** The trade deadline, or the season's end: every holdout reports. */
export function endHoldouts(state: LeagueState): Player[] {
  const back = Object.values(state.players).filter((p) => p.holdout);
  for (const p of back) delete p.holdout;
  return back;
}
