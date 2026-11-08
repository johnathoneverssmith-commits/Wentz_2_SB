/** Agent 3: coaching staff effect. Focal team's staff varies (rating r on chosen roles, others 50); opponent = league-average staff.
 * Paired seeds vs focal staff = league average. usage: staff_swap.ts <roles:HC,OC,DC> <rating> <reps> <talent> */
import { NFL_TEAMS } from "../../../../src/engine/nfl-structure.js";
import { roster } from "../../../../src/engine/roster.js";
import { simulateGame } from "../../../../src/engine/sim.js";
import { leagueAverageStaff, type Staff } from "../../../../src/engine/staff.js";
import { weatherFor } from "../../../../src/engine/weather.js";
const [ROLES, RATING, REPS, TALENT] = [process.argv[2]!.split(","), Number(process.argv[3]), Number(process.argv[4]), Number(process.argv[5] ?? 1)];
const mk = (): Staff => { const s = leagueAverageStaff(); if (ROLES.includes("HC")) { s.headCoach.gameManagement = RATING; s.headCoach.discipline = RATING; }
  if (ROLES.includes("OC")) s.oc.rating = RATING; if (ROLES.includes("DC")) s.dc.rating = RATING; return s; };
const teams = [...NFL_TEAMS]; const d: number[] = [], w: number[] = [];
for (let rep = 0; rep < REPS; rep++) teams.forEach((t, ti) => {
  const o = teams[(ti + 1 + ((rep * 11 + ti * 5) % 31)) % 32]!; const home = (rep + ti) % 2 === 0; const seed = 7_100_000 + rep * 1009 + ti;
  const run = (st: Staff) => { const h = home ? t : o, a = home ? o : t;
    const g = simulateGame(seed, h, a, { homeRoster: roster(h), awayRoster: roster(a), overtime: "nfl", injuries: true, talentScale: TALENT,
      weather: weatherFor(h, "REG", 1 + (rep % 17), seed), homeStaff: home ? st : leagueAverageStaff(), awayStaff: home ? leagueAverageStaff() : st });
    return home ? g.score[0]! - g.score[1]! : g.score[1]! - g.score[0]!; };
  const m0 = run(leagueAverageStaff()), m1 = run(mk()); d.push(m1 - m0); w.push(Math.sign(m1) - Math.sign(m0));
});
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1)); };
console.log(JSON.stringify({ roles: ROLES.join("+"), rating: RATING, talent: TALENT, n: d.length, dMargin: +mean(d).toFixed(3), seMargin: +(sd(d) / Math.sqrt(d.length)).toFixed(3), dWinPct: +(50 * mean(w)).toFixed(2), seWinPct: +(50 * sd(w) / Math.sqrt(d.length)).toFixed(2) }));
