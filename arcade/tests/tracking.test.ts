/**
 * Receiver tracking and ball leading (Phase C1b-2b). The receiver the ball is thrown to reads it and runs to where it lands, aimed through the catch point; a corner plays
 * to the inside of a receiver by more than a body, so the two do not collide on every step. Each rule has a negative control, and a faster receiver must gain from his speed.
 */
import { describe, expect, it } from 'vitest';
import { decodeSave, encodeSave } from '../browser/save';
import { MAN_LEVERAGE, CATCH_RADIUS } from '../core/behavior';
import { choosePlay, lineUp, snap, stepDown, throwPass, type DownState, type Play } from '../core/down';
import { BODY, EASE_YARDS, type PlayerId } from '../core/simulation';
import { sweep, tickRange, type ThrowRecord } from '../balance/window';
import { farAway, idle } from './helpers';

const start = (p: Play): DownState => snap(choosePlay(lineUp('home', 40, { playNumber: 1 }), p));
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
const at = (s: DownState, id: PlayerId) => s.players.find(p => p.id === id)!;
/** A go route thrown to WR1 at `tick` with every defender parked, the target then shoved `shove` yards sideways as the ball leaves, and the ball followed to its arrival. */
function shoved(tick: number, shove: number, speed = 80, target: PlayerId = 'home-WR1', seed?: number) {
    let s = start('go');
    s = { ...s, players: s.players.map(p => p.id === target ? { ...p, abilities: { ...p.abilities, speed } } : p) };
    for (let t = 0; t < tick; t++) s = stepDown(farAway(s), idle);
    s = throwPass(s, 1);
    if (s.ball.kind !== 'flight') throw new Error('no throw');
    const to = s.ball.to;
    s = { ...s, players: s.players.map(p => p.id === 'home-WR1' ? { ...p, y: p.y + shove } : p) };
    while (s.phase === 'live' && s.ball.kind === 'flight') s = stepDown(farAway(s), idle);
    return { s, gap: dist(at(s, 'home-WR1'), to), to, seed };
}
const rate = (rs: ThrowRecord[], f: (r: ThrowRecord) => boolean) => rs.filter(f).length / rs.length;

describe('the receiver reads the ball and goes to it', () => {
    it('a receiver knocked off the line the ball was led along still arrives at the ball, at any speed', () => {
        for (const speed of [40, 60, 80, 99]) for (const shove of [1.5, 3]) {
            const { gap } = shoved(60, shove, speed);
            expect(gap, `speed ${speed}, shoved ${shove} yd`).toBeLessThan(CATCH_RADIUS / 2);
        }
    });
    it('NEGATIVE CONTROL: the receiver who is not the target does not leave his route for the ball', () => {
        // WR2 is shoved the same way but the ball is for WR1, so nothing brings WR2 back: he stays where the shove (and his own route) put him
        let s = start('go');
        for (let t = 0; t < 60; t++) s = stepDown(farAway(s), idle);
        const withBall = throwPass(s, 1);
        if (withBall.ball.kind !== 'flight') throw new Error('no throw');
        const shove = (st: DownState): DownState => ({ ...st, players: st.players.map(p => p.id === 'home-WR2' || p.id === 'home-WR1' ? { ...p, y: p.y + 3 } : p) });
        let a: DownState = shove(withBall), b: DownState = shove(s);
        for (let t = 0; t < 20; t++) { a = stepDown(farAway(a), idle); b = stepDown(farAway(b), idle); }
        // the thrown-to receiver chases the ball; WR2 runs the same path with or without a ball in the air to someone else
        expect(dist(at(a, 'home-WR2'), at(b, 'home-WR2'))).toBeLessThan(0.05);
        // ...while the one the ball is for, shoved the same way, is brought back to it and so is somewhere else than he would be running his route
        expect(dist(at(a, 'home-WR1'), at(b, 'home-WR1'))).toBeGreaterThan(0.5);
    });
    it('he runs through the catch point at speed instead of easing off short of it', () => {
        // aimed at the point itself, the ease-in (core/simulation.ts) leaves a runner a fifth of a yard short with the ball arriving; aimed through it he is on it
        expect(EASE_YARDS).toBeGreaterThan(0);
        for (const speed of [0, 40, 70, 99]) expect(shoved(90, 0, speed).gap, `speed ${speed}`).toBeLessThan(0.1);
    });
    it('a receiver who has finished his route and would drift on is brought back to the ball', () => {
        for (const speed of [40, 70, 99]) expect(shoved(200, 0, speed).gap, `speed ${speed}`).toBeLessThan(0.75);
    });
    it('the play replays identically and survives a save while the ball is in the air to a receiver who has been shoved', () => {
        let s = start('go');
        for (let t = 0; t < 60; t++) s = stepDown(farAway(s), idle);
        s = throwPass(s, 1);
        s = { ...s, players: s.players.map(p => p.id === 'home-WR1' ? { ...p, y: p.y + 2.5 } : p) };
        for (let t = 0; t < 10; t++) s = stepDown(farAway(s), idle);
        expect(s.ball.kind).toBe('flight');
        const loaded = decodeSave(encodeSave(s))!;
        expect(loaded).toEqual(s);
        let a: DownState = s, b: DownState = loaded;
        while (a.phase === 'live' && a.ball.kind === 'flight') { a = stepDown(farAway(a), idle); b = stepDown(farAway(b), idle); }
        expect(b).toEqual(a);
    });
});

describe('a corner does not stand in the receiver\'s lane', () => {
    it('he plays the inside by more than a body width: at 1.2 yd against a body of 1.66 the two collided on every step they were level', () => {
        expect(MAN_LEVERAGE).toBeGreaterThan(BODY);
    });
    it('a corner close on a go route costs the receiver no more at speed 99 than at speed 50', () => {
        const lost = (speed: number) => {
            const run = (parked: boolean) => { let s = start('go'); s = { ...s, players: s.players.map(p => p.id === 'home-WR1' ? { ...p, abilities: { ...p.abilities, speed } } : p) }; for (let i = 0; i < 90; i++) s = stepDown(parked ? farAway(s) : s, idle); return at(s, 'home-WR1').x; };
            return run(true) - run(false);
        };
        expect(Math.abs(lost(99) - lost(50)), 'yards lost to the corner, fast against slow').toBeLessThan(0.75);
    });
});

describe('a faster receiver gains from his speed', () => {
    const SEEDS = Array.from({ length: 12 }, (_, k) => k + 1);
    const goes = (speed: number) => sweep({ plays: ['go'], targets: [1], ticks: tickRange(0, 240, 8), seeds: SEEDS, stopAtArrival: true, abilities: { 'home-WR1': { speed } } }).filter(r => r.outcome !== 'sack');
    it('go routes are not caught less often by a faster receiver (they were: 66% at speed 50, 45% at 99)', () => {
        expect(rate(goes(99), r => r.outcome === 'complete')).toBeGreaterThan(rate(goes(50), r => r.outcome === 'complete') - 0.06);
    });
    it('the ball arrives within a yard of him at every speed, and he gains yards per throw with speed', () => {
        const yards = (rs: ThrowRecord[]) => rs.reduce((a, r) => a + (r.outcome === 'complete' ? r.yards : 0), 0) / rs.length;
        for (const speed of [50, 70, 99]) expect(goes(speed).reduce((a, r) => a + r.receiverGap, 0) / goes(speed).length, `mean gap at speed ${speed}`).toBeLessThan(0.5);
        expect(yards(goes(99))).toBeGreaterThan(yards(goes(70)) + 1);
        expect(yards(goes(70))).toBeGreaterThan(yards(goes(50)) + 1);
    });
});
