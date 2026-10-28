/**
 * Offers the league makes to you.
 *
 * Every trade in the game started with the human: they opened the screen,
 * built a package, and asked. Nothing ever came the other way. A franchise
 * mode where the phone never rings is missing the moment that makes the
 * position feel real — someone wants your left tackle, and now you have to
 * decide what he's worth.
 */
import type { DraftPickAsset, LeagueState, Player, TradeAsset, TradeProposal } from "@/domain";

import { packageValue } from "@/sim/MockSimulationService";
import { ROSTER_TEMPLATE } from "@/sim/roster-template";

import { pickKey, picksOwnedBy } from "./draftPicks.ts";
import { judgeWith, TRADE_ACCEPT_THRESHOLD, tradeContext, type TradeContext } from "./tradeModel.ts";
import { TEAMS_BY_CODE } from "@/data/teams";
import { strategyAgeBonus, strategyEliteBonus, strategyPositionBonus } from "./aiStrategy.ts";
import { deterministicNoiseUnit } from "./aiDifficulty.ts";
import { difficultyFor, strategyOf } from "./aiGms.ts";
import { unitGainer } from "./unitValue.ts";

/** Deterministic per league + season + stage, so an offer isn't reroll-able. */
function rng(seed: number): () => number {
  let x = seed >>> 0;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return ((x >>> 0) % 100000) / 100000;
  };
}

const ROSTER_OF = (s: LeagueState, code: string): Player[] =>
  Object.values(s.players).filter((p) => p.nfl_team === code && !p.retired && !p.free_agent);

/** How badly `code` needs help at `pos` — 0 when they're already strong there. */
function needAt(roster: readonly Player[], pos: string): number {
  // the roster in hand, not re-read from the league: this ran once per
  // position per suitor, each a pass over every player in the league, and
  // it was most of a CPU deadline turn's cost
  const best = roster
    .filter((p) => p.position === pos)
    .reduce((m, p) => Math.max(m, p.overall), 0);
  // Trade Valuation optimization pass (trade.ai_generated_offers.need_bar).
  return Math.max(0, 77 - (best || 40));
}

/**
 * How much a future pick from this team is worth, relative to a .500 team's
 * same-round pick (playtest finding 14). A first-rounder from a winless team
 * is a top-five selection; the same round from an unbeaten team is the last
 * pick of the night — record projects draft position, and draft position is
 * most of what the pick is worth.
 *
 * 0.6 (best team in the league) .. 1.5 (worst) around 1.0 at .500. Games
 * played gates it early in a season, when a handful of results shouldn't yet
 * read as a full projection.
 */
export function pickStrengthFor(s: LeagueState, teamCode: string): number {
  const team = s.teams[teamCode];
  if (!team) return 1;
  const games = team.wins + team.losses + team.ties;
  if (games < 3) return 1;
  const winPct = (team.wins + team.ties * 0.5) / games;
  return 1.5 - winPct * 0.9;
}

/** How many of a team's picks and spare players a package is chosen from: every combination of up to three of them is tried. */
const PICK_CANDIDATES = 9;
const PLAYER_CANDIDATES = 6;
/** The share of rounds a contender works the phones in. */
const PHONE_RATE = 0.25;

/** How sure the team receiving a package has to be, above the line every channel answers at, before one is offered to it. */
const OFFER_MARGIN = 0.02;

/**
 * Players a team can send without weakening itself, healthy and worth something: everyone behind its best at the position (`best`),
 * or behind its starters (`starters`).
 */
export function sparePlayers(ctx: TradeContext, roster: readonly Player[], minOverall: number, keep: "best" | "starters"): Player[] {
  const startersAt = new Map(ROSTER_TEMPLATE.map((r) => [r.pos, keep === "best" ? 1 : r.starters]));
  const out: Player[] = [];
  for (const [pos, list] of Object.entries(
    roster.reduce<Record<string, Player[]>>((m, p) => ((m[p.position] ??= []).push(p), m), {}),
  )) {
    const sorted = [...list].sort((a, b) => b.overall - a.overall);
    const keep = startersAt.get(pos as Player["position"]) ?? 0;
    for (const p of sorted.slice(keep)) {
      if (p.overall < minOverall || p.injury_status) continue;
      if (ctx.chart({ kind: "player", playerId: p.id }) < 3) continue;
      out.push(p);
    }
  }
  return out.sort((a, b) => ctx.chart({ kind: "player", playerId: b.id }) - ctx.chart({ kind: "player", playerId: a.id }));
}

