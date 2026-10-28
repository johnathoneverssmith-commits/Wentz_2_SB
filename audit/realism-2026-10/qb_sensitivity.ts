/**
 * Isolated QB-rating sensitivity. One baseline team, its QB replaced by copies shifted by `delta` attribute points
 * (overall moves with it); everything else fixed.
 *   A) pre-limit logit contribution of each layer (rating / team-strength / synergy) per channel, vs the reference QB
 *   B) simulated passing line + margin vs all 31 opponents, home and away, at talent 1 and 1.5, synergy on/off
 * usage: qb_sensitivity.ts <TEAM> <repeats>
 */
import { NFL_TEAMS } from "../../src/engine/nfl-structure.js";
import { Roster, roster } from "../../src/engine/roster.js";
import { completionLogitShift, interceptionLogitShift, sackLogitShift } from "../../src/engine/ratings.js";
import { simulateGame, softCap } from "../../src/engine/sim.js";
import { strengthIndex, strengthShift } from "../../src/engine/team-strength.js";
import { setSynergyScale, synergyShift } from "../../src/engine/synergy.js";
import { teamStaff } from "../../src/engine/staff-data.js";
import { weatherFor } from "../../src/engine/weather.js";
import type { Player } from "../../src/schema/player.js";

const TEAM = process.argv[2] ?? "LV";
const REP = Number(process.argv[3] ?? 2);
const base = roster(TEAM);
const qb0 = base.depth.get("QB")![0]!;
const mk = (delta: number): Roster => {
  const attrs: Record<string, number> = {};
  for (const [k, v] of Object.entries(qb0.attributes ?? {})) attrs[k] = typeof v === "number" ? Math.max(1, Math.min(99, v + delta)) : (v as any);
  const q = { ...qb0, id: `${qb0.id}~${delta}`, overall: Math.max(1, Math.min(99, (qb0.overall ?? 0) + delta)), attributes: attrs } as Player;
  const players: Player[] = [q];
  for (const [pos, ps] of base.depth) for (const p of ps) if (pos !== "QB") players.push(p); // backups removed so a weak synthetic QB stays the starter
  return new Roster(TEAM, players);
};
const DELTAS = [-26, -18, -10, -4, 0, 4, 10, 16];
const opp = NFL_TEAMS.filter((t) => t !== TEAM);
console.log(`baseline ${TEAM}: QB ${qb0.name} overall ${qb0.overall}; team mean-ish rating index offense ${strengthIndex(base).offense.toFixed(1)}`);

// ---- A) layer decomposition vs the median opposing defense (mean over all 31 opponents)
console.log("\nA) pre-limit logit shift by layer, relative to the reference QB (mean over 31 opponent defenses)");
console.log("overall  complete: rating  strength  synergy  | total  limited(x1) | INT: rating strength synergy | total | sack: rating(strength+syn)");
const ref: Record<string, number> = {};
for (const d of DELTAS) {
  const r = mk(d);
  const acc: Record<string, number> = {};
  for (const t of opp) {
    const o = r.offense(); const dd = roster(t).defense(false);
    const add = (k: string, v: number) => (acc[k] = (acc[k] ?? 0) + v / opp.length);
    add("cR", completionLogitShift([], [], o.QB1 ?? null));
    add("cS", strengthShift(strengthIndex(r), strengthIndex(roster(t)), "complete"));
    add("cY", synergyShift(o, dd, "complete"));
    add("iR", interceptionLogitShift(o.QB1 ?? null));
    add("iS", strengthShift(strengthIndex(r), strengthIndex(roster(t)), "interception"));
    add("iY", synergyShift(o, dd, "interception"));
    add("sS", strengthShift(strengthIndex(r), strengthIndex(roster(t)), "sack"));
    add("sY", synergyShift(o, dd, "sack"));
  }
  if (d === 0) Object.assign(ref, acc);
  (acc as any).ovr = r.depth.get("QB")![0]!.overall;
  (mk as any)[`a${d}`] = acc;
}
for (const d of DELTAS) {
  const a = (mk as any)[`a${d}`];
  const rel = (k: string) => a[k] - ref[k]!;
  const cT = rel("cR") + rel("cS") + rel("cY"), iT = rel("iR") + rel("iS") + rel("iY");
  // limited value at the actual (absolute) level for the baseline team, to show the cap bite
  const absC = a.cR + a.cS + a.cY, absI = a.iR + a.iS + a.iY;
  console.log(`${String(a.ovr).padStart(5)}   ${rel("cR").toFixed(3).padStart(8)} ${rel("cS").toFixed(3).padStart(9)} ${rel("cY").toFixed(3).padStart(8)} | ${cT.toFixed(3).padStart(6)} abs ${absC.toFixed(2)}->${softCap(absC, 0.35, 0.55).toFixed(2)} | ${rel("iR").toFixed(3).padStart(7)} ${rel("iS").toFixed(3).padStart(7)} ${rel("iY").toFixed(3).padStart(7)} | ${iT.toFixed(3).padStart(6)} abs ${absI.toFixed(2)}->${softCap(absI, 0.35, 0.55).toFixed(2)} | sack strength ${rel("sS").toFixed(3)} syn ${rel("sY").toFixed(3)}`);
}

// ---- B) simulated
console.log("\nB) simulated: passing line of the baseline team");
console.log("talent syn  QBovr  cmp%   Y/A   TD%  INT%  INT/17g sack%  margin  win%");
for (const [talent, syn] of [[1, 1], [1, 0], [1.5, 1], [1.5, 0]] as const) {
  setSynergyScale(syn);
  for (const d of DELTAS) {
    const r = mk(d);
    const t = { att: 0, cmp: 0, yds: 0, td: 0, int: 0, sack: 0, m: 0, w: 0, n: 0, gm: 0 };
    let k = 0;
    for (let rep = 0; rep < REP; rep++) for (const o of opp) for (const home of [true, false]) {
      const seed = 700000 + rep * 997 + k++;
      const h = home ? TEAM : o, a = home ? o : TEAM;
      const g = simulateGame(seed, h, a, { homeRoster: home ? r : roster(o), awayRoster: home ? roster(o) : r, injuries: true, talentScale: talent, overtime: "nfl", weather: weatherFor(h, "REG", 1 + (k % 17), seed), homeStaff: teamStaff(h)!, awayStaff: teamStaff(a)! });
      const me = home ? 0 : 1; const s = g.teams[me]!.s as Record<string, number>;
      t.att += s.pass_att ?? 0; t.cmp += s.completion ?? 0; t.yds += s.pass_yards ?? 0; t.td += (s.pass_td ?? 0); t.int += s.int_thrown ?? 0; t.sack += s.sack ?? 0;
      t.m += g.score[me] - g.score[1 - me]; t.w += g.score[me] > g.score[1 - me] ? 1 : 0; t.gm++;
    }
    console.log(`${String(talent).padEnd(6)} ${syn}    ${String(r.depth.get("QB")![0]!.overall).padStart(4)}  ${(100 * t.cmp / t.att).toFixed(1)}  ${(t.yds / t.att).toFixed(2)}  ${(100 * t.td / t.att).toFixed(1).padStart(4)} ${(100 * t.int / t.att).toFixed(2)}  ${(17 * t.int / t.gm).toFixed(1).padStart(6)}  ${(100 * t.sack / (t.att + t.sack)).toFixed(1)}  ${(t.m / t.gm).toFixed(1).padStart(6)}  ${(100 * t.w / t.gm).toFixed(0)}`);
  }
}
setSynergyScale(1);
