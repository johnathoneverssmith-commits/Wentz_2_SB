/**
 * Experiment A: synergy beyond additive talent, and skill-style fit. REAL engine.
 *   ENGINE_ROOT=<repo|/tmp/proto> NFL_POOL_PATH=<pool> npx tsx expA_synergy.ts <reps> <out.json>
 * Cells share seed/opponent/venue per (team, rep). Margin is focal-team points; rush/pass stats from the box score.
 * Part 1 (quality factorial): RB / run-blockers / both get the same attribute bump -> interaction = both - rb - ol.
 * All attribute edits are in z-units of the rating layer (see bump); STYLE_DZ (default 0.5) is the half-width of a style edit.
 * Part 2 (style 2x2x2, quality held constant): RB style x OL style x declared run concept (proto only reads the concept).
 * Part 3 (pass analogue): QB style x WR style x declared pass concept.
 */
import { writeFileSync } from "node:fs";
import { build, setTags, play, teams, mean, se, rnd, IS_PROTO } from "./lib.ts";
import { bump, Q, SZ, sum, RUN_Q, OL_Q, RB_E, RB_P, OL_M, OL_Dv, QB_V, QB_K, WR_V, WR_T, RUN_QN, OL_QN } from "./edits.ts";
const REPS = Number(process.argv[2] ?? 12), OUT = process.argv[3] ?? "expA.json";
const OLS = ["OT", "OG", "C"];
type Edit = { rb?: any; ol?: any; qb?: any; wr?: any; run?: string; pass?: string };
const cells: Record<string, Edit> = { base: {}, rb: { rb: RUN_Q }, ol: { ol: OL_Q }, both: { rb: RUN_Q, ol: OL_Q } };
for (const rbs of ["E", "P"]) for (const ols of ["M", "D"]) for (const c of ["zone", "power"])
  cells[`run|rb${rbs}|ol${ols}|${c}`] = { rb: rbs === "E" ? RB_E : RB_P, ol: ols === "M" ? OL_M : OL_Dv, run: c };
for (const qs of ["V", "K"]) for (const ws of ["V", "T"]) for (const c of ["vertical", "timing"])
  cells[`pass|qb${qs}|wr${ws}|${c}`] = { qb: qs === "V" ? QB_V : QB_K, wr: ws === "V" ? WR_V : WR_T, pass: c };
const mix = sum;
// Part 4: elite quality AND aligned style together (superadditivity test): excess = combo|aligned - both - run|rbE|olM|zone
// style-NEUTRAL quality bumps: every attribute of both style groups (each group's weights sum to 1) rises by D, so style z is unchanged
cells["eliteN"] = { rb: RUN_QN, ol: OL_QN };
cells["comboN|aligned"] = { rb: mix(RUN_QN, RB_E), ol: mix(OL_QN, OL_M), run: "zone" };
cells["comboN|anti"] = { rb: mix(RUN_QN, RB_E), ol: mix(OL_QN, OL_M), run: "power" };
cells["comboN|balanced"] = { rb: mix(RUN_QN, RB_E), ol: mix(OL_QN, OL_M) };
cells["combo|aligned"] = { rb: mix(RUN_Q, RB_E), ol: mix(OL_Q, OL_M), run: "zone" };
cells["combo|anti"] = { rb: mix(RUN_Q, RB_E), ol: mix(OL_Q, OL_M), run: "power" };
cells["combo|balanced"] = { rb: mix(RUN_Q, RB_E), ol: mix(OL_Q, OL_M) };
if (process.env.ONLY_COMBO) for (const k of Object.keys(cells)) if (!["base", "both", "rb", "ol", "run|rbE|olM|zone", "run|rbE|olM|power", "combo|aligned", "combo|anti", "combo|balanced", "eliteN", "comboN|aligned", "comboN|anti", "comboN|balanced"].includes(k)) delete cells[k];
const rows: any[] = [];
for (let ti = 0; ti < teams.length; ti++) {
  const team = teams[ti]!;
  for (let r = 0; r < REPS; r++) {
    const opp = teams[(ti + 1 + Math.floor(rnd() * (teams.length - 1))) % teams.length]!;
    const home = r % 2 === 0, seed = 8_100_000 + ti * 10007 + r * 31;
    const oppRoster = build(opp, `o${ti}_${r}`);
    for (const [name, e] of Object.entries(cells)) {
      const used = new Set<string>();
      const foc = build(team, `${name}_${ti}_${r}`, (p, pos, rank) => {
        if (pos === "RB" && rank === 0 && e.rb) bump(p, e.rb);
        if (OLS.includes(pos) && rank < (pos === "OT" ? 2 : pos === "OG" ? 2 : 1) && e.ol) bump(p, e.ol);
        if (pos === "QB" && rank === 0) { if (e.qb) bump(p, e.qb); const t: string[] = []; if (e.run) t.push(e.run); if (e.pass) t.push(e.pass); setTags(p, t); }
        if (pos === "WR" && rank < 3 && e.wr) bump(p, e.wr);
      });
      const g = home ? play(seed, team, opp, foc, oppRoster) : play(seed, opp, team, oppRoster, foc);
      const me = home ? g.home : g.away, you = home ? g.away : g.home;
      const m = (home ? g.score[0] - g.score[1] : g.score[1] - g.score[0]);
      rows.push({ team, r, cell: name, margin: m, ypc: me.rushAtt ? me.rushYards / me.rushAtt : null, rushAtt: me.rushAtt, rushYards: me.rushYards, passYds: me.passYards, comp: me.completions, att: me.passAtt, sacks: me.sacksAllowed, ints: me.interceptionsThrown });
    }
  }
  writeFileSync(OUT, JSON.stringify({ proto: IS_PROTO, reps: REPS, rows }));
  process.stderr.write(`team ${ti + 1}/32\n`);
}
