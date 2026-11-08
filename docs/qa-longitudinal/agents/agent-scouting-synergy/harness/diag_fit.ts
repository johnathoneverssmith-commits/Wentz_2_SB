import { build, setTags, teams, synergy, rosterMod } from "./lib.ts";
import { bump, sum, RUN_Q, OL_Q, RB_E, OL_M, RUN_QN, OL_QN } from "./edits.ts";
const mix = sum;
const acc: Record<string, number[]> = {};
for (const t of teams) {
  const opp = rosterMod.roster(teams[(teams.indexOf(t) + 5) % 32]!);
  for (const [name, rb, ol, c] of [["base", {}, {}, null], ["style", RB_E, OL_M, "zone"], ["styleAnti", RB_E, OL_M, "power"], ["eliteN+style", mix(RUN_QN, RB_E), mix(OL_QN, OL_M), "zone"], ["eliteN+styleAnti", mix(RUN_QN, RB_E), mix(OL_QN, OL_M), "power"], ["eliteN", RUN_QN, OL_QN, null]] as any) {
    const r = build(t, `${name}${t}`, (p, pos, rank) => { if (pos === "RB" && rank === 0) bump(p, rb); if (["OT", "OG", "C"].includes(pos) && rank < (pos === "C" ? 1 : 2)) bump(p, ol); if (pos === "QB" && rank === 0) setTags(p, c ? [c] : []); });
    const o = r.offense(), d = opp.defense();
    const s = synergy.unitScores(o, d);
    (acc[name + "|runFit"] ??= []).push(s.runFit); const dbg = synergy.protoDebug(o); for (const k of ["qRun", "Q", "sRb", "sOl"]) (acc[name + "|" + k] ??= []).push((dbg as any)[k]); (acc[name + "|shift"] ??= []).push(synergy.synergyShift(o, d, "rushYards"));
  }
}
const m = (x: number[]) => (x.reduce((a, b) => a + b, 0) / x.length).toFixed(3);
for (const [k, v] of Object.entries(acc)) console.log(k.padEnd(24), m(v));
