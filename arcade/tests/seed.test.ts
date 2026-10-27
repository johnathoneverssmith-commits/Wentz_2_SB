/**
 * Phase C1a: the game carries a random seed, and nothing reads it yet. These tests pin the properties C1b depends on: a roll is a pure
 * function of the seed and the event, the seed travels through the whole game and through a save, an old save gets a stable seed, and
 * adding the seed changes no play.
 */
import { describe, expect, it } from 'vitest';
import { decodeSave, encodeSave } from '../browser/save';
import { newSeed } from '../browser/newSeed';
import { createClock, advance } from '../core/clock';
import { choosePlay, createDown, lineUp, nextDown, snap, stepDown, throwPass, type DownState } from '../core/down';
import { DEFAULT_SEED, mix, roll, validSeed } from '../core/seed';
import { idle, tackled } from './helpers';

describe('roll: seeded chance without a generator to keep in step', () => {
    it('is a pure function of the seed and the keys, in [0, 1)', () => {
        for (const seed of [0, 1, 7, 123456789, 0xffffffff]) for (const keys of [[], [1], [3, 41], [3, 41, 5]]) {
            const a = roll(seed, ...keys);
            expect(roll(seed, ...keys)).toBe(a);
            expect(a).toBeGreaterThanOrEqual(0);
            expect(a).toBeLessThan(1);
        }
        expect(Number.isInteger(mix(1, 2, 3))).toBe(true);
        expect(mix(1, 2, 3)).toBeLessThan(2 ** 32);
    });
    it('depends on every input and on their order', () => {
        const base = roll(9, 3, 41, 5);
        expect(roll(10, 3, 41, 5)).not.toBe(base);
        expect(roll(9, 4, 41, 5)).not.toBe(base);
        expect(roll(9, 3, 42, 5)).not.toBe(base);
        expect(roll(9, 3, 41, 6)).not.toBe(base);
        expect(roll(9, 41, 3, 5)).not.toBe(base);
        expect(roll(9, 3, 41)).not.toBe(base);
        expect(roll(9, 3, 41, 5, 0)).not.toBe(base);
    });
    it('spreads evenly: ten thousand consecutive events fill ten bins about equally, whatever the seed', () => {
        for (const seed of [DEFAULT_SEED, 424242, 0xdeadbeef]) {
            const bins = new Array(10).fill(0) as number[];
            for (let tick = 0; tick < 10000; tick++) bins[Math.floor(roll(seed, 17, tick) * 10)]!++;
            for (const n of bins) {
                expect(n).toBeGreaterThan(880);
                expect(n).toBeLessThan(1120);
            }
        }
    });
    it('neighbouring events are uncorrelated, and one changed input flips about half the bits', () => {
        const n = 4000, xs: number[] = [], ys: number[] = [];
        for (let t = 0; t < n; t++) { xs.push(roll(5, 1, t)); ys.push(roll(5, 1, t + 1)); }
        const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length, mx = mean(xs), my = mean(ys);
        let cov = 0, vx = 0, vy = 0;
        for (let i = 0; i < n; i++) { cov += (xs[i]! - mx) * (ys[i]! - my); vx += (xs[i]! - mx) ** 2; vy += (ys[i]! - my) ** 2; }
        expect(Math.abs(cov / Math.sqrt(vx * vy))).toBeLessThan(0.05);
        let flipped = 0;
        for (let seed = 0; seed < 500; seed++) {
            let x = mix(seed, 3, 9) ^ mix(seed + 1, 3, 9);
            while (x) { flipped += x & 1; x >>>= 1; }
        }
        expect(flipped / 500).toBeGreaterThan(14);
        expect(flipped / 500).toBeLessThan(18);
    });
    it('validSeed accepts exactly the unsigned 32-bit integers', () => {
        for (const ok of [0, 1, 2 ** 32 - 1]) expect(validSeed(ok)).toBe(true);
        for (const bad of [-1, 1.5, 2 ** 32, NaN, Infinity, '3', null, undefined]) expect(validSeed(bad)).toBe(false);
    });
});

