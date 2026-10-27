/**
 * `npm --prefix arcade run balance:passing` prints the passing-balance report: window sweeps, the seeded strategy matrix with confidence
 * intervals and dominant-strategy detection, scoring distributions and the status of every known imbalance. It describes the rules
 * against scripted players; it asserts nothing and changes nothing.
 *
 *   --seeds N    seeds per strategy and defense (default 6; 14 drives per seed)
 *   --games N    also play N regulation games per strategy pairing (default 0; about 2 s each)
 *   --br N       start spots the best-response strategy is run from (default 4; about 3 s a drive)
 *   --json FILE  also write the numbers to FILE
 */
import { writeFileSync } from 'node:fs';
import type { DefensePolicy } from './sim';
import { KNOWN_IMBALANCES, gatherEvidence } from './imbalances';
import { PROVISIONAL_BENCHMARKS, STARTS, cells, dominance, readBenchmarks, runGames, runMatrix, type Cell } from './matrix';
import { summarize } from './stats';
import { BEST_RESPONSE, STRATEGIES } from './strategies';
import { byDistance, byRoute, byTiming, windowMap, type Rates, type ThrowRecord } from './window';

const arg = (name: string, fallback: number): number => { const i = process.argv.indexOf(`--${name}`); return i < 0 ? fallback : Number(process.argv[i + 1]); };
const pct = (x: number, d = 0) => `${(100 * x).toFixed(d)}%`;
const ci = (p: { p: number; ci: { lo: number; hi: number } }) => `${pct(p.p)} [${pct(p.ci.lo)}-${pct(p.ci.hi)}]`;
const pad = (v: string | number, n: number) => String(v).padEnd(n);
const ratesLine = (r: Rates) => `${String(r.throws).padStart(4)} throws  complete ${ci(r.complete).padEnd(14)} intercepted ${ci(r.interception).padEnd(14)} touchdown ${pct(r.touchdown.p).padStart(4)}  yd/catch ${r.yardsPerCompletion.toFixed(1).padStart(5)}  longest open run ${r.openRun}`;

export function printWindows(pocket: readonly ThrowRecord[]): void {
    console.log('\n=== 1. Passing windows: every pass play x receiver x throw moment (ticks 0-240, every 4; AI defense, humans idle, line 40) ===');
    console.log('Window maps, one letter per throw (C caught, T touchdown, x incomplete, I intercepted, S sacked first):');
    for (const [key] of byRoute(pocket)) {
        const [play, target] = key.split(' -> ') as [string, string];
        console.log(`  ${pad(key, 14)} ${windowMap(pocket.filter(r => r.play === play && r.target === ({ WR1: 1, WR2: 2, TE1: 3 } as Record<string, number>)[target]))}`);
    }
    console.log('\nBy route:');
    for (const [key, r] of byRoute(pocket)) console.log(`  ${pad(key, 14)} ${ratesLine(r)}`);
    console.log('\nBy throw timing (all routes):');
    for (const b of byTiming(pocket)) console.log(`  ${pad(b.label, 22)} ${ratesLine(b.rates)}`);
    console.log('\nBy air distance (all routes):');
    for (const b of byDistance(pocket)) console.log(`  ${pad(b.label, 22)} ${ratesLine(b.rates)}`);
    console.log('\nTelemetry by outcome (mean over throws): separation = receiver to nearest defender, gap = receiver (or defender) to the landing point');
    for (const outcome of ['complete', 'incomplete', 'interception'] as const) {
        const rs = pocket.filter(r => r.outcome === outcome), m = (f: (r: ThrowRecord) => number) => summarize(rs.map(f)).mean.toFixed(1);
        console.log(`  ${pad(outcome, 13)} n=${String(rs.length).padStart(3)}  air ${m(r => r.airYards).padStart(5)} yd  separation at throw ${m(r => r.separationAtThrow).padStart(5)}  at arrival ${m(r => r.separationAtArrival).padStart(5)}  receiver gap ${m(r => r.receiverGap).padStart(4)}  defender gap ${m(r => r.defenderGap).padStart(4)}`);
    }
}

