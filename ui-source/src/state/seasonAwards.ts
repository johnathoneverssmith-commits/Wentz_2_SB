import type { LeagueState, Player, PlayerStatLine } from "@/domain";

/**
 * Season awards and career totals.
 *
 * A season's stats were wiped at the next kickoff and nothing remembered
 * them: no MVP was ever named (the "MVP tracker" read quarterback passing
 * alone and only while the season ran), and a ten-year veteran's page showed
 * this season and nothing else. At each season's end the league now names
 * its award winners from the stats that were actually played, and folds
 * every player's season into his career line.
 */

export type AwardKind = "MVP" | "OPOY" | "DPOY" | "OROY" | "DROY" | "COY";

export interface SeasonAward {
  season: number;
  award: AwardKind;
  playerId: string;
  name: string;
  position: string;
  team: string;
  /** a one-line stat summary, as shown in history */
  line: string;
}

export const AWARD_LABEL: Record<AwardKind, string> = {
  MVP: "Most Valuable Player",
  OPOY: "Offensive Player of the Year",
  DPOY: "Defensive Player of the Year",
  OROY: "Offensive Rookie of the Year",
  DROY: "Defensive Rookie of the Year",
  COY: "Coach of the Year",
};

const OFFENSE = new Set(["QB", "RB", "WR", "TE", "OT", "OG", "C"]);
const DEFENSE = new Set(["EDGE", "DT", "ILB", "OLB", "CB", "S"]);

const n = (v: number | undefined) => v ?? 0;

/** Fantasy-style production: what voters actually reward. */
function offenseScore(st: PlayerStatLine): number {
  return (
    n(st.passYds) / 25 + n(st.passTd) * 4 - n(st.passInt) * 2 +
    n(st.rushYds) / 10 + n(st.rushTd) * 6 +
    n(st.recYds) / 10 + n(st.recTd) * 6
  );
}
function defenseScore(st: PlayerStatLine): number {
  return n(st.sacks) * 5 + n(st.defInt) * 7 + n(st.tackles) * 0.45 + n(st.passDef) * 1.5 + n(st.ffum) * 4 + n(st.defTd) * 6;
}

// "5,231 pass yds", the way every other yardage in the game reads
const yds = (v: number) => v.toLocaleString("en-US");

function lineFor(p: Player, st: PlayerStatLine): string {
  if (p.position === "QB") return `${yds(n(st.passYds))} pass yds, ${n(st.passTd)} TD, ${n(st.passInt)} INT`;
  if (OFFENSE.has(p.position)) {
    const rush = n(st.rushYds);
    const rec = n(st.recYds);
    return rush >= rec ? `${yds(rush)} rush yds, ${n(st.rushTd)} TD` : `${n(st.rec)} rec, ${yds(rec)} yds, ${n(st.recTd)} TD`;
  }
  return `${n(st.tackles)} tkl, ${n(st.sacks)} ${n(st.sacks) === 1 ? "sack" : "sacks"}, ${n(st.defInt)} INT`;
}

export function awardSeason(s: LeagueState): SeasonAward[] {
  if ((s.awards ?? []).some((a) => a.season === s.season)) return [];
  const candidates = Object.values(s.players).filter(
    (p) => !p.retired && p.season_stats && p.season_stats.gamesPlayed >= 8 && s.teams[p.nfl_team],
  );
  const wins = (p: Player) => s.teams[p.nfl_team]?.wins ?? 0;
  // no banked season yet: `years_pro` alone never advanced before careers did
  const rookie = (p: Player) => (p.years_pro ?? 0) === 0 && !p.career;
  const best = (pool: Player[], score: (p: Player) => number): Player | undefined =>
    pool.reduce<Player | undefined>((a, b) => (!a || score(b) > score(a) ? b : a), undefined);

  const off = candidates.filter((p) => OFFENSE.has(p.position));
  const def = candidates.filter((p) => DEFENSE.has(p.position));
  const offS = (p: Player) => offenseScore(p.season_stats!);
  const defS = (p: Player) => defenseScore(p.season_stats!);
  // the MVP is the best offensive season on a winning team — and, as voters
  // actually vote, a quarterback's season counts for more: unweighted, a
  // 1,800-yard back out-polled a 4,800-yard, 37-touchdown passer
  const mvp = best(off, (p) => offS(p) * (p.position === "QB" ? 1.3 : 1) + wins(p) * 12);
  const picks: [AwardKind, Player | undefined][] = [
    ["MVP", mvp],
    ["OPOY", best(off.filter((p) => p !== mvp), offS)],
    ["DPOY", best(def, defS)],
    ["OROY", best(off.filter(rookie), offS)],
    ["DROY", best(def.filter(rookie), defS)],
  ];
  const out: SeasonAward[] = [];
  for (const [award, p] of picks) {
    if (!p) continue;
    out.push({
      season: s.season,
      award,
      playerId: p.id,
      name: p.name,
      position: p.position,
      team: p.nfl_team,
      line: lineFor(p, p.season_stats!),
    });
  }
  s.awards = [...(s.awards ?? []), ...out];
  return out;
}

