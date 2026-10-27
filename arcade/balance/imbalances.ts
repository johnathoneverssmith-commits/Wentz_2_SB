/**
 * The known passing imbalances, measured. Each entry says what is wrong, how the framework detects it, and whether it is still open.
 *
 * Nothing here tunes the engine to make a test pass. A test asserts that every `open` entry IS detected today and that every `fixed` entry
 * is NOT, so the list cannot go stale in either direction: the pull request that fixes an imbalance changes its status to `fixed`
 * (and the test then proves the fix); a regression that brings a fixed one back fails the same test.
 */
import { CATCH_RADIUS } from '../core/behavior';
import { isDeep, rates, sweep, tickRange, ticksToSack, type ThrowRecord } from './window';
import { percentile } from './stats';

export interface Evidence {
    /** Every pass play x receiver x throw moment across the whole pocket (ticks 0-240, every 4), line 40, defenders on AI, humans idle. */
    readonly pocket: readonly ThrowRecord[];
    /** The deep route to WR1 with the receiver's speed at 70 (the default) and at 80, ticks 0-160. */
    readonly deepAtSpeed70: readonly ThrowRecord[];
    readonly deepAtSpeed80: readonly ThrowRecord[];
    /** The deep route to WR1 with a receiver 25 speed points faster than the corner (99 against 74), ticks 0-240. */
    readonly deepWithSpeedEdge: readonly ThrowRecord[];
    /** Ticks a pass play lasts when the quarterback never throws (the pocket's real length). */
    readonly ticksToSack: number;
}

/** Catches are chance, so every measurement is taken over these game seeds (not one trajectory). */
export const EVIDENCE_SEEDS: readonly number[] = [1, 2, 3, 4, 5, 6];
export function gatherEvidence(): Evidence {
    const seeds = EVIDENCE_SEEDS;
    return {
        pocket: sweep({ ticks: tickRange(0, 240, 4), seeds }),
        deepAtSpeed70: sweep({ plays: ['go'], targets: [1], ticks: tickRange(0, 160, 4), seeds, abilities: { 'home-WR1': { speed: 70 } } }),
        deepAtSpeed80: sweep({ plays: ['go'], targets: [1], ticks: tickRange(0, 160, 4), seeds, abilities: { 'home-WR1': { speed: 80 } } }),
        deepWithSpeedEdge: sweep({ plays: ['go'], targets: [1], ticks: tickRange(0, 240, 4), seeds, abilities: { 'home-WR1': { speed: 99 } } }),
        ticksToSack: ticksToSack('slants'),
    };
}

export interface Detection { readonly present: boolean; readonly evidence: string }
export interface KnownImbalance {
    readonly id: string;
    readonly title: string;
    readonly status: 'open' | 'fixed';
    readonly why: string;
    /** For a fixed entry: what changed it, with the numbers before and after. */
    readonly resolution?: string;
    detect(ev: Evidence): Detection;
}

const route = (ev: Evidence, play: string, target: number) => ev.pocket.filter(r => r.play === play && r.target === target);
const pct = (x: number) => `${(100 * x).toFixed(0)}%`;
const median = (xs: number[]) => percentile(xs, 0.5);

