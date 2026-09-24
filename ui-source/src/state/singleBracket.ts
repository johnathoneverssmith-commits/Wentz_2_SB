import type { BracketMatchup, BracketState, LeagueState, PlayoffRound } from "@/domain";
import { bracketRounds } from "@/domain";

import { humansOnlyRounds, playoffFieldSize } from "./leagueFormat";

/**
 * A humans-only league's playoff: one table, one bracket.
 *
 * The top of the standings qualifies — the field size is `playoffFieldSize` —
 * seeded by record, then point differential, then points scored. Best plays
 * worst in every round, the higher seed hosts, and the final is at a neutral
 * site, the same as the Super Bowl it is named after. Built on the NFL
 * bracket's round keys so the reveal and game-day machinery is shared; the
 * semifinal is stored as `CONF` and labelled by `roundLabelFor`.
 *
 * `winProb` is the caller's own curve — the adapter and the offline fallback
 * each quote odds the way they play the game.
 */
export type WinProb = (home: string, away: string, site: "home" | "neutral") => number;

/** The table, best first. */
export function standingsOrder(state: Pick<LeagueState, "teams">): string[] {
  const pct = (c: string): number => {
    const t = state.teams[c]!;
    const g = t.wins + t.losses + t.ties;
    return g ? (t.wins + 0.5 * t.ties) / g : 0;
  };
  const diff = (c: string): number => state.teams[c]!.pointsFor - state.teams[c]!.pointsAgainst;
  return Object.keys(state.teams).sort(
    (a, b) =>
      pct(b) - pct(a) ||
      diff(b) - diff(a) ||
      state.teams[b]!.pointsFor - state.teams[a]!.pointsFor ||
      a.localeCompare(b),
  );
}

const siteOf = (round: PlayoffRound): "home" | "neutral" => (round === "SB" ? "neutral" : "home");

/** One round's matchups from a seed-ordered list of who is still alive. */
function pairings(
  round: PlayoffRound,
  alive: { code: string; seed: number }[],
  winProb: WinProb,
): BracketMatchup[] {
  const bySeed = [...alive].sort((a, b) => a.seed - b.seed);
  const out: BracketMatchup[] = [];
  for (let i = 0; i < bySeed.length / 2; i++) {
    const high = bySeed[i]!;
    const low = bySeed[bySeed.length - 1 - i]!;
    out.push({
      round,
      conference: "SB",
      highSeed: high,
      lowSeed: low,
      favoredWinProb: Math.round(winProb(high.code, low.code, siteOf(round))),
      homeScore: null,
      awayScore: null,
      winner: null,
    });
  }
  return out;
}

export function seedSingleBracket(state: Pick<LeagueState, "teams">, winProb: WinProb): BracketState {
  const n = Object.keys(state.teams).length;
  const field = standingsOrder(state).slice(0, playoffFieldSize(n));
  const rounds = humansOnlyRounds(n);
  return {
    currentRound: rounds[0]!,
    seeds: { AFC: [], NFC: [] },
    format: "single",
    rounds,
    field,
    matchups: pairings(
      rounds[0]!,
      field.map((code, i) => ({ code, seed: i + 1 })),
      winProb,
    ),
    champion: null,
  };
}

/**
 * After `round`'s games are in: crown the champion, or pair the winners for
 * the next round. Mutates and returns `b`.
 */
export function advanceSingleBracket(b: BracketState, round: PlayoffRound, winProb: WinProb): BracketState {
  const order = bracketRounds(b);
  const played = b.matchups.filter((m) => m.round === round);
  const next = order[order.indexOf(round) + 1];
  if (!next) {
    b.champion = played[0]?.winner ?? null;
    return b;
  }
  const winners = played.map((m) => (m.winner === m.highSeed?.code ? m.highSeed! : m.lowSeed!));
  b.currentRound = next;
  b.matchups.push(...pairings(next, winners, winProb));
  return b;
}
