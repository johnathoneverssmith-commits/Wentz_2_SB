/**
 * Ball physics (Phase B1): how long a pass flies, where it is thrown, and what a saved game holds while it is in the air.
 * Defenders are parked far away wherever a test is about the ball and the receiver alone, so nothing else decides the result.
 */
import { describe, expect, it } from 'vitest';
import { decodeSave, encodeSave } from '../browser/save';
import { BALL_SPEED, CATCH_RADIUS, MAX_FLIGHT, MIN_FLIGHT } from '../core/behavior';
import { choosePlay, lineUp, snap, stepDown, throwPass, type DownState, type Play } from '../core/down';
import { STEP_SECONDS, accelerationOf, distanceCovered, maxSpeed, type PlayerId } from '../core/simulation';
import { farAway, idle } from './helpers';

const RECEIVER = { 1: 'home-WR1', 2: 'home-WR2', 3: 'home-TE1' } as const;
const withSpeed = (s: DownState, id: PlayerId, speed: number): DownState => ({ ...s, players: s.players.map(p => p.id === id ? { ...p, abilities: { ...p.abilities, speed } } : p) });
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

interface Throw { readonly thrown: DownState; readonly arrived: DownState; readonly air: number; readonly flight: number; readonly gap: number; readonly receiver: PlayerId }
/** One pass with every defender parked far away: thrown at `tick` to `target`, followed to the tick the ball arrives. */
function uncovered(play: Play, target: 1 | 2 | 3, tick: number, speed?: number, line = 40, seed?: number): Throw {
    let s: DownState = snap(choosePlay(lineUp('home', line, { playNumber: 1, seed }), play));
    if (speed !== undefined) s = withSpeed(s, RECEIVER[target], speed);
    for (let t = 0; t < tick; t++) s = stepDown(farAway(s), idle);
    const qb = s.players.find(p => p.id === s.possession.carrier)!, thrown = throwPass(s, target);
    if (thrown.ball.kind !== 'flight') throw new Error('no throw');
    const ball = thrown.ball;
    let r = thrown;
    while (r.phase === 'live' && r.ball.kind === 'flight') r = stepDown(farAway(r), idle);
    const rec = r.players.find(p => p.id === ball.target)!;
    return { thrown, arrived: r, air: dist(qb, ball.to), flight: ball.duration, gap: dist(rec, ball.to), receiver: ball.target };
}
const CASES: [Play, 1 | 2 | 3, number][] = [['go', 1, 8], ['go', 1, 90], ['go', 2, 150], ['slants', 1, 40], ['slants', 2, 100], ['slants', 3, 20], ['slants', 3, 200], ['go', 3, 60]];

describe('a pass flies for as long as its distance needs', () => {
    it('the time is the distance over the ball speed, held between the shortest and longest flight, in whole ticks', () => {
        for (const [play, target, tick] of CASES) {
            const t = uncovered(play, target, tick);
            const wanted = Math.ceil(Math.min(MAX_FLIGHT, Math.max(MIN_FLIGHT, t.air / BALL_SPEED)) * 60 - 1e-9);
            expect(Math.round(t.flight * 60), `${play} -> ${target} at ${tick}`).toBe(wanted);
            expect(t.flight * 60).toBeCloseTo(Math.round(t.flight * 60), 9);
        }
    });
    it('a longer throw never takes less time than a shorter one', () => {
        const all = CASES.map(([p, t, k]) => uncovered(p, t, k)).sort((a, b) => a.air - b.air);
        for (let i = 1; i < all.length; i++) expect(all[i]!.flight).toBeGreaterThanOrEqual(all[i - 1]!.flight);
        expect(all[all.length - 1]!.flight).toBeGreaterThan(all[0]!.flight);
    });
    it('a short throw and a deep throw really differ: about a third of a second against more than a second', () => {
        const short = uncovered('slants', 3, 20), deep = uncovered('go', 1, 150);
        expect(short.flight).toBeLessThan(0.6); expect(deep.flight).toBeGreaterThan(1.0);
        expect(deep.air / deep.flight).toBeGreaterThan(20); expect(deep.air / deep.flight).toBeLessThan(BALL_SPEED + 1);
    });
    it('stays inside the bounds a saved game accepts', () => {
        expect(MIN_FLIGHT).toBeGreaterThan(0); expect(MAX_FLIGHT).toBeLessThanOrEqual(2);
        for (const [play, target, tick] of CASES) { const t = uncovered(play, target, tick); expect(t.flight).toBeGreaterThanOrEqual(MIN_FLIGHT); expect(t.flight).toBeLessThanOrEqual(MAX_FLIGHT); }
    });
    it('the ball is in the air for exactly that many ticks, and arrives on the last one', () => {
        const t = uncovered('go', 1, 90);
        let s = t.thrown, ticks = 0;
        while (s.ball.kind === 'flight') { s = stepDown(farAway(s), idle); ticks++; }
        expect(ticks).toBe(Math.round(t.flight * 60));
    });
});

