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
import { EVIDENCE_SEEDS, KNOWN_IMBALANCES, gatherEvidence } from './imbalances';
import { PROVISIONAL_BENCHMARKS, STARTS, cells, dominance, readBenchmarks, runGames, runMatrix, summarizeCell, type Cell, type DriveRecord } from './matrix';
import { summarize } from './stats';
import { BEST_RESPONSE, ORACLE_BEST_RESPONSE, STRATEGIES, predictions } from './strategies';
import { byDistance, byRoute, byTiming, windowMap, type Rates, type ThrowRecord } from './window';

const arg = (name: string, fallback: number): number => { const i = process.argv.indexOf(`--${name}`); return i < 0 ? fallback : Number(process.argv[i + 1]); };
const pct = (x: number, d = 0) => `${(100 * x).toFixed(d)}%`;
const ci = (p: { p: number; ci: { lo: number; hi: number } }) => `${pct(p.p)} [${pct(p.ci.lo)}-${pct(p.ci.hi)}]`;
const pad = (v: string | number, n: number) => String(v).padEnd(n);
const ratesLine = (r: Rates) => `${String(r.throws).padStart(4)} throws  complete ${ci(r.complete).padEnd(14)} contested ${pct(r.contested.p).padStart(4)} intercepted ${ci(r.interception).padEnd(14)} knocked down ${pct(r.breakup.p).padStart(4)} touchdown ${pct(r.touchdown.p).padStart(4)}  yd/catch ${r.yardsPerCompletion.toFixed(1).padStart(5)}  longest open run ${r.openRun}`;

export function printWindows(pocket: readonly ThrowRecord[]): void {
    console.log('\n=== 1. Passing windows: every pass play x receiver x throw moment (ticks 0-240, every 4; AI defense, humans idle, line 40) ===');
    console.log(`Window maps for one game (seed ${EVIDENCE_SEEDS[0]}), one letter per throw (C caught cleanly, c caught with a defender at the ball, T touchdown, x incomplete, b knocked down, I intercepted, S sacked first).`);
    console.log(`Every number below is over ${EVIDENCE_SEEDS.length} games (seeds ${EVIDENCE_SEEDS[0]}-${EVIDENCE_SEEDS.at(-1)}), because a catch is chance:`);
    for (const [key] of byRoute(pocket)) {
        const [play, target] = key.split(' -> ') as [string, string];
        console.log(`  ${pad(key, 14)} ${windowMap(pocket.filter(r => r.seed === EVIDENCE_SEEDS[0] && r.play === play && r.target === ({ WR1: 1, WR2: 2, TE1: 3 } as Record<string, number>)[target]))}`);
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

/**
 * The expectation best response chooses each throw by its average over 16 imagined outcomes (seeds that are not the game's) and then lives with the real draw;
 * its held-out games are the matrix seeds, none of which is an evaluation seed. The oracle judges each throw under the game's own seed (it has seen the dice):
 * it is a diagnostic of the best any offense could do if chance could be foreseen, never a measure of what a player can do.
 */
export function printBestResponse(best: readonly DriveRecord[], oracle: readonly DriveRecord[], predicted: readonly { pComplete: number; pIntercept: number }[]): void {
    console.log('\n=== 2b. Best response: expectation (practicable) against ORACLE (sees the dice; diagnostic only) ===');
    const row = (label: string, rs: readonly DriveRecord[]) => {
        const c = summarizeCell(rs.filter(r => r.defense === 'idle'));
        console.log(`  ${pad(label, 34)} ${c.drives} drives  points/drive ${c.points.mean.toFixed(2)} [${c.points.ci.lo.toFixed(2)}, ${c.points.ci.hi.toFixed(2)}]  TD drives ${ci(c.touchdownDrives)}  completion ${ci(c.completion)}  interception ${ci(c.interception)}  plays ${c.playsPerDrive.toFixed(1)}`);
    };
    row('expectation best response', best);
    row('ORACLE best response (diagnostic)', oracle);
    const meanOf = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
    const realized = summarizeCell(best.filter(r => r.defense === 'idle'));
    console.log(`  the expectation best response predicted ${pct(meanOf(predicted.map(p => p.pComplete)))} completion and ${pct(meanOf(predicted.map(p => p.pIntercept)))} interception over ${predicted.length} chosen throws; on held-out games it realized ${pct(realized.completion.p)} and ${pct(realized.interception.p)}`);
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
    predictions.length = 0;
    const bestStarts = STARTS.slice(0, Math.max(1, arg('br', 4)));
    const best = runMatrix({ strategies: [BEST_RESPONSE], defenses: ['idle', 'attentive'], seeds: [1, 2, 3], starts: bestStarts });
    const predicted = predictions.slice();
    const oracle = runMatrix({ strategies: [ORACLE_BEST_RESPONSE], defenses: ['idle', 'attentive'], seeds: [1, 2, 3], starts: bestStarts });
    const all = cells([...records, ...best]);
    printMatrix(all, ['idle', 'attentive', 'cover']);
    printBestResponse(best, oracle, predicted);
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
    if (out >= 0) writeFileSync(process.argv[out + 1]!, JSON.stringify({ seeds, cells: all, oracle: cells(oracle), imbalances: findings, games: gameRows }, null, 2));
}
if (process.argv[1] && /passing-report\.ts$/.test(process.argv[1].replace(/\\/g, '/'))) main();
