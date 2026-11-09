/**
 * Experiment A2 (simulated): explicit 2x2x2 factorial, RB quality {avg, elite} x line quality {avg, elite} x style {aligned, mismatched}.
 *   [ENGINE_ROOT=/tmp/proto PROTO_Q=mean|geo PROTO_W=...] TALENT=1|1.5 npx tsx expA2_factorial.ts <reps> <out.json>
 * Same players in "aligned" and "mismatched" (only the declared concept differs). Quality bumps are style-neutral (+ELITE z on both style groups).
 * Every cell shares seed/opponent/venue per (team, rep). Records margin and run stats; analyze_A2.py computes the interaction contrasts.
 */
import { writeFileSync } from "node:fs";
import { build, setTags, play, teams, rnd, IS_PROTO } from "./lib.ts";
import { bump, sum, RB_E, OL_M, RB_PLUS, RB_MINUS, OL_PLUS, OL_MINUS, grp } from "./edits.ts";
const REPS = Number(process.argv[2] ?? 40), OUT = process.argv[3] ?? "expA2.json", ELITE = Number(process.env.ELITE ?? 1.0);
const rbQ = (z: number) => grp([...RB_PLUS, ...RB_MINUS, "speed"], z);
const olQ = (z: number) => grp([...OL_PLUS, ...OL_MINUS, "run_block", "line_calls"], z);
const rows: any[] = [];
for (let ti = 0; ti < teams.length; ti++) {
  const team = teams[ti]!;
  for (let r = 0; r < REPS; r++) {
    const opp = teams[(ti + 1 + Math.floor(rnd() * 31)) % 32]!, seed = 9_100_000 + ti * 10007 + r * 31, home = r % 2 === 0;
    const oppR = build(opp, `o${ti}_${r}`);
    for (const al of ["A", "M"]) for (const rb of [0, 1]) for (const ol of [0, 1]) {
      const foc = build(team, `${al}${rb}${ol}_${ti}_${r}`, (p, pos, rank) => {
        if (pos === "RB" && rank === 0) bump(p, sum(rbQ(rb * ELITE), RB_E));
        if (["OT", "OG", "C"].includes(pos) && rank < (pos === "C" ? 1 : 2)) bump(p, sum(olQ(ol * ELITE), OL_M));
        if (pos === "QB" && rank === 0) setTags(p, [al === "A" ? "zone" : "power"]);
      });
      const g = home ? play(seed, team, opp, foc, oppR) : play(seed, opp, team, oppR, foc);
      const me = home ? g.home : g.away;
      rows.push({ team, r, cell: `${al}|rb${rb}|ol${ol}`, margin: home ? g.score[0] - g.score[1] : g.score[1] - g.score[0], ypc: me.rushAtt ? me.rushYards / me.rushAtt : null });
    }
  }
  writeFileSync(OUT, JSON.stringify({ proto: IS_PROTO, q: process.env.PROTO_Q ?? "n/a", talent: process.env.TALENT ?? "1.5", elite: ELITE, reps: REPS, rows }));
  process.stderr.write(`team ${ti + 1}/32\n`);
}
