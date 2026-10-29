/** League DNA strategy tournament: `npx tsx --tsconfig tsconfig.app.json scripts/league_dna_strategies.ts <legacy|fictional> <leagues> <games>`. One seat drafts by a scripted strategy against 31 CPU teams; reports strength-index delta vs the CPU mean. */
import { createLeague, DEFAULT_CONFIG, recomputeTeamRatings } from "../src/state/seed.ts";
import { applyPick, beginDraft, draftValue, runAiPicks } from "../src/state/rules.ts";
import { ROSTER_TEMPLATE } from "../src/sim/roster-template.ts";
import { Roster } from "../../src/engine/roster.js";
import { strengthIndex } from "../../src/engine/team-strength.js";
import { simulateGame } from "../../src/engine/sim.js";
import type { LeagueState, Player, Position } from "../src/domain/index.ts";

const MODE = (process.argv[2] ?? "fictional") as "legacy" | "fictional";
const N = Number(process.argv[3] ?? 6), GAMES = Number(process.argv[4] ?? 0);
const mean = (x: number[]) => x.reduce((a, b) => a + b, 0) / x.length;
const sd = (x: number[]) => { const m = mean(x); return Math.sqrt(mean(x.map((v) => (v - mean(x)) ** 2))); };

const GROUPS: Record<string, Position[]> = {
  qb: ["QB"], ol: ["OT", "OG", "C"], dl: ["EDGE", "DT"], skill: ["WR", "RB", "TE"], dback: ["CB", "S"], defense: ["EDGE", "DT", "ILB", "CB", "S"],
};
/** how many picks of the target group the scripted drafter takes before turning to best-available */
const PLAN: Record<string, { group: Position[]; n: number }> = {
  bpa: { group: [], n: 0 },
  qb_first: { group: GROUPS.qb!, n: 2 },
  ol_first: { group: GROUPS.ol!, n: 6 },
  dl_first: { group: GROUPS.dl!, n: 6 },
  defense_first: { group: GROUPS.defense!, n: 10 },
  skill_first: { group: GROUPS.skill!, n: 8 },
};
const FLOOR = new Map(ROSTER_TEMPLATE.filter((r) => r.starters > 0).map((r) => [r.pos, Math.min(r.count, r.starters + 1)]));

function draftWith(s: LeagueState, team: string, strat: string): void {
  const gm = s.gms[0]!; gm.isHuman = true; gm.teamCode = team;
  s.teams[team]!.controlledBy = { kind: "human", gmId: gm.id };
  beginDraft(s, "fantasy");
  const d = s.draft!;
  const plan = PLAN[strat]!;
  let taken = 0;
  for (let guard = 0; guard < 5000 && d.currentPickIndex < d.pickOrder.length; guard++) {
    runAiPicks(s);
    if (d.currentPickIndex >= d.pickOrder.length) break;
    const mine = Object.values(s.players).filter((p) => p.nfl_team === team);
    const have = new Map<Position, number>();
    for (const p of mine) have.set(p.position, (have.get(p.position) ?? 0) + 1);
    const left = d.pickOrder.slice(d.currentPickIndex).filter((t) => t === team).length;
    const deficit = [...FLOOR].filter(([pos, n]) => (have.get(pos) ?? 0) < n);
    const needed = deficit.reduce((a, [pos, n]) => a + n - (have.get(pos) ?? 0), 0);
    const pool = Object.values(s.players).filter((p) => p.free_agent && !p.retired);
    let cand: Player[];
    if (needed >= left) cand = pool.filter((p) => deficit.some(([pos]) => pos === p.position));
    else if (taken < plan.n && plan.group.length) {
      cand = pool.filter((p) => plan.group.includes(p.position));
      // a quarterback pick means one man at the top, not a stack
      if (strat === "qb_first" && (have.get("QB") ?? 0) >= 1) cand = pool;
    } else cand = pool.filter((p) => (have.get(p.position) ?? 0) < (ROSTER_TEMPLATE.find((r) => r.pos === p.position)?.count ?? 0));
    if (!cand.length) cand = pool;
    const best = cand.reduce((a, b) => (draftValue(b.overall, b.position) > draftValue(a.overall, a.position) ? b : a));
    if (plan.group.includes(best.position)) taken++;
    applyPick(s, best.id);
  }
}

function idxOf(s: LeagueState, code: string): number {
  const ps = Object.values(s.players).filter((p) => p.nfl_team === code && !p.retired);
  const si = strengthIndex(new Roster(code, ps as any));
  return (si.offense + si.defense) / 2;
}

const out: any[] = [];
for (let i = 0; i < N; i++) {
  const seed = 3000 + i * 53;
  const base = createLeague(seed, { ...DEFAULT_CONFIG, humanGmCount: 1, playerPool: MODE });
  const codes = Object.keys(base.teams);
  const seat = codes[(seed * 7) % codes.length]!;
  const res: Record<string, { delta: number; rank: number; margin: number | null }> = {};
  let cpuSd = 0;
  for (const strat of Object.keys(PLAN)) {
    const s = structuredClone(base);
    draftWith(s, seat, strat);
    recomputeTeamRatings(s);
    const idx = Object.fromEntries(codes.map((c) => [c, idxOf(s, c)]));
    const others = codes.filter((c) => c !== seat).map((c) => idx[c]!);
    cpuSd = sd(others);
    const rank = 1 + others.filter((v) => v > idx[seat]!).length;
    let margin: number | null = null;
    if (GAMES > 0) {
      const ms: number[] = [];
      const r1 = new Roster(seat, Object.values(s.players).filter((p) => p.nfl_team === seat) as any);
      for (let g = 0; g < GAMES; g++) {
        const o = codes.filter((c) => c !== seat)[(g * 5 + 3) % 31]!;
        const ro = new Roster(o, Object.values(s.players).filter((p) => p.nfl_team === o) as any);
        const r = simulateGame(seed * 1000 + g, seat, o, { homeRoster: g % 2 ? r1 : ro, awayRoster: g % 2 ? ro : r1, talentScale: 1.5 } as any) as any;
        ms.push(g % 2 ? r.score[0] - r.score[1] : r.score[1] - r.score[0]);
      }
      margin = mean(ms);
    }
    res[strat] = { delta: idx[seat]! - mean(others), rank, margin };
  }
  const best = Object.entries(res).sort((a, b) => b[1].delta - a[1].delta)[0]![0];
  const deltas = Object.values(res).map((r) => r.delta);
  const prof = (base as any).dna?.profile;
  out.push({ seed, seat, best, cpuSd, spread: Math.max(...deltas) - Math.min(...deltas), res, era: prof?.title ?? "-" });
  console.error(i, seed, best, "spread", (Math.max(...deltas) - Math.min(...deltas)).toFixed(2), JSON.stringify(Object.fromEntries(Object.entries(res).map(([k, v]) => [k, +v.delta.toFixed(2)]))));
}
const strats = Object.keys(PLAN);
const meanDelta = Object.fromEntries(strats.map((k) => [k, mean(out.map((o) => o.res[k].delta))]));
const sdDelta = Object.fromEntries(strats.map((k) => [k, sd(out.map((o) => o.res[k].delta))]));
console.log(JSON.stringify({ mode: MODE, n: N, meanDelta, sdDeltaAcrossSeeds: sdDelta, distinctBest: new Set(out.map((o) => o.best)).size, bests: out.map((o) => o.best), spreadMean: mean(out.map((o) => o.spread)), cpuSdMean: mean(out.map((o) => o.cpuSd)), out }, null, 1));
