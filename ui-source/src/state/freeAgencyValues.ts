import type { LeagueState, Player } from "@/domain";

import { recoveryScaleFor, staffAt } from "./coachEffects";
import { coachRoleForPosition } from "@/domain";

/**
 * What a free agent is actually weighing.
 *
 * Every player carries one primary value, fixed to them rather than to the
 * league they happen to be in — so the same person wants the same thing in
 * every save, and a GM who learns that a player chases money learns something
 * durable. Money still matters to everyone: an offer below what a player
 * expects is not eligible at all, whatever else it has going for it. The
 * primary value decides between offers that clear that bar.
 *
 * The seven are deliberately different *kinds* of thing rather than seven
 * flavours of money, because a market where everybody optimises the same
 * quantity is an auction with extra steps. A rebuilding team with cap space
 * and a hole at the position should be able to beat a contender on something
 * other than price.
 */
export const PRIMARY_VALUES = [
  "salary",
  "startingOpportunity",
  "championship",
  "location",
  "warmClimate",
  "positionCoach",
  "rebuildLeadership",
] as const;
export type PrimaryValue = (typeof PRIMARY_VALUES)[number];

export const PRIMARY_VALUE_LABEL: Record<PrimaryValue, string> = {
  salary: "Salary",
  startingOpportunity: "Starting opportunity",
  championship: "Championship contention",
  location: "Location",
  warmClimate: "Warm climate",
  positionCoach: "Position coach quality",
  rebuildLeadership: "Rebuild leadership",
};

/** Teams that play somewhere warm or indoors. */
const WARM_TEAMS = new Set([
  "ARI", "ATL", "CAR", "DAL", "HOU", "JAX", "LAC", "LAR", "LV",
  "MIA", "NO", "TB", "TEN", "IND", "DET", "MIN",
]);

/** Roughly where each club sits, for the players who care about it. */
const REGION: Record<string, string> = {
  BUF: "northeast", MIA: "southeast", NE: "northeast", NYJ: "northeast",
  BAL: "northeast", CIN: "midwest", CLE: "midwest", PIT: "northeast",
  HOU: "south", IND: "midwest", JAX: "southeast", TEN: "south",
  DEN: "west", KC: "midwest", LV: "west", LAC: "west",
  DAL: "south", NYG: "northeast", PHI: "northeast", WAS: "northeast",
  CHI: "midwest", DET: "midwest", GB: "midwest", MIN: "midwest",
  ATL: "southeast", CAR: "southeast", NO: "south", TB: "southeast",
  ARI: "west", LAR: "west", SF: "west", SEA: "west",
};

