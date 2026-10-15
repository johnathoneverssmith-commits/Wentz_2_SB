import type { Page } from "@playwright/test";

import { expect } from "@playwright/test";

import { teamIdentity } from "./season.ts";
import { SAVE_KEY } from "./test.ts";

export type Round = "WC" | "DIV" | "CONF" | "SB";
export const ROUNDS: readonly Round[] = ["WC", "DIV", "CONF", "SB"];
export const ROUND_NAME: Record<Round, string> = { WC: "Wild Card", DIV: "Divisional", CONF: "Conference Championship", SB: "Super Bowl" };

export interface Side {
  code: string;
  seed: number;
}
export interface Matchup {
  round: Round;
  conference: "AFC" | "NFC" | "SB";
  high: Side | null;
  low: Side | null;
  homeScore: number | null;
  awayScore: number | null;
  winner: string | null;
}

/** The postseason as the app saved it: the bracket, what is held for the Game Day screen, and what the season recorded. */
export interface Postseason {
  stage: string;
  me: string;
  round: Round;
  champion: string | null;
  seeds: { AFC: string[]; NFC: string[] };
  matchups: Matchup[];
  pending: null | { phase: string; gameIds: string[] };
  /** Games on the books that are neither preseason nor regular season (the Mock records a round in the bracket, not here). */
  postseasonGames: string[];
  /** Every regular-season game: id and score, to show none was added, replayed or changed. */
  regularSeason: string;
  /** What finalizing the season wrote down for each team's GM, for the current season (empty until it is finalized). */
  outcomes: Array<{ team: string; madePlayoffs: boolean; seed: number; furthestRound: string; wonSuperBowl: boolean }>;
}

export async function readPostseason(page: Page): Promise<Postseason> {
  return page.evaluate((key) => {
    const raw = window.localStorage.getItem(key);
    if (raw == null) throw new Error("no saved league");
    const s = (JSON.parse(raw) as { state: Record<string, any> }).state;
    const me = (s.gms as Array<{ id: string; teamCode?: string }>).find((g) => g.id === s.viewerGmId)!.teamCode as string;
    const b = s.bracket as null | { currentRound: Round; champion: string | null; seeds: { AFC: string[]; NFC: string[] }; matchups: Array<{ round: Round; conference: "AFC" | "NFC" | "SB"; highSeed: Side | null; lowSeed: Side | null; homeScore: number | null; awayScore: number | null; winner: string | null }> };
    if (!b) throw new Error("no bracket");
    const games = s.games as Array<{ id: string; phase: string; week: number; homeTeam: string; awayTeam: string; homeScore: number; awayScore: number }>;
    const outcomes: Postseason["outcomes"] = [];
    for (const g of s.aiGms as Array<{ teamCode?: string; seasons?: Array<{ season: number; teamCode?: string; madePlayoffs: boolean; seed: number; furthestRound: string; wonSuperBowl: boolean }> }>) {
      for (const se of g.seasons ?? []) if (se.season === s.season) outcomes.push({ team: (g.teamCode ?? se.teamCode) as string, madePlayoffs: se.madePlayoffs, seed: se.seed, furthestRound: se.furthestRound, wonSuperBowl: se.wonSuperBowl });
    }
    for (const h of (s.history ?? []) as Array<{ season: number; teamCode: string; madePlayoffs: boolean; seed: number; furthestRound: string; wonSuperBowl: boolean }>) {
      if (h.season === s.season) outcomes.push({ team: h.teamCode, madePlayoffs: h.madePlayoffs, seed: h.seed, furthestRound: h.furthestRound, wonSuperBowl: h.wonSuperBowl });
    }
    return {
      stage: s.stage as string,
      me,
      round: b.currentRound,
      champion: b.champion,
      seeds: b.seeds,
      matchups: b.matchups.map((m) => ({ round: m.round, conference: m.conference, high: m.highSeed, low: m.lowSeed, homeScore: m.homeScore, awayScore: m.awayScore, winner: m.winner })),
      pending: s.pendingGameDay ? { phase: s.pendingGameDay.phase, gameIds: s.pendingGameDay.gameIds } : null,
      postseasonGames: games.filter((g) => g.phase !== "REG" && g.phase !== "PRE").map((g) => g.id),
      regularSeason: games.filter((g) => g.phase === "REG").map((g) => `${g.id}:${g.homeScore}-${g.awayScore}`).join("|"),
      outcomes,
    };
  }, SAVE_KEY);
}

