/** League DNA post-fantasy-draft parity: `npx tsx --tsconfig tsconfig.app.json scripts/league_dna_parity.ts <legacy|fictional> <leagues> <games>`. Drafts 32 CPU teams, reads the engine strength index and simulates games. */
import { createLeague, DEFAULT_CONFIG, recomputeTeamRatings } from "../src/state/seed.ts";
import { beginDraft, completeDraft } from "../src/state/rules.ts";
import { strategyOf } from "../src/state/aiGms.ts";
import { Roster } from "../../src/engine/roster.js";
import { strengthIndex } from "../../src/engine/team-strength.js";
import { simulateGame } from "../../src/engine/sim.js";

import { ATTRIBUTE_TUNING } from "../src/sim/leagueDna/generate.ts";
if (process.env.DNA_ATTR) Object.assign(ATTRIBUTE_TUNING, JSON.parse(process.env.DNA_ATTR));
const MODE = (process.argv[2] ?? "fictional") as "legacy" | "fictional";
const N = Number(process.argv[3] ?? 8), GAMES = Number(process.argv[4] ?? 6);
const mean = (x: number[]) => x.reduce((a, b) => a + b, 0) / x.length;
const sd = (x: number[]) => { const m = mean(x); return Math.sqrt(mean(x.map((v) => (v - m) ** 2))); };
const rows: any[] = [];
const stratBySeed: Record<string, number[]>[] = [];
const elite: string[][] = [];
for (let i = 0; i < N; i++) {
  const seed = 1000 + i * 31;
  const s = createLeague(seed, { ...DEFAULT_CONFIG, humanGmCount: 0, playerPool: MODE });
  beginDraft(s, "fantasy"); completeDraft(s); recomputeTeamRatings(s);
  const codes = Object.keys(s.teams);
  const rosters: Record<string, Roster> = {};
  const idx: Record<string, number> = {};
  for (const c of codes) {
    const ps = Object.values(s.players).filter((p) => p.nfl_team === c && !p.retired);
    rosters[c] = new Roster(c, ps as any);
    const si = strengthIndex(rosters[c]);
    idx[c] = (si.offense + si.defense) / 2;
  }
  elite.push(Object.values(s.players).filter((p) => p.overall >= 90).map((p) => p.name));
  const vals = codes.map((c) => idx[c]!);
  const margin: Record<string, number[]> = {}; const pts: number[] = [];
  codes.forEach((c, ci) => {
    for (let g = 0; g < GAMES; g++) {
      const o = codes[(ci + 1 + ((g * 5 + ci) % 31)) % 32]!; if (o === c) continue;
      const r = simulateGame(seed * 100 + ci * 10 + g, c, o, { homeRoster: rosters[c], awayRoster: rosters[o], talentScale: 1.5 } as any);
      (margin[c] ??= []).push((r as any).score[0] - (r as any).score[1]); pts.push((r as any).score[0], (r as any).score[1]);
    }
  });
  const avgMargin = codes.map((c) => mean(margin[c] ?? [0]));
  const bs: Record<string, number[]> = {};
  codes.forEach((c, k) => { (bs[strategyOf(s, c)] ??= []).push(avgMargin[k]!); });
  stratBySeed.push(bs);
  const sorted = [...vals].sort((a, b) => b - a);
  const prof = (s as any).dna?.profile;
  rows.push({ seed, idxSd: sd(vals), range: sorted[0]! - sorted.at(-1)!, top8mbot8: mean(sorted.slice(0, 8)) - mean(sorted.slice(-8)), marginSd: sd(avgMargin), ptsMean: mean(pts), ptsSd: sd(pts), era: prof?.title ?? "-" });
  console.error(i, JSON.stringify(rows.at(-1)));
}
const strats = Object.keys(stratBySeed[0]!);
const stratMeans = stratBySeed.map((b) => Object.fromEntries(strats.map((k) => [k, mean(b[k] ?? [0])])));
const winners = stratMeans.map((m) => Object.entries(m).sort((a, b) => b[1] - a[1])[0]![0]);
const spread = stratMeans.map((m) => sd(Object.values(m)));
// pairwise overlap of 90+ names between seeds
let ov = 0, pairs = 0;
for (let a = 0; a < elite.length; a++) for (let b = a + 1; b < elite.length; b++) { const sb = new Set(elite[b]); ov += elite[a]!.filter((n) => sb.has(n)).length / Math.max(1, elite[a]!.length); pairs++; }
console.log(JSON.stringify({ mode: MODE, n: N, games: GAMES,
  idxSd: mean(rows.map((r) => r.idxSd)), idxSdRange: [Math.min(...rows.map((r) => r.idxSd)), Math.max(...rows.map((r) => r.idxSd))],
  range: mean(rows.map((r) => r.range)), top8mbot8: mean(rows.map((r) => r.top8mbot8)), marginSd: mean(rows.map((r) => r.marginSd)), ptsMean: mean(rows.map((r) => r.ptsMean)), ptsSd: mean(rows.map((r) => r.ptsSd)),
  eliteOverlap: ov / pairs, elite90PerLeague: mean(elite.map((e) => e.length)),
  distinctBestStrategies: new Set(winners).size, bestStrategyBySeed: winners, strategySpreadMean: mean(spread),
  eras: rows.map((r) => r.era) }, null, 1));