describe('the seed travels with the game', () => {
    it('a new game carries the seed it was given, or the default', () => {
        expect(createDown().seed).toBe(DEFAULT_SEED);
        expect(createDown(77).seed).toBe(77);
        expect(lineUp('away', 30, { seed: 5 }).seed).toBe(5);
        expect(createClock(9).match.seed).toBe(9);
        expect(createClock().match.seed).toBe(DEFAULT_SEED);
    });
    it('stays the same through a snap, a played-out pass, the next down and a change of possession', () => {
        let s: DownState = snap(choosePlay(createDown(31337), 'slants'));
        for (let t = 0; t < 30; t++) s = stepDown(s, idle);
        s = throwPass(s, 1);
        while (s.phase === 'live') {
            s = stepDown(s, idle);
            expect(s.seed).toBe(31337);
        }
        expect(nextDown(s).seed).toBe(31337);
        expect(nextDown(tackled(createDown(31337), 4)).seed).toBe(31337);
        const turnover = nextDown({ ...s, phase: 'dead', result: { playNumber: s.playNumber, reason: 'interception', yards: 0, turnover: true, touchdown: false, firstDown: false, turnoverOnDowns: false } as never });
        expect(turnover.seed).toBe(31337);
    });
    it('changes nothing until a pass arrives: two games that differ only in their seed play out identically, tick for tick, up to the catch', () => {
        const play = (seed: number) => {
            let s: DownState = snap(choosePlay(createDown(seed), 'go'));
            const trace: unknown[] = [];
            for (let t = 0; t < 400 && s.phase === 'live'; t++) {
                if (t === 95) s = throwPass(s, 2);
                if (s.ball.kind === 'flight' && s.ball.elapsed + 1 / 60 + 1e-9 >= s.ball.duration) break;
                s = stepDown(s, idle);
                const { seed: _seed, ...rest } = s;
                trace.push(rest);
            }
            return trace;
        };
        expect(play(1)).toEqual(play(0xcafef00d));
        const rush = (seed: number) => { let s: DownState = snap(createDown(seed)); for (let t = 0; t < 300 && s.phase === 'live'; t++) s = stepDown(s, idle); const { seed: _s, ...rest } = s; return rest; };
        expect(rush(1)).toEqual(rush(2));
        const ra = advance(advance(createClock(1), 0.1, idle), 0.1, idle), rb = advance(advance(createClock(2), 0.1, idle), 0.1, idle);
        const { seed: _a, ...ma } = ra.match, { seed: _b, ...mb } = rb.match;
        expect(ma).toEqual(mb);
    });
});

describe('the seed is saved', () => {
    it('round trips in the current version, mid-play and with the ball in the air', () => {
        let s: DownState = snap(choosePlay(createDown(2468), 'go'));
        for (let t = 0; t < 90; t++) s = stepDown(s, idle);
        s = throwPass(s, 1);
        for (let t = 0; t < 10; t++) s = stepDown(s, idle);
        expect(s.ball.kind).toBe('flight');
        const text = encodeSave(s);
        expect(JSON.parse(text).version).toBe(7);
        const back = decodeSave(text)!;
        expect(back).toEqual(s);
        expect(back.seed).toBe(2468);
        let a = s, b = back;
        for (let t = 0; t < 200 && a.phase === 'live'; t++) { a = stepDown(a, idle); b = stepDown(b, idle); }
        expect(b).toEqual(a);
    });
    it('a version-6 save (no seed) loads with a seed derived from the game it holds: always the same one, and nothing else changes', () => {
        const dead = tackled(createDown(), 4);
        const { seed: _s, ...v6 } = dead;
        const text = JSON.stringify({ version: 6, state: v6 });
        const one = decodeSave(text)!, two = decodeSave(text)!;
        expect(validSeed(one.seed)).toBe(true);
        expect(two.seed).toBe(one.seed);
        const { seed: _o, ...rest } = one;
        expect(rest).toEqual(v6);
        expect(decodeSave(encodeSave(one))).toEqual(one);
        const other = tackled(lineUp('away', 60), 9);
        const { seed: _t, ...v6b } = other;
        expect(decodeSave(JSON.stringify({ version: 6, state: v6b }))!.seed).not.toBe(one.seed);
    });
    it('a version-6 save that somehow carries a seed does not keep it, so old saves are all treated alike', () => {
        const dead = tackled(createDown(555), 4);
        const { seed: _s, ...v6 } = dead;
        expect(decodeSave(JSON.stringify({ version: 6, state: { ...v6, seed: 555 } }))!.seed).toBe(decodeSave(JSON.stringify({ version: 6, state: v6 }))!.seed);
    });
    it('a current-version save must carry a valid seed', () => {
        const state = snap(createDown(10));
        const { seed: _s, ...without } = state;
        expect(decodeSave(JSON.stringify({ version: 7, state: without }))).toBeNull();
        for (const seed of [-1, 1.5, 2 ** 32, '10', null, NaN]) expect(decodeSave(JSON.stringify({ version: 7, state: { ...state, seed } })), String(seed)).toBeNull();
        expect(decodeSave(JSON.stringify({ version: 7, state: { ...state, seed: 0 } }))).not.toBeNull();
        expect(decodeSave(JSON.stringify({ version: 7, state: { ...state, seed: 2 ** 32 - 1 } }))).not.toBeNull();
    });
});

describe('a new browser game picks its seed', () => {
    it('?seed=N replays the same game; anything else gets a random valid seed', () => {
        expect(newSeed('?seed=123')).toBe(123);
        expect(newSeed('?x=1&seed=0')).toBe(0);
        expect(newSeed('?seed=4294967295')).toBe(4294967295);
        for (const bad of ['?seed=4294967296', '?seed=-1', '?seed=abc', '?seed=1.5', '?seed=', '']) expect(validSeed(newSeed(bad)), bad).toBe(true);
        const picked = new Set(Array.from({ length: 8 }, () => newSeed('')));
        expect(picked.size).toBeGreaterThan(1);
    });
});