const inRound = (p: Postseason, round: Round, conference?: string) => p.matchups.filter((m) => m.round === round && (conference === undefined || m.conference === conference));
const isBye = (m: Matchup) => m.round === "WC" && m.low === null;
const seedOf = (p: Postseason, conf: "AFC" | "NFC", code: string) => p.seeds[conf].indexOf(code) + 1;

/** Who wins a game by its score: the home side (the higher seed; the AFC side in the Super Bowl) has `homeScore`. */
export function winnerByScore(m: Matchup): string | null {
  if (isBye(m)) return m.high!.code;
  if (m.homeScore === null || m.awayScore === null || m.homeScore === m.awayScore) return null;
  return m.homeScore > m.awayScore ? m.high!.code : m.low!.code;
}

/**
 * The next round, worked out from the winners of the last one alone, by the league's reseeding: the best surviving seed plays
 * the worst, the next best the next worst; the higher seed hosts. The Super Bowl is the two conference champions.
 */
export function expectedNextRound(p: Postseason, finished: Round): Array<{ conference: string; high: Side; low: Side }> {
  if (finished === "CONF") {
    const champ = (conf: "AFC" | "NFC") => inRound(p, "CONF", conf)[0]!.winner!;
    return [{ conference: "SB", high: { code: champ("AFC"), seed: 0 }, low: { code: champ("NFC"), seed: 0 } }];
  }
  const out: Array<{ conference: string; high: Side; low: Side }> = [];
  for (const conf of ["AFC", "NFC"] as const) {
    const survivors = inRound(p, finished, conf)
      .map((m) => m.winner!)
      .map((code) => ({ code, seed: seedOf(p, conf, code) }))
      .sort((a, b) => a.seed - b.seed);
    for (let i = 0; i < survivors.length / 2; i++) out.push({ conference: conf, high: survivors[i]!, low: survivors[survivors.length - 1 - i]! });
  }
  return out;
}

/**
 * Everything that must be true of the bracket after `played` rounds have been played (0 = freshly seeded, 4 = the Super Bowl done):
 * the field is the seeded fourteen, the one seeds have byes, each played game has a winner that its score gives, the next round
 * is the reseeding of those winners, no one beaten ever appears again, and nothing later has been played.
 */
export function expectBracketConsistent(p: Postseason, played: number, startingSeeds: Postseason["seeds"]): void {
  expect(p.seeds, "the seeds never change once the bracket is made").toEqual(startingSeeds);
  const field = new Set([...startingSeeds.AFC, ...startingSeeds.NFC]);
  expect(field.size, "fourteen different teams").toBe(14);

  const losers = new Set<string>();
  for (let r = 0; r < ROUNDS.length; r++) {
    const round = ROUNDS[r]!;
    const games = inRound(p, round);
    if (r > played) {
      expect(games, `${ROUND_NAME[round]} is not made until the round before it is played`).toEqual([]);
      continue;
    }
    expect(games, `${ROUND_NAME[round]}: games per conference`).toHaveLength(round === "WC" ? 8 : round === "DIV" ? 4 : round === "CONF" ? 2 : 1);

    // the field of this round, each team once, none already beaten
    const teams = games.flatMap((m) => [m.high?.code, m.low?.code]).filter((c): c is string => !!c);
    expect(new Set(teams).size, `${ROUND_NAME[round]}: no team twice`).toBe(teams.length);
    for (const t of teams) expect(losers.has(t), `${t} was beaten earlier and is back in the ${ROUND_NAME[round]}`).toBe(false);

    if (r === 0) {
      // the opening round: the seeds, the 1 seeds on a bye, and 2-7, 3-6, 4-5
      for (const conf of ["AFC", "NFC"] as const) {
        const seeds = startingSeeds[conf];
        const wc = inRound(p, "WC", conf);
        expect(wc.filter(isBye).map((m) => m.high), `${conf}: the bye`).toEqual([{ code: seeds[0], seed: 1 }]);
        for (const [hi, lo] of [[2, 7], [3, 6], [4, 5]] as const) {
          const m = wc.find((x) => x.high?.seed === hi)!;
          expect([m.high, m.low], `${conf}: ${hi} hosts ${lo}`).toEqual([{ code: seeds[hi - 1], seed: hi }, { code: seeds[lo - 1], seed: lo }]);
        }
      }
    } else {
      // every later round is the reseeding of the winners of the one before it
      const want = expectedNextRound(p, ROUNDS[r - 1]!);
      const got = games.map((m) => ({ conference: m.conference, high: m.high, low: m.low }));
      const key = (x: { conference: string; high: Side | null; low: Side | null }) => `${x.conference}|${x.high?.code}#${x.high?.seed}|${x.low?.code}#${x.low?.seed}`;
      expect(got.map(key).sort(), `${ROUND_NAME[round]}: the winners, reseeded`).toEqual(want.map(key).sort());
    }

    if (r < played) {
      // a round that has been played: every game decided, once, by its score; the winners go on, the losers are out
      for (const m of games) {
        if (isBye(m)) {
          expect(m.winner, "a bye advances its team").toBe(m.high!.code);
          expect([m.homeScore, m.awayScore], "a bye is not a game").toEqual([null, null]);
          continue;
        }
        expect(Number.isInteger(m.homeScore) && Number.isInteger(m.awayScore), `${m.high?.code} v ${m.low?.code}: has a score`).toBe(true);
        expect(m.homeScore, "no ties in the playoffs").not.toBe(m.awayScore);
        expect(m.winner, `${m.high?.code} ${m.homeScore}, ${m.low?.code} ${m.awayScore}: the winner is the team with the higher score`).toBe(winnerByScore(m));
        losers.add(m.winner === m.high!.code ? m.low!.code : m.high!.code);
      }
    } else {
      // the round about to be played: nothing in it has happened (the byes are already through)
      for (const m of games) {
        if (isBye(m)) continue;
        expect([m.homeScore, m.awayScore, m.winner], `${ROUND_NAME[round]}: not played yet`).toEqual([null, null, null]);
      }
    }
  }

  if (played >= 4) {
    expect(p.champion, "the Super Bowl winner is the champion").toBe(inRound(p, "SB")[0]!.winner);
    expect(field.has(p.champion!)).toBe(true);
  } else {
    expect(p.champion, "no champion before the Super Bowl").toBeNull();
  }
}

