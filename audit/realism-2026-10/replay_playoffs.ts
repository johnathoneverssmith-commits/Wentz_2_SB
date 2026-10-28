/** Re-plays each stored season's playoffs on the franchise path (withPlayoffRosters). usage: po_run.ts <talent> <in.json...> -> writes <in>.po.json */
import { readFileSync, writeFileSync } from "node:fs";
import { NFL_TEAMS } from "../../src/engine/nfl-structure.js";
import { simulatePlayoffs, withPlayoffRosters } from "../../src/engine/playoffs.js";
import { roster } from "../../src/engine/roster.js";
import { allStaffs } from "../../src/engine/staff-data.js";
import { computeStandings } from "../../src/engine/standings.js";

const talent = Number(process.argv[2]);
for (const f of process.argv.slice(3)) {
  const d = JSON.parse(readFileSync(f, "utf8"));
  const rosters = Object.fromEntries(NFL_TEAMS.map((t) => [t, roster(t)]));
  const staffs = allStaffs();
  for (const s of d.seasons) {
    const st = computeStandings(s.games.map((g: any) => ({ home: g.h, away: g.a, homeScore: g.hs, awayScore: g.as })), NFL_TEAMS as string[]);
    // five replays of each bracket (different seed offsets) to widen the playoff sample
    s.po = [];
    for (let k = 0; k < 5; k++) {
      const r = withPlayoffRosters(rosters, () => simulatePlayoffs(s.seed + k * 7919, st.seeding), talent, staffs, 0, null, null);
      s.po.push({ games: r.games, champion: r.champion });
    }
  }
  writeFileSync(f.replace(".json", ".po.json"), JSON.stringify(d));
}
