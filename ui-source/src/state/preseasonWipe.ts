import type { LeagueState } from "@/domain";

import { emptyReveal } from "./reveal";
import { recomputeStandings } from "./standings";

/**
 * Throw the preseason away.
 *
 * Preseason results exist to be watched and then to stop mattering. The
 * alternative — leaving three weeks of exhibition games in `state.games` —
 * costs something real on every axis this design cares about: the league
 * document carries 48 dead games forever, every schedule and statistics
 * screen has to remember to filter them out (and one that forgets shows a
 * quarterback with 2,900 yards in week one), and a GM's preseason record sits
 * next to their real one looking like it counts.
 *
 * So it is deleted rather than hidden. Standings and season statistics never
 * counted preseason games in the first place, but they are recomputed anyway:
 * this runs once per season, and a wipe that half-worked would be much more
 * expensive to find than the recompute is to do.
 *
 * Reveal state is reset with it. That is the relock the spec asks for — with
 * no preseason weeks revealed and no regular-season weeks revealed either,
 * Latest Box Score and Watch Play-by-Play go back to being locked until each
 * GM watches their first real game.
 */
export function wipePreseason(state: LeagueState): void {
  const before = state.games.length;
  state.games = state.games.filter((g) => g.phase !== "PRE");
  if (state.games.length === before && !state.reveal) return;

  // every GM starts the regular season having watched nothing
  state.reveal = emptyReveal();

  // preseason games never fed these, but prove it rather than assume it
  for (const p of Object.values(state.players)) {
    if (p.season_stats) p.season_stats = { gamesPlayed: 0 };
  }
  recomputeStandings(state);
}