/** The last round each playoff team played, and whether it won it all: what the season's record of it must say. */
export function expectedOutcome(p: Postseason, code: string): { furthestRound: Round; wonSuperBowl: boolean } {
  let furthest: Round = "WC";
  for (const m of p.matchups) if (m.high?.code === code || m.low?.code === code) if (ROUNDS.indexOf(m.round) > ROUNDS.indexOf(furthest)) furthest = m.round;
  return { furthestRound: furthest, wonSuperBowl: p.champion === code };
}

export interface ShownMatchup {
  seeds: number[];
  labels: string[];
  scores: Array<number | null>;
  /** Per team, whether the screen marks it as the winner of that game (the winner's score is drawn in the "good" colour). */
  winners: boolean[];
}

/**
 * Reads bracket boxes as drawn, one array of games per container. Self-contained: it runs in the page.
 * A game's winner is the team whose score is drawn in the colour the UI keeps for winners (`--good`), not the other's.
 */
function readColumns(cols: Element[]): ShownMatchup[][] {
  const probe = document.createElement("span");
  probe.style.color = "var(--good)";
  document.body.appendChild(probe);
  const good = getComputedStyle(probe).color;
  probe.remove();
  return cols.map((col) =>
    Array.from(col.children)
      .map((box) => {
        const rows = Array.from(box.querySelectorAll("span"))
          .filter((el) => el.children.length === 0 && /^\d+ OVR · \d+-\d+(?:-\d+)?$/.test((el.textContent ?? "").trim()))
          .map((record) => {
            const name = record.parentElement!;
            const cluster = name.parentElement!;
            const row = cluster.parentElement!;
            const scoreEl = row.querySelector(":scope > .oswald");
            return {
              seed: Number((cluster.querySelector(".oswald")?.textContent ?? "").replace("•", "0")),
              label: name.querySelector("span")?.textContent?.trim() ?? "",
              score: scoreEl == null ? null : Number(scoreEl.textContent),
              winner: scoreEl != null && getComputedStyle(scoreEl).color === good,
            };
          });
        return { seeds: rows.map((r) => r.seed), labels: rows.map((r) => r.label), scores: rows.map((r) => r.score), winners: rows.map((r) => r.winner) };
      })
      .filter((m) => m.labels.length > 0), // (a round not made yet is a "TBD" placeholder, not a game)
  );
}

