/**
 * `npm --prefix arcade run balance:coverage` prints what Phase C1b-2a changes and what it must not: how open receivers are, how the passing windows look by distance, timing
 * and route, how coverage and speed ratings move the game, how the quick and deep games trade off, how offenses that need different amounts of room fare against each
 * defensive behaviour, and how long a game takes. It describes the rules against scripted players; it asserts nothing and changes nothing. The same script runs on any
 * earlier commit, which is how the before-and-after tables in BALANCE.md were made.
 *
 *   --seeds N    seeds per strategy and defense in the drive matrix (default 6; 14 drives per seed)
 *   --games N    regulation games to time (default 3; about 2 s each)
 *   --json FILE  also write the numbers to FILE
 */
import { writeFileSync } from 'node:fs';
import { drive, game, minutes, OFFENSES, type DefensePolicy } from './sim';
import { cells, runMatrix } from './matrix';
import * as strategies from './strategies';
import { sweep, tickRange, byDistance, byRoute, byTiming, rates, type ThrowRecord, type Rates } from './window';
import { summarize } from './stats';
import { mix } from '../core/seed';

const arg = (name: string, fallback: number): number => { const i = process.argv.indexOf(`--${name}`); return i < 0 ? fallback : Number(process.argv[i + 1]); };
const pct = (x: number, d = 0) => `${(100 * x).toFixed(d)}%`;
const pad = (v: string | number, n: number) => String(v).padEnd(n);
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const DEF = ['DE1', 'DT1', 'DT2', 'DE2', 'OLB1', 'MLB', 'OLB2', 'CB1', 'CB2', 'CB3', 'FS', 'SS'].map(c => `away-${c}`);
const everyDefender = (patch: Record<string, number>) => Object.fromEntries(DEF.map(id => [id, patch]));
const edge = (id: string, speed: number) => ({ [id]: { speed, accel: speed } });
const out: Record<string, unknown> = {};

const line = (label: string, r: Rates) => `  ${pad(label, 24)} n=${String(r.throws).padStart(4)}  complete ${pct(r.complete.p).padStart(4)}  intercepted ${pct(r.interception.p).padStart(4)}  knocked down ${pct(r.breakup.p).padStart(4)}  yd/catch ${r.yardsPerCompletion.toFixed(1).padStart(5)}`;
const thrown = (rs: readonly ThrowRecord[]) => rs.filter(r => r.outcome !== 'sack');
const share = (rs: readonly ThrowRecord[], f: (r: ThrowRecord) => boolean) => rs.filter(f).length / Math.max(1, rs.length);
const row = (label: string, rs: readonly ThrowRecord[]) => console.log(`  ${pad(label, 34)} complete ${pct(share(rs, r => r.outcome === 'complete')).padStart(4)}  int ${pct(share(rs, r => r.outcome === 'interception')).padStart(4)}  knocked down ${pct(share(rs, r => r.catchKind === 'breakup')).padStart(4)}   separation at throw ${mean(rs.map(r => r.separationAtThrow)).toFixed(1)} yd, at arrival ${mean(rs.map(r => r.separationAtArrival)).toFixed(1)} yd`);