/**
 * Fold every player's season into his career line (non-zero fields only, to
 * keep saves small), and credit him the accrued season: `years_pro` was set
 * when a player was created and never moved, so a ten-year veteran drafted
 * in-game still read as a rookie.
 */
export function accrueCareers(s: LeagueState): void {
  // an accrued season for everyone on a roster — linemen have no stat line
  // to hang it on (`finalizeSeason` runs once a season, so this does too)
  if (s.accruedSeason !== s.season) {
    s.accruedSeason = s.season;
    for (const p of Object.values(s.players)) {
      if (!p.retired && !p.free_agent && s.teams[p.nfl_team]) p.years_pro = (p.years_pro ?? 0) + 1;
    }
  }
  for (const p of Object.values(s.players)) {
    const st = p.season_stats;
    if (!st || st.gamesPlayed === 0) continue;
    const c = (p.career ??= { seasons: 0, gamesPlayed: 0 });
    if (c.lastSeason === s.season) continue;
    c.lastSeason = s.season;
    c.seasons += 1;
    c.peak = Math.max(c.peak ?? 0, p.overall);
    for (const [k, v] of Object.entries(st)) {
      if (typeof v !== "number" || v === 0) continue;
      const key = k as keyof PlayerStatLine;
      (c as unknown as Record<string, number>)[key] = ((c as unknown as Record<string, number>)[key] ?? 0) + v;
    }
  }
}

// ---- the MVP race, as the award will score it ---------------------------------

/**
 * The in-season MVP board, scored exactly the way the award is decided at
 * season's end — the Player Statistics "front-runner" used a separate,
 * passing-only heuristic, so the favourite all year could lose the award.
 */
export function mvpRace(s: LeagueState): { player: Player; score: number }[] {
  return Object.values(s.players)
    .filter((p) => !p.retired && p.season_stats && p.season_stats.gamesPlayed > 0 && OFFENSE.has(p.position))
    .map((p) => ({
      player: p,
      score: offenseScore(p.season_stats!) * (p.position === "QB" ? 1.3 : 1) + (s.teams[p.nfl_team]?.wins ?? 0) * 12,
    }))
    .sort((a, b) => b.score - a.score);
}

// ---- champions, records, All-Pro, Hall of Fame --------------------------------

export interface ChampionRow {
  season: number;
  champion: string;
  runnerUp: string | null;
}

export type RecordStat = "passYds" | "passTd" | "rushYds" | "rushTd" | "rec" | "recYds" | "recTd" | "sacks" | "defInt" | "tackles";

export interface RecordRow {
  stat: RecordStat;
  value: number;
  playerId: string;
  name: string;
  team: string;
  season: number;
}

export const RECORD_LABEL: Record<RecordStat, string> = {
  passYds: "Passing yards",
  passTd: "Passing touchdowns",
  rushYds: "Rushing yards",
  rushTd: "Rushing touchdowns",
  rec: "Receptions",
  recYds: "Receiving yards",
  recTd: "Receiving touchdowns",
  sacks: "Sacks",
  defInt: "Interceptions",
  tackles: "Tackles",
};

export interface AllProRow {
  season: number;
  playerId: string;
  name: string;
  position: string;
  team: string;
}

/** One team's season, kept for franchise histories. */
export interface TeamSeasonRow {
  season: number;
  team: string;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  pointsAgainst: number;
  finish: "champion" | "runner-up" | "playoffs" | "missed";
  headCoach: string | null;
}