/**
 * Whether neither team ends a trade over the cap. The deadline is allowed to break the roster limit (reconciliation trims it after)
 * but a front office does not plan to spend money it does not have, so a package is built to fit the cap. Dead money counts, as it
 * does in `checkTrade`.
 */
export function capLegal(s: LeagueState, fromTeam: string, toTeam: string, fromAssets: readonly TradeAsset[], toAssets: readonly TradeAsset[]): boolean {
  const hit = (assets: readonly TradeAsset[]): number =>
    assets.reduce((n, a) => n + (a.kind === "player" ? (s.players[a.playerId ?? ""]?.contract?.cap_hit_by_year[0] ?? 0) : 0), 0);
  const fits = (team: string, gains: number, loses: number): boolean => {
    const t = s.teams[team];
    return !t || t.cap.used - loses + gains <= t.cap.total + 1e-6;
  };
  return fits(fromTeam, hit(toAssets), hit(fromAssets)) && fits(toTeam, hit(fromAssets), hit(toAssets));
}

export interface PackageSearch {
  payer: string;
  payee: string;
  /** what the payer is asking for */
  get: TradeAsset[];
  /** the payer's picks and spare players to choose from */
  picks: DraftPickAsset[];
  players: Player[];
  /** which kinds the package may hold: `mixed` needs at least one of each */
  kinds: "any" | "picks" | "players" | "mixed";
  /** whether the team being paid, and the payer, would each make this trade */
  willing: (give: TradeAsset[]) => boolean;
  /** the package's chart value, as a share of what is asked for, must fall between these */
  floor: number;
  ceiling: number;
}

/**
 * The cheapest package that clears every test: pick from the payer's few best picks and spare players, try every combination of up to
 * three, keep the ones that fit under both teams' caps, that the other team would take and that sit in the value band,
 * and take the one that costs the payer least on the chart, counting a first-round pick a little extra (draft capital is what a
 * front office protects).
 *
 * This replaces the "cheapest single pick that covers a gap" rule, which met a 45-point target with a 75-point first-round pick and
 * had contenders paying 1.7 times what they got.
 */
export function cheapestPackage(s: LeagueState, ctx: TradeContext, q: PackageSearch): TradeAsset[] | null {
  const chart = (a: TradeAsset): number => ctx.chart(a);
  const asked = packageValue(s, q.get, chart);
  const pool: TradeAsset[] = [];
  if (q.kinds !== "players") {
    // every round is on offer, not only the biggest picks: the nearest draft's pick in each round, and the one after it in the first
    // two. Taking the six most valuable would leave only firsts and seconds, steps of 83 and 30 points, and a player of any size would
    // always be the cheaper way to cover a gap (the first measurement had a pick-only package in 2% of trades)
    const nearest = new Map<number, DraftPickAsset[]>();
    for (const pick of q.picks) nearest.set(pick.round, [...(nearest.get(pick.round) ?? []), pick]);
    const chosen: DraftPickAsset[] = [];
    for (const [round, list] of nearest) {
      const byYear = [...list].sort((a, b) => a.year - b.year || (a.originalTeam < b.originalTeam ? -1 : 1));
      chosen.push(...byYear.slice(0, round <= 2 ? 2 : 1));
    }
    chosen.sort((a, b) => chart({ kind: "pick", pick: b }) - chart({ kind: "pick", pick: a }));
    for (const pick of chosen.slice(0, PICK_CANDIDATES)) pool.push({ kind: "pick", pick });
  }
  if (q.kinds !== "picks") for (const p of q.players.slice(0, PLAYER_CANDIDATES)) pool.push({ kind: "player", playerId: p.id });
  const n = pool.length;
  const cost = (give: TradeAsset[]): number =>
    packageValue(s, give, chart) + 0.12 * give.reduce((m, a) => m + (a.kind === "pick" && a.pick?.round === 1 ? chart(a) : 0), 0);
  const hold: { best: { give: TradeAsset[]; cost: number } | null } = { best: null };
  const consider = (give: TradeAsset[]): void => {
    const hasPick = give.some((a) => a.kind === "pick");
    const hasPlayer = give.some((a) => a.kind === "player");
    if (q.kinds === "mixed" && !(hasPick && hasPlayer)) return;
    const value = packageValue(s, give, chart);
    if (value < asked * q.floor || value > asked * q.ceiling) return;
    const c = cost(give);
    if (hold.best && c >= hold.best.cost) return;
    if (!q.willing(give)) return;
    if (!capLegal(s, q.payer, q.payee, give, q.get)) return;
    hold.best = { give, cost: c };
  };
  for (let i = 0; i < n; i++) {
    consider([pool[i]!]);
    for (let j = i + 1; j < n; j++) {
      consider([pool[i]!, pool[j]!]);
      for (let k = j + 1; k < n; k++) consider([pool[i]!, pool[j]!, pool[k]!]);
    }
  }
  return hold.best ? hold.best.give : null;
}

