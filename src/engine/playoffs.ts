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
): { homeScore: number; awayScore: number; winner: string; decidedBySeed: boolean } {
  for (let k = 0; k < TIE_BREAK_TRIES; k += 1) {
    const g = simulateGame(seed + k * SEED_STRIDE, home.team, away.team);
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
  const g = simulateGame(seed, home.team, away.team);
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
  // higher seed (smaller number) hosts
  const [home, away] = a.seed <= b.seed ? [a, b] : [b, a];
  const r = decide(seed, home, away);
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

function runConference(
  conf: Conference,
  seed: number,
  seeding: ConferenceSeeding,
  games: PlayoffGame[],
): Contender {
  const bySeed = seeding.seeds.map((team, i) => ({ team, seed: i + 1 }));
  if (bySeed.length !== 7) {
    throw new Error(`simulatePlayoffs: ${conf} needs 7 seeds, got ${bySeed.length}`);
  }
  const [s1, s2, s3, s4, s5, s6, s7] = bySeed as [
    Contender,
    Contender,
    Contender,
    Contender,
    Contender,
    Contender,
    Contender,
  ];

  // wild card
  const wc: PlayoffGame[] = [
    play("wildcard", conf, seed + 10, s2, s7),
    play("wildcard", conf, seed + 20, s3, s6),
    play("wildcard", conf, seed + 30, s4, s5),
  ];
  games.push(...wc);
  const survived: Contender[] = [s1];
  for (const g of wc) {
    const w = g.winner === g.home ? g.homeSeed : g.awaySeed;
    survived.push({ team: g.winner, seed: w });
  }

  // divisional — reseed: #1 vs lowest, next two meet
  survived.sort((x, y) => x.seed - y.seed);
  const [d1, d2, d3, d4] = survived as [Contender, Contender, Contender, Contender];
  const div: PlayoffGame[] = [
    play("divisional", conf, seed + 40, d1, d4),
    play("divisional", conf, seed + 50, d2, d3),
  ];
  games.push(...div);
  const finalists: Contender[] = div.map((g) => ({
    team: g.winner,
    seed: g.winner === g.home ? g.homeSeed : g.awaySeed,
  }));

  // conference championship
  finalists.sort((x, y) => x.seed - y.seed);
  const champGame = play("conference", conf, seed + 60, finalists[0]!, finalists[1]!);
  games.push(champGame);
  return {
    team: champGame.winner,
    seed: champGame.winner === champGame.home ? champGame.homeSeed : champGame.awaySeed,
  };
}

export function simulatePlayoffs(
  seed: number,
  seeding: Record<Conference, ConferenceSeeding>,
): PlayoffResult {
  const games: PlayoffGame[] = [];
  const afc = runConference("AFC", seed + 100_000, seeding.AFC, games);
  const nfc = runConference("NFC", seed + 200_000, seeding.NFC, games);

  // Super Bowl — neutral; better seed listed home, AFC on a seed tie
  const sb =
    afc.seed <= nfc.seed
      ? play("superbowl", "NFL", seed + 900_000, afc, nfc)
      : play("superbowl", "NFL", seed + 900_000, nfc, afc);
  games.push(sb);

  return {
    games,
    conferenceChampions: { AFC: afc.team, NFC: nfc.team },
    champion: sb.winner,
    runnerUp: sb.winner === afc.team ? nfc.team : afc.team,
  };
}
