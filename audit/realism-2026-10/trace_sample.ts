import { writeFileSync } from "node:fs";
import { simulateGame } from "../../src/engine/sim.js";
import { nflSchedule } from "../../src/engine/schedule.js";
import { teamStaff } from "../../src/engine/staff-data.js";
import { weatherFor } from "../../src/engine/weather.js";
const talent = Number(process.argv[2]); const out = process.argv[4]!; const nGames = Number(process.argv[3]);
const sch = nflSchedule({ year: 2026 });
const rows: any[] = [];
for (let i = 0; i < nGames; i++) {
  const sc = sch[(i * 7) % sch.length]!;
  const gs = 424242 + i;
  const g = simulateGame(gs, sc.home, sc.away, { trace: true, injuries: true, talentScale: talent, overtime: "nfl", weather: weatherFor(sc.home, "REG", sc.week, gs), homeStaff: teamStaff(sc.home)!, awayStaff: teamStaff(sc.away)! });
  for (const p of g.playTrace ?? []) {
    const diff = p.team === 0 ? p.scoreBefore[0] - p.scoreBefore[1] : p.scoreBefore[1] - p.scoreBefore[0];
    rows.push([i, p.team, p.quarter, p.clock, p.down, p.ydstogo, p.ballOn, p.call, p.outcome, Math.round(p.gained), diff, p.distance ?? null, p.touchdown ? 1 : 0, p.turnover ? 1 : 0]);
  }
}
writeFileSync(out, JSON.stringify(rows));
