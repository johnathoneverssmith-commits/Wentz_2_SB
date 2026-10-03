/**
 * Who owns which draft pick.
 *
 * `DraftPickAsset` and `TradeAsset.kind === "pick"` were in the domain from
 * the start and nothing ever produced one: the rookie draft assigned every
 * slot to the team that earned it, and the trade screen could only move
 * players. Trading picks is half of how a franchise is actually built — the
 * rebuild that sells a veteran for a first, the contender that spends three
 * years of capital on one player — and none of it was expressible.
 */
import type { DraftPickAsset, LeagueState } from "@/domain";
import { TEAMS_BY_CODE } from "@/data/teams";
import { ROSTER_SIZE } from "@/sim/roster-template";

/** Rounds in the rookie draft. */
export const DRAFT_ROUNDS = 7;

/**
 * The fantasy draft's length: a round per roster spot. The GMs make their
 * manual picks and the draft then carries on by itself until every team holds
 * a full 53-man roster, so there is nothing left for `fillRosterGaps` to do.
 */
export const FANTASY_DRAFT_ROUNDS = ROSTER_SIZE;

/**
 * How far ahead picks exist to be traded. The real rule is three drafts —
 * this year's and the next two — and the same limit keeps a GM from
 * mortgaging a decade they'll never play.
 */
export const PICK_HORIZON = 3;

export const pickKey = (year: number, round: number, originalTeam: string): string =>
  `${year}-${round}-${originalTeam}`;

/** Makes sure every team's picks exist for `season` and the two drafts after. */
export function ensureDraftPicks(state: LeagueState, season: number): void {
  state.draftPicks ??= {};
  for (let y = season; y < season + PICK_HORIZON; y++) {
    for (let round = 1; round <= DRAFT_ROUNDS; round++) {
      for (const code of Object.keys(state.teams)) {
        const key = pickKey(y, round, code);
        state.draftPicks[key] ??= { year: y, round, ownedBy: code, originalTeam: code };
      }
    }
  }
}

/** Drops the picks for drafts already held, so the ledger doesn't grow forever. */
export function forgetSpentPicks(state: LeagueState, season: number): void {
  if (!state.draftPicks) return;
  for (const [key, pick] of Object.entries(state.draftPicks)) {
    if (pick.year < season) delete state.draftPicks[key];
  }
}

/** Every pick `teamCode` owns in `year`, earliest round first. */
export function picksOwnedBy(state: LeagueState, teamCode: string, year?: number): DraftPickAsset[] {
  return Object.values(state.draftPicks ?? {})
    .filter((p) => p.ownedBy === teamCode && (year == null || p.year === year))
    .sort((a, b) => a.year - b.year || a.round - b.round);
}

/**
 * How much less a pick is worth for being far off.
 *
 * A 2029 first is not a 2027 first: nobody knows whose it will be, the team
 * trading it may not be the team that regrets it, and the league discounts
 * future capital accordingly. `MockSimulationService`'s `PICK_VALUE_BY_ROUND`
 * (the Jimmy Johnson chart, averaged per round) prices the pick itself;
 * this is the only thing it can't know without a season attached.
 */
export function futureDiscount(pick: DraftPickAsset, season: number): number {
  const yearsOut = Math.max(0, pick.year - season);
  // Trade Valuation optimization pass (trade.future_pick_discount): steeper
  // per-year discount and a slightly higher floor than before.
  return Math.max(0.55, 1 - yearsOut * 0.18);
}

/**
 * "2028 Round 1 (via CLE)" — the label every screen shows a pick by.
 *
 * Named for the draft it's used in, which is held the spring after season
 * `pick.year` — the same year the draft room and preview put on that draft.
 * Showing `pick.year` itself called one draft "2028 Rookie Draft" in the
 * room and "2027 Round 1" on the picks that were used in it.
 */
/**
 * A pick as it appears in a trade: whose it originally was. A trade record
 * keeps the pick as it stood when offered, so `pickLabel`'s "(via …)" never
 * appeared — and two "2029 Round 6"s swapped for each other said nothing.
 */
export function tradedPickLabel(pick: DraftPickAsset): string {
  return `${TEAMS_BY_CODE[pick.originalTeam]?.abbr ?? pick.originalTeam}'s ${pick.year + 1} Round ${pick.round}`;
}

export function pickLabel(pick: DraftPickAsset): string {
  const via = pick.originalTeam !== pick.ownedBy ? ` (via ${pick.originalTeam})` : "";
  return `${pick.year + 1} Round ${pick.round}${via}`;
}

/**
 * The draft order for `season`, as the team that will *use* each slot.
 *
 * `baseOrder` is the order the slots were earned in (worst record first); the
 * pick ledger decides who actually holds each one.
 */
export function pickOrderFor(
  state: LeagueState,
  season: number,
  baseOrder: string[],
  rounds: number,
): string[] {
  const out: string[] = [];
  for (let round = 1; round <= rounds; round++) {
    for (const earnedBy of baseOrder) {
      const owner = state.draftPicks?.[pickKey(season, round, earnedBy)]?.ownedBy;
      out.push(owner ?? earnedBy);
    }
  }
  return out;
}

/**
 * How much this pick is worth relative to a .500 team's pick in the same
 * round, from the record of the team whose pick it is (playtest finding
 * 14): a winless team's first is a top-five selection, an unbeaten team's
 * is the last of the night. 0.6 (best) .. 1.5 (worst), 1.0 until three games
 * are in. A later draft's pick is only half as sure of the projection.
 *
 * Lives here, used by `tradeAssetValue`, so the CPU values a pick the same
 * way when it builds an offer as when it judges one. The builder used to
 * scale its own picks and the judge didn't: a good team's first was cheap
 * to offer and full price to receive, and a New Orleans package came out
 * 41 points in the human's favour by the league's own chart.
 */
export function pickSlotFactor(s: LeagueState, pick: DraftPickAsset): number {
  const team = s.teams[pick.originalTeam];
  if (!team) return 1;
  const games = team.wins + team.losses + team.ties;
  if (games < 3) return 1;
  const winPct = (team.wins + team.ties * 0.5) / games;
  const full = 1.5 - winPct * 0.9;
  return pick.year <= s.season ? full : 1 + (full - 1) / 2;
}

/**
 * Display order for one side of a trade: players first, then picks soonest
 * first. Offers keep their assets in whatever order they were built, which
 * put a 2032 pick above a 2030 one.
 */
export function byTradeAssetOrder(
  a: { kind: string; pick?: { year: number; round: number } | undefined },
  b: { kind: string; pick?: { year: number; round: number } | undefined },
): number {
  return (
    Number(a.kind === "pick") - Number(b.kind === "pick") ||
    (a.pick?.year ?? 0) - (b.pick?.year ?? 0) ||
    (a.pick?.round ?? 0) - (b.pick?.round ?? 0)
  );
}
