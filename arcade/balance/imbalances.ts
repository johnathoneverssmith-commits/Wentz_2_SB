/**
 * The known passing imbalances, measured. Each entry says what is wrong, how the framework detects it, and whether it is still open.
 *
 * Nothing here tunes the engine to make a test pass. A test asserts that every `open` entry IS detected today and that every `fixed` entry
 * is NOT, so the list cannot go stale in either direction: the pull request that fixes an imbalance changes its status to `fixed`
 * (and the test then proves the fix); a regression that brings a fixed one back fails the same test.
 */
import { CATCH_RADIUS } from '../core/behavior';
import { rates, sweep, tickRange, ticksToSack, type ThrowRecord } from './window';
import { percentile } from './stats';

export interface Evidence {
    /** Every pass play x receiver x throw moment across the whole pocket (ticks 0-240, every 4), line 40, defenders on AI, humans idle. */
    readonly pocket: readonly ThrowRecord[];
    /** The deep route to WR1 with the receiver's speed at 70 (the default) and at 80, ticks 0-160. */
    readonly deepAtSpeed70: readonly ThrowRecord[];
    readonly deepAtSpeed80: readonly ThrowRecord[];
    /** Ticks a pass play lasts when the quarterback never throws (the pocket's real length). */
    readonly ticksToSack: number;
}

export function gatherEvidence(): Evidence {
    return {
        pocket: sweep({ ticks: tickRange(0, 240, 4) }),
        deepAtSpeed70: sweep({ plays: ['go'], targets: [1], ticks: tickRange(0, 160, 4), abilities: { 'home-WR1': { speed: 70 } } }),
        deepAtSpeed80: sweep({ plays: ['go'], targets: [1], ticks: tickRange(0, 160, 4), abilities: { 'home-WR1': { speed: 80 } } }),
        ticksToSack: ticksToSack('slants'),
    };
}

export interface Detection { readonly present: boolean; readonly evidence: string }
export interface KnownImbalance {
    readonly id: string;
    readonly title: string;
    readonly status: 'open' | 'fixed';
    readonly why: string;
    detect(ev: Evidence): Detection;
}

const route = (ev: Evidence, play: string, target: number) => ev.pocket.filter(r => r.play === play && r.target === target);
const pct = (x: number) => `${(100 * x).toFixed(0)}%`;
const median = (xs: number[]) => percentile(xs, 0.5);

