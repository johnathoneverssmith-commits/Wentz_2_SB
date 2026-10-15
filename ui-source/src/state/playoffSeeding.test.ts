import { describe, expect, it } from "vitest";

import { computeStandings, type FinishedGame } from "../../../src/engine/standings.ts";
import { MockSimulationService } from "@/sim/MockSimulationService";
import type { GameResult, LeagueState } from "@/domain";

import { createLeague, DEFAULT_CONFIG } from "./seed.ts";
import { recomputeStandings } from "./standings.ts";

/**
 * One set of playoff rules, everywhere.
 *
 * The engine's `computeStandings` is the documented rule book: division winners are seeds 1-4 (ranked against each
 * other), the three best of the rest are seeds 5-7, and every tie goes through head-to-head, division / common /
 * conference record, strength of victory and schedule, then net points. The local game (the Mock, which is also what
 * the multiplayer server seeds with) and the standings the screens show used to have their own, simpler orderings:
 * wins then point difference for the bracket, and a shorter tiebreak with no division-winner priority for the ranks.
 * The same completed season therefore produced different seeds, byes and pairings depending on where it was asked.
 *
 * These tests take whole seasons (the league's real schedule, results from a seeded generator, ties included) and ask
 * the engine, independently, what the answer is.
 */
const toEngine = (c: string): string => (c === "LAR" ? "LA" : c);
const toUi = (c: string): string => (c === "LA" ? "LAR" : c);
const sim = new MockSimulationService();

/** A small seeded generator, so a failing season can be replayed. */
const rng = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 2 ** 32;
};

/** A league that has played every regular-season game on its own schedule, with results drawn from `seed`. */
const seasons = new Map<number, LeagueState>();
/** (built once and shared: the tests only read them) */
function playedSeason(seed: number): LeagueState {
  const known = seasons.get(seed);
  if (known) return known;
  const built = buildSeason(seed);
  seasons.set(seed, built);
  return built;
}
function buildSeason(seed: number): LeagueState {
  const s = createLeague(7, { ...DEFAULT_CONFIG, humanGmCount: 1 });
  const next = rng(seed * 9973 + 11);
  // each team has a hidden strength, so records spread out the way a league's do
  const strength = Object.fromEntries(Object.keys(s.teams).map((c) => [c, next() * 2 - 1]));
  s.games = s.schedule
    .filter((g) => g.phase === "REG")
    .map((g, i): GameResult => {
      const edge = strength[g.homeTeam]! - strength[g.awayTeam]! + 0.1;
      const roll = next();
      const tie = roll < 0.012;
      const homeWins = roll < 0.5 + edge * 0.35;
      const margin = 1 + Math.floor(next() * 20);
      const base = 13 + Math.floor(next() * 14);
      const homeScore = tie ? base : homeWins ? base + margin : base;
      const awayScore = tie ? base : homeWins ? base : base + margin;
      return { id: `g${seed}-${i}`, week: g.week, phase: "REG", homeTeam: g.homeTeam, awayTeam: g.awayTeam, played: true, homeScore, awayScore };
    });
  recomputeStandings(s);
  return s;
}

/** What the rule book says, from the completed games alone. */
function engineSays(s: LeagueState) {
  const games: FinishedGame[] = s.games.filter((g) => g.phase === "REG" && g.played).map((g) => ({ home: toEngine(g.homeTeam), away: toEngine(g.awayTeam), homeScore: g.homeScore, awayScore: g.awayScore }));
  const r = computeStandings(games, Object.keys(s.teams).map(toEngine));
  const conf = (c: "AFC" | "NFC") => ({ seeds: r.seeding[c].seeds.map(toUi), winners: r.seeding[c].divisionWinners.map(toUi), wildCards: r.seeding[c].wildCards.map(toUi) });
  return { AFC: conf("AFC"), NFC: conf("NFC"), rows: new Map(r.rows.map((row) => [toUi(row.team), row])) };
}

/** The ordering the bracket used before: wins, then point difference, nothing about divisions or ties. */
function legacyBracketSeeds(s: LeagueState, conference: readonly string[]): string[] {
  return [...conference]
    .sort((x, y) => s.teams[y]!.wins - s.teams[x]!.wins || s.teams[y]!.pointsFor - s.teams[y]!.pointsAgainst - (s.teams[x]!.pointsFor - s.teams[x]!.pointsAgainst))
    .slice(0, 7);
}

const SEASONS = Array.from({ length: 40 }, (_, i) => i + 1);

