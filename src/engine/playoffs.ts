/**
 * NFL playoff bracket (Phase A1).
 *
 * Seven seeds per conference. #1 gets a first-round bye; Wild Card weekend is
 * 2v7 / 3v6 / 4v5 with the higher seed hosting. Each later round re-seeds so the
 * top remaining seed always draws the lowest. Conference Championship winners
 * meet in the Super Bowl (neutral site — the better seed is listed home for
 * bookkeeping). Every game runs through `simulateGame`; a playoff game can't end
 * in a tie, so a drawn sim is replayed with a bumped seed and, failing that,
 * awarded to the higher seed.
 */

import type { Conference } from "./nfl-structure.js";
import type { ConferenceSeeding } from "./standings.js";
import { simulateGame } from "./sim.js";

export type PlayoffRound = "wildcard" | "divisional" | "conference" | "superbowl";

export interface PlayoffGame {
  round: PlayoffRound;
  conference: Conference | "NFL";
  home: string;
  away: string;
  homeSeed: number;
  awaySeed: number;
  homeScore: number;
  awayScore: number;
  winner: string;
  /** true if the winner was forced (repeated ties) rather than won on the field. */
  decidedBySeed?: boolean;
}

export interface PlayoffResult {
  games: PlayoffGame[];
  conferenceChampions: Record<Conference, string>;
  champion: string;
  runnerUp: string;
}

interface Contender {
  team: string;
  seed: number;
}

const TIE_BREAK_TRIES = 24;
const SEED_STRIDE = 1_000_003; // spread re-sim seeds far apart

function decide(
  seed: number,
  home: Contender,
  away: Contender,
  neutralSite = false,
): { homeScore: number; awayScore: number; winner: string; decidedBySeed: boolean } {
  const opts = { neutralSite };
  for (let k = 0; k < TIE_BREAK_TRIES; k += 1) {
    const g = simulateGame(seed + k * SEED_STRIDE, home.team, away.team, opts);
    const [hs, as] = g.score;
    if (hs !== as) {
      return {
        homeScore: hs,
        awayScore: as,
        winner: hs > as ? home.team : away.team,
        decidedBySeed: false,
      };
    }
  }
  // deadlocked: the better seed (listed home) advances
  const g = simulateGame(seed, home.team, away.team, opts);
  return {
    homeScore: g.score[0],
    awayScore: g.score[1],
    winner: home.team,
    decidedBySeed: true,
  };
}

function play(
  round: PlayoffRound,
  conference: Conference | "NFL",
  seed: number,
  a: Contender,
  b: Contender,
): PlayoffGame {
  // higher seed (smaller number) hosts — except the Super Bowl, where the
  // better seed is only *listed* home and both teams travel
  const [home, away] = a.seed <= b.seed ? [a, b] : [b, a];
  const r = decide(seed, home, away, round === "superbowl");
  return {
    round,
    conference,
    home: home.team,
    away: away.team,
    homeSeed: home.seed,
    awaySeed: away.seed,
    homeScore: r.homeScore,
    awayScore: r.awayScore,
    winner: r.winner,
    ...(r.decidedBySeed ? { decidedBySeed: true } : {}),
  };
}

// per-conference seed base (added to the run seed); rounds get fixed offsets
// on top so every game's seed is stable however the bracket is stepped.
const CONF_BASE: Record<Conference, number> = { AFC: 100_000, NFC: 200_000 };
const SUPER_BOWL_OFFSET = 900_000;

const asContenders = (seeding: ConferenceSeeding): Contender[] => {
  if (seeding.seeds.length !== 7) {
    throw new Error(`playoffs: a conference needs 7 seeds, got ${seeding.seeds.length}`);
  }
  return seeding.seeds.map((team, i) => ({ team, seed: i + 1 }));
};
const winnerOf = (g: PlayoffGame): Contender => ({
  team: g.winner,
  seed: g.winner === g.home ? g.homeSeed : g.awaySeed,
});
const bySeed = (cs: Contender[]) => [...cs].sort((x, y) => x.seed - y.seed);