// 1. windows
const pocket = thrown(sweep({ ticks: tickRange(0, 240, 4), seeds: [1, 2, 3, 4, 5, 6], stopAtArrival: true }));
console.log('=== 1. Passing windows: every route x throw moment (ticks 0-240 every 4, six seeds, AI defense) ===');
for (const [k, r] of byRoute(pocket)) console.log(line(k, r));
console.log('By throw timing:'); for (const b of byTiming(pocket)) console.log(line(b.label, b.rates));
console.log('By air distance (short < 12 yd, intermediate 12-22, deep 22+):'); for (const b of byDistance(pocket)) console.log(line(b.label, b.rates));
const first = (rs: ThrowRecord[], a: number, b: number) => rs.filter(r => r.throwTick >= a && r.throwTick < b);
console.log('Receiver separation (nearest defender): at the throw / at arrival');
for (const [label, a, b] of [['first second (ticks 0-59)', 0, 60], ['second second (60-119)', 60, 120], ['after (120+)', 120, 241]] as const) console.log(`  ${pad(label, 28)} ${mean(first(pocket, a, b).map(r => r.separationAtThrow)).toFixed(1)} yd / ${mean(first(pocket, a, b).map(r => r.separationAtArrival)).toFixed(1)} yd`);
console.log(`  all pocket throws            ${mean(pocket.map(r => r.separationAtThrow)).toFixed(1)} yd / ${mean(pocket.map(r => r.separationAtArrival)).toFixed(1)} yd`);
const quick = (play: 'slants' | 'go', a: number, b: number) => pocket.filter(r => r.play === play && r.throwTick >= a && r.throwTick < b);
console.log('Early quick-pass vulnerability (complete / intercepted):');
for (const play of ['slants', 'go'] as const) for (const [a, b] of [[0, 24], [24, 48]] as const) console.log(`  ${pad(`${play} thrown at ticks ${a}-${b - 1}`, 30)} ${pct(share(quick(play, a, b), r => r.outcome === 'complete'))} / ${pct(share(quick(play, a, b), r => r.outcome === 'interception'))}`);
out.windows = { throws: pocket.length, separationAtThrow: mean(pocket.map(r => r.separationAtThrow)), separationAtArrival: mean(pocket.map(r => r.separationAtArrival)), distance: byDistance(pocket).map(b => ({ label: b.label, complete: b.rates.complete.p, interception: b.rates.interception.p, breakup: b.rates.breakup.p })) };

// 2. ratings
const rated = (abilities: Record<string, Partial<Record<string, number>>>, extra: object = {}) => thrown(sweep({ ticks: tickRange(0, 140, 4), seeds: Array.from({ length: 12 }, (_, k) => k + 1), stopAtArrival: true, abilities, ...extra } as Parameters<typeof sweep>[0]));
console.log('\n=== 2. Defensive ratings (every defender; throws while the receiver runs his route) ===');
console.log('Coverage rating:'); for (const c of [20, 45, 76, 90, 99]) row(`coverage ${c}`, rated(everyDefender({ coverage: c })));
console.log('Hands rating (coverage unchanged): hands change interceptions into knock-downs, not completions, and move nobody'); for (const h of [0, 55, 99]) row(`hands ${h}`, rated(everyDefender({ hands: h })));
console.log('Receiver speed x corner speed, go to WR1 (throws 96-160, the receiver running with the corner):');
for (const w of [55, 70, 85, 99]) console.log(`  WR ${String(w).padStart(2)}: ` + [55, 74, 90].map(c => { const rs = thrown(sweep({ plays: ['go'], targets: [1], ticks: tickRange(96, 160, 4), seeds: Array.from({ length: 12 }, (_, k) => k + 1), stopAtArrival: true, abilities: { ...edge('home-WR1', w), ...edge('away-CB1', c) } })); return `CB ${c}: ${pct(share(rs, r => r.outcome === 'complete')).padStart(4)} (sep ${mean(rs.map(r => r.separationAtThrow)).toFixed(1)})`; }).join('   '));
console.log('Receiver speed x corner speed, slants to WR1 (throws 0-112):');
for (const w of [55, 70, 85, 99]) console.log(`  WR ${String(w).padStart(2)}: ` + [55, 74, 90].map(c => { const rs = thrown(sweep({ plays: ['slants'], targets: [1], ticks: tickRange(0, 112, 4), seeds: Array.from({ length: 12 }, (_, k) => k + 1), stopAtArrival: true, abilities: { ...edge('home-WR1', w), ...edge('away-CB1', c) } })); return `CB ${c}: ${pct(share(rs, r => r.outcome === 'complete')).padStart(4)} (sep ${mean(rs.map(r => r.separationAtThrow)).toFixed(1)})`; }).join('   '));

