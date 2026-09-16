import { ROUND_ORDER } from "@/domain";
import type { BracketState, LeagueState } from "@/domain";

/**
 * Who has seen what.
 *
 * From the preseason onward the league stops playing games when a GM presses
 * a button — the whole block is simulated up front, at the checkpoint, and
 * the buttons afterwards only *reveal* what is already saved. That is the
 * only way the same league can be watched by four people at four different
 * speeds without any of them changing what happens.
 *
 * So reveal state is per GM and permanent. One GM racing ahead to week nine
 * does not move anybody else's screen, and a GM who closes the tab comes back
 * to exactly the week they were on rather than to somebody else's progress.
 *
 * The rule that makes it safe: nothing a GM has not revealed may appear
 * anywhere. Standings, statistics, injuries and the schedule all have to be
 * built from that GM's revealed weeks rather than from the league's saved
 * truth, or a leaderboard quietly spoils a game they have not watched.
 */

export interface RevealState {
  /** Highest preseason week this GM has revealed, 0 = none. */
  preseasonWeek: Record<string, number>;
  /** Highest regular-season week revealed. */
  regularWeek: Record<string, number>;
  /** Playoff rounds revealed, in order. */
  playoffRounds: Record<string, string[]>;
}

export function emptyReveal(): RevealState {
  return { preseasonWeek: {}, regularWeek: {}, playoffRounds: {} };
}

export function revealOf(s: LeagueState): RevealState {
  return s.reveal ?? emptyReveal();
}

/** How far this GM has watched, for the phase they are in. */
export function revealedWeek(s: LeagueState, gmId: string, phase: "PRE" | "REG"): number {
  const r = revealOf(s);
  return (phase === "PRE" ? r.preseasonWeek[gmId] : r.regularWeek[gmId]) ?? 0;
}

/** Move one GM's marker forward. Never backward — a reveal cannot be undone. */
export function markRevealed(
  s: LeagueState,
  gmId: string,
  phase: "PRE" | "REG",
  week: number,
): void {
  s.reveal ??= emptyReveal();
  const map = phase === "PRE" ? s.reveal.preseasonWeek : s.reveal.regularWeek;
  map[gmId] = Math.max(map[gmId] ?? 0, week);
}

export function revealedRounds(s: LeagueState, gmId: string): string[] {
  return revealOf(s).playoffRounds[gmId] ?? [];
}

export function markRoundRevealed(s: LeagueState, gmId: string, round: string): void {
  s.reveal ??= emptyReveal();
  const list = (s.reveal.playoffRounds[gmId] ??= []);
  if (!list.includes(round)) list.push(round);
}

/**
 * The games this GM is allowed to see.
 *
 * Everything downstream — standings, stats, the schedule, injuries — should
 * be derived from this rather than from `state.games`, which holds the whole
 * precomputed block including weeks nobody has watched yet.
 */
export function visibleGames(s: LeagueState, gmId: string) {
  const pre = revealedWeek(s, gmId, "PRE");
  const reg = revealedWeek(s, gmId, "REG");
  return s.games.filter((g) => {
    if (!g.played) return false;
    if (g.phase === "PRE") return g.week <= pre;
    if (g.phase === "REG") return g.week <= reg;
    // playoff games carry their round in the phase field
    return revealedRounds(s, gmId).includes(g.phase);
  });
}

/** Whether this GM still has something left to reveal in the block. */
export function hasMoreToReveal(
  s: LeagueState,
  gmId: string,
  phase: "PRE" | "REG",
  lastWeek: number,
): boolean {
  return revealedWeek(s, gmId, phase) < lastWeek;
}

/**
 * The bracket as this GM is allowed to see it.
 *
 * The saved bracket holds the whole postseason the moment the checkpoint
 * closes — every winner, every score, the champion. Rendering that directly
 * would put the Super Bowl result on screen before the GM has watched the
 * wild card, which is the one thing the reveal architecture exists to
 * prevent. So rounds the GM has not revealed are stripped back to the shape
 * of a fixture: who is in it, and nothing about how it went.
 *
 * `currentRound` is moved back to the first unrevealed round for the same
 * reason — it is what the header reads, and a header saying "Super Bowl" to
 * somebody still on the divisional round gives away that their team is out.
 */
export function visibleBracket(
  bracket: BracketState,
  s: LeagueState,
  gmId: string,
): BracketState {
  const seen = revealedRounds(s, gmId);
  const firstUnseen = ROUND_ORDER.find((r) => !seen.includes(r));
  return {
    ...bracket,
    currentRound: firstUnseen ?? bracket.currentRound,
    champion: seen.includes("SB") ? bracket.champion : null,
    matchups: bracket.matchups.map((m) =>
      seen.includes(m.round)
        ? m
        : { ...m, winner: null, homeScore: null, awayScore: null },
    ),
  };
}