export const KNOWN_IMBALANCES: readonly KnownImbalance[] = [
    {
        id: 'deep-window-never-closes', status: 'fixed', resolution: 'Phase B2: the corner no longer trails a beaten route 3 yd behind for its whole length: he plays off the receiver while he is shallow and closes the cushion as he goes deep. The go routes are now covered (0% complete at baseline ratings), which is its own entry: deep-routes-closed-at-equal-speed.', title: 'Once a go route gets free, every throw completes',
        why: 'The corner trails about 3 yd behind from tick ~45 and reacts to the ball 36 ticks late, so he can never reach a ball thrown ahead of the receiver.',
        detect(ev) {
            const wr1 = rates(route(ev, 'go', 1)), wr2 = rates(route(ev, 'go', 2));
            return { present: wr1.openRun >= 20 && wr2.openRun >= 20, evidence: `go -> WR1: ${wr1.openRun} consecutive completions (${wr1.openRun * 4} ticks); go -> WR2: ${wr2.openRun} (${wr2.openRun * 4} ticks)` };
        },
    },
    {
        id: 'slants-wr1-dead-target', status: 'fixed', resolution: 'Phase B1 (exact receiver leading), as a side effect: slants to WR1 went from 3% to 43% complete. The old 20% overthrow had been putting the ball past a corner who now sits on the receiver.', title: 'Slants to WR1 is almost never complete',
        why: 'The corner starts 7 yd deep on the route and the 10-yd cut never beats him; WR1 is permanently covered on this play.',
        detect(ev) { const r = rates(route(ev, 'slants', 1)); return { present: r.complete.p < 0.1, evidence: `slants -> WR1 completes ${pct(r.complete.p)} (${r.complete.k}/${r.throws}), 95% interval ${pct(r.complete.ci.lo)}-${pct(r.complete.ci.hi)}` }; },
    },
    {
        id: 'early-slants-intercepted', status: 'fixed', resolution: 'Phase B2: slants thrown before tick 20 are now intercepted 3/15 times (20%), down from 14/15 (93%): the corner no longer jumps forward to a 7-yd cushion at the snap, so the ball is not thrown into him.', title: 'A slants throw in the first third of a second is intercepted',
        why: 'The throw leads the receiver to a point inside the corner\'s cushion before the receiver has made his cut.',
        detect(ev) {
            const early = ev.pocket.filter(r => r.play === 'slants' && r.throwTick < 20), picked = early.filter(r => r.outcome === 'interception').length;
            return { present: early.length > 0 && picked / early.length >= 0.8, evidence: `slants throws before tick 20: ${picked}/${early.length} intercepted (${pct(picked / Math.max(1, early.length))})` };
        },
    },
    {
        id: 'go-tight-end-intercepted', status: 'fixed', resolution: 'Phase C1b-1: catches are a seeded sequence of decisions, not a radius: the tight end on the go play is intercepted 16% of the time (it was 80%) and completes 28% (it was 2%). Provisional until C1b-2 re-measures.', title: 'The tight end on the go play is a turnover',
        why: 'The tight end\'s 14-yd route runs into the linebackers and safety zones, which take the ball.',
        detect(ev) { const r = rates(route(ev, 'go', 3)); return { present: r.interception.p >= 0.5, evidence: `go -> TE1 intercepted ${pct(r.interception.p)} (${r.interception.k}/${r.throws}), completed ${pct(r.complete.p)}` }; },
    },
    {
        id: 'flight-time-constant', status: 'fixed', resolution: 'Phase B1: a pass flies for as long as its distance needs (BALL_SPEED 26 yd/s, 0.35-2.0 s, whole ticks). Flight times now run 0.37-1.72 s across the pocket sweep, median 0.82 s.', title: 'Every pass is in the air for exactly one second',
        why: 'The ball\'s duration is fixed, so a 44-yd throw flies at 44 yd/s and a 7-yd throw at 7 yd/s: distance costs nothing.',
        detect(ev) {
            const thrown = ev.pocket.filter(r => r.outcome !== 'sack'), flights = new Set(thrown.map(r => r.flightSeconds));
            const air = thrown.map(r => r.airYards), spread = Math.max(...air) - Math.min(...air);
            return { present: flights.size === 1 && spread >= 25, evidence: `${flights.size === 1 ? `every flight is ${[...flights][0]} s` : `${flights.size} different flight times, ${Math.min(...flights).toFixed(2)}-${Math.max(...flights).toFixed(2)} s`}; air distance ${Math.min(...air).toFixed(1)}-${Math.max(...air).toFixed(1)} yd` };
        },
    },
    {
        id: 'overthrow-catch-knife-edge', status: 'fixed', resolution: 'Phase B1: the ball is led to exactly where the receiver will be (PASS_LEAD 1). The median receiver-to-ball gap on completed deep throws went from 1.50 yd to 0.00 yd, so a catch no longer depends on a margin against the catch radius.', title: 'A deep catch is decided by a 0.1-yard margin, not by the defense',
        why: 'The throw leads the receiver by 20% more than he can run (PASS_LEAD 1.2), so he arrives about 1.5 yd short, and the catch radius is 1.6 yd.',
        detect(ev) {
            const gaps = ev.pocket.filter(r => r.play === 'go' && r.target !== 3 && r.outcome === 'complete').map(r => r.receiverGap), m = median(gaps);
            return { present: gaps.length > 0 && m >= 1.3 && m < CATCH_RADIUS, evidence: `median receiver-to-ball gap on completed go throws ${m.toFixed(2)} yd against a catch radius of ${CATCH_RADIUS} yd (${gaps.length} catches)` };
        },
    },
    {
        id: 'faster-receiver-worse-deep-game', status: 'fixed', resolution: 'Phase B1: go to WR1 completes 95% at receiver speed 70 and at 80 (it was 76% and 0%).', title: 'A faster receiver makes the deep ball worse',
        why: 'The 20% overthrow grows with speed and passes the catch radius: at receiver speed 80 no go throw is complete.',
        detect(ev) {
            const a = rates(ev.deepAtSpeed70).complete.p, b = rates(ev.deepAtSpeed80).complete.p;
            return { present: b < a - 0.05, evidence: `go -> WR1 completes ${pct(a)} at receiver speed 70 and ${pct(b)} at speed 80` };
        },
    },
    {
        id: 'deep-ball-uncontested', status: 'fixed', resolution: 'Partly, by Phase B1: the median distance from the nearest defender to a completed deep catch fell from 4.1 yd to 2.7 yd because the ball now arrives with the receiver. Every completed deep catch still has no defender inside the break-up radius, and the deep window still never closes; that is tracked by deep-window-never-closes.', title: 'Defenders are nowhere near the deep catch',
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
        id: 'slants-tight-end-loses-yards', status: 'fixed', resolution: 'Phase C1b-1: a catch no longer needs the receiver to be 2.2 yd clear of every defender, so the tight end is no longer only open when he has drifted behind the line: completions average 0.0 yd (they were -0.5). Provisional until C1b-2 re-measures.', title: "The tight end's slants catch is behind the line",
        why: 'His 2-4 yd route ends at the line of scrimmage, so a completion gains nothing or loses ground (a catch behind the line).',
        detect(ev) {
            const done = route(ev, 'slants', 3).filter(r => r.outcome === 'complete'), mean = done.reduce((a, r) => a + r.yards, 0) / Math.max(1, done.length);
            return { present: done.length > 0 && mean < 0, evidence: `slants -> TE1 completions average ${mean.toFixed(1)} yd (${done.length} catches)` };
        },
    },
    {
        id: 'slants-wr2-always-broken-up', status: 'fixed', resolution: 'Phase B2: slants to WR2 completes 15% (it was 7% after B1 and 33% before). The corner keeps the depth he lined up at while the receiver is shallow, so the quick window now exists; the rest of the route runs into the safeties.', title: 'Slants to WR2 is almost always broken up',
        why: 'With the ball led exactly (Phase B1) the receiver is at the ball and the corner shadows him about 2 yd away, inside the 2.2 yd break-up radius. It was 33% complete when the old overthrow put the ball past the corner. A coverage and catch-rule question for the next phases.',
        detect(ev) { const r = rates(route(ev, 'slants', 2)); return { present: r.complete.p < 0.1, evidence: `slants -> WR2 completes ${pct(r.complete.p)} (${r.complete.k}/${r.throws}), intercepted ${pct(r.interception.p)}` }; },
    },
    {
        id: 'tight-end-dump-off-always-open', status: 'fixed', resolution: 'Phase B2: linebackers with the tight end assigned follow him, and slants to the tight end complete 41% (80% after B1) with a longest open run of 20 (34).', title: 'The tight end underneath is always open',
        why: 'Underneath, the tight end is not covered by a corner or a safety: on slants he is free from tick ~16 and from tick ~100 on every throw completes, so a patient dump-off drive moves the ball down the field with no risk.',
        detect(ev) { const r = rates(route(ev, 'slants', 3)); return { present: r.complete.p >= 0.7 && r.openRun >= 25, evidence: `slants -> TE1 completes ${pct(r.complete.p)} with a run of ${r.openRun} consecutive completions, intercepted ${pct(r.interception.p)}` }; },
    },
    {
        id: 'quick-slants-always-open', status: 'open', title: 'A quick slants throw to either wideout completes every time',
        why: 'The corner lines up about 10 yd off and needs a quarter of a second to see the ball: a throw in the first half-second lands before he can get to it. With no randomness, a player who repeats it wins every drive.',
        detect(ev) {
            const quick = (target: number) => ev.pocket.filter(r => r.play === 'slants' && r.target === target && r.throwTick < 24), done = (rs: ThrowRecord[]) => rs.filter(r => r.outcome === 'complete').length / rs.length;
            const a = done(quick(1)), b = done(quick(2));
            return { present: a >= 0.8 && b >= 0.8, evidence: `slants thrown before tick 24 complete ${pct(a)} to WR1 and ${pct(b)} to WR2` };
        },
    },
    {
        id: 'deep-routes-closed-at-equal-speed', status: 'fixed', resolution: 'Phase B2: the committed corner trails at the hip of the receiver (2.5 yd behind) instead of staying 1.2 yd in front, so a receiver with a speed edge gets past him. Deep throws (landing 20+ yd downfield, receiver at pace) complete 0% at baseline in the old model and about 10% with equal-ish athletes now, 26% with a real edge.', title: 'The deep route is covered at baseline ratings, and a speed edge barely opens it',
        why: 'The corner started about 10 yd off and stayed 1.2 yd in front of the receiver, so he was nearer every ball led to the receiver than the receiver was: a speed edge of 25 points gains about 1.25 yd/s on a 10 yd cushion, and the 31-yd route and the 4 s pocket run out first.',
        detect(ev) {
            const base = rates(ev.pocket.filter(r => r.play === 'go' && (r.target === 1 || r.target === 2) && isDeep(r))), edge = rates(ev.deepWithSpeedEdge.filter(isDeep));
            return { present: base.complete.p < 0.05 && edge.complete.p < 0.1, evidence: `deep go throws to a wideout complete ${pct(base.complete.p)} at baseline and ${pct(edge.complete.p)} for a receiver 25 speed points faster than the corner` };
        },
    },
    {
        id: 'deep-interceptions-high', status: 'fixed', resolution: 'Phase C1b-1: a defender inside the old interception radius no longer always takes the ball, and taking it away needs his hands: deep go throws to a wideout are intercepted 19% of the time (35%) and complete 46% (8%). Provisional until C1b-2 re-measures.', title: 'Deep throws are intercepted about as often as they are caught',
        why: 'A deep ball thrown while the corner is still in front of the receiver (before the receiver has run past him) lands where the corner is nearer than the receiver, so he intercepts it; any defender inside 1.6 yd of the landing point intercepts even when the receiver is closer to it. The first half is coverage and is right; the second is catch resolution, left for the seeded catch model (Phase C).',
        detect(ev) { const r = rates(ev.pocket.filter(x => x.play === 'go' && (x.target === 1 || x.target === 2) && isDeep(x))); return { present: r.interception.p >= 0.25, evidence: `deep go throws to a wideout are intercepted ${pct(r.interception.p)} of the time and complete ${pct(r.complete.p)}` }; },
    },
    {
        id: 'offense-completes-most-passes', status: 'open', title: 'Every route completes about half of its throws or more',
        why: 'With catches decided by chance and not by a 2.2 yd radius, a defender who is only beside the ball no longer ends the play. The defenders\' standoffs (1.9 yd beside the ball) were set for the old radii, and nothing yet makes a throw hard to make (accuracy, pressure: C2, C3), so the scripted timing-aware offense scores a touchdown on most drives. Expected, and left for C1b-2 to assess, not tuned.',
        detect(ev) {
            const routes: [string, number][] = [['slants', 1], ['slants', 2], ['slants', 3], ['go', 1], ['go', 2]];
            const rs = routes.map(([play, target]) => rates(route(ev, play, target)).complete.p);
            return { present: rs.every(p => p >= 0.45), evidence: `completion by route over the whole pocket: slants ${rs.slice(0, 3).map(pct).join('/')}, go ${rs.slice(3).map(pct).join('/')} (WR1/WR2/TE1, WR1/WR2)` };
        },
    },
];

export const imbalanceById = (id: string): KnownImbalance => { const k = KNOWN_IMBALANCES.find(x => x.id === id); if (!k) throw new Error(`unknown imbalance ${id}`); return k; };