/** One conference's bracket as drawn: for each round (Wild Card, Divisional, Conference Championship), each game's teams, scores and winner. */
export async function bracketOnScreen(page: Page, conf: "AFC" | "NFC"): Promise<ShownMatchup[][]> {
  await page.getByRole("tab", { name: conf, exact: true }).or(page.getByRole("button", { name: conf, exact: true })).first().click();
  const columns = page.locator(".panel.open .bracket-col");
  await expect(columns.first()).toBeVisible();
  return columns.evaluateAll(readColumns);
}

/** The Super Bowl tab, opened by name: the one game drawn there. */
export async function superBowlOnScreen(page: Page): Promise<ShownMatchup[]> {
  await page.getByRole("tab", { name: "Super Bowl", exact: true }).or(page.getByRole("button", { name: "Super Bowl", exact: true })).first().click();
  const panel = page.locator(".panel.open > div").first();
  await expect(panel, "the Super Bowl tab is open").toBeVisible();
  const [games] = await panel.evaluateAll(readColumns);
  return games!;
}

const homeWon = (m: Matchup) => m.homeScore !== null && m.awayScore !== null && m.homeScore > m.awayScore;
const awayWon = (m: Matchup) => m.homeScore !== null && m.awayScore !== null && m.awayScore > m.homeScore;

/** What the bracket screen must show for a conference, from the save: the same games, teams, seeds, scores and winners. */
export function expectedOnScreen(p: Postseason, conf: "AFC" | "NFC"): ShownMatchup[][] {
  return (["WC", "DIV", "CONF"] as const).map((round) =>
    inRound(p, round, conf).map((m) => {
      const sides = [m.high, m.low].filter((s): s is Side => s !== null);
      return {
        seeds: sides.map((s) => s.seed),
        labels: sides.map((s) => teamIdentity(s.code).label),
        scores: isBye(m) ? [null] : m.homeScore === null ? [null, null] : [m.homeScore, m.awayScore],
        winners: isBye(m) ? [false] : [homeWon(m), awayWon(m)],
      };
    }),
  );
}

/** The Super Bowl as the save has it: the AFC champion (home, seed shown as a dot) against the NFC champion, both scores, the winner marked. */
export function expectedSuperBowl(p: Postseason): ShownMatchup[] {
  return inRound(p, "SB").map((m) => ({
    seeds: [0, 0],
    labels: [teamIdentity(m.high!.code).label, teamIdentity(m.low!.code).label],
    scores: m.homeScore === null ? [null, null] : [m.homeScore, m.awayScore],
    winners: [homeWon(m), awayWon(m)],
  }));
}

/** One finished game as the Game Day screen lists it: the home team, the score, the away team, and which name is set in the winner's weight. */
export interface ShownResult {
  home: string;
  away: string;
  score: string;
  homeBold: boolean;
  awayBold: boolean;
}

/** The Game Day screen's "This round" list, row by row, in the order shown. */
export async function gameDayResults(page: Page): Promise<ShownResult[]> {
  const rows = page.getByText("This round", { exact: true }).locator("xpath=following-sibling::div[1]").locator(":scope > div");
  await expect(rows.first(), "the Game Day screen lists the round's games").toBeVisible();
  return rows.evaluateAll((rs) =>
    rs.map((row) => {
      const [homeSide, middle, awaySide] = Array.from(row.children);
      const side = (el: Element) => {
        const label = el.lastElementChild!; // [badge, label]; the away side only reads right to left
        return { name: (label.firstChild?.textContent ?? "").trim(), bold: Number(getComputedStyle(label).fontWeight) >= 600 };
      };
      return { home: side(homeSide!).name, away: side(awaySide!).name, score: (middle!.textContent ?? "").trim(), homeBold: side(homeSide!).bold, awayBold: side(awaySide!).bold };
    }),
  );
}

/**
 * The games of a round as Game Day must list them, from the save: the home (higher-seeded) team, its score first, the away team, and
 * the winner's name emphasised. The viewer's own game comes first, then the bracket's order (the screen's own rule).
 */
export function expectedGameDay(p: Postseason, round: Round): ShownResult[] {
  const mine = (m: Matchup) => m.high?.code === p.me || m.low?.code === p.me;
  return inRound(p, round)
    .filter((m) => m.high && m.low && m.homeScore !== null && m.awayScore !== null)
    .sort((a, b) => Number(mine(b)) - Number(mine(a)))
    .map((m) => ({ home: teamIdentity(m.high!.code).label, away: teamIdentity(m.low!.code).label, score: `${m.homeScore}–${m.awayScore}`, homeBold: m.winner === m.high!.code, awayBold: m.winner === m.low!.code }));
}
