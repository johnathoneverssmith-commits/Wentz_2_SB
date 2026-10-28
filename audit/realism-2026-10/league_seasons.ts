/**
 * Plays seasons on a rosters file: either a dumped drafted league ({teams:{code:Player[]}}) or, with
 * "fixed", the 32 reference rosters. usage: league_seasons.ts <league.json|fixed> <nSeasons> <talent> <gameSeedBase> <out.json>
 * Same options as server/simGame.ts (trace, injuries, weather, staff, NFL overtime).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { extractBoxScore } from "../../src/engine/boxscore.js";
import { NFL_TEAMS } from "../../src/engine/nfl-structure.js";
import { Roster, roster } from "../../src/engine/roster.js";
import { nflSchedule } from "../../src/engine/schedule.js";
import { simulateGame } from "../../src/engine/sim.js";
import { teamStaff } from "../../src/engine/staff-data.js";
import { weatherFor } from "../../src/engine/weather.js";

const [file, nSeasons, talent, base, out] = [process.argv[2]!, Number(process.argv[3]), Number(process.argv[4]), Number(process.argv[5]), process.argv[6]!];
const rosters: Record<string, Roster> = {};
const ovrOf: Record<string, Record<string, number>> = {};
if (file === "fixed") for (const t of NFL_TEAMS) rosters[t] = roster(t);
else {
  const d = JSON.parse(readFileSync(file, "utf8"));
  for (const t of NFL_TEAMS) rosters[t] = new Roster(t, d.teams[t]);
}
for (const t of NFL_TEAMS) { const o: Record<string, number> = {}; for (const ps of rosters[t]!.depth.values()) for (const p of ps) o[p.name] = p.overall ?? 0; ovrOf[t] = o; }
// QB_KAPPA=k: what-if, shrink every starting QB'"'"'s attributes and overall toward the league's starting-QB mean by k (1 = off).
// Prototype of "compress the QB term" without touching engine code; ovrOf keeps the original rating for bucketing.
const KAPPA = process.env.QB_KAPPA ? Number(process.env.QB_KAPPA) : 1;
if (KAPPA !== 1) {
  const qbs = NFL_TEAMS.map((t) => rosters[t]!.depth.get("QB")![0]!);
  const mean = (f: (p: any) => number) => qbs.reduce((n, p) => n + f(p), 0) / qbs.length;
  const refAttr: Record<string, number> = {};
  for (const k of Object.keys(qbs[0]!.attributes ?? {})) refAttr[k] = mean((p) => (p.attributes?.[k] as number) ?? 0);
  const refOvr = mean((p) => p.overall ?? 0);
  for (const t of NFL_TEAMS) {
    const r = rosters[t]!; const players = [...r.depth.values()].flat(); const q0 = r.depth.get("QB")![0]!;
    const attrs: Record<string, any> = {};
    for (const [k, v] of Object.entries(q0.attributes ?? {})) attrs[k] = typeof v === "number" && k in refAttr ? Math.round(refAttr[k]! + KAPPA * (v - refAttr[k]!)) : v;
    const q1 = { ...q0, overall: Math.round(refOvr + KAPPA * ((q0.overall ?? 0) - refOvr)), attributes: attrs };
    rosters[t] = new Roster(t, players.map((p) => (p === q0 ? (q1 as any) : p)));
  }
}
const sch = nflSchedule({ year: 2026 });
const seasons: any[] = [];
for (let s = 0; s < nSeasons; s++) {
  const seed = base + s * 10000;
  const games: any[] = [];
  const qb: Record<string, any> = {};
  sch.forEach((sc, i) => {
    const gs = seed + i;
    const g = simulateGame(gs, sc.home, sc.away, {
      homeRoster: rosters[sc.home]!, awayRoster: rosters[sc.away]!, trace: true, injuries: true, talentScale: talent, overtime: "nfl",
      weather: weatherFor(sc.home, "REG", sc.week, gs), homeStaff: teamStaff(sc.home)!, awayStaff: teamStaff(sc.away)!,
    });
    const box = extractBoxScore(g, sc.home, sc.away, sc.week);
    games.push({ h: sc.home, a: sc.away, hs: g.score[0], as: g.score[1], pa: [box.home.passAtt, box.away.passAtt], to: [box.home.turnovers, box.away.turnovers] });
    const teams = [sc.home, sc.away];
    for (const p of g.playTrace ?? []) {
      if (p.call !== "pass" || !p.passer) continue;
      const t = teams[p.team]!;
      const k = `${t}|${p.passer}`;
      const l = (qb[k] ??= { team: t, name: p.passer, ovr: ovrOf[t]![p.passer] ?? 0, att: 0, cmp: 0, yds: 0, td: 0, int: 0 });
      l.att++;
      if (p.outcome === "complete") { l.cmp++; l.yds += Math.round(p.gained); if (p.touchdown) l.td++; } else if (p.outcome === "interception") l.int++;
    }
  });
  seasons.push({ seed, games, qb: Object.values(qb).filter((l: any) => l.att >= 100) });
}
writeFileSync(out, JSON.stringify({ file, talent, seasons }));
