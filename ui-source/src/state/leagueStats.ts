import { TEAMS } from "@/data/teams";
import type { LeagueState } from "@/domain";

export interface TeamStatRow {
  code: string;
  games: number;
  offTotal: number;
  offPass: number;
  offRush: number;
  defTotal: number;
  defPass: number;
  defRush: number;
  ppg: number;
  paPg: number;
  diff: number;
  fgPct: number;
  puntRet: number;
  kickRet: number;
  netPunt: number;
}

/** Per-game team offense/defense/special aggregates from played REG games. */
export function teamStatRows(s: LeagueState): TeamStatRow[] {
  const acc = new Map<string, { g: number; pf: number; pa: number; oy: number; opy: number; ory: number; dy: number; dpy: number; dry: number; fgm: number; fga: number }>();
  for (const t of TEAMS) acc.set(t.code, { g: 0, pf: 0, pa: 0, oy: 0, opy: 0, ory: 0, dy: 0, dpy: 0, dry: 0, fgm: 0, fga: 0 });

  for (const game of s.games) {
    if (game.phase !== "REG" || !game.played || !game.totals) continue;
    const h = acc.get(game.homeTeam)!;
    const a = acc.get(game.awayTeam)!;
    const { home, away } = game.totals;
    h.g++; a.g++;
    h.pf += home.points; h.pa += away.points;
    a.pf += away.points; a.pa += home.points;
    h.oy += home.totalYards; h.opy += home.passYards; h.ory += home.rushYards;
    a.oy += away.totalYards; a.opy += away.passYards; a.ory += away.rushYards;
    h.dy += away.totalYards; h.dpy += away.passYards; h.dry += away.rushYards;
    a.dy += home.totalYards; a.dpy += home.passYards; a.dry += home.rushYards;
  }
  // kicking from player lines
  for (const p of Object.values(s.players)) {
    if (p.position !== "K" || !p.season_stats) continue;
    const e = acc.get(p.nfl_team);
    if (!e) continue;
    e.fgm += p.season_stats.fgm ?? 0;
    e.fga += p.season_stats.fga ?? 0;
  }

  return TEAMS.map((t) => {
    const e = acc.get(t.code)!;
    const g = Math.max(1, e.g);
    return {
      code: t.code,
      games: e.g,
      offTotal: e.oy / g,
      offPass: e.opy / g,
      offRush: e.ory / g,
      defTotal: e.dy / g,
      defPass: e.dpy / g,
      defRush: e.dry / g,
      ppg: e.pf / g,
      paPg: e.pa / g,
      diff: (e.pf - e.pa) / g,
      fgPct: e.fga ? (e.fgm / e.fga) * 100 : 0,
      // no per-return data in the mock box score → stable pseudo values by code
      puntRet: 6 + hash(t.code, 1) * 8,
      kickRet: 19 + hash(t.code, 2) * 7,
      netPunt: 38 + hash(t.code, 3) * 8,
    };
  });
}

function hash(code: string, salt: number): number {
  let h = salt * 2654435761;
  for (let i = 0; i < code.length; i++) h = (h ^ code.charCodeAt(i)) * 16777619;
  return ((h >>> 0) % 1000) / 1000;
}

export interface LeaderRow {
  playerId: string;
  name: string;
  position: string;
  team: string;
  value: number;
  line: string;
}

export function leaders(
  s: LeagueState,
  cat: "passing" | "rushing" | "receiving" | "defense" | "kicking" | "returns",
): LeaderRow[] {
  const rows: LeaderRow[] = [];
  for (const p of Object.values(s.players)) {
    const st = p.season_stats;
    if (!st || st.gamesPlayed === 0) continue;
    if (cat === "passing" && (st.passYds ?? 0) > 0) {
      rows.push({ playerId: p.id, name: p.name, position: p.position, team: p.nfl_team, value: st.passYds!, line: `${st.passCmp ?? 0}/${st.passAtt ?? 0}, ${st.passTd ?? 0} TD, ${st.passInt ?? 0} INT` });
    } else if (cat === "rushing" && (st.rushYds ?? 0) > 0) {
      rows.push({ playerId: p.id, name: p.name, position: p.position, team: p.nfl_team, value: st.rushYds!, line: `${st.rushAtt ?? 0} att, ${st.rushTd ?? 0} TD` });
    } else if (cat === "receiving" && (st.recYds ?? 0) > 0) {
      rows.push({ playerId: p.id, name: p.name, position: p.position, team: p.nfl_team, value: st.recYds!, line: `${st.rec ?? 0} rec, ${st.recTd ?? 0} TD` });
    } else if (cat === "defense" && ((st.tackles ?? 0) > 0 || (st.sacks ?? 0) > 0)) {
      rows.push({ playerId: p.id, name: p.name, position: p.position, team: p.nfl_team, value: (st.sacks ?? 0) * 10 + (st.tackles ?? 0), line: `${st.tackles ?? 0} tkl, ${st.sacks ?? 0} sk, ${st.defInt ?? 0} INT` });
    } else if (cat === "kicking" && (st.fga ?? 0) > 0) {
      rows.push({ playerId: p.id, name: p.name, position: p.position, team: p.nfl_team, value: st.fgm ?? 0, line: `${st.fgm ?? 0}/${st.fga ?? 0} FG, ${st.xpm ?? 0}/${st.xpa ?? 0} XP` });
    } else if (cat === "returns" && (st.krYds ?? 0) + (st.prYds ?? 0) > 0) {
      rows.push({ playerId: p.id, name: p.name, position: p.position, team: p.nfl_team, value: (st.krYds ?? 0) + (st.prYds ?? 0), line: `${(st.krAtt ?? 0) + (st.prAtt ?? 0)} ret` });
    }
  }
  return rows.sort((a, b) => b.value - a.value).slice(0, 20);
}

/** Simple MVP heuristic: QB passing production + a bump for team wins. */
export function mvpTracker(s: LeagueState): LeaderRow[] {
  const wins = new Map(Object.values(s.teams).map((t) => [t.code, t.wins]));
  return Object.values(s.players)
    .filter((p) => p.season_stats && p.season_stats.gamesPlayed > 0)
    .map((p) => {
      const st = p.season_stats!;
      const score =
        (st.passYds ?? 0) * 0.04 +
        (st.passTd ?? 0) * 4 -
        (st.passInt ?? 0) * 2 +
        (st.rushYds ?? 0) * 0.05 +
        (st.rushTd ?? 0) * 5 +
        (st.recYds ?? 0) * 0.05 +
        (st.recTd ?? 0) * 5 +
        (wins.get(p.nfl_team) ?? 0) * 3;
      return {
        playerId: p.id,
        name: p.name,
        position: p.position,
        team: p.nfl_team,
        value: Math.round(score),
        line: `${p.position} · ${p.nfl_team}`,
      };
    })
    .sort((a, b) => b.value - a.value)
    .slice(0, 5);
}
