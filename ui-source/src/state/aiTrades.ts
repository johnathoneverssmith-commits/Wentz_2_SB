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

import { packageValue, tradeAssetValue } from "@/sim/MockSimulationService";

import { pickKey, picksOwnedBy } from "./draftPicks.ts";
import { strategyAgeBonus, strategyEliteBonus, strategyFor, strategyPositionBonus } from "./aiStrategy.ts";
import { deterministicNoiseUnit, difficultyProfile } from "./aiDifficulty.ts";
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
function needAt(s: LeagueState, code: string, pos: string): number {
  const best = ROSTER_OF(s, code)
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
    const strategy = strategyFor(suitor, s.season);
    // AI Difficulty (§14): the same bounded valuation noise and need-
    // awareness scaling as every other target-ranking call site — never a
    // change to the canonical trade-value formula itself.
    const difficulty = difficultyProfile(s.config.difficulty);
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
          need: needAt(s, suitor, pos) * difficulty.needAwareness,
          wantedScore,
        };
      })
      .sort((a, b) => b.gain + b.need / 5 + b.wantedScore - (a.gain + a.need / 5 + a.wantedScore));
    const wanted = positions.find((p) => {
      if (p.gain < 4) return false;
      const mine = myRoster.filter((x) => x.position === p.pos).sort((a, b) => b.overall - a.overall);
      // they ask for the best one *only* if there's someone behind him
      return mine.length >= 2 && mine[0]!.overall >= 72;
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
    /**
     * What an asset is worth to this package, priced by `tradeAssetValue` —
     * the same function `evaluateTrade` settles the deal with.
     *
     * This used to be a scale of its own: `overall - 42` for a player and
     * `(33 - round * 5)` for a pick. Both disagreed with the evaluator, in
     * the same direction. Position was ignored entirely, so a 95 quarterback
     * and a 95 guard cost the same to acquire; and a seventh-round pick was
     * priced at 3 against the real chart's 0.5, so two of them "closed" a gap
     * they barely touched. A suitor chasing Lamar Jackson set a target of 53,
     * met it with a 77 guard and two sevenths, and sent an offer the
     * evaluator scored at under a fifth of what it asked for. Playing a stock
     * dynasty, that is the offer that actually arrived.
     */
    const worthOf = (p: Player): number =>
      tradeAssetValue(s, { kind: "player", playerId: p.id });
    const targetValue = worthOf(askFor);
    const spares = theirRoster
      .filter((p) => {
        const better = theirRoster.filter(
          (x) => x.position === p.position && x.overall > p.overall,
        ).length;
        return better >= 1 && p.overall >= 62;
      })
      .sort((a, b) => Math.abs(a.overall - askFor.overall) - Math.abs(b.overall - askFor.overall));
    const availablePicks = picksOwnedBy(s, suitor).sort((a, b) => a.round - b.round);
    const strength = pickStrengthFor(s, suitor);
    // a pick's contribution scales with the team's own projected draft slot
    // (finding 14) — a bad team's pick closes more of the gap than the same
    // round from a good one, so it takes a later round to match it
    const pickValue = (pick: DraftPickAsset): number =>
      tradeAssetValue(s, { kind: "pick", pick }) * strength;

    const shapeRoll = random();
    const shape: "players" | "picks" | "mixed" =
      availablePicks.length === 0 ? "players" : shapeRoll < 0.25 ? "picks" : shapeRoll < 0.55 ? "mixed" : "players";

    const give: TradeAsset[] = [];
    let offered = 0;
    const usedPicks = new Set<string>();
    const cheapestFirst = [...availablePicks].sort((a, b) => b.round - a.round);
    /**
     * Top up with the *cheapest pick that actually closes the gap*, falling
     * back to the best one left when none does.
     *
     * The instinct is still "keep the good future assets out of a package
     * that doesn't need them" — but it has to be measured against the real
     * pick chart, where a seventh-rounder is worth 0.5 and a first is 82.7.
     * Reaching for the cheapest pick unconditionally meant a mixed package
     * was one spare player plus two sevenths: about a point of value on top,
     * which stopped clearing the suitor's own target once players were priced
     * by position. Mixed offers then vanished from the market entirely, and
     * with them the varied package shapes finding 15 asked for.
     */
    const addBestPick = (): boolean => {
      const left = cheapestFirst.filter(
        (p) => !usedPicks.has(pickKey(p.year, p.round, p.originalTeam)),
      );
      if (left.length === 0) return false;
      const gap = targetValue - offered;
      const pick = left.find((p) => pickValue(p) >= gap) ?? left[left.length - 1]!;
      usedPicks.add(pickKey(pick.year, pick.round, pick.originalTeam));
      give.push({ kind: "pick", pick });
      offered += pickValue(pick);
      return true;
    };

    if (shape === "picks") {
      // Lead with capital, a few picks at most, each the cheapest that closes
      // what is left of the gap. Walking up from the latest round used to be
      // the rule, and on the real pick chart — where a seventh is worth 0.5
      // and a first 82.7 — it met a real target by piling on every Day 3
      // pick for three drafts: a dozen-pick package nobody sends. Too far
      // short after four picks and the offer falls to the lowball gate below.
      for (let n = 0; n < 4 && offered < targetValue; n++) {
        if (!addBestPick()) break;
      }
    } else {
      if (shape === "mixed" && spares[0]) {
        // exactly one player, so the pick(s) alongside it are load-bearing
        // rather than an afterthought
        give.push({ kind: "player", playerId: spares[0].id });
        offered += worthOf(spares[0]);
      } else {
        // at most three: past that it is a pile of spares, not an offer,
        // and the package discount makes each extra one worth little anyway
        for (const p of spares) {
          if (offered >= targetValue || give.length >= 3) break;
          give.push({ kind: "player", playerId: p.id });
          offered = packageValue(s, give);
        }
      }
      // top up with draft capital either way, capped so a small gap can't
      // turn into a handful of Day 3 picks nobody would actually attach
      for (let n = 0; n < 2 && offered < targetValue; n++) {
        if (!addBestPick()) break;
      }
    }
    if (give.length === 0) continue;
    // Don't send a package the suitor itself rates as a lowball. Offers used
    // to go out on "we assembled something", however far short of the target
    // it landed, which is the other half of why the deadline felt fake: a GM
    // who knows he is 60% short doesn't make the call. A little under is
    // haggling and still goes.
    if (offered < targetValue * 0.9) continue;

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
 * The deadline only ever produced offers aimed at humans, so in ten seasons
 * no two CPU teams traded with each other once — the league never moved
 * unless a human moved it. A real deadline is contenders buying from teams
 * that are out of it: this finds the upgrade that adds most to the buyer's
 * starting units (the Master AI's reading, `unitGainer`) on a losing CPU
 * team, and offers the buyer's draft picks for him — the cheapest pick that
 * covers his trade value with a seller's premium, or the best few that come
 * closest. If the cap would not take him, the starter he replaces goes the
 * other way. The seller decides with the same evaluator as any other offer.
 */
export function cpuToCpuOffer(
  s: LeagueState,
  buyer: string,
  salt: number,
): { toTeam: string; fromAssets: TradeAsset[]; toAssets: TradeAsset[] } | null {
  const isCpu = (code: string) => s.teams[code]?.controlledBy.kind === "ai";
  const me = s.teams[buyer];
  if (!me || !isCpu(buyer) || me.wins <= me.losses) return null;
  // not every contender works the phones every round
  if (rng(s.season * 104729 + salt + hashCode(buyer))() > 0.4) return null;

  const mine = ROSTER_OF(s, buyer);
  const byPos = new Map<string, number[]>();
  for (const p of mine) byPos.set(p.position, [...(byPos.get(p.position) ?? []), p.overall]);
  const gain = unitGainer((pos) => byPos.get(pos) ?? []);

  const sellers = Object.keys(s.teams).filter((c) => c !== buyer && isCpu(c) && s.teams[c]!.wins < s.teams[c]!.losses);
  let best: { p: Player; team: string; g: number } | null = null;
  for (const team of sellers) {
    for (const p of ROSTER_OF(s, team)) {
      if (p.age > 31 || p.overall < 75 || p.injury_status) continue;
      const g = gain(p.position, p.overall);
      if (g >= 0.6 && (!best || g > best.g)) best = { p, team, g };
    }
  }
  if (!best) return null;

  const need = tradeAssetValue(s, { kind: "player", playerId: best.p.id }) * 1.1;
  const picks = picksOwnedBy(s, buyer).map((pick) => ({ pick, v: tradeAssetValue(s, { kind: "pick", pick }) }));
  const covering = picks.filter((x) => x.v >= need).sort((a, b) => a.v - b.v)[0];
  const give: TradeAsset[] = [];
  if (covering) give.push({ kind: "pick", pick: covering.pick });
  else {
    let total = 0;
    for (const x of picks.sort((a, b) => b.v - a.v).slice(0, 3)) {
      give.push({ kind: "pick", pick: x.pick });
      total += x.v;
      if (total >= need) break;
    }
    if (total < need * 0.85) return null;
  }

  // the cap has to take him: send the man he replaces if it would not
  const hit = (p: Player) => p.contract?.cap_hit_by_year[0] ?? 0;
  if (me.cap.used + hit(best.p) > me.cap.total) {
    const displaced = mine
      .filter((p) => p.position === best!.p.position)
      .sort((a, b) => a.overall - b.overall)
      .find((p) => me.cap.used + hit(best!.p) - hit(p) <= me.cap.total);
    if (!displaced) return null;
    give.push({ kind: "player", playerId: displaced.id });
  }
  return { toTeam: best.team, fromAssets: give, toAssets: [{ kind: "player", playerId: best.p.id }] };
}

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return h >>> 0;
}