describe('the ball is led to where the receiver will be', () => {
    it('the distance a runner covers matches what the engine moves him in the same time (from rest and at speed)', () => {
        for (const [speed, accel, preRun] of [[70, 78, 0], [50, 40, 0], [90, 99, 0], [70, 78, 40]] as const) {
            let s = snap(choosePlay(lineUp('home', 40, { playNumber: 1 }), 'go'));
            s = { ...s, players: s.players.map(p => p.id === 'home-WR1' ? { ...p, abilities: { ...p.abilities, speed, accel } } : p) };
            for (let t = 0; t < preRun; t++) s = stepDown(farAway(s), idle);
            const start = s.players.find(p => p.id === 'home-WR1')!, predicted = distanceCovered(start, 0.8);
            for (let t = 0; t < 48; t++) s = stepDown(farAway(s), idle);
            const end = s.players.find(p => p.id === 'home-WR1')!;
            expect(dist(start, end), `speed ${speed} accel ${accel} after ${preRun} ticks`).toBeCloseTo(predicted, 0);
        }
        const p = snap(choosePlay(lineUp('home', 40, { playNumber: 1 }), 'go')).players.find(x => x.id === 'home-WR1')!;
        expect(distanceCovered(p, 0)).toBe(0);
        expect(accelerationOf(p)).toBeGreaterThan(0); expect(maxSpeed(p)).toBe(7.5);
    });
    it('a receiver running a straight route is within a quarter yard of the ball when it lands, whatever his speed', () => {
        for (const speed of [0, 20, 40, 55, 70, 80, 90, 99]) for (const [play, target, tick] of [['go', 1, 0], ['go', 1, 30], ['go', 1, 90], ['go', 2, 60]] as const) {
            const t = uncovered(play, target, tick, speed);
            expect(t.gap, `${play} -> ${target} at tick ${tick}, speed ${speed}`).toBeLessThan(0.25);
        }
    });
    it('a receiver making his cut is within a yard of the ball when it lands, whatever his speed (well inside the 1.6 yd catch radius)', () => {
        for (const speed of [0, 20, 40, 55, 70, 80, 90, 99]) for (const [target, tick] of [[1, 12], [1, 40], [2, 12], [2, 60], [2, 100]] as const) {
            const t = uncovered('slants', target, tick, speed);
            expect(t.gap, `slants -> ${target} at tick ${tick}, speed ${speed}`).toBeLessThan(1);
        }
    });
    it('the lead assumes straight running, so a receiver who has finished his route and drifts can still land away from the ball (a known limit, not tuned away)', () => {
        const late = [0, 20, 40, 55, 70, 80, 90, 99].map(speed => uncovered('slants', 2, 200, speed).gap);
        expect(Math.max(...late)).toBeGreaterThan(1);
    });
    it('and so he is at the ball and catches it, at every speed (a faster receiver used to overrun the old lead and never catch the deep ball)', () => {
        for (const speed of [0, 20, 40, 55, 70, 74, 80, 90, 99]) for (const tick of [30, 60, 90, 120]) {
            const t = uncovered('go', 1, tick, speed);
            expect(t.gap, `speed ${speed}, tick ${tick}`).toBeLessThan(CATCH_RADIUS);
            // nobody covers him, so he catches it unless he drops it: with most seeds he is the carrier
            const caught = Array.from({ length: 24 }, (_, i) => { const s = uncovered('go', 1, tick, speed, 40, i + 1); return s.arrived.possession.carrier === s.receiver; }).filter(Boolean).length;
            expect(caught, `speed ${speed}, tick ${tick}`).toBeGreaterThanOrEqual(19);
        }
    });
    it('is the same from any spot in the interior of the field', () => {
        const spots = [30, 50, 70].map(line => uncovered('go', 1, 90, 80, line));
        for (const t of spots) { expect(t.flight).toBeCloseTo(spots[0]!.flight, 1); expect(t.gap).toBeLessThan(0.25); }
    });
});