/**
 * Builds the offers the AI makes the human this stage.
 *
 * An AI team shops for the position it's weakest at, asks for the best
 * player the human has there, and puts together a package it can actually
 * afford — players it can spare plus draft capital. It only offers for
 * someone the human can spare in return: a team's *only* good player at a
 * position is not what an offer opens with, because a GM who gets nothing
 * but insulting offers stops reading them.
 */
export function generateAiTradeOffers(s: LeagueState, salt: number, howMany = 1): TradeProposal[] {
  const humanTeams = s.gms.filter((g) => g.isHuman && g.teamCode).map((g) => g.teamCode);
  if (humanTeams.length === 0) return [];
  const random = rng(s.season * 7919 + salt);
  const out: TradeProposal[] = [];
  const ctx = tradeContext(s);

  const aiTeams = Object.keys(s.teams).filter((c) => !humanTeams.includes(c));
  // `howMany` *per human GM*, not per league: picking a random human meant
  // that in a three-GM hot seat two offers usually went to the other two and
  // the player at the keyboard never saw the feature exist.
  const rounds = humanTeams.flatMap((code) =>
    Array.from({ length: howMany }, (_, n) => ({ target: code, n })),
  );
  for (let i = 0; i < rounds.length; i++) {
    const target = rounds[i]!.target;
    const suitor = aiTeams[Math.floor(random() * aiTeams.length)]!;
    const theirRoster = ROSTER_OF(s, suitor);
    const myRoster = ROSTER_OF(s, target);
    if (theirRoster.length === 0 || myRoster.length === 0) continue;

    // Where the human has someone clearly better than the suitor does. A
    // hole is the obvious case, but most teams don't have holes after the
    // roster fill — what drives real trades is an upgrade, and an upgrade is
    // what an AI team can see from across the league.
    const bestOf = (roster: Player[], pos: string): Player | undefined =>
      roster.filter((p) => p.position === pos).sort((a, b) => b.overall - a.overall)[0];
    // §8.1: the suitor's own season strategy biases which near-equivalent
    // target it goes after — a bounded add-on to gain+need, not a
    // replacement for either.
    const strategy = strategyOf(s, suitor);
    // AI Difficulty (§14): the same bounded valuation noise and need-
    // awareness scaling as every other target-ranking call site — never a
    // change to the canonical trade-value formula itself.
    const difficulty = difficultyFor(s, suitor);
    const positions = [...new Set(myRoster.map((p) => p.position))]
      .map((pos) => {
        const theirs = bestOf(theirRoster, pos);
        const mine = bestOf(myRoster, pos);
        const noise =
          difficulty.tradeEvaluationNoise === 0
            ? 0
            : deterministicNoiseUnit(suitor, s.season, "trade_target", `${target}:${pos}`) * difficulty.tradeEvaluationNoise;
        const wantedScore =
          strategyPositionBonus(strategy, pos as Player["position"]) +
          (mine ? strategyAgeBonus(strategy, mine.age) + strategyEliteBonus(strategy, mine.overall) : 0) +
          noise;
        return {
          pos,
          gain: (mine?.overall ?? 0) - (theirs?.overall ?? 40),
          need: needAt(theirRoster, pos) * difficulty.needAwareness,
          wantedScore,
        };
      })
      .sort((a, b) => b.gain + b.need / 5 + b.wantedScore - (a.gain + a.need / 5 + a.wantedScore));
    const wanted = positions.find((p) => {
      if (p.gain < 4) return false;
      const mine = myRoster.filter((x) => x.position === p.pos).sort((a, b) => b.overall - a.overall);
      // they ask for the best one *only* if there's someone behind him who
      // could actually play: every roster carries a backup quarterback, so
      // "someone behind him" had GMs asked for their 93 starter, with a 58
      // behind him, at every deadline
      return mine.length >= 2 && mine[0]!.overall >= 72 && mine[1]!.overall >= mine[0]!.overall - 15;
    });
    if (!wanted) continue;

    const askFor = myRoster
      .filter((p) => p.position === wanted.pos)
      .sort((a, b) => b.overall - a.overall)[0]!;
    // one GM shouldn't get two offers for the same man in the same window
    if (out.some((t) => t.toAssets.some((a) => a.playerId === askFor.id))) continue;

    // a package: their best spare player(s) at a position they're deep in,
    // draft capital, or both, aimed at landing a little over what they're
    // asking for. Playtest finding 15: every offer used to be players-only
    // (picks were a same-round-every-time top-up, never the point of the
    // package), which reads as one AI GM copy-pasted thirty-two times — a
    // package shape is rolled first, the same way a real front office
    // sometimes leads with picks and sometimes doesn't.
    // the package is chosen by search (`cheapestPackage`): the cheapest combination of the suitor's picks and spare players that is
    // legal, that the suitor itself would make, and that is worth the player to the person being asked
    const askAssets: TradeAsset[] = [{ kind: "player", playerId: askFor.id }];
    // A star is not bought with a pile of backups. Anyone in the package has to be a real player, near the star's own level.
    const minPiece = Math.max(66, askFor.overall - 16);
    const spares = sparePlayers(ctx, theirRoster, minPiece, "best");
    const availablePicks = picksOwnedBy(s, suitor);
    const shapeRoll = random();
    const shape: "players" | "picks" | "mixed" =
      availablePicks.length === 0 ? "players" : shapeRoll < 0.25 ? "picks" : shapeRoll < 0.55 ? "mixed" : "players";
    const search = (kinds: PackageSearch["kinds"]): TradeAsset[] | null =>
      cheapestPackage(s, ctx, {
        payer: suitor,
        payee: target,
        get: askAssets,
        picks: availablePicks,
        players: spares,
        kinds,
        // they proposed it, so the suitor must itself be willing: the same decision it would give were the person to ask it
        willing: (give) => judgeWith(ctx, target, suitor, askAssets, give, { friction: false }).acceptLikelihood >= TRADE_ACCEPT_THRESHOLD,
        floor: 0.95,
        ceiling: 1.4,
      });
    const give = (shape === "picks" ? search("picks") : shape === "mixed" ? (search("mixed") ?? search("any")) : (search("players") ?? search("any"))) ?? [];
    if (give.length === 0) continue;
    const offered = packageValue(s, give);
    const targetValue = packageValue(s, askAssets);
    // quantity for quality: nobody sends a star's price in lesser players
    // alone. A package with a player in it needs a centrepiece — one close to
    // the star, or a first- or second-round pick.
    const givenOveralls = give.flatMap((a) => (a.kind === "player" && a.playerId && s.players[a.playerId] ? [s.players[a.playerId]!.overall] : []));
    const bestGiven = Math.max(0, ...givenOveralls);
    const hasCapital = give.some((a) => a.kind === "pick" && !!a.pick && a.pick.round <= 2);
    if (givenOveralls.length >= 2 && bestGiven < askFor.overall - 10 && !hasCapital) continue;
    if (givenOveralls.length >= 1 && bestGiven < askFor.overall - 14 && !hasCapital) continue;
    // nor one that overpays: a CPU front office doesn't give away 40% extra
    if (offered > targetValue * 1.4) continue;

    out.push({
      id: `trade_ai_${s.season}_${salt}_${target}_${rounds[i]!.n}`,
      fromTeam: suitor,
      toTeam: target,
      fromAssets: give,
      toAssets: [{ kind: "player", playerId: askFor.id }],
      aiValueDelta: 0,
      aiAcceptLikelihood: 1, // they proposed it; they're willing by definition
      status: "offered",
    });
  }
  return out;
}

