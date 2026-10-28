import { simulateGame } from "../../src/engine/sim.js";
import { roster } from "../../src/engine/roster.js";
import { teamStaff } from "../../src/engine/staff-data.js";
import { weatherFor } from "../../src/engine/weather.js";
import { simulateOne } from "../../server/simGame.js";
const pairs = [["KC","BUF"],["PHI","DAL"],["NO","TEN"],["SF","SEA"],["DET","GB"]];
let diff = 0, n = 0, traceDiff = 0, svDiff = 0;
for (let s = 1; s <= 200; s++) for (const [h,a] of pairs) {
  const mk = (trace: boolean) => simulateGame(s*13, h!, a!, { trace, injuries: true, talentScale: 1.5, overtime: "nfl", weather: weatherFor(h!, "REG", 4, s*13), homeStaff: teamStaff(h!)!, awayStaff: teamStaff(a!)! });
  const g1 = mk(true), g2 = mk(true), g3 = mk(false);
  n++;
  if (JSON.stringify([g1.score, g1.teams[0].s, g1.teams[1].s]) !== JSON.stringify([g2.score, g2.teams[0].s, g2.teams[1].s])) diff++;
  if (g1.score.join() !== g3.score.join()) traceDiff++;
  // server adapter path (no players supplied => file-backed rosters) vs direct
  if (s <= 20) { const o = simulateOne({ gameSeed: s*13, week: 4, phase: "REG", homeTeam: h!, awayTeam: a!, isViewer: false, talentScale: 1.5, homeStaff: teamStaff(h!), awayStaff: teamStaff(a!) } as any);
    if (o.homeScore !== g1.score[0] || o.awayScore !== g1.score[1]) svDiff++; }
}
console.log({ n, repeatDiff: diff, traceOnVsOffDiff: traceDiff, serverAdapterVsDirectDiff: svDiff });