// 3. offenses x defenses
const seeds = Array.from({ length: arg('seeds', 6) }, (_, k) => k + 1);
const S = strategies as unknown as { timingAware?: (t: number) => import('./strategies').Strategy };
const timing = (t: number) => S.timingAware ? S.timingAware(t) : t === 5.5 ? strategies.TIMING_AWARE : null;
const timings = [3, 4, 5.5, 7].map(timing).filter((s): s is NonNullable<ReturnType<typeof timing>> => !!s);
const defenses: DefensePolicy[] = ['idle', 'chase', 'attentive', 'cover'];
console.log(`\n=== 3. Drives: offenses that need different room, against every defensive behaviour (${seeds.length} seeds x 7 starts x both teams = ${seeds.length * 14} drives per cell) ===`);
console.log(pad('offense', 28), pad('defense', 10), pad('points/drive [95% CI]', 24), pad('TD drives', 10), pad('completion', 11), pad('interception', 13), 'plays');
const matrix = cells(runMatrix({ strategies: [...timings, strategies.DEEP, strategies.SHORT, strategies.BALANCED], defenses, seeds }));
for (const c of matrix) console.log(pad(c.strategy, 28), pad(c.defense, 10), pad(`${c.points.mean.toFixed(2)} [${c.points.ci.lo.toFixed(2)}, ${c.points.ci.hi.toFixed(2)}]`, 24), pad(pct(c.touchdownDrives.p), 10), pad(pct(c.completion.p), 11), pad(pct(c.interception.p), 13), c.playsPerDrive.toFixed(1));
out.drives = matrix.map(c => ({ strategy: c.strategy, defense: c.defense, points: c.points.mean, td: c.touchdownDrives.p, completion: c.completion.p, interception: c.interception.p }));

// 4. pacing
const games = arg('games', 3);
if (games > 0) {
    console.log(`\n=== 4. Pacing: ${games} regulation games, balanced offense on both sides, attentive defense ===`);
    const rs = Array.from({ length: games }, (_, k) => game({ off: OFFENSES['balanced']!, def: 'attentive' }, { off: OFFENSES['balanced']!, def: 'attentive' }, undefined, mix(0xc0de, k)));
    const m = rs.map(g => minutes(g)), pts = rs.map(g => g.score.home + g.score.away);
    console.log(`  game length ${summarize(m).mean.toFixed(1)} min (${Math.min(...m).toFixed(1)}-${Math.max(...m).toFixed(1)}), ${summarize(pts).mean.toFixed(1)} points a game, ${mean(rs.map(g => g.stats.plays)).toFixed(0)} plays`);
    out.pacing = { minutes: summarize(m).mean, points: summarize(pts).mean };
}

// 5. best response calibration (only where the strategy records held-out values)
const P = strategies.predictions as unknown as { defense: DefensePolicy; pComplete: number; pCompleteHeldOut?: number }[];
if (P && 'HELD_OUT_SEEDS' in strategies) {
    P.length = 0;
    console.log('\n=== 5. Best response (practicable) calibration against held-out seeds ===');
    runMatrix({ strategies: [strategies.BEST_RESPONSE], defenses: ['idle'], seeds: [1, 2, 3], starts: [28, 50, 74] });
    const own = mean(P.map(p => p.pComplete)), held = mean(P.map(p => p.pCompleteHeldOut ?? NaN));
    console.log(`  ${P.length} chosen throws: own estimate ${pct(own, 1)}, the same throws on held-out seeds ${pct(held, 1)}, optimism ${pct(own - held, 1)}`);
    out.calibration = { throws: P.length, own, held };
}
void drive;
const json = process.argv.indexOf('--json');
if (json >= 0) writeFileSync(process.argv[json + 1]!, JSON.stringify(out, null, 1));
void rates;
