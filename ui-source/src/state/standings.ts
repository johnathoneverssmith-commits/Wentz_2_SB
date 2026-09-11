import { TEAMS_BY_CODE } from "@/data/teams";
import type { GameResult, LeagueState, TeamState } from "@/domain";

/** Recompute every team's W/L/T + points + ranks from played REG games. */
export function recomputeStandings(state: LeagueState): void {
  for (const code of Object.keys(state.teams)) {
    const t = state.teams[code]!;
    t.wins = t.losses = t.ties = t.pointsFor = t.pointsAgainst = 0;
  }
  for (const g of state.games) {
    if (g.phase !== "REG" || !g.played) continue;
    apply(state.teams[g.homeTeam], g, "home");
    apply(state.teams[g.awayTeam], g, "away");
  }

  const codes = Object.keys(state.teams);
  const pct = (t: TeamState) => {
    const games = t.wins + t.losses + t.ties;
    return games ? (t.wins + 0.5 * t.ties) / games : 0;
  };
  const diff = (t: TeamState) => t.pointsFor - t.pointsAgainst;
  const cmp = (a: string, b: string) =>
    pct(state.teams[b]!) - pct(state.teams[a]!) ||
    diff(state.teams[b]!) - diff(state.teams[a]!) ||
    state.teams[b]!.pointsFor - state.teams[a]!.pointsFor ||
    a.localeCompare(b);

  const league = [...codes].sort(cmp);
  league.forEach((c, i) => (state.teams[c]!.leagueRank = i + 1));

  for (const conf of ["AFC", "NFC"] as const) {
    const inConf = codes.filter((c) => TEAMS_BY_CODE[c]!.conference === conf).sort(cmp);
    inConf.forEach((c, i) => (state.teams[c]!.conferenceRank = i + 1));
  }
  const divKey = (c: string) => `${TEAMS_BY_CODE[c]!.conference}-${TEAMS_BY_CODE[c]!.division}`;
  const divs = new Set(codes.map(divKey));
  for (const d of divs) {
    const inDiv = codes.filter((c) => divKey(c) === d).sort(cmp);
    inDiv.forEach((c, i) => (state.teams[c]!.divisionRank = i + 1));
  }
}

function apply(t: TeamState | undefined, g: GameResult, side: "home" | "away"): void {
  if (!t) return;
  const forPts = side === "home" ? g.homeScore : g.awayScore;
  const againstPts = side === "home" ? g.awayScore : g.homeScore;
  t.pointsFor += forPts;
  t.pointsAgainst += againstPts;
  if (forPts > againstPts) t.wins += 1;
  else if (forPts < againstPts) t.losses += 1;
  else t.ties += 1;
}

/** Accumulate per-player season stat lines from a batch of game results. */
export function accrueSeasonStats(state: LeagueState, results: GameResult[]): void {
  for (const g of results) {
    for (const side of ["home", "away"] as const) {
      for (const line of g.playerLines?.[side] ?? []) {
        const p = state.players[line.playerId];
        if (!p) continue;
        const s = (p.season_stats ??= { gamesPlayed: 0 });
        s.gamesPlayed += 1;
        s.passYds = (s.passYds ?? 0) + (line.passYds ?? 0);
        s.passTd = (s.passTd ?? 0) + (line.passTd ?? 0);
        s.passInt = (s.passInt ?? 0) + (line.passInt ?? 0);
        s.passAtt = (s.passAtt ?? 0) + (line.passAtt ?? 0);
        s.passCmp = (s.passCmp ?? 0) + (line.passCmp ?? 0);
        s.rushYds = (s.rushYds ?? 0) + (line.rushYds ?? 0);
        s.rushTd = (s.rushTd ?? 0) + (line.rushTd ?? 0);
        s.rushAtt = (s.rushAtt ?? 0) + (line.rushAtt ?? 0);
        s.rec = (s.rec ?? 0) + (line.rec ?? 0);
        s.recYds = (s.recYds ?? 0) + (line.recYds ?? 0);
        s.recTd = (s.recTd ?? 0) + (line.recTd ?? 0);
        s.tackles = (s.tackles ?? 0) + (line.tackles ?? 0);
        s.sacks = (s.sacks ?? 0) + (line.sacks ?? 0);
        s.defInt = (s.defInt ?? 0) + (line.defInt ?? 0);
        s.passDef = (s.passDef ?? 0) + (line.passDef ?? 0);
        s.fgm = (s.fgm ?? 0) + (line.fgm ?? 0);
        s.fga = (s.fga ?? 0) + (line.fga ?? 0);
        s.xpm = (s.xpm ?? 0) + (line.xpm ?? 0);
        s.xpa = (s.xpa ?? 0) + (line.xpa ?? 0);
      }
    }
  }
}

/** Wipe every player's accumulating season stats (regular-season week 1). */
export function resetSeasonStats(state: LeagueState): void {
  for (const p of Object.values(state.players)) p.season_stats = { gamesPlayed: 0 };
}