/** Applies an offer the human accepted — the mirror of `applyTrade`. */
export function assetsOf(s: LeagueState, t: TradeProposal): { players: Player[]; picks: string[] } {
  const players: Player[] = [];
  const picks: string[] = [];
  for (const a of [...t.fromAssets, ...t.toAssets]) {
    if (a.kind === "player" && a.playerId && s.players[a.playerId]) players.push(s.players[a.playerId]!);
    if (a.kind === "pick" && a.pick) picks.push(pickKey(a.pick.year, a.pick.round, a.pick.originalTeam));
  }
  return { players, picks };
}

/**
 * A CPU contender's deadline offer to a CPU seller.
 *
 * The deadline only ever produced offers aimed at humans, so in ten seasons no two CPU teams traded with each other once. A real
 * deadline is contenders buying from teams that are out of it. Who is which is the team's window (`readTeamTimeline`: record and
 * the strength of its lineup), not the record alone: a buyer is a contender, a seller a team that is rebuilding and not in its division.
 *
 * The buyer finds the upgrade that adds most to its starting units (the Master AI's reading, `unitGainer`) on a seller, passing over
 * a player whose pay will outlast his play (past his decline age with years left: a liability the evaluator prices, and a rebuild
 * is the last team to want), and then searches for the cheapest package of its picks and spare players that the seller would
 * take (`cheapestPackage`, the same decision the seller would give anyone). It can be a pick, a player or a mix. The cap is checked as part of the
 * search, so a player goes the other way when the numbers need him to; the roster limit is not (the deadline may break it, and
 * reconciliation trims after).
 */
