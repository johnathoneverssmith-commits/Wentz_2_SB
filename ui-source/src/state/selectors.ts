import { TEAMS_BY_CODE } from "@/data/teams";
import type { GameResult, LeagueState, Player, ScheduledGame } from "@/domain";

export function viewerTeamCode(s: LeagueState): string | undefined {
  return s.gms.find((g) => g.id === s.viewerGmId)?.teamCode || undefined;
}

export function currentPhase(s: LeagueState): "PRE" | "REG" | null {
  if (s.stage === "preseason") return "PRE";
  if (s.stage === "regularSeason") return "REG";
  return null;
}

/** The game the given team is scheduled for this week (if any). */
export function weekGame(
  s: LeagueState,
  teamCode: string | undefined,
  week = s.week,
  phase = currentPhase(s),
): ScheduledGame | undefined {
  if (!teamCode || !phase) return undefined;
  return s.schedule.find(
    (g) => g.week === week && g.phase === phase && (g.homeTeam === teamCode || g.awayTeam === teamCode),
  );
}

export function opponentOf(g: ScheduledGame | undefined, teamCode: string | undefined): string | undefined {
  if (!g || !teamCode) return undefined;
  return g.homeTeam === teamCode ? g.awayTeam : g.homeTeam;
}

export function playedGames(s: LeagueState, phase?: "PRE" | "REG"): GameResult[] {
  return s.games.filter((g) => g.played && (!phase || g.phase === phase));
}

export function teamRoster(s: LeagueState, code: string): Player[] {
  return Object.values(s.players)
    .filter((p) => p.nfl_team === code && !p.retired)
    .sort((a, b) => b.overall - a.overall);
}

export function divisionRivals(code: string): string[] {
  const meta = TEAMS_BY_CODE[code]!;
  return Object.values(TEAMS_BY_CODE)
    .filter((t) => t.conference === meta.conference && t.division === meta.division)
    .map((t) => t.code);
}

export function injuredOn(s: LeagueState, code: string): Player[] {
  return Object.values(s.players).filter(
    (p) => p.nfl_team === code && p.injury_status && !p.retired,
  );
}

export function leagueInjuries(s: LeagueState): Player[] {
  return Object.values(s.players)
    .filter((p) => p.injury_status && !p.retired)
    .sort((a, b) => b.overall - a.overall)
    .slice(0, 12);
}

/** "[min–max] wks" / "week to week" / "season" from an injury status. */
export function recoveryText(p: Player): string {
  const st = p.injury_status;
  if (!st) return "—";
  if (!st.weeks_out_est) return "Week to week";
  const [lo, hi] = st.weeks_out_est;
  if (hi >= 17) return "Season";
  return lo === hi ? `${lo} wk` : `${lo}–${hi} wks`;
}

/** Head-to-head W-L between every pair of human-GM teams, this season, REG only. */
export function humanHeadToHead(
  s: LeagueState,
): Record<string, Record<string, { w: number; l: number }>> {
  const humanCodes = s.gms.filter((g) => g.isHuman && g.teamCode).map((g) => g.teamCode);
  const rec: Record<string, Record<string, { w: number; l: number }>> = {};
  for (const a of humanCodes) {
    rec[a] = {};
    for (const b of humanCodes) if (a !== b) rec[a]![b] = { w: 0, l: 0 };
  }
  for (const g of s.games) {
    if (g.phase !== "REG" || !g.played) continue;
    if (!humanCodes.includes(g.homeTeam) || !humanCodes.includes(g.awayTeam)) continue;
    const homeWon = g.homeScore > g.awayScore;
    const [w, l] = homeWon ? [g.homeTeam, g.awayTeam] : [g.awayTeam, g.homeTeam];
    rec[w]![l]!.w += 1;
    rec[l]![w]!.l += 1;
  }
  return rec;
}

/** Rough projected playoff odds 0–100 from current record + starting-lineup rating. */
export function playoffOdds(s: LeagueState, code: string): number {
  const t = s.teams[code];
  if (!t) return 0;
  const games = t.wins + t.losses + t.ties;
  const pct = games ? (t.wins + 0.5 * t.ties) / games : 0.5;
  const strength = (t.ratings.overall - 75) / 25; // roughly -1..+1
  const played = pct * (games / 17);
  const projected = (0.5 + strength * 0.35) * (1 - games / 17);
  return Math.round(Math.min(0.98, Math.max(0.02, played + projected + strength * 0.1)) * 100);
}

/**
 * Per-human-GM "things to watch" storylines — camp buzz in the preseason, season
 * arcs in the regular season. Shown on every GM's hub so the league stays social.
 */
export function watchNotes(
  s: LeagueState,
): Array<{ gmId: string; gmName: string; teamCode: string; player: string; note: string }> {
  const preseasonNotes = [
    "turning heads in camp — looks a step faster and could carve out a real role",
    "has been running with the ones and might have leapfrogged the starter",
    "struggled through camp; the coaching staff sounds worried about a decline",
    "is a genuine breakout candidate after a dominant week of joint practices",
    "looked rusty early but rounded into form; watch the snap count in Week 1",
  ];
  const seasonNotes = [
    "is quietly having a career year and could push for an All-Pro spot",
    "has cooled off badly over the last month — usage is trending down",
    "is one hot stretch from forcing a contract conversation this offseason",
    "keeps showing up in crunch time; the clutch reputation is earned",
    "is nursing a nagging issue that hasn't hit the report yet",
  ];
  const pool = s.stage === "preseason" ? preseasonNotes : seasonNotes;
  return s.gms
    .filter((g) => g.isHuman && g.teamCode)
    .map((g, gi) => {
      const roster = Object.values(s.players)
        .filter((p) => p.nfl_team === g.teamCode && !p.retired)
        .sort((a, b) => b.overall - a.overall);
      const idx = (s.season + gi * 7 + s.week * 3) % Math.max(1, Math.min(roster.length, 14));
      const player = roster[idx];
      const note = pool[(s.season * 3 + gi * 2 + s.week + gi) % pool.length]!;
      return {
        gmId: g.id,
        gmName: g.id === s.viewerGmId ? "You" : g.name,
        teamCode: g.teamCode,
        player: player ? `${player.name} (${player.position})` : "the roster",
        note,
      };
    });
}
