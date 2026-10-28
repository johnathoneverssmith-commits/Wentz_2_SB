/** Do the player lines add up to the team box score? 600 franchise-config games; prints the mismatch rate per stat. */
import { simulateOne } from "../../server/simGame.js";
import { nflSchedule } from "../../src/engine/schedule.js";
import { teamStaff } from "../../src/engine/staff-data.js";
import { loadPool } from "../../src/engine/roster.js";

const sch = nflSchedule({ year: 2026 });
const pool = loadPool();
const mism: Record<string, { games: number; diffSum: number; maxAbs: number }> = {};
const note = (k: string, d: number) => {
  const m = (mism[k] ??= { games: 0, diffSum: 0, maxAbs: 0 });
  if (d !== 0) { m.games++; m.diffSum += d; m.maxAbs = Math.max(m.maxAbs, Math.abs(d)); }
};
const N = 600;
for (let i = 0; i < N; i++) {
  const sc = sch[(i * 5) % sch.length]!;
  const o: any = simulateOne({ gameSeed: 9000 + i, week: sc.week, phase: "REG", homeTeam: sc.home, awayTeam: sc.away, isViewer: false, talentScale: 1, homeStaff: teamStaff(sc.home), awayStaff: teamStaff(sc.away),
    homePlayers: pool.get(sc.home) as any, awayPlayers: pool.get(sc.away) as any } as any);
  for (const [side, lines, def] of [["home", o.playerLines.home, o.playerLines.away], ["away", o.playerLines.away, o.playerLines.home]] as const) {
    const t = o.totals[side];
    const sum = (ls: any[], k: string) => ls.reduce((n, l) => n + (l[k] ?? 0), 0);
    note("passYds(player - team)", sum(lines, "passYds") - t.passYards);
    note("passAtt(player - team)", sum(lines, "passAtt") - t.passAtt);
    note("passCmp(player - team)", sum(lines, "passCmp") - t.passComp);
    note("rushYds(player - team)", sum(lines, "rushYds") - t.rushYards);
    note("rushAtt(player - team) [team rush_att; box has no field -> plays - passAtt - sacks]", sum(lines, "rushAtt") - (t.plays - t.passAtt - t.sacksAllowed));
    note("recYds(player - team passYds)", sum(lines, "recYds") - t.passYards);
    note("rec(player - team completions)", sum(lines, "rec") - t.passComp);
    note("sacks credited (defense) - sacks allowed (offense)", sum(def, "sacks") - t.sacksAllowed);
    note("passInt(player - team int)", sum(lines, "passInt") - (t.intThrown ?? 0));
    note("defInt (opp) - int thrown", sum(def, "defInt") - (t.intThrown ?? 0));
  }
}
console.log(`${N} games (home+away sides = ${2 * N} team-games)`);
for (const [k, v] of Object.entries(mism)) console.log(`${k.padEnd(52)} mismatching team-games ${String(v.games).padStart(4)}  mean diff when off ${(v.diffSum / Math.max(1, v.games)).toFixed(1).padStart(7)}  max |diff| ${v.maxAbs}`);