export function cpuToCpuOffer(
  s: LeagueState,
  buyer: string,
  salt: number,
  /** a person's staff shopping for them: same eyes, but it works the phones every time it is asked */
  asStaff = false,
): { toTeam: string; fromAssets: TradeAsset[]; toAssets: TradeAsset[] } | null {
  const isCpu = (code: string) => s.teams[code]?.controlledBy.kind === "ai";
  const me = s.teams[buyer];
  if (!me || (!asStaff && !isCpu(buyer))) return null;
  const ctx = tradeContext(s);
  // a contender: a person's staff shops for a team above .500, a CPU team for one whose window is open
  if (asStaff ? me.wins <= me.losses : ctx.windowOf(buyer) <= 0.1) return null;
  // not every contender works the phones every round, and a contender that has bought this deadline has done its shopping
  if (!asStaff && rng(s.season * 104729 + salt + hashCode(buyer))() > PHONE_RATE) return null;
  if (!asStaff && s.tradeDeadline?.resolved.some((r) => r.outcome === "accepted" && r.fromTeam === buyer)) return null;
  const strategy = strategyOf(s, buyer);

  const mine = ROSTER_OF(s, buyer);
  const byPos = new Map<string, number[]>();
  for (const p of mine) byPos.set(p.position, [...(byPos.get(p.position) ?? []), p.overall]);
  const gain = unitGainer((pos) => byPos.get(pos) ?? []);

  // A seller is out of it, not merely a game under .500, and it sells what a real seller sells: not its franchise quarterback, not a
  // young star it is building around.
  const division = (c: string) => `${TEAMS_BY_CODE[c]?.conference}-${TEAMS_BY_CODE[c]?.division}`;
  const sellers = Object.keys(s.teams).filter((c) => c !== buyer && isCpu(c) && ctx.windowOf(c) <= -0.1 && division(c) !== division(buyer));
  const found: { p: Player; team: string; g: number }[] = [];
  for (const team of sellers) {
    for (const p of ROSTER_OF(s, team)) {
      if (p.overall < 75 || p.injury_status) continue;
      if (isCornerstone(p)) continue;
      // a veteran's last year is a rental, which a contender is right to want; years after his decline are a liability
      if (p.age >= p.decline_age_threshold && (p.contract?.years_remaining ?? 0) >= 2) continue;
      if (ctx.chart({ kind: "player", playerId: p.id }) < 15) continue;
      const g = gain(p.position, p.overall);
      // the GM's identity breaks ties between similar upgrades
      const ranked = g + 0.08 * (strategyPositionBonus(strategy, p.position) + strategyAgeBonus(strategy, p.age) + strategyEliteBonus(strategy, p.overall));
      if (g >= 0.6) found.push({ p, team, g: ranked });
    }
  }
  found.sort((a, b) => b.g - a.g || (a.p.id < b.p.id ? -1 : 1));

  const picks = picksOwnedBy(s, buyer);
  // the buyer's own spare players: behind its starters, so a trade does not open a hole
  const spares = sparePlayers(ctx, mine, 60, "starters");
  for (const { p, team } of found.slice(0, 4)) {
    const get: TradeAsset[] = [{ kind: "player", playerId: p.id }];
    const give = cheapestPackage(s, ctx, {
      payer: buyer,
      payee: team,
      get,
      picks,
      players: spares,
      kinds: "any",
      // the seller must take it on its own reading, and the buyer must not be paying much over the chart for him
      willing: (g) => judgeWith(ctx, buyer, team, g, get).acceptLikelihood >= TRADE_ACCEPT_THRESHOLD + OFFER_MARGIN,
      floor: 0,
      ceiling: 1.3,
    });
    if (give && give.length > 0) return { toTeam: team, fromAssets: give, toAssets: get };
  }
  return null;
}

/**
 * A player a rebuilding team builds around rather than sells: its starting-
 * calibre quarterback, a young star, or a prime-age player it has just
 * committed years to.
 */
function isCornerstone(p: Player): boolean {
  if (p.position === "QB" && p.overall >= 78) return true;
  if (p.age <= 26 && p.overall >= 84) return true;
  return p.age <= 28 && p.overall >= 82 && (p.contract?.years_remaining ?? 0) >= 3;
}

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return h >>> 0;
}
