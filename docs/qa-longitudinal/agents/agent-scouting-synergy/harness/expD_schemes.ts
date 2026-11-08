/**
 * Experiment D: game-plan / scheme alignment and counters. REAL engine.
 *  D1 (baseline engine, run with ENGINE_ROOT=repo): effect of the offensive coordinator's SCHEME (rating held at 50) on a
 *     roster whose players carry scheme_tags (pool-2026) vs the same roster with tags removed (what a default fictional league
 *     and every drafted rookie look like). Reference = pro_style (neutral).
 *  D2 (prototype, ENGINE_ROOT=/tmp/proto): concept strategies vs opponents of each front/coverage type.
 *   npx tsx expD_schemes.ts D1|D2 <reps> <out.json>
 */
import { writeFileSync } from "node:fs";
import { build, setTags, play, teams, mean, se, rnd, staffMod, synergy, rosterMod } from "./lib.ts";
const MODE = process.argv[2] ?? "D1", REPS = Number(process.argv[3] ?? 10), OUT = process.argv[4] ?? "expD.json";
const rows: any[] = [];
if (MODE === "D1") {
  const OFF = ["pro_style", "west_coast", "vertical", "spread", "power_run", "zone_run"];
  const DEF = ["multiple", "four_three", "three_four", "cover_3", "cover_2", "man_press"];
  const staff = (oc: string, dc: string) => { const s = staffMod.leagueAverageStaff("T"); s.oc.scheme = oc; s.dc.scheme = dc; return s; };
  const neutral = staffMod.leagueAverageStaff("N");
  for (let ti = 0; ti < teams.length; ti++) {
    const team = teams[ti]!;
    for (let r = 0; r < REPS; r++) {
      const opp = teams[(ti + 1 + Math.floor(rnd() * 31)) % 32]!; const seed = 8_300_000 + ti * 10007 + r * 31; const home = r % 2 === 0;
      for (const tagless of [false, true]) {
        const mk = (tag: string) => build(team, tag, tagless ? (p) => { p.scheme_tags = []; } : undefined);
        const oppR = build(opp, `o${ti}_${r}_${tagless}`, tagless ? (p) => { p.scheme_tags = []; } : undefined);
        for (const sch of OFF) {
          const foc = mk(`${sch}${tagless}${ti}_${r}`);
          const st = staff(sch, "multiple");
          const g = home ? play(seed, team, opp, foc, oppR, { homeStaff: st, awayStaff: neutral }) : play(seed, opp, team, oppR, foc, { homeStaff: neutral, awayStaff: st });
          rows.push({ kind: "off", team, r, tagless, scheme: sch, margin: home ? g.score[0] - g.score[1] : g.score[1] - g.score[0] });
        }
        for (const sch of DEF) {
          const foc = mk(`d${sch}${tagless}${ti}_${r}`);
          const st = staff("pro_style", sch);
          const g = home ? play(seed, team, opp, foc, oppR, { homeStaff: st, awayStaff: neutral }) : play(seed, opp, team, oppR, foc, { homeStaff: neutral, awayStaff: st });
          rows.push({ kind: "def", team, r, tagless, scheme: sch, margin: home ? g.score[0] - g.score[1] : g.score[1] - g.score[0] });
        }
      }
    }
    writeFileSync(OUT, JSON.stringify({ MODE, rows })); process.stderr.write(`team ${ti + 1}/32\n`);
  }
} else {
  // D2: concepts. Style axes from the prototype diagnostics.
  const sgn = (x: number, t = 0.25) => (x > t ? 1 : x < -t ? -1 : 0);
  for (let ti = 0; ti < teams.length; ti++) {
    const team = teams[ti]!;
    const base = rosterMod.roster(team);
    for (let r = 0; r < REPS; r++) {
      const oi = (ti + 1 + Math.floor(rnd() * 31)) % 32, opp = teams[oi]!; const seed = 8_500_000 + ti * 10007 + r * 31; const home = r % 2 === 0;
      const oppR = build(opp, `o${ti}_${r}`);
      const stl = synergy.protoStyles(base.offense(), oppR.defense());
      const natRun = sgn(stl.sRb + stl.sOl), natPass = sgn(stl.sQb + stl.sWr);
      const strategies: Record<string, [number, number]> = {
        balanced: [0, 0], natural: [natRun, natPass], opposite: [-natRun, -natPass],
        counter: [sgn(stl.front, 0.15), sgn(stl.cover, 0.15)], natLean: [natRun !== 0 ? natRun : sgn(stl.front, 0.15), natPass !== 0 ? natPass : sgn(stl.cover, 0.15)], allZoneVert: [1, 1], allPowerTiming: [-1, -1],
      };
      for (const [name, [cr, cp]] of Object.entries(strategies)) {
        const foc = build(team, `${name}${ti}_${r}`, (p, pos, rank) => { if (pos === "QB" && rank === 0) setTags(p, [cr > 0 ? "zone" : cr < 0 ? "power" : "", cp > 0 ? "vertical" : cp < 0 ? "timing" : ""].filter(Boolean)); });
        const g = home ? play(seed, team, opp, foc, oppR) : play(seed, opp, team, oppR, foc);
        rows.push({ team, opp, r, strat: name, front: stl.front, cover: stl.cover, natRun, natPass, margin: home ? g.score[0] - g.score[1] : g.score[1] - g.score[0] });
      }
    }
    writeFileSync(OUT, JSON.stringify({ MODE, rows })); process.stderr.write(`team ${ti + 1}/32\n`);
  }
}