export function printMatrix(all: readonly Cell[], defenses: readonly DefensePolicy[]): void {
    console.log('\n=== 2. Strategy matrix (seeded; drives from 7 start spots x both teams per seed) ===');
    console.log(`Provisional benchmark ranges (reference only): ${Object.entries(PROVISIONAL_BENCHMARKS).map(([k, v]) => `${k} ${pct(v.lo)}-${pct(v.hi)}`).join(', ')}`);
    console.log(pad('strategy', 10), pad('defense', 10), pad('drives', 7), pad('points/drive [95% CI]', 24), pad('TD drives', 16), pad('completion', 16), pad('interception', 16), 'plays  vs ranges (comp/int/td)');
    for (const c of all) {
        const b = readBenchmarks(c).map(x => x.status).join('/');
        console.log(pad(c.strategy, 10), pad(c.defense, 10), pad(c.drives, 7), pad(`${c.points.mean.toFixed(2)} [${c.points.ci.lo.toFixed(2)}, ${c.points.ci.hi.toFixed(2)}]`, 24), pad(ci(c.touchdownDrives), 16), pad(ci(c.completion), 16), pad(ci(c.interception), 16), c.playsPerDrive.toFixed(1).padStart(4), ' ', b);
    }
    console.log('\nDominant strategy (significantly out-scores every other strategy in points per drive; 95% intervals of the differences all above 0):');
    for (const d of defenses) {
        const practicable = dominance(all, d, s => s !== BEST_RESPONSE.id), withBest = dominance(all, d);
        console.log(`  vs ${pad(d, 10)} practicable: ${practicable.dominant ?? 'none'}${practicable.leads[0] ? ` (leads by ${practicable.leads[0].diff.toFixed(2)} [${practicable.leads[0].lo.toFixed(2)}, ${practicable.leads[0].hi.toFixed(2)}] over ${practicable.leads[0].versus})` : ''}   including best response: ${withBest.dominant ?? 'none'}`);
    }
    console.log('\nScoring distribution (share of drives by points):');
    for (const c of all) console.log(`  ${pad(c.strategy, 10)} ${pad(c.defense, 10)} ${c.pointsDistribution.map(d => `${d.value}: ${pct(d.share)}`).join('  ')}`);
}

export function main(): void {
    const seeds = Array.from({ length: arg('seeds', 6) }, (_, i) => i + 1);
    const evidence = gatherEvidence();
    printWindows(evidence.pocket);
    const practicable = STRATEGIES.filter(s => s.id !== BEST_RESPONSE.id), defenses: DefensePolicy[] = ['idle', 'attentive', 'cover'];
    const records = runMatrix({ strategies: practicable, defenses, seeds });
    const best = runMatrix({ strategies: [BEST_RESPONSE], defenses: ['idle', 'attentive'], seeds: [1], starts: STARTS.slice(0, Math.max(1, arg('br', 4))) });
    const all = cells([...records, ...best]);
    printMatrix(all, ['idle', 'attentive', 'cover']);
    const games = arg('games', 0);
    const gameRows: unknown[] = [];
    if (games > 0) {
        console.log(`\n=== 3. Regulation games (${games} per pairing; score at the end of regulation) ===`);
        for (const s of practicable) {
            const g = runGames({ home: s, away: s, homeDefense: 'attentive', awayDefense: 'attentive', seeds: Array.from({ length: games }, (_, i) => i + 1) });
            const total = summarize(g.map(x => x.points)), diff = summarize(g.map(x => Math.abs(x.home - x.away)));
            console.log(`  ${pad(s.id, 9)} vs itself: points per game ${total.mean.toFixed(1)} [${total.ci.lo.toFixed(1)}, ${total.ci.hi.toFixed(1)}], range ${total.min}-${total.max}, margin ${diff.mean.toFixed(1)}, plays ${summarize(g.map(x => x.plays)).mean.toFixed(0)}`);
            gameRows.push({ strategy: s.id, games: g });
        }
    }
    console.log('\n=== 4. Known imbalances (measured now; an open entry is documented, not tuned away) ===');
    const findings = KNOWN_IMBALANCES.map(k => ({ id: k.id, status: k.status, title: k.title, ...k.detect(evidence) }));
    for (const f of findings) console.log(`  [${f.status}] ${pad(f.id, 32)} ${f.present ? 'DETECTED' : 'not detected'}  ${f.evidence}`);
    const out = process.argv.indexOf('--json');
    if (out >= 0) writeFileSync(process.argv[out + 1]!, JSON.stringify({ seeds, cells: all, imbalances: findings, games: gameRows }, null, 2));
}
if (process.argv[1] && /passing-report\.ts$/.test(process.argv[1].replace(/\\/g, '/'))) main();
