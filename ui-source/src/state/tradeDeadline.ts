import type { LeagueState, TradeAsset } from "@/domain";
import { MockSimulationService } from "@/sim/MockSimulationService";
import { generateAiTradeOffers } from "./aiTrades";

import { applyTrade } from "./rules";

/**
 * The trade deadline, as three rounds of turns rather than an open market.
 *
 * A live deadline does not work in a league played asynchronously: every team
 * negotiating at once means a player can be promised twice, and the answer to
 * "is he still available" depends on whose browser you ask. So the deadline
 * becomes what the fantasy draft already is — an order, a turn, and exactly
 * one thing happening at a time.
 *
 * The serialization is the whole design. One unresolved negotiation, ever.
 * Every proposal is built from the rosters as they stand at that moment, so
 * an asset traded in round one is simply not on the board in round two, and
 * no screen has to explain why the thing it is showing cannot be had.
 *
 * Three constraints run through all of it:
 *
 *   - the order is computed once, from the standings after week 9, and never
 *     recomputed. Worst team first. A team that improves itself by trading
 *     does not thereby lose its place in line;
 *   - one modification per negotiation. A counter to a counter is how a
 *     deadline becomes a chat client;
 *   - nothing is validated against the cap, the roster limit, or positional
 *     minimums. Those are deliberately allowed to break here and reconciled
 *     afterwards, because a deadline where the last legal move is blocked by
 *     arithmetic is a deadline nobody uses.
 */

export const TRADE_DEADLINE_ROUNDS = 3;

/**
 * One turn, as it crosses the wire.
 *
 * Assets travel as id strings (a draft pick is `pick:<year>-<round>-<team>`)
 * rather than as resolved objects, so the server looks every one of them up
 * in its own saved state. A client that sent whole assets could describe a
 * pick it no longer owns.
 *
 * A counter always states the package in the original orientation —
 * `proposerGives` is what the team that opened the negotiation sends,
 * whichever side is countering.
 */
export type DeadlineMove =
  | { kind: "propose"; toTeam: string; give: string[]; get: string[] }
  | { kind: "skip" }
  | { kind: "accept" }
  | { kind: "deny" }
  | { kind: "modify"; proposerGives: string[]; proposerGets: string[] };

export interface DeadlineOffer {
  id: string;
  fromTeam: string;
  toTeam: string;
  fromAssets: TradeAsset[];
  toAssets: TradeAsset[];
  /**
   * Whose decision the negotiation is waiting on.
   *
   * "recipient" is the opening offer. "proposer" is the state after the
   * recipient countered — the original proposer now accepts or denies, and
   * that is the end of it either way.
   */
  awaiting: "recipient" | "proposer";
  modified: boolean;
  round: number;
}

export interface ResolvedOffer extends DeadlineOffer {
  outcome: "accepted" | "denied";
}

export interface TradeDeadlineState {
  /** 32 team codes, worst-ranked first, fixed for the whole event. */
  order: string[];
  round: number;
  /** Index into `order` — whose proposing turn it is. */
  index: number;
  /** The one live negotiation, or null when the turn is still to be used. */
  active: DeadlineOffer | null;
  /** Every negotiation that finished, in the order they finished. */
  resolved: ResolvedOffer[];
  /** Per-team saved drafts, so a disconnected GM comes back to their work. */
  drafts: Record<string, { toTeam: string; fromAssets: TradeAsset[]; toAssets: TradeAsset[] }>;
  done: boolean;
}

/**
 * Worst first, by the standings as they stood after week 9.
 *
 * Read off the saved games rather than off `team.wins`, which the block's
 * `recomputeStandings` already wrote — same numbers, but this way the order
 * cannot be perturbed by anything that happens during the deadline itself.
 */
export function deadlineOrder(s: LeagueState): string[] {
  const rows = Object.keys(s.teams).map((code) => {
    let wins = 0;
    let losses = 0;
    let diff = 0;
    for (const g of s.games) {
      if (g.phase !== "REG" || !g.played) continue;
      const home = g.homeTeam === code;
      if (!home && g.awayTeam !== code) continue;
      const us = home ? g.homeScore : g.awayScore;
      const them = home ? g.awayScore : g.homeScore;
      if (us > them) wins++;
      else if (them > us) losses++;
      diff += us - them;
    }
    const played = wins + losses;
    return { code, pct: played ? wins / played : 0, diff };
  });
  // worst record first; point differential breaks it, then the code, so the
  // order is identical on every machine that computes it
  rows.sort((a, b) => a.pct - b.pct || a.diff - b.diff || a.code.localeCompare(b.code));
  return rows.map((r) => r.code);
}

export function beginTradeDeadline(s: LeagueState): void {
  if (s.tradeDeadline) return;
  s.tradeDeadline = {
    order: deadlineOrder(s),
    round: 1,
    index: 0,
    active: null,
    resolved: [],
    drafts: {},
    done: false,
  };
}

