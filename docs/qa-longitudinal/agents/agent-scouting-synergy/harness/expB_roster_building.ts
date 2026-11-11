/**
 * Experiment B: fit-based roster building vs highest-overall acquisition under EQUAL spend. REAL engine.
 *   ENGINE_ROOT=<repo|/tmp/proto> [PROTO_W=...] NFL_POOL_PATH=<pool> npx tsx expB_roster_building.ts <reps> <out.json>
 * For each team and rep, a market of M=8 random league starters is drawn per offensive skill slot (QB, RB, WR1-3, TE, OT x2, OG x2, C).
 *  H  (highest overall): buys the highest-overall candidate at every slot; declares the concept its players happen to fit ("natural").
 *  F  (fit-based): chooses an identity (run: zone|power, pass: vertical|timing) and at every slot buys the best quality+style-fit
 *     candidate with TOTAL spend not above H's (price depends on overall and position only, like the trade chart); money can move between slots.
 *  B  (balanced, no concept): same players as H, no declared concept (isolates "knowing your identity" from "buying for it").
 * All three play identical seeds/opponents against the unmodified opponent roster.
 */
import { writeFileSync } from "node:fs";
import { build, setTags, play, teams, mean, se, rnd, allPlayers, clone, rosterMod, ratings, IS_PROTO } from "./lib.ts";
const REPS = Number(process.argv[2] ?? 10), OUT = process.argv[3] ?? "expB.json", M = 8, LAMBDA = Number(process.env.LAMBDA ?? 0.6);
const zOf = (p: any, spec: Record<string, number>): number => { let n = 0, d = 0; for (const [a, w] of Object.entries(spec)) { const v = p.attributes?.[a]; if (typeof v !== "number") continue; const z = ratings.attributeZ(a, v); if (z === null) continue; n += w * z; d += w; } return d ? n / d : 0; };
const sty = (p: any, a: any, b: any) => Math.max(-2, Math.min(2, zOf(p, a) - zOf(p, b)));
const S = {
  RB: [{ ball_carrier_vision: .4, agility: .2, juke_move: .2, acceleration: .2 }, { break_tackle: .4, stiff_arm: .3, strength: .3 }],
  OL: [{ agility: .5, acceleration: .25, speed: .25 }, { strength: .5, anchor: .3, pass_block_power: .2 }],
  QB: [{ throw_accuracy_deep: .5, throw_power: .5 }, { throw_accuracy_short: .6, awareness: .4 }],
  WR: [{ route_running_deep: .4, speed: .3, acceleration: .3 }, { route_running_short: .4, catching: .3, release: .3 }],
} as const;
const QUAL: Record<string, Record<string, number>> = {
  RB: { ball_carrier_vision: .35, break_tackle: .25, speed: .2, acceleration: .2 },
  OL: { run_block: .5, pass_block: .3, anchor: .1, line_calls: .1 },
  QB: { throw_accuracy_short: .35, throw_accuracy_mid: .35, throw_accuracy_deep: .2, awareness: .1 },
  WR: { catching: .4, route_running_short: .2, route_running_mid: .2, route_running_deep: .1, release: .1 },
  TE: { catching: .3, run_block: .3, route_running_mid: .2, pass_block: .2 },
};
const SLOTS: { key: string; pos: string; n: number; grp: keyof typeof QUAL; styleKey?: keyof typeof S; axis: "run" | "pass" | null }[] = [
  { key: "QB", pos: "QB", n: 1, grp: "QB", styleKey: "QB", axis: "pass" }, { key: "RB", pos: "RB", n: 1, grp: "RB", styleKey: "RB", axis: "run" },
  { key: "WR", pos: "WR", n: 3, grp: "WR", styleKey: "WR", axis: "pass" }, { key: "TE", pos: "TE", n: 1, grp: "TE", axis: null },
  { key: "OT", pos: "OT", n: 2, grp: "OL", styleKey: "OL", axis: "run" }, { key: "OG", pos: "OG", n: 2, grp: "OL", styleKey: "OL", axis: "run" }, { key: "C", pos: "C", n: 1, grp: "OL", styleKey: "OL", axis: "run" },
];
const POSV: Record<string, number> = { QB: 2.92, RB: .78, WR: 1.15, TE: .9, OT: 1.15, OG: .92, C: .88 };
const price = (p: any) => Math.pow(Math.max(0, Math.min(99, p.overall) - 40), 2.2) / 68 * (POSV[p.position] ?? 1);
const _stat = new Map<string, { m: number; s: number }>();
/** style standardised against the league's starters of the same group (what the engine's axes do), clamped to +-2 */
const styleOfP = (p: any, k: keyof typeof S) => {
  let st = _stat.get(k);
  if (!st) {
    const groups: Record<string, string[]> = { RB: ["RB"], OL: ["OT", "OG", "C"], QB: ["QB"], WR: ["WR"] };
    const xs = groups[k]!.flatMap((pos) => (byPos.get(pos) ?? []).map((q) => zOf(q, S[k][0]) - zOf(q, S[k][1])));
    const m = mean(xs), sdv = Math.sqrt(mean(xs.map((x) => (x - m) ** 2))) || 1;
    _stat.set(k, (st = { m, s: sdv }));
  }
  return Math.max(-2, Math.min(2, (zOf(p, S[k][0]) - zOf(p, S[k][1]) - st.m) / st.s));
};
const qualOf = (p: any, g: keyof typeof QUAL) => zOf(p, QUAL[g]!);
// league starters by position (the market)
const byPos = new Map<string, any[]>();
for (const t of teams) for (const [pos, list] of rosterMod.roster(t).depth) for (const p of list.slice(0, pos === "WR" ? 3 : pos === "OT" || pos === "OG" ? 2 : 1)) { const l = byPos.get(pos) ?? []; l.push({ ...p, _team: t }); byPos.set(pos, l); }
const rows: any[] = [];
function assemble(team: string, tag: string, picks: Record<string, any[]>, concept: string[]) {
  const base = allPlayers(team);
  const drop = new Set<string>(); const keep: any[] = [];
  for (const sl of SLOTS) { const cur = base.filter((p) => p.position === sl.pos).sort((a, b) => b.overall - a.overall); for (const p of cur.slice(0, sl.n)) drop.add(p.id); }
  for (const p of base) if (!drop.has(p.id)) keep.push(clone(p, tag));
  const added: any[] = [];
  for (const sl of SLOTS) for (const c of picks[sl.key]!) { const q = clone(c, tag); delete q._team; q.nfl_team = team; added.push(q); }
  const qb = added.find((p) => p.position === "QB"); if (qb) setTags(qb, concept);
  return new rosterMod.Roster(team, [...keep, ...added]);
}
for (let ti = 0; ti < teams.length; ti++) {
  const team = teams[ti]!;
  for (let r = 0; r < REPS; r++) {
    const opp = teams[(ti + 1 + Math.floor(rnd() * 31)) % 32]!, seed = 8_700_000 + ti * 10007 + r * 31, home = r % 2 === 0;
    const market: Record<string, any[]> = {};
    for (const sl of SLOTS) { const pool = (byPos.get(sl.pos) ?? []).filter((p) => p._team !== team); const pick: any[] = []; for (let i = 0; i < sl.n; i++) { const c: any[] = []; while (c.length < M) { const x = pool[Math.floor(rnd() * pool.length)]; if (!c.includes(x) && !pick.includes(x)) c.push(x); } market[`${sl.key}${i}`] = c; pick.push(null); } }
    // H: highest overall per slot-item
    const H: Record<string, any[]> = {}; const Hprice: Record<string, number> = {};
    for (const sl of SLOTS) { H[sl.key] = []; for (let i = 0; i < sl.n; i++) { const c = [...market[`${sl.key}${i}`]!].sort((a, b) => b.overall - a.overall)[0]; H[sl.key]!.push(c); Hprice[`${sl.key}${i}`] = price(c); } }
    const nat = (picks: Record<string, any[]>) => {
      const rb = styleOfP(picks.RB![0], "RB"), ol = mean([...picks.OT!, ...picks.OG!, ...picks.C!].map((p) => styleOfP(p, "OL")));
      const qb = styleOfP(picks.QB![0], "QB"), wr = mean(picks.WR!.map((p) => styleOfP(p, "WR")));
      const sg = (x: number) => (x > 0.25 ? 1 : x < -0.25 ? -1 : 0);
      return [sg(rb + ol) > 0 ? "zone" : sg(rb + ol) < 0 ? "power" : "", sg(qb + wr) > 0 ? "vertical" : sg(qb + wr) < 0 ? "timing" : ""].filter(Boolean);
    };
    // F: best identity. Equal TOTAL spend: Lagrangian knapsack over the market (maximise sum(score - mu*price), mu in [-1,1] by bisection to the largest spend <= H's total)
    const budget = Object.values(Hprice).reduce((a, b) => a + b, 0);
    let bestF: Record<string, any[]> | null = null, bestScore = -1e9, bestC: string[] = [];
    for (const run of [1, -1]) for (const pass of [1, -1]) {
      const choose = (mu: number) => {
        const picks: Record<string, any[]> = {}; let score = 0, cost = 0;
        for (const sl of SLOTS) { picks[sl.key] = []; for (let i = 0; i < sl.n; i++) {
          const cand = market[`${sl.key}${i}`]!.filter((p) => !picks[sl.key]!.includes(p));
          let b = cand[0]!, bs = -1e9, bsc = 0;
          for (const c of cand) { const al = sl.styleKey ? (sl.axis === "run" ? run : pass) * styleOfP(c, sl.styleKey) : 0; const sc = qualOf(c, sl.grp) + LAMBDA * al; const v = sc - mu * price(c); if (v > bs) { bs = v; b = c; bsc = sc; } }
          picks[sl.key]!.push(b); score += bsc; cost += price(b); } }
        return { picks, score, cost };
      };
      let lo = -1, hi = 1, res = choose(1);
      for (let it = 0; it < 40; it++) { const mid = (lo + hi) / 2; const r2 = choose(mid); if (r2.cost > budget + 1e-9) lo = mid; else { hi = mid; res = r2; } }
      if (res.cost <= budget + 1e-6 && res.score > bestScore) { bestScore = res.score; bestF = res.picks; bestC = [run > 0 ? "zone" : "power", pass > 0 ? "vertical" : "timing"]; }
    }
    if (!bestF) bestF = H;
    const oppR = build(opp, `o${ti}_${r}`);
    const arms: Record<string, any> = { H: assemble(team, `H${ti}_${r}`, H, nat(H)), B: assemble(team, `B${ti}_${r}`, H, []), F: assemble(team, `F${ti}_${r}`, bestF!, bestC) };
    const spend = (pk: Record<string, any[]>) => Object.values(pk).flat().reduce((a, p) => a + price(p), 0);
    const ov = (pk: Record<string, any[]>) => mean(Object.values(pk).flat().map((p) => p.overall));
    for (const [name, ro] of Object.entries(arms)) {
      const g = home ? play(seed, team, opp, ro, oppR) : play(seed, opp, team, oppR, ro);
      rows.push({ team, r, arm: name, margin: home ? g.score[0] - g.score[1] : g.score[1] - g.score[0], spend: spend(name === "F" ? bestF! : H), ovr: ov(name === "F" ? bestF! : H) });
    }
  }
  writeFileSync(OUT, JSON.stringify({ proto: IS_PROTO, lambda: LAMBDA, reps: REPS, rows })); process.stderr.write(`team ${ti + 1}/32\n`);
}
