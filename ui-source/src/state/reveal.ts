import { bracketRounds } from "@/domain";
import type { BracketState, GameResult, LeagueState } from "@/domain";
import { currentBlock } from "./revealBlocks";

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
  /**
   * How far each GM has walked through a stage that is really several
   * screens.
   *
   * Change 12 puts two screens inside one league stage — retirement review
   * and draft preview — and lets a GM cross between them without the league
   * moving. The league has exactly one `stage`, and it should: the league
   * really is all in the offseason together. What differs is which of that
   * stage's screens each GM is looking at, and that is a fact about the GM,
   * so it lives here with the rest of them.
   */
  step: Record<string, string>;
}

export function emptyReveal(): RevealState {
  return { preseasonWeek: {}, regularWeek: {}, playoffRounds: {}, step: {} };
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

/** Which screen of a multi-screen stage this GM has reached. */
export function stepOf(s: LeagueState, gmId: string): string | null {
  return revealOf(s).step?.[gmId] ?? null;
}

/** Move one GM forward within a stage. Never backward — like every reveal. */
export function markStep(s: LeagueState, gmId: string, step: string): void {
  s.reveal ??= emptyReveal();
  s.reveal.step ??= {};
  s.reveal.step[gmId] = step;
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

/**
 * `state.games` as this GM is allowed to see it, shape-preserved.
 *
 * Unlike `visibleGames`, this keeps every entry — including games nobody has
 * watched yet — because the schedule and the standings still need to show
 * that a game exists and who it's between. What it strips is the *outcome*:
 * a game this GM hasn't revealed comes back looking exactly like an unplayed
 * one, the same way `visibleBracket` nulls out an unrevealed matchup's score
 * rather than removing it from the bracket.
 *
 * This is what a league's full state has to be passed through before it
 * reaches a client. The block is simulated once, at the checkpoint, for
 * every game at once — so an unfiltered `state.games` already holds next
 * week's scores and the whole rest of the postseason the moment the
 * checkpoint runs, whether or not anyone has watched that far yet.
 */
export function redactedGames(s: LeagueState, gmId: string): GameResult[] {
  const seen = new Set(visibleGames(s, gmId).map((g) => g.id));
  return s.games.map((g) =>
    seen.has(g.id)
      ? g
      : {
          id: g.id,
          week: g.week,
          phase: g.phase,
          homeTeam: g.homeTeam,
          awayTeam: g.awayTeam,
          played: false,
          homeScore: 0,
          awayScore: 0,
        },
  );
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
  const rounds = bracketRounds(bracket);
  const firstUnseen = rounds.find((r) => !seen.includes(r));
  const unseenAt = firstUnseen ? rounds.indexOf(firstUnseen) : rounds.length;
  // Who is in a round past the first unwatched one *is* a result: listing
  // the divisional matchups before the wild card is watched told a GM who
  // won every wild-card game. Only a bye is known without a result, so the
  // round after the first unwatched one keeps its bye teams and everything
  // later is TBD.
  const byeTeams = new Set(
    bracket.matchups
      .filter((m) => m.round === firstUnseen && !m.lowSeed && m.highSeed)
      .map((m) => m.highSeed!.code),
  );
  const known = (side: BracketState["matchups"][number]["highSeed"], at: number) =>
    side && at === unseenAt + 1 && byeTeams.has(side.code) ? side : null;
  // a round is played once one real game in it is decided (a bye is decided from the start)
  const roundsPlayed = rounds.filter((r) =>
    bracket.matchups.some((m) => m.round === r && m.winner != null && m.highSeed && m.lowSeed),
  ).length;
  return {
    ...bracket,
    roundsPlayed,
    currentRound: firstUnseen ?? bracket.currentRound,
    champion: seen.includes("SB") ? bracket.champion : null,
    matchups: bracket.matchups.map((m) => {
      if (seen.includes(m.round)) return m;
      const at = rounds.indexOf(m.round);
      const hidden = { ...m, winner: null, homeScore: null, awayScore: null };
      if (at <= unseenAt) return hidden;
      return { ...hidden, highSeed: known(m.highSeed, at), lowSeed: known(m.lowSeed, at) };
    }),
  };
}

/**
 * The week this GM is on: the first game of the current block they haven't
 * watched, or the block's last week once it's all watched. Null outside the
 * preseason and regular season, which have no week to speak of.
 *
 * Reveals do not move `state.week`, so reading it directly showed every GM
 * the league's week rather than their own — and "Wk 3" on League
 * Developments, left over from the preseason.
 */
export function viewerWeek(s: LeagueState): number | null {
  const block = currentBlock(s);
  if (!block) return null;
  const watched = revealedWeek(s, s.viewerGmId, block.phase);
  return Math.min(Math.max(s.week, watched + 1), block.lastWeek);
}
