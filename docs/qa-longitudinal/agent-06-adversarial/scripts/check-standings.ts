// Recompute standings/seeding with the engine's own computeStandings and compare to what the franchise store recorded.
import { readFileSync } from "node:fs";
import { computeStandings } from "../../../../src/engine/standings.ts";
const doc = JSON.parse(readFileSync(process.argv[2]!, "utf8")); const s = doc.state ?? doc;
const M = (c: string) => (c === "LAR" ? "LA" : c); const R = (c: string) => (c === "LA" ? "LAR" : c);
const reg = s.games.filter((g: any) => g.phase === "REG" && g.played).map((g: any) => ({ home: M(g.homeTeam), away: M(g.awayTeam), homeScore: g.homeScore, awayScore: g.awayScore }));
const st = computeStandings(reg, Object.keys(s.teams).map(M)); const bad: string[] = [];
for (const c of ["AFC", "NFC"] as const) { const want = st.seeding[c].seeds.map(R), got = s.bracket?.seeds?.[c]; if (JSON.stringify(want) !== JSON.stringify(got)) bad.push(`SEEDS ${c}: engine ${want} vs stored ${got}`); }
for (const r of st.rows) { const t = s.teams[R(r.team)]; if (t.divisionRank !== r.divisionRank) bad.push(`DIVRANK ${r.team}: stored ${t.divisionRank} vs engine ${r.divisionRank}`); if (t.wins !== r.wins || t.losses !== r.losses || t.ties !== r.ties) bad.push(`REC ${r.team}`); }
const me = s.history.at(-1); if (me && me.season === s.season) { const row = st.rows.find((r) => R(r.team) === me.teamCode)!; const seed = row.seed ?? 0; if (me.seed !== seed) bad.push(`HISTORY seed ${me.teamCode}: stored ${me.seed} vs engine ${seed}`); }
console.log(JSON.stringify({ season: s.season, stage: s.stage, regGames: reg.length, mismatches: bad.length })); bad.slice(0, 20).forEach((b) => console.log("  " + b));
