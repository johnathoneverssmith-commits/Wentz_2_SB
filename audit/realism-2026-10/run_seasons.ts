/**
 * Audit harness (scratch, uncommitted). Plays full franchise-style seasons the way
 * server/simGame.ts does (trace + injuries + weather + staff + nfl overtime), then the
 * playoffs, and dumps raw rows to JSON for audit_report.ts.
 *   NFL_POOL_PATH=ui-source/src/data/pool-2026.json npx tsx audit_run.ts <seedStart> <nSeasons> <talent> <out.json>
 */
import { writeFileSync } from "node:fs";
import { extractBoxScore } from "../../src/engine/boxscore.js";
import { NFL_TEAMS } from "../../src/engine/nfl-structure.js";
import { simulatePlayoffs } from "../../src/engine/playoffs.js";
import { loadPool } from "../../src/engine/roster.js";
import { nflSchedule } from "../../src/engine/schedule.js";
import { simulateGame } from "../../src/engine/sim.js";
import { teamStaff } from "../../src/engine/staff-data.js";
import { computeStandings } from "../../src/engine/standings.js";
import { weatherFor } from "../../src/engine/weather.js";

const [seed0, nSeasons, talent, out] = [Number(process.argv[2]), Number(process.argv[3]), Number(process.argv[4]), process.argv[5]!];
const pool = loadPool();
const posOf = new Map<string, Map<string, { pos: string; ovr: number }>>();
for (const [t, ps] of pool) posOf.set(t, new Map(ps.map((p) => [p.name, { pos: p.position, ovr: p.overall }])));