function wildCardGames(conf: Conference, base: number, s: Contender[]): PlayoffGame[] {
  return [
    play("wildcard", conf, base + 10, s[1]!, s[6]!),
    play("wildcard", conf, base + 20, s[2]!, s[5]!),
    play("wildcard", conf, base + 30, s[3]!, s[4]!),
  ];
}
function divisionalGames(conf: Conference, base: number, alive: Contender[]): PlayoffGame[] {
  const a = bySeed(alive);
  return [
    play("divisional", conf, base + 40, a[0]!, a[3]!),
    play("divisional", conf, base + 50, a[1]!, a[2]!),
  ];
}
function conferenceGame(conf: Conference, base: number, alive: Contender[]): PlayoffGame {
  const a = bySeed(alive);
  return play("conference", conf, base + 60, a[0]!, a[1]!);
}
function superBowlGame(seed: number, afc: Contender, nfc: Contender): PlayoffGame {
  return afc.seed <= nfc.seed
    ? play("superbowl", "NFL", seed + SUPER_BOWL_OFFSET, afc, nfc)
    : play("superbowl", "NFL", seed + SUPER_BOWL_OFFSET, nfc, afc);
}

/**
 * Full bracket. Games are grouped by round (all Wild Card, then all Divisional,
 * …), then the Super Bowl last. Equivalent to `finishPlayoffs(startPlayoffs(…))`.
 */
export function simulatePlayoffs(
  seed: number,
  seeding: Record<Conference, ConferenceSeeding>,
): PlayoffResult {
  return finishPlayoffs(startPlayoffs(seed, seeding));
}

// --- round-by-round stepper (for an interactive postseason UI) ---

export interface PlayoffProgress {
  seed: number;
  seeding: Record<Conference, ConferenceSeeding>;
  /** Next round to play; "done" once the Super Bowl is in. */
  nextRound: PlayoffRound | "done";
  games: PlayoffGame[];
  /** Teams still alive per conference (seed-sorted); one each once conf champs are decided. */
  alive: Record<Conference, Contender[]>;
}

export function startPlayoffs(
  seed: number,
  seeding: Record<Conference, ConferenceSeeding>,
): PlayoffProgress {
  return {
    seed,
    seeding,
    nextRound: "wildcard",
    games: [],
    alive: { AFC: asContenders(seeding.AFC), NFC: asContenders(seeding.NFC) },
  };
}

/** Play the next round (both conferences, or the Super Bowl). Pure — `p` is not mutated. */
export function playPlayoffRound(p: PlayoffProgress): {
  progress: PlayoffProgress;
  games: PlayoffGame[];
} {
  if (p.nextRound === "done") return { progress: p, games: [] };

  const fresh: PlayoffGame[] = [];
  const alive = { AFC: [...p.alive.AFC], NFC: [...p.alive.NFC] };
  let nextRound: PlayoffRound | "done";

  if (p.nextRound === "superbowl") {
    const sb = superBowlGame(p.seed, alive.AFC[0]!, alive.NFC[0]!);
    fresh.push(sb);
    nextRound = "done";
  } else {
    for (const conf of ["AFC", "NFC"] as Conference[]) {
      const base = p.seed + CONF_BASE[conf];
      const seeds = asContenders(p.seeding[conf]);
      let roundGames: PlayoffGame[];
      if (p.nextRound === "wildcard") {
        roundGames = wildCardGames(conf, base, seeds);
        alive[conf] = bySeed([seeds[0]!, ...roundGames.map(winnerOf)]);
      } else if (p.nextRound === "divisional") {
        roundGames = divisionalGames(conf, base, alive[conf]);
        alive[conf] = bySeed(roundGames.map(winnerOf));
      } else {
        roundGames = [conferenceGame(conf, base, alive[conf])];
        alive[conf] = [winnerOf(roundGames[0]!)];
      }
      fresh.push(...roundGames);
    }
    nextRound =
      p.nextRound === "wildcard"
        ? "divisional"
        : p.nextRound === "divisional"
          ? "conference"
          : "superbowl";
  }

  return {
    progress: { ...p, nextRound, games: [...p.games, ...fresh], alive },
    games: fresh,
  };
}

export function playoffsComplete(p: PlayoffProgress): boolean {
  return p.nextRound === "done";
}

/** Play out the remaining rounds and assemble the result. */
export function finishPlayoffs(p: PlayoffProgress): PlayoffResult {
  let cur = p;
  while (!playoffsComplete(cur)) cur = playPlayoffRound(cur).progress;
  const sb = cur.games[cur.games.length - 1]!;
  const afc = cur.alive.AFC[0]!.team;
  const nfc = cur.alive.NFC[0]!.team;
  return {
    games: cur.games,
    conferenceChampions: { AFC: afc, NFC: nfc },
    champion: sb.winner,
    runnerUp: sb.winner === afc ? nfc : afc,
  };
}