/** The team whose proposing turn it is, or null once the event is over. */
export function onTheClock(s: LeagueState): string | null {
  const d = s.tradeDeadline;
  if (!d || d.done) return null;
  return d.order[d.index] ?? null;
}

/** Whether a human has something to do right now, and what. */
export function pendingFor(
  s: LeagueState,
  teamCode: string,
): "propose" | "respond" | "final" | null {
  const d = s.tradeDeadline;
  if (!d || d.done) return null;
  if (d.active) {
    if (d.active.awaiting === "recipient" && d.active.toTeam === teamCode) return "respond";
    if (d.active.awaiting === "proposer" && d.active.fromTeam === teamCode) return "final";
    return null;
  }
  return onTheClock(s) === teamCode ? "propose" : null;
}

function isHuman(s: LeagueState, teamCode: string): boolean {
  return s.gms.some((g) => g.isHuman && g.teamCode === teamCode);
}

/**
 * Move to the next proposing turn, ending the event after round three.
 *
 * Only ever called with no live negotiation: the rule that there is exactly
 * one at a time is enforced by there being exactly one place that advances
 * the clock.
 */
function nextTurn(s: LeagueState): void {
  const d = s.tradeDeadline!;
  d.active = null;
  d.index++;
  if (d.index < d.order.length) return;
  d.index = 0;
  d.round++;
  if (d.round > TRADE_DEADLINE_ROUNDS) d.done = true;
}

/** Submit the turn's one proposal. */
export function proposeAtDeadline(
  s: LeagueState,
  fromTeam: string,
  toTeam: string,
  fromAssets: TradeAsset[],
  toAssets: TradeAsset[],
): { ok: boolean; reason?: string } {
  const d = s.tradeDeadline;
  if (!d || d.done) return { ok: false, reason: "The deadline has passed." };
  if (d.active) return { ok: false, reason: "Another negotiation is still open." };
  if (onTheClock(s) !== fromTeam) return { ok: false, reason: "It isn't your turn." };
  if (toTeam === fromTeam) return { ok: false, reason: "You can't trade with yourself." };
  if (fromAssets.length === 0 && toAssets.length === 0) {
    return { ok: false, reason: "An offer has to contain something." };
  }
  const check = assetsStillOwned(s, fromTeam, fromAssets) && assetsStillOwned(s, toTeam, toAssets);
  if (!check) return { ok: false, reason: "Something in that offer has already moved." };

  d.active = {
    id: `td_${s.season}_${d.round}_${d.index}`,
    fromTeam,
    toTeam,
    fromAssets,
    toAssets,
    awaiting: "recipient",
    modified: false,
    round: d.round,
  };
  delete d.drafts[fromTeam];
  return { ok: true };
}

/** Give the turn up, irreversibly. */
export function skipTurn(s: LeagueState, teamCode: string): { ok: boolean; reason?: string } {
  const d = s.tradeDeadline;
  if (!d || d.done) return { ok: false, reason: "The deadline has passed." };
  if (d.active) return { ok: false, reason: "Finish the open negotiation first." };
  if (onTheClock(s) !== teamCode) return { ok: false, reason: "It isn't your turn." };
  delete d.drafts[teamCode];
  nextTurn(s);
  return { ok: true };
}

/**
 * Everything in the package still belongs to the side offering it.
 *
 * The deadline runs on saved rosters that change under it, so this is the
 * check that stops a stale screen from trading a player who left two turns
 * ago — which would otherwise silently move somebody else's player.
 */
function assetsStillOwned(s: LeagueState, teamCode: string, assets: TradeAsset[]): boolean {
  return assets.every((a) => {
    if (a.kind === "player") {
      const p = s.players[a.playerId ?? ""];
      return !!p && p.nfl_team === teamCode && !p.retired && !p.free_agent;
    }
    if (!a.pick) return false;
    const key = `${a.pick.year}-${a.pick.round}-${a.pick.originalTeam}`;
    const held = s.draftPicks?.[key];
    return !!held && held.ownedBy === teamCode;
  });
}