export interface HallOfFamer {
  playerId: string;
  name: string;
  position: string;
  inducted: number;
  seasons: number;
  why: string;
}

/** The slots an All-Pro first team fills, by position. */
const ALL_PRO: [string, number][] = [
  ["QB", 1], ["RB", 1], ["WR", 3], ["TE", 1], ["OT", 2], ["OG", 2], ["C", 1],
  ["EDGE", 2], ["DT", 2], ["ILB", 2], ["CB", 2], ["S", 2], ["K", 1], ["P", 1],
];

/**
 * The league's memory of a season: its champion, any single-season records
 * that fell, and the All-Pro first team (the best-rated player at each spot
 * who played most of the year). Runs once, at season's end.
 */
export function recordSeason(s: LeagueState): void {
  const bracket = s.bracket;
  if (bracket?.champion && !(s.champions ?? []).some((c) => c.season === s.season)) {
    const sb = bracket.matchups?.find((m) => m.round === "SB");
    const runnerUp = sb ? ([sb.highSeed?.code, sb.lowSeed?.code].find((c) => c && c !== bracket.champion) ?? null) : null;
    s.champions = [...(s.champions ?? []), { season: s.season, champion: bracket.champion, runnerUp }];
  }

  const records = [...(s.records ?? [])];
  for (const stat of Object.keys(RECORD_LABEL) as RecordStat[]) {
    let best: Player | undefined;
    for (const p of Object.values(s.players)) {
      const v = p.season_stats?.[stat] ?? 0;
      if (v > 0 && (!best || v > (best.season_stats?.[stat] ?? 0))) best = p;
    }
    if (!best) continue;
    const value = best.season_stats![stat] ?? 0;
    const i = records.findIndex((r) => r.stat === stat);
    if (i < 0 || value > records[i]!.value) {
      const row: RecordRow = { stat, value, playerId: best.id, name: best.name, team: best.nfl_team, season: s.season };
      if (i < 0) records.push(row);
      else records[i] = row;
    }
  }
  s.records = records;

  // every team's season, for franchise histories and Coach of the Year
  if (!(s.teamSeasons ?? []).some((r) => r.season === s.season)) {
    const inPlayoffs = new Set(
      s.games.filter((g) => g.phase !== "REG" && g.phase !== "PRE").flatMap((g) => [g.homeTeam, g.awayTeam]),
    );
    const champ = s.champions?.find((c) => c.season === s.season);
    const rows: TeamSeasonRow[] = Object.keys(s.teams).map((code) => {
      const t = s.teams[code]!;
      const hc = Object.values(s.coaches).find((c) => c.team === code && c.role === "HC");
      return {
        season: s.season,
        team: code,
        wins: t.wins,
        losses: t.losses,
        ties: t.ties,
        pointsFor: t.pointsFor,
        pointsAgainst: t.pointsAgainst,
        finish:
          champ?.champion === code ? "champion" : champ?.runnerUp === code ? "runner-up" : inPlayoffs.has(code) ? "playoffs" : "missed",
        headCoach: hc?.name ?? null,
      };
    });
    const prior = new Map((s.teamSeasons ?? []).filter((r) => r.season === s.season - 1).map((r) => [r.team, r]));
    s.teamSeasons = [...(s.teamSeasons ?? []), ...rows];

    // Coach of the Year: the biggest turnaround among winning teams (a
    // first season has no "before", so it goes to the best record)
    if (!(s.awards ?? []).some((a) => a.season === s.season && a.award === "COY")) {
      const score = (r: TeamSeasonRow) => {
        const before = prior.get(r.team);
        return before ? r.wins - before.wins + r.wins * 0.25 : r.wins;
      };
      const best = rows.filter((r) => r.wins > r.losses && r.headCoach).sort((a, b) => score(b) - score(a))[0];
      const coach = best && Object.values(s.coaches).find((c) => c.team === best.team && c.role === "HC");
      if (best && coach) {
        const before = prior.get(best.team);
        s.awards = [
          ...(s.awards ?? []),
          {
            season: s.season,
            award: "COY",
            playerId: coach.id,
            name: coach.name,
            position: "HC",
            team: best.team,
            line: before ? `${before.wins}-${before.losses} to ${best.wins}-${best.losses}` : `${best.wins}-${best.losses}`,
          },
        ];
      }
    }
  }

  if (!(s.allPro ?? []).some((a) => a.season === s.season)) {
    const team: AllProRow[] = [];
    for (const [pos, n] of ALL_PRO) {
      Object.values(s.players)
        .filter((p) => !p.retired && p.position === pos && s.teams[p.nfl_team] && (p.season_stats?.gamesPlayed ?? 0) >= 10)
        .sort((a, b) => b.overall - a.overall)
        .slice(0, n)
        .forEach((p) => team.push({ season: s.season, playerId: p.id, name: p.name, position: pos, team: p.nfl_team }));
    }
    // ten seasons of teams is plenty of memory
    s.allPro = [...(s.allPro ?? []).filter((a) => a.season > s.season - 10), ...team];
  }
}

