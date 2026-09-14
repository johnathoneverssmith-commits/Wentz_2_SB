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

/** Rounds in the rookie draft. */
export const DRAFT_ROUNDS = 7;

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
  return Math.max(0.5, 1 - yearsOut * 0.14);
}

/** "2027 Round 1 (via CLE)" — the label every screen shows a pick by. */
export function pickLabel(pick: DraftPickAsset): string {
  const via = pick.originalTeam !== pick.ownedBy ? ` (via ${pick.originalTeam})` : "";
  return `${pick.year} Round ${pick.round}${via}`;
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