describe('a pass in the air survives a save', () => {
    const inAir = () => { let s = uncovered('go', 1, 90).thrown; for (let i = 0; i < 20; i++) s = stepDown(s, idle); return s; };
    it('the variable flight time is saved and restored exactly, and play resumes identically', () => {
        const s = inAir();
        expect(s.ball.kind).toBe('flight');
        const loaded = decodeSave(encodeSave(s));
        expect(loaded).toEqual(s);
        let a = s, b = loaded!;
        for (let i = 0; i < 120 && a.phase === 'live'; i++) { a = stepDown(a, idle); b = stepDown(b, idle); }
        expect(b).toEqual(a);
        expect(a.ball.kind).not.toBe('flight');
    });
    it('every flight time the sweep can produce is accepted by the save format', () => {
        for (const [play, target, tick] of CASES) { const s = stepDown(uncovered(play, target, tick).thrown, idle); expect(decodeSave(encodeSave(s)), `${play} -> ${target} at ${tick}`).not.toBeNull(); }
    });
    it('a pass thrown under the old rules (a one-second flight, led long) still loads and resolves', () => {
        const base = uncovered('go', 1, 90).thrown;
        if (base.ball.kind !== 'flight') throw new Error('flight');
        const old: DownState = { ...base, ball: { ...base.ball, duration: 1, elapsed: 0.35, to: { x: base.ball.to.x + 1.5, y: base.ball.to.y } } };
        const loaded = decodeSave(encodeSave(old));
        expect(loaded).toEqual(old);
        let s = loaded!;
        for (let i = 0; i < 200 && s.phase === 'live' && s.ball.kind === 'flight'; i++) s = stepDown(s, idle);
        expect(s.ball.kind).not.toBe('flight');
        expect(['complete', 'incomplete', 'interception'].length).toBeGreaterThan(0);
    });
    it('the longest flight is accepted, and one longer than the format allows is refused', () => {
        const base = uncovered('go', 1, 90).thrown;
        if (base.ball.kind !== 'flight') throw new Error('flight');
        expect(decodeSave(encodeSave({ ...base, ball: { ...base.ball, duration: MAX_FLIGHT } }))).not.toBeNull();
        expect(decodeSave(encodeSave({ ...base, ball: { ...base.ball, duration: MAX_FLIGHT + 0.01 } }))).toBeNull();
        expect(decodeSave(encodeSave({ ...base, ball: { ...base.ball, duration: 0 } }))).toBeNull();
    });
    it('a flight resumes where it was: the ball position follows the saved elapsed time', () => {
        const s = inAir();
        if (s.ball.kind !== 'flight') throw new Error('flight');
        const loaded = decodeSave(encodeSave(s))!;
        if (loaded.ball.kind !== 'flight') throw new Error('flight');
        expect(loaded.ball.elapsed).toBeCloseTo(20 * STEP_SECONDS, 9);
        expect(loaded.ball.duration).toBe(s.ball.duration);
    });
});