describe("the bracket is seeded by the rule book", () => {
  it("in every season, the Mock's seeds, byes and pairings are the engine's, conference by conference", () => {
    for (const seed of SEASONS) {
      const s = playedSeason(seed);
      const said = engineSays(s);
      const b = sim.seedBracket(s);
      for (const conf of ["AFC", "NFC"] as const) {
        expect(b.seeds[conf], `season ${seed}, ${conf}: seeds`).toEqual(said[conf].seeds);
        const wc = b.matchups.filter((m) => m.round === "WC" && m.conference === conf);
        expect(wc.find((m) => m.lowSeed === null)?.highSeed?.code, `season ${seed}, ${conf}: the bye`).toBe(said[conf].seeds[0]);
        for (const [hi, lo] of [[2, 7], [3, 6], [4, 5]] as const) {
          const m = wc.find((x) => x.highSeed?.seed === hi)!;
          expect([m.highSeed?.code, m.lowSeed?.code], `season ${seed}, ${conf}: ${hi} hosts ${lo}`).toEqual([said[conf].seeds[hi - 1], said[conf].seeds[lo - 1]]);
        }
      }
    }
  });

  it("division champions are seeds 1-4 and wild cards 5-7, including when a champion has fewer wins than a wild card", () => {
    let champBehindWildCard = 0;
    for (const seed of SEASONS) {
      const s = playedSeason(seed);
      const b = sim.seedBracket(s);
      const said = engineSays(s);
      for (const conf of ["AFC", "NFC"] as const) {
        expect(b.seeds[conf].slice(0, 4), `season ${seed}, ${conf}: seeds 1-4 are the division champions`).toEqual(said[conf].winners);
        expect(b.seeds[conf].slice(4), `season ${seed}, ${conf}: seeds 5-7 are the wild cards`).toEqual(said[conf].wildCards);
        for (const champ of said[conf].winners) for (const wildCard of said[conf].wildCards) {
          if (s.teams[champ]!.wins < s.teams[wildCard]!.wins) {
            champBehindWildCard++;
            expect(b.seeds[conf].indexOf(champ), `season ${seed}: ${champ} (${s.teams[champ]!.wins} wins) won a division and outseeds ${wildCard} (${s.teams[wildCard]!.wins} wins)`).toBeLessThan(b.seeds[conf].indexOf(wildCard));
          }
        }
      }
    }
    expect(champBehindWildCard, "the seasons really do contain a champion with fewer wins than a wild card").toBeGreaterThan(0);
  });

  it("the old wins-then-point-difference order disagrees with the rule book in some of these seasons (so the tests above can fail)", () => {
    let disagreements = 0;
    for (const seed of SEASONS) {
      const s = playedSeason(seed);
      const said = engineSays(s);
      for (const name of ["AFC", "NFC"] as const) {
        const members = [...said.rows.values()].filter((r) => r.conference === name).map((r) => toUi(r.team));
        if (JSON.stringify(legacyBracketSeeds(s, members)) !== JSON.stringify(said[name].seeds)) disagreements++;
      }
    }
    expect(disagreements).toBeGreaterThan(0);
  });
});

describe("the standings the screens read are the rule book's", () => {
  it("division ranks and conference ranks are the engine's, and ranks 1-7 are the seeds in seed order", () => {
    for (const seed of SEASONS) {
      const s = playedSeason(seed);
      const said = engineSays(s);
      for (const [code, row] of said.rows) expect(s.teams[code]!.divisionRank, `season ${seed}: ${code}'s division rank`).toBe(row.divisionRank);
      for (const conf of ["AFC", "NFC"] as const) {
        said[conf].seeds.forEach((code, i) => expect(s.teams[code]!.conferenceRank, `season ${seed}: ${code} is conference rank ${i + 1}`).toBe(i + 1));
        const inConf = [...said.rows.values()].filter((r) => r.conference === conf).map((r) => toUi(r.team));
        expect(inConf.map((c) => s.teams[c]!.conferenceRank).sort((a, b) => a - b), `season ${seed}, ${conf}: ranks 1..16, each once`).toEqual(inConf.map((_, i) => i + 1));
      }
    }
  });

  it("head-to-head beats point difference between two teams with the same record in a division", () => {
    const s = createLeague(7, { ...DEFAULT_CONFIG, humanGmCount: 1 });
    const game = (id: string, home: string, away: string, homeScore: number, awayScore: number): GameResult => ({ id, week: 1, phase: "REG", homeTeam: home, awayTeam: away, played: true, homeScore, awayScore });
    s.games = [
      game("a", "BAL", "CIN", 21, 20), // BAL beat CIN
      game("b", "CIN", "CLE", 45, 3), // CIN, a huge margin
      game("c", "PIT", "BAL", 30, 3), // BAL lost badly
    ];
    recomputeStandings(s);
    expect([s.teams.BAL!.wins, s.teams.BAL!.losses]).toEqual([1, 1]);
    expect([s.teams.CIN!.wins, s.teams.CIN!.losses]).toEqual([1, 1]);
    expect(s.teams.CIN!.pointsFor - s.teams.CIN!.pointsAgainst).toBeGreaterThan(s.teams.BAL!.pointsFor - s.teams.BAL!.pointsAgainst);
    expect(s.teams.BAL!.divisionRank, "BAL beat CIN, so ranks ahead of the better point difference").toBeLessThan(s.teams.CIN!.divisionRank);
    expect(s.teams.PIT!.divisionRank).toBe(1);
  });
});