/** Deterministic hash so a player's profile never moves between sessions. */
function hash(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * The one thing this player cares about most.
 *
 * Derived from who he is rather than drawn at random, so it is explicable: a
 * good player near the end of his career wants a ring, a fringe player wants
 * a job, a young one wants to be coached. The hash only breaks ties within a
 * band, which is what keeps two similar players from being identical.
 */
export function primaryValueOf(p: Player): PrimaryValue {
  const h = hash(p.id);
  const old = p.age >= 30;
  const young = p.age <= 24;
  const star = p.overall >= 85;
  const fringe = p.overall < 70;

  if (star && old) return h % 3 === 0 ? "salary" : "championship";
  if (old && !fringe) return h % 3 === 0 ? "rebuildLeadership" : "championship";
  if (fringe) return h % 3 === 0 ? "warmClimate" : "startingOpportunity";
  if (young) return h % 3 === 0 ? "location" : "positionCoach";
  if (star) return "salary";
  // the broad middle: spread across the rest so no one motive dominates
  const rest: PrimaryValue[] = [
    "salary",
    "startingOpportunity",
    "championship",
    "location",
    "warmClimate",
    "positionCoach",
  ];
  return rest[h % rest.length]!;
}

/** The region a player would rather be in, fixed to him. */
export function preferredRegion(p: Player): string {
  const regions = ["northeast", "southeast", "south", "midwest", "west"];
  return regions[hash(p.id + "r") % regions.length]!;
}

/** What a player expects to be paid, in $M per year. */
export function expectedSalary(p: Player): number {
  // a curve rather than a line: the top of the market is much steeper than
  // the middle, which is what makes a star genuinely expensive
  const over = Math.max(0, p.overall - 60);
  const base = 0.9 + Math.pow(over / 39, 2.6) * 34;
  const agePenalty = p.age >= 31 ? 0.82 : p.age >= 29 ? 0.92 : 1;
  return Math.round(base * agePenalty * 10) / 10;
}

/**
 * How well a team satisfies this player's primary value, in 0..1.
 *
 * Contextual rather than fixed: the same team is a different proposition to
 * the same player depending on who else is on the roster and who is coaching
 * it, which is what makes the market move between rounds.
 */
export function fitFor(s: LeagueState, p: Player, teamCode: string): number {
  const value = primaryValueOf(p);
  const team = s.teams[teamCode];
  if (!team) return 0;

  switch (value) {
    case "salary":
      // handled by the salary term in the score; neutral here so money is
      // not counted twice for the players who care about it most
      return 0.5;

    case "startingOpportunity": {
      const atPosition = Object.values(s.players).filter(
        (x) => x.nfl_team === teamCode && x.position === p.position && !x.retired && !x.free_agent,
      );
      const best = atPosition.reduce((n, x) => Math.max(n, x.overall), 0);
      // a clear path to the field is worth the most; a crowded room the least
      if (atPosition.length === 0) return 1;
      return Math.max(0, Math.min(1, (p.overall - best + 12) / 24));
    }

    case "championship": {
      const ranks = Object.values(s.teams).map((t) => t.ratings.overall);
      const max = Math.max(...ranks);
      const min = Math.min(...ranks);
      if (max === min) return 0.5;
      return (team.ratings.overall - min) / (max - min);
    }

    case "location":
      return REGION[teamCode] === preferredRegion(p) ? 1 : 0.2;

    case "warmClimate":
      return WARM_TEAMS.has(teamCode) ? 1 : 0.15;

    case "positionCoach": {
      const role = coachRoleForPosition(p.position);
      if (!role) return 0.5;
      const coach = staffAt(s, teamCode, role);
      const ovr = coach?.overall ?? 72;
      return Math.max(0, Math.min(1, (ovr - 40) / 55));
    }

    case "rebuildLeadership": {
      const ranks = Object.values(s.teams).map((t) => t.ratings.overall);
      const max = Math.max(...ranks);
      const min = Math.min(...ranks);
      const weak = max === min ? 0.5 : 1 - (team.ratings.overall - min) / (max - min);
      const atPosition = Object.values(s.players).filter(
        (x) => x.nfl_team === teamCode && x.position === p.position && !x.retired && !x.free_agent,
      );
      const best = atPosition.reduce((n, x) => Math.max(n, x.overall), 0);
      const room = p.overall >= best ? 1 : 0.4;
      return weak * 0.7 + room * 0.3;
    }
  }
}

export interface Offer {
  teamCode: string;
  /** Average annual value, $M. */
  salary: number;
  /** Whole years, 1..5. */
  years: number;
  /** Round it was made in, for tie-breaking and the Signed tab. */
  round: number;
  /** Order within the round, so the earliest offer wins a dead heat. */
  sequence: number;
}

/**
 * Score one offer, for a player choosing between them.
 *
 * Money and fit both count, and money counts for more — a player who wants a
 * ring still notices being underpaid. The salary term is measured against
 * what he expected rather than in absolute dollars, so a modest overpay for a
 * modest player is worth as much as a large one for a star.
 */
export function scoreOffer(s: LeagueState, p: Player, offer: Offer): number {
  const expected = expectedSalary(p);
  const premium = expected <= 0 ? 1 : offer.salary / expected;
  // diminishing: doubling the money is not twice as persuasive
  const money = Math.min(2, Math.sqrt(premium));
  const fit = fitFor(s, p, offer.teamCode);
  return money * 0.65 + fit * 0.35;
}

/** Whether an offer is even eligible — below what he expects, nothing else matters. */
export function offerEligible(p: Player, offer: Offer): boolean {
  return offer.salary >= expectedSalary(p);
}

/**
 * Which offer a player takes, or null if none clears his asking price.
 *
 * Ties go to the bigger salary, and a dead heat there to whoever offered
 * first — so a team that moves early is rewarded for it rather than losing a
 * coin toss.
 */
export function bestOfferFor(s: LeagueState, p: Player, offers: Offer[]): Offer | null {
  const eligible = offers.filter((o) => offerEligible(p, o));
  if (eligible.length === 0) return null;
  return eligible.reduce((best, o) => {
    const a = scoreOffer(s, p, o);
    const b = scoreOffer(s, p, best);
    if (a !== b) return a > b ? o : best;
    if (o.salary !== best.salary) return o.salary > best.salary ? o : best;
    if (o.round !== best.round) return o.round < best.round ? o : best;
    return o.sequence < best.sequence ? o : best;
  });
}
