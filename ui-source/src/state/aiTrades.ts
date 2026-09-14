/**
 * Offers the league makes to you.
 *
 * Every trade in the game started with the human: they opened the screen,
 * built a package, and asked. Nothing ever came the other way. A franchise
 * mode where the phone never rings is missing the moment that makes the
 * position feel real — someone wants your left tackle, and now you have to
 * decide what he's worth.
 */
import type { LeagueState, Player, TradeAsset, TradeProposal } from "@/domain";

import { pickKey, picksOwnedBy } from "./draftPicks.ts";

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
  return Math.max(0, 80 - (best || 40));
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
    const positions = [...new Set(myRoster.map((p) => p.position))]
      .map((pos) => {
        const theirs = bestOf(theirRoster, pos);
        const mine = bestOf(myRoster, pos);
        return { pos, gain: (mine?.overall ?? 0) - (theirs?.overall ?? 40), need: needAt(s, suitor, pos) };
      })
      .sort((a, b) => b.gain + b.need / 4 - (a.gain + a.need / 4));
    const wanted = positions.find((p) => {
      if (p.gain < 5) return false;
      const mine = myRoster.filter((x) => x.position === p.pos).sort((a, b) => b.overall - a.overall);
      // they ask for the best one *only* if there's someone behind him
      return mine.length >= 2 && mine[0]!.overall >= 70;
    });
    if (!wanted) continue;

    const askFor = myRoster
      .filter((p) => p.position === wanted.pos)
      .sort((a, b) => b.overall - a.overall)[0]!;
    // one GM shouldn't get two offers for the same man in the same window
    if (out.some((t) => t.toAssets.some((a) => a.playerId === askFor.id))) continue;

    // a package: their best spare player at a position they're deep in, plus
    // a pick, aimed at landing a little over what they're asking for
    const targetValue = Math.max(0, askFor.overall - 50);
    const spares = theirRoster
      .filter((p) => {
        const better = theirRoster.filter(
          (x) => x.position === p.position && x.overall > p.overall,
        ).length;
        return better >= 1 && p.overall >= 60;
      })
      .sort((a, b) => Math.abs(a.overall - askFor.overall) - Math.abs(b.overall - askFor.overall));
    const give: TradeAsset[] = [];
    let offered = 0;
    for (const p of spares) {
      if (offered >= targetValue) break;
      give.push({ kind: "player", playerId: p.id });
      offered += Math.max(0, p.overall - 50);
    }
    // top it up with draft capital — the round scaled to what's still owed
    if (offered < targetValue) {
      const short = targetValue - offered;
      const round = short > 20 ? 1 : short > 10 ? 2 : short > 5 ? 3 : 4;
      const theirPick = picksOwnedBy(s, suitor).find((p) => p.round === round);
      if (theirPick) {
        give.push({ kind: "pick", pick: theirPick });
        offered += short;
      }
    }
    if (give.length === 0) continue;

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
