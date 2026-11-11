/**
 * Experiment A2 (deterministic, no game noise): the EXACT run-game synergy shift for a 2x2x2 factorial
 *   RB quality {average, elite} x line quality {average, elite} x style {aligned, mismatched}
 * on all 32 rosters (vs a fixed opponent), before and after the channel's tanh saturation.
 *   ENGINE_ROOT=/tmp/proto PROTO_Q=mean|prod|geo|min PROTO_W=... npx tsx diagA_factorial_shift.ts <elite z> <out.json>
 * Interaction = c(1,1) - c(1,0) - c(0,1) + c(0,0). Units: yards per carry added by the synergy layer (rushYards channel).
 */
import { writeFileSync } from "node:fs";
import { build, setTags, teams, synergy, rosterMod } from "./lib.ts";
import { bump, sum, RB_E, OL_M, RB_PLUS, RB_MINUS, OL_PLUS, OL_MINUS, grp } from "./edits.ts";
const ELITE = Number(process.argv[2] ?? 1.0), OUT = process.argv[3] ?? "diagA.json";
const rbQ = (z: number) => grp([...RB_PLUS, ...RB_MINUS, "speed"], z);
const olQ = (z: number) => grp([...OL_PLUS, ...OL_MINUS, "run_block", "line_calls"], z);
const CAP = 1.4;
const W = synergy.SYNERGY_WEIGHTS.rushYards as Record<string, number>;
const PW = (synergy.PROTO?.w?.rushYards ?? {}) as Record<string, number>;
const pscale = synergy.PROTO?.scale ?? 1;
function parts(o: any, d: any) {
  const s = synergy.unitScores(o, d);
  let base = 0, proto = 0;
  for (const [k, w] of Object.entries(W)) base += (s[k] ?? 0) * w;
  for (const [k, w] of Object.entries(PW)) proto += (s[k] ?? 0) * w * pscale;
  const pre = base + proto, post = CAP * Math.tanh(pre / CAP);
  return { base, proto, pre, post };
}
const cells: Record<string, number[]>[] = [];
const acc: Record<string, Record<string, number[]>> = {};
for (const t of teams) {
  const opp = rosterMod.roster(teams[(teams.indexOf(t) + 7) % 32]!);
  for (const align of ["A", "M"]) for (const rb of [0, 1]) for (const ol of [0, 1]) {
    const r = build(t, `${align}${rb}${ol}${t}`, (p, pos, rank) => {
      if (pos === "RB" && rank === 0) bump(p, sum(rbQ(rb * ELITE), RB_E));
      if (["OT", "OG", "C"].includes(pos) && rank < (pos === "C" ? 1 : 2)) bump(p, sum(olQ(ol * ELITE), OL_M));
      if (pos === "QB" && rank === 0) setTags(p, [align === "A" ? "zone" : "power"]);
    });
    const x = parts(r.offense(), opp.defense());
    const key = `${align}|rb${rb}|ol${ol}`;
    for (const [k, v] of Object.entries(x)) ((acc[key] ??= {})[k] ??= []).push(v);
  }
}
const m = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const se = (a: number[]) => { const mu = m(a); return Math.sqrt(a.reduce((x, y) => x + (y - mu) ** 2, 0) / (a.length - 1) / a.length); };
const c = (key: string, k: string, i: number) => acc[key]![k]![i]!;
const n = teams.length, res: any = { variant: process.env.PROTO_Q ?? "n/a", elite: ELITE, cells: {}, interactions: {} };
for (const key of Object.keys(acc)) res.cells[key] = Object.fromEntries(Object.entries(acc[key]!).map(([k, v]) => [k, +m(v).toFixed(4)]));
for (const k of ["pre", "post", "proto", "base"]) {
  for (const al of ["A", "M"]) {
    const v = [...Array(n).keys()].map((i) => c(`${al}|rb1|ol1`, k, i) - c(`${al}|rb1|ol0`, k, i) - c(`${al}|rb0|ol1`, k, i) + c(`${al}|rb0|ol0`, k, i));
    res.interactions[`${k}|RBxOL|${al}`] = [+m(v).toFixed(4), +se(v).toFixed(4)];
  }
  const qs = [...Array(n).keys()].map((i) => (c("A|rb1|ol1", k, i) - c("M|rb1|ol1", k, i)) - (c("A|rb0|ol0", k, i) - c("M|rb0|ol0", k, i)));
  res.interactions[`${k}|QualityxAlignment`] = [+m(qs).toFixed(4), +se(qs).toFixed(4)];
}
res.saturation = { postOverPre_eliteAligned: +(m(acc["A|rb1|ol1"]!.post!) / m(acc["A|rb1|ol1"]!.pre!)).toFixed(3), maxPre: +Math.max(...acc["A|rb1|ol1"]!.pre!).toFixed(3), cap: CAP };
writeFileSync(OUT, JSON.stringify(res, null, 1));
console.log(res.variant, "elite", ELITE, JSON.stringify(res.interactions), JSON.stringify(res.saturation));