/**
 * Inducts the greats as they retire: a real career (five seasons or more in
 * this league) crowned by an MVP or Player of the Year, three All-Pro nods,
 * or a peak among the best the game has seen. Kept apart from the player
 * record, because retirees are forgotten a season after they leave.
 */
export function inductHallOfFame(s: LeagueState, retiringIds: readonly string[]): HallOfFamer[] {
  const out: HallOfFamer[] = [];
  const honours = (id: string) =>
    (s.awards ?? []).filter((a) => a.playerId === id && (a.award === "MVP" || a.award === "OPOY" || a.award === "DPOY"));
  const allPros = (id: string) => (s.allPro ?? []).filter((a) => a.playerId === id).length;
  for (const id of retiringIds) {
    const p = s.players[id];
    if (!p || (s.hallOfFame ?? []).some((h) => h.playerId === id)) continue;
    const seasons = p.career?.seasons ?? 0;
    if (seasons < 7) continue;
    const h = honours(id);
    const ap = allPros(id);
    const peak = p.career?.peak ?? p.overall;
    const specialist = p.position === "K" || p.position === "P";
    // A first pass inducted six a year — All-Pro nods by rating pile up and
    // kickers rate high by nature. An honour now needs a real body of work:
    // a top award with two All-Pro years, five All-Pro years, or (never for a
    // specialist) an all-time peak over a long career.
    const why =
      h.length > 0 && ap >= 2
        ? h.map((a) => `${a.season} ${a.award}`).join(", ")
        : ap >= (specialist ? 7 : 5)
          ? `${ap}x All-Pro`
          : !specialist && peak >= 96 && seasons >= 9
            ? `peaked at ${peak} overall`
            : null;
    if (!why) continue;
    out.push({ playerId: id, name: p.name, position: p.position, inducted: s.season, seasons, why });
  }
  if (out.length) s.hallOfFame = [...(s.hallOfFame ?? []), ...out];
  return out;
}

/**
 * The competition committee: keeps a league scoring like the NFL.
 *
 * The engine is calibrated to league-average NFL scoring on real rosters, but
 * a league drifts from there as it turns over — generated players' skill
 * profiles, recycled coaching staffs and the balance of young and old each
 * move it a little, and a decade took scoring from 22.6 points a team-game to
 * 20.5. The real league answers drift with rule changes; this answers it the
 * same way. Each season's end measures the league's own scoring and moves a
 * small offense correction toward the NFL's 22.6, at most 0.08 a season and
 * 0.5 in all. It moves the level of every game alike — never who wins.
 */
export const NFL_POINTS_PER_TEAM_GAME = 22.56;
export function scoringCommittee(s: LeagueState): void {
  const reg = s.games.filter((g) => g.phase === "REG" && g.played);
  if (reg.length < 50) return;
  const ppg = reg.reduce((n, g) => n + g.homeScore + g.awayScore, 0) / (reg.length * 2);
  // ~0.1 completion log-odds is ~1 point a team-game (analysis/37)
  const step = Math.max(-0.08, Math.min(0.08, (NFL_POINTS_PER_TEAM_GAME - ppg) * 0.1));
  s.offenseAdjust = Math.max(-0.5, Math.min(0.5, (s.offenseAdjust ?? 0) + step));
}