const schedule = nflSchedule({ year: 2026 });
const seasons: any[] = [];
for (let s = 0; s < nSeasons; s++) {
  const seed = seed0 + s * 10000;
  const games: any[] = [];
  const players = new Map<string, any>();
  const line = (team: string, name: string) => {
    const k = `${team}|${name}`;
    let l = players.get(k);
    if (!l) {
      const meta = posOf.get(team)?.get(name);
      l = { team, name, pos: meta?.pos ?? "?", ovr: meta?.ovr ?? 0, g: 0 };
      players.set(k, l);
    }
    return l;
  };
  const bump = (l: any, k: string, n = 1) => (l[k] = (l[k] ?? 0) + n);
  const injuries: any[] = [];
  schedule.forEach((sc, i) => {
    const gs = seed + i;
    const g = simulateGame(gs, sc.home, sc.away, {
      trace: true,
      injuries: true,
      talentScale: talent,
      overtime: "nfl",
      weather: weatherFor(sc.home, "REG", sc.week, gs),
      ...(process.env.NOSTAFF ? {} : { homeStaff: teamStaff(sc.home)!, awayStaff: teamStaff(sc.away)! }),
    });
    const box = extractBoxScore(g, sc.home, sc.away, sc.week);
    const teams = [sc.home, sc.away];
    const maxLead = { h: 0, a: 0 };
    const tr = g.playTrace ?? [];
    const per = new Map<string, any>();
    const seen = new Set<string>();
    for (const p of tr) {
      maxLead.h = Math.max(maxLead.h, p.scoreBefore[0] - p.scoreBefore[1]);
      maxLead.a = Math.max(maxLead.a, p.scoreBefore[1] - p.scoreBefore[0]);
      const off = teams[p.team]!, def = teams[1 - p.team]!;
      const y = Math.round(p.gained);
      const add = (name: string | undefined, k: string, n: number) => {
        if (!name) return;
        const key = `${off}|${name}`;
        const o = per.get(key) ?? {};
        o[k] = (o[k] ?? 0) + n;
        per.set(key, o);
      };
      if (p.passer) seen.add(`${off}|${p.passer}`);
      if (p.targetOrRusher) seen.add(`${off}|${p.targetOrRusher}`);
      if (p.call === "pass") {
        if (p.passer) {
          const l = line(off, p.passer);
          bump(l, "att");
          add(p.passer, "att", 1);
          if (p.outcome === "complete") { bump(l, "cmp"); bump(l, "pyd", y); add(p.passer, "pyd", y); if (p.touchdown) { bump(l, "ptd"); add(p.passer, "ptd", 1); } }
          else if (p.outcome === "interception") { bump(l, "int"); add(p.passer, "int", 1); }
        }
        if (p.targetOrRusher) {
          const l = line(off, p.targetOrRusher);
          bump(l, "tgt");
          if (p.outcome === "complete") { bump(l, "rec"); bump(l, "ryd", y); add(p.targetOrRusher, "ryd", y); add(p.targetOrRusher, "rec", 1); if (p.touchdown) bump(l, "rtd"); }
        }
        if (p.defender) {
          const l = line(def, p.defender);
          if (p.outcome === "interception") bump(l, "dint"); else if (p.outcome === "incomplete") bump(l, "pd");
        }
      } else if (p.call === "run" || p.call === "scramble") {
        if (p.targetOrRusher) {
          const l = line(off, p.targetOrRusher);
          bump(l, p.call === "run" ? "car" : "scr"); bump(l, "cyd", y); if (p.touchdown) bump(l, "ctd");
          if (p.call === "run") { add(p.targetOrRusher, "cyd", y); add(p.targetOrRusher, "car", 1); }
        }
      } else if (p.call === "sack") {
        if (p.defender) bump(line(def, p.defender), "sack");
        if (p.passer) bump(line(off, p.passer), "sacked");
      } else if (p.call === "field_goal" && p.kicker) {
        const l = line(off, p.kicker);
        bump(l, "fga"); if (p.outcome === "made") bump(l, "fgm");
        if (p.distance && p.distance >= 50) { bump(l, "fga50"); if (p.outcome === "made") bump(l, "fgm50"); }
      }
      if (p.tackler) bump(line(def, p.tackler), "tkl");
    }
    const ext: any = { pyd: 0, ryd: 0, cyd: 0, rec: 0, car: 0, ptd: 0, int: 0 };
    for (const o of per.values()) for (const k of Object.keys(ext)) ext[k] = Math.max(ext[k], o[k] ?? 0);
    const sideStats = (b: any) => ({
      pts: b.points, pa: b.passAtt, cmp: b.completions, py: b.passYards, ra: b.rushAtt, ry: b.rushYards, sk: b.sacksAllowed,
      to: b.turnovers, int: b.interceptionsThrown, fl: b.fumblesLost, pen: b.penalties, fd: b.firstDowns, td: b.touchdowns,
      fg: b.fieldGoals[0], fga: b.fieldGoals[1], t3: b.thirdDown, drv: b.drives, top: b.possessionSeconds, qbh: b.qbHits,
      xp: b.explosivePlays, rz: b.redZone, krtd: b.kickReturnTds, prtd: b.puntReturnTds,
    });
    for (const e of g.injuryLog ?? []) injuries.push({ team: e.team, pos: e.position, slot: e.slot, sev: e.severity, wk: e.projectedWeeks, q: e.quarter });
    games.push({
      w: sc.week, h: sc.home, a: sc.away, hs: g.score[0], as: g.score[1], ot: g.qtr > 4 ? 1 : 0,
      H: sideStats(box.home), A: sideStats(box.away), plays: tr.length, lead: maxLead, ext, ninj: (g.injuryLog ?? []).length,
    });
    for (const k of seen) { const l = players.get(k); if (l) l.g++; }
  });
  const standings = computeStandings(
    games.map((g) => ({ home: g.h, away: g.a, homeScore: g.hs, awayScore: g.as })),
    NFL_TEAMS as string[],
  );
  const po = simulatePlayoffs(seed, standings.seeding);
  seasons.push({ seed, games, players: [...players.values()], injuries, playoffs: po.games, champion: po.champion });
  process.stderr.write(`season ${s + 1}/${nSeasons} done\n`);
}
writeFileSync(out, JSON.stringify({ talent, seasons }));