export const KNOWN_IMBALANCES: readonly KnownImbalance[] = [
    {
        id: 'deep-window-never-closes', status: 'open', title: 'Once a go route gets free, every throw completes',
        why: 'The corner trails about 3 yd behind from tick ~45 and reacts to the ball 36 ticks late, so he can never reach a ball thrown ahead of the receiver.',
        detect(ev) {
            const wr1 = rates(route(ev, 'go', 1)), wr2 = rates(route(ev, 'go', 2));
            return { present: wr1.openRun >= 20 && wr2.openRun >= 20, evidence: `go -> WR1: ${wr1.openRun} consecutive completions (${wr1.openRun * 4} ticks); go -> WR2: ${wr2.openRun} (${wr2.openRun * 4} ticks)` };
        },
    },
    {
        id: 'slants-wr1-dead-target', status: 'open', title: 'Slants to WR1 is almost never complete',
        why: 'The corner starts 7 yd deep on the route and the 10-yd cut never beats him; WR1 is permanently covered on this play.',
        detect(ev) { const r = rates(route(ev, 'slants', 1)); return { present: r.complete.p < 0.1, evidence: `slants -> WR1 completes ${pct(r.complete.p)} (${r.complete.k}/${r.throws}), 95% interval ${pct(r.complete.ci.lo)}-${pct(r.complete.ci.hi)}` }; },
    },
    {
        id: 'early-slants-intercepted', status: 'open', title: 'A slants throw in the first third of a second is intercepted',
        why: 'The throw leads the receiver to a point inside the corner\'s cushion before the receiver has made his cut.',
        detect(ev) {
            const early = ev.pocket.filter(r => r.play === 'slants' && r.throwTick < 20), picked = early.filter(r => r.outcome === 'interception').length;
            return { present: early.length > 0 && picked / early.length >= 0.8, evidence: `slants throws before tick 20: ${picked}/${early.length} intercepted (${pct(picked / Math.max(1, early.length))})` };
        },
    },
    {
        id: 'go-tight-end-intercepted', status: 'open', title: 'The tight end on the go play is a turnover',
        why: 'The tight end\'s 14-yd route runs into the linebackers and safety zones, which take the ball.',
        detect(ev) { const r = rates(route(ev, 'go', 3)); return { present: r.interception.p >= 0.5, evidence: `go -> TE1 intercepted ${pct(r.interception.p)} (${r.interception.k}/${r.throws}), completed ${pct(r.complete.p)}` }; },
    },
    {
        id: 'flight-time-constant', status: 'open', title: 'Every pass is in the air for exactly one second',
        why: 'The ball\'s duration is fixed, so a 44-yd throw flies at 44 yd/s and a 7-yd throw at 7 yd/s: distance costs nothing.',
        detect(ev) {
            const thrown = ev.pocket.filter(r => r.outcome !== 'sack'), flights = new Set(thrown.map(r => r.flightSeconds));
            const air = thrown.map(r => r.airYards), spread = Math.max(...air) - Math.min(...air);
            return { present: flights.size === 1 && spread >= 25, evidence: `flight times: ${[...flights].join(', ')} s; air distance ${Math.min(...air).toFixed(1)}-${Math.max(...air).toFixed(1)} yd` };
        },
    },
    {
        id: 'overthrow-catch-knife-edge', status: 'open', title: 'A deep catch is decided by a 0.1-yard margin, not by the defense',
        why: 'The throw leads the receiver by 20% more than he can run (PASS_LEAD 1.2), so he arrives about 1.5 yd short, and the catch radius is 1.6 yd.',
        detect(ev) {
            const gaps = ev.pocket.filter(r => r.play === 'go' && r.target !== 3 && r.outcome === 'complete').map(r => r.receiverGap), m = median(gaps);
            return { present: gaps.length > 0 && m >= 1.3 && m < CATCH_RADIUS, evidence: `median receiver-to-ball gap on completed go throws ${m.toFixed(2)} yd against a catch radius of ${CATCH_RADIUS} yd (${gaps.length} catches)` };
        },
    },
    {
        id: 'faster-receiver-worse-deep-game', status: 'open', title: 'A faster receiver makes the deep ball worse',
        why: 'The 20% overthrow grows with speed and passes the catch radius: at receiver speed 80 no go throw is complete.',
        detect(ev) {
            const a = rates(ev.deepAtSpeed70).complete.p, b = rates(ev.deepAtSpeed80).complete.p;
            return { present: b < a, evidence: `go -> WR1 completes ${pct(a)} at receiver speed 70 and ${pct(b)} at speed 80` };
        },
    },
    {
        id: 'deep-ball-uncontested', status: 'open', title: 'Defenders are nowhere near the deep catch',
        why: 'The nearest defender is about 4 yd from the landing point when the ball arrives: no defender, safety or corner, contests it.',
        detect(ev) {
            const gaps = ev.pocket.filter(r => r.play === 'go' && r.target !== 3 && r.outcome === 'complete').map(r => r.defenderGap), m = median(gaps);
            return { present: gaps.length > 0 && m >= 3, evidence: `median nearest-defender-to-ball distance on completed go throws: ${m.toFixed(1)} yd` };
        },
    },
    {
        id: 'pocket-never-collapses', status: 'open', title: 'The quarterback has four seconds before the first sack',
        why: 'Blocks hold long enough that nothing forces a throw; waiting for the one open window is free.',
        detect(ev) { return { present: ev.ticksToSack >= 200, evidence: `an unthrown pass play ends in a sack at tick ${ev.ticksToSack} (${(ev.ticksToSack / 60).toFixed(1)} s)` }; },
    },
    {
        id: 'slants-tight-end-loses-yards', status: 'open', title: 'The tight end\'s slants catch is behind the line',
        why: 'His 2-4 yd route ends at the line of scrimmage, so a completion gains nothing or loses ground.',
        detect(ev) {
            const done = route(ev, 'slants', 3).filter(r => r.outcome === 'complete'), mean = done.reduce((a, r) => a + r.yards, 0) / Math.max(1, done.length);
            return { present: done.length > 0 && mean < 2, evidence: `slants -> TE1 completions average ${mean.toFixed(1)} yd (${done.length} catches)` };
        },
    },
];

export const imbalanceById = (id: string): KnownImbalance => { const k = KNOWN_IMBALANCES.find(x => x.id === id); if (!k) throw new Error(`unknown imbalance ${id}`); return k; };