/** Accept, deny, or counter once. */
export function respondAtDeadline(
  s: LeagueState,
  teamCode: string,
  response:
    | { kind: "accept" }
    | { kind: "deny" }
    | { kind: "modify"; fromAssets: TradeAsset[]; toAssets: TradeAsset[] },
): { ok: boolean; reason?: string } {
  const d = s.tradeDeadline;
  const offer = d?.active;
  if (!d || !offer) return { ok: false, reason: "There's nothing to respond to." };

  const mine =
    offer.awaiting === "recipient" ? offer.toTeam === teamCode : offer.fromTeam === teamCode;
  if (!mine) return { ok: false, reason: "That negotiation isn't yours." };

  if (response.kind === "modify") {
    if (offer.awaiting !== "recipient" || offer.modified) {
      // one counter, and then a yes or a no. A counter to a counter is how a
      // deadline turns into a conversation with no end state.
      return { ok: false, reason: "This offer has already been countered once." };
    }
    offer.fromAssets = response.fromAssets;
    offer.toAssets = response.toAssets;
    offer.modified = true;
    offer.awaiting = "proposer";
    return { ok: true };
  }

  if (response.kind === "accept") {
    if (
      !assetsStillOwned(s, offer.fromTeam, offer.fromAssets) ||
      !assetsStillOwned(s, offer.toTeam, offer.toAssets)
    ) {
      // it cannot happen while one negotiation runs at a time, but accepting
      // a trade of somebody else's player is bad enough to be worth refusing
      // rather than trusting the invariant
      finish(s, "denied");
      return { ok: false, reason: "Something in that offer had already moved." };
    }
    // deliberately no cap, roster-size or positional check: the deadline is
    // allowed to break all three, and reconciliation cleans up afterwards
    applyTrade(s, {
      id: offer.id,
      fromTeam: offer.fromTeam,
      toTeam: offer.toTeam,
      fromAssets: offer.fromAssets,
      toAssets: offer.toAssets,
      aiValueDelta: 0,
      aiAcceptLikelihood: 0,
      status: "accepted",
    });
    finish(s, "accepted");
    return { ok: true };
  }

  finish(s, "denied");
  return { ok: true };
}

function finish(s: LeagueState, outcome: "accepted" | "denied"): void {
  const d = s.tradeDeadline!;
  if (d.active) d.resolved.push({ ...d.active, outcome });
  nextTurn(s);
}

/**
 * Run the event forward until a human has to do something.
 *
 * Everything a CPU does happens here, in one pass, and the loop stops the
 * moment a human is on the clock or owes a response. That is what makes the
 * deadline feel like a turn order rather than a queue: a GM opens the screen
 * and it is either their move or it is finished.
 *
 * The bound is belt and braces. Each iteration either resolves a negotiation
 * or advances a turn, so 32 × 3 × 2 is already more than enough; a loop that
 * could spin here would hang the server rather than the tab.
 */
export function runCpuTurns(s: LeagueState): void {
  const d = s.tradeDeadline;
  if (!d) return;
  const sim = new MockSimulationService();

  for (let guard = 0; guard < TRADE_DEADLINE_ROUNDS * 64 + 8; guard++) {
    if (d.done) return;

    if (d.active) {
      const decider = d.active.awaiting === "recipient" ? d.active.toTeam : d.active.fromTeam;
      if (isHuman(s, decider)) return;
      cpuRespond(s, sim, decider);
      continue;
    }

    const up = onTheClock(s);
    if (!up) return;
    if (isHuman(s, up)) return;
    cpuPropose(s, up);
  }
}

/**
 * A CPU's turn.
 *
 * Contenders buy, sellers sell, and the split is the record: a team above
 * .500 is trying to win this year and will pay future capital for a current
 * upgrade; a team below it would rather have the capital. That is the whole
 * strategy for now, and it is deliberately simple and deterministic — the
 * change log has this marked for calibration once there is a season of
 * results to calibrate against.
 */
function cpuPropose(s: LeagueState, teamCode: string): void {
  const d = s.tradeDeadline!;
  const offers = generateAiTradeOffers(s, d.round * 1000 + d.index, 1);
  const mine = offers.find((o) => o.fromTeam === teamCode);
  if (!mine) {
    skipTurn(s, teamCode);
    return;
  }
  const res = proposeAtDeadline(s, teamCode, mine.toTeam, mine.fromAssets, mine.toAssets);
  if (!res.ok) skipTurn(s, teamCode);
}

function cpuRespond(s: LeagueState, sim: MockSimulationService, teamCode: string): void {
  const d = s.tradeDeadline!;
  const offer = d.active!;
  const evaluation = sim.evaluateTrade(
    s,
    offer.fromTeam,
    offer.toTeam,
    offer.fromAssets,
    offer.toAssets,
  );
  // `acceptLikelihood` is the recipient's willingness, so the proposer
  // looking at a counter reads it the other way round
  const forMe =
    offer.awaiting === "recipient" ? evaluation.acceptLikelihood : 1 - evaluation.acceptLikelihood;

  // deterministic: same league, same round, same turn, same answer on every
  // machine that runs it — including a retry after a failed save
  const roll = hash(`${offer.id}|${teamCode}|${offer.modified ? 1 : 0}`) / 0xffffffff;
  respondAtDeadline(s, teamCode, { kind: roll < forMe ? "accept" : "deny" });
}

function hash(key: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Everything that finished, from the viewing GM's side. */
export function tradesFor(s: LeagueState, teamCode: string) {
  const d = s.tradeDeadline;
  if (!d) return { mine: [], league: [], rejected: [] };
  const involvesMe = (o: ResolvedOffer) => o.fromTeam === teamCode || o.toTeam === teamCode;
  return {
    mine: d.resolved.filter((o) => o.outcome === "accepted" && involvesMe(o)),
    league: d.resolved.filter((o) => o.outcome === "accepted"),
    rejected: d.resolved.filter((o) => o.outcome === "denied" && involvesMe(o)),
  };
}
