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

export type AwardKind = "MVP" | "OPOY" | "DPOY" | "OROY" | "DROY";

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

function lineFor(p: Player, st: PlayerStatLine): string {
  if (p.position === "QB") return `${n(st.passYds)} pass yds, ${n(st.passTd)} TD, ${n(st.passInt)} INT`;
  if (OFFENSE.has(p.position)) {
    const rush = n(st.rushYds);
    const rec = n(st.recYds);
    return rush >= rec ? `${rush} rush yds, ${n(st.rushTd)} TD` : `${n(st.rec)} rec, ${rec} yds, ${n(st.recTd)} TD`;
  }
  return `${n(st.tackles)} tkl, ${n(st.sacks)} sacks, ${n(st.defInt)} INT`;
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
  // the MVP is the best offensive season on a winning team
  const mvp = best(off, (p) => offS(p) + wins(p) * 12);
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
    for (const [k, v] of Object.entries(st)) {
      if (typeof v !== "number" || v === 0) continue;
      const key = k as keyof PlayerStatLine;
      (c as unknown as Record<string, number>)[key] = ((c as unknown as Record<string, number>)[key] ?? 0) + v;
    }
  }
}
