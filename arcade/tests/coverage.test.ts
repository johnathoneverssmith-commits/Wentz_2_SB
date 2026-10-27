/**
 * Pass coverage (Phase B2): defenders react to what they can see (where the receivers are and how they move, where the ball is going)
 * and never to the play call; a corner keeps his cushion while the receiver is shallow and closes it as he breaks or goes deep; a
 * safety stays over the top; every defender who can reach the ball goes for it, with a human's reaction time.
 */
import { describe, expect, it } from 'vitest';
import { decodeSave, encodeSave } from '../browser/save';
import { BALL_READ_TICKS, CATCH_RADIUS, planTick } from '../core/behavior';
import { choosePlay, lineUp, snap, stepDown, throwPass, type DownState, type Play } from '../core/down';
import type { PlayerId } from '../core/simulation';
import { farAway, idle, parkBlockers } from './helpers';
import { throwOnce } from '../balance/window';

const start = (play: Play, team: 'home' | 'away' = 'home', line = 40): DownState => snap(choosePlay(lineUp(team, line, { playNumber: 1 }), play));
const run = (s: DownState, ticks: number): DownState => { for (let t = 0; t < ticks; t++) s = stepDown(s, idle); return s; };
const at = (s: DownState, id: PlayerId) => s.players.find(p => p.id === id)!;
const gap = (s: DownState, a: PlayerId, b: PlayerId) => Math.hypot(at(s, a).x - at(s, b).x, at(s, a).y - at(s, b).y);
const defenders = (s: DownState) => s.players.filter(p => p.team !== s.offense);

describe('coverage does not depend on the play call', () => {
    it('swapping the play label on the same snapshot changes no defender\'s plan, before the throw or after it', () => {
        for (const play of ['go', 'slants'] as const) for (const [tick, throwAfter] of [[0, false], [20, false], [60, false], [100, false], [30, true], [70, true]] as const) {
            let s = run(start(play), tick);
            if (throwAfter) s = run(throwPass(s, 1), 6);
            const reference = planTick(s);
            for (const label of ['go', 'slants', 'rush'] as const) {
                const other = planTick({ ...s, play: label });
                for (const d of defenders(s)) {
                    expect(other.intents.get(d.id), `${play} t${tick} ${d.id} under label ${label}`).toEqual(reference.intents.get(d.id));
                    expect(other.players.find(p => p.id === d.id)).toEqual(reference.players.find(p => p.id === d.id));
                }
            }
        }
    });
    it('a corner is in the same place on a go route and on a slant until the receiver does something different', () => {
        const a = run(start('go'), 25), b = run(start('slants'), 25);
        for (const id of ['away-CB1', 'away-CB2', 'away-FS', 'away-SS'] as const) { expect(at(a, id).x).toBeCloseTo(at(b, id).x, 6); expect(at(a, id).y).toBeCloseTo(at(b, id).y, 6); }
    });
});

describe('cornerbacks', () => {
    it('keep the depth they lined up at: nobody jumps forward to a shorter cushion at the snap', () => {
        for (const play of ['go', 'slants'] as const) {
            const s0 = start(play), s = run(s0, 20);
            expect(gap(s, 'away-CB1', 'home-WR1'), `${play}: gap to WR1 at tick 20`).toBeGreaterThan(gap(s0, 'away-CB1', 'home-WR1') - 1);
            expect(at(s, 'away-CB1').x - 40, 'still deep').toBeGreaterThan(6);
        }
    });
    it('close on a receiver who breaks off the stem, and not on one who keeps running deep (route recognition)', () => {
        const slants = run(start('slants'), 90), go = run(start('go'), 90);
        expect(gap(slants, 'away-CB1', 'home-WR1'), 'after the cut').toBeLessThan(5);
        expect(gap(go, 'away-CB1', 'home-WR1'), 'receiver still running the stem').toBeGreaterThan(7);
        expect(gap(go, 'away-CB1', 'home-WR1')).toBeGreaterThan(gap(slants, 'away-CB1', 'home-WR1') + 3);
    });
    it('a defender who sees his man cut keeps running the old way for a moment: his reading follows the real velocity late', () => {
        const s = run(start('slants'), 50), d = at(s, 'away-CB1'), r = at(s, 'home-WR1');
        expect(d.read).toBeTruthy();
        // the receiver is already moving sideways; the corner's reading of him still has more downfield speed than the real velocity
        expect(d.read!.x).toBeGreaterThan(r.vx);
        expect(Math.abs(d.read!.y)).toBeLessThan(Math.abs(r.vy) + 1e-9);
    });
    it('a receiver with a speed edge gets separation that grows with it, and a much slower corner gives it up', () => {
        const sep = (wr: number, cb: number) => throwOnce({ play: 'go', target: 1, throwTick: 200, abilities: { 'home-WR1': { speed: wr }, 'away-CB1': { speed: cb } } }).separationAtArrival;
        expect(sep(60, 74)).toBeLessThan(sep(70, 74)); expect(sep(70, 74)).toBeLessThan(sep(80, 74)); expect(sep(80, 74)).toBeLessThan(sep(99, 74));
        expect(sep(99, 40)).toBeGreaterThan(sep(99, 74));
    });
});

describe('linebackers and safeties', () => {
    it('the linebacker assigned to the tight end follows him underneath instead of sitting behind him', () => {
        for (const play of ['slants', 'go'] as const) for (const tick of [60, 80, 100, 120]) {
            const s = run(start(play), tick);
            expect(gap(s, 'away-OLB2', 'home-TE1'), `${play} at tick ${tick}`).toBeLessThan(3.5);
        }
    });
    it('the deep safety stays over the top of the deepest receiver who is running vertically', () => {
        const s = run(start('go'), 110), deepest = Math.max(...['home-WR1', 'home-WR2', 'home-TE1'].map(id => at(s, id as PlayerId).x));
        expect(at(s, 'away-FS').x, 'FS depth').toBeGreaterThan(deepest + 2);
    });
    /** The ball in the air toward a spot `depth` yards past the line, the safety and nobody else near: how close does he get? */
    function closest(depth: number, y: number): number {
        let s = run(start('go'), 30);
        const rec = at(s, 'home-WR1'), qb = at(s, 'home-QB');
        s = { ...s, ball: { kind: 'flight', from: { x: qb.x, y: qb.y }, to: { x: 40 + depth, y }, elapsed: 0, duration: 1.3, target: rec.id } };
        let best = Infinity;
        for (let t = 0; t < 78 && s.ball.kind === 'flight'; t++) { s = stepDown(farAway(s, ['away-FS']), idle); const fs = at(s, 'away-FS'); best = Math.min(best, Math.hypot(fs.x - (40 + depth), fs.y - y)); }
        return best;
    }
    it('reacts to a deep ball the same way just short of 20 yards and just past it: no gap in the safety\'s reaction', () => {
        const near = closest(19.5, 26), far = closest(20.5, 26);
        expect(Math.abs(near - far), `closest approach ${near.toFixed(2)} vs ${far.toFixed(2)}`).toBeLessThan(1);
        // and he really does go for balls he can reach
        expect(closest(24, 26)).toBeLessThan(3);
    });
});

describe('reactions to the ball', () => {
    it('a defender breaks on the ball a human reaction time after the release, not sooner and not much later', () => {
        let s = farAway(run(start('slants'), 4), ['away-CB1']);
        s = throwPass(s, 1);
        const to = (s.ball as { to: { x: number; y: number } }).to, cb = () => at(s, 'away-CB1');
        const toBall = () => Math.hypot(cb().x - to.x, cb().y - to.y);
        const before = (() => { for (let t = 0; t < BALL_READ_TICKS - 2; t++) s = stepDown(farAway(s, ['away-CB1']), idle); return cb(); })();
        const intentBefore = planTick(s).intents.get('away-CB1')!, after = (() => { for (let t = 0; t < 4; t++) s = stepDown(farAway(s, ['away-CB1']), idle); return planTick(s).intents.get('away-CB1')!; })();
        expect(before.behavior).toBe('man');
        expect(intentBefore.to).not.toBeNull();
        expect(planTick(s).players.find(p => p.id === 'away-CB1')!.behavior).toBe('pursue');
        expect(Math.hypot(after.to!.x - to.x, after.to!.y - to.y), 'he aims at the landing point').toBeLessThan(2.5);
        void toBall;
    });
    it('a defender who is behind his man (back to the ball) takes longer to find it than one in front', () => {
        let s = run(start('go'), 4);
        const place = (d: PlayerId, depthFromWr: number): DownState => ({ ...s, players: s.players.map(p => p.id === d ? { ...p, x: at(s, 'home-WR1').x + depthFromWr, y: at(s, 'home-WR1').y + 1.5 } : p) });
        s = throwPass(s, 1);
        const behavior = (depthFromWr: number, ticks: number) => { let r = place('away-CB1', depthFromWr); for (let t = 0; t < ticks; t++) r = stepDown(farAway(r, ['away-CB1']), idle); return planTick(r).players.find(p => p.id === 'away-CB1')!.behavior; };
        // 17 ticks after the throw: a defender in front has seen it (15 ticks), one behind his man (21) has not
        expect(behavior(+6, 17)).toBe('pursue');
        expect(behavior(-6, 17)).not.toBe('pursue');
        expect(behavior(-6, 24)).toBe('pursue');
    });
    it('a defender who can get to the landing spot before the ball plays it right there (where he intercepts); one who cannot gets beside it (where he only breaks it up)', () => {
        let s = farAway(run(start('slants'), 30), ['away-CB1']);
        s = throwPass(s, 1);
        const to = (s.ball as { to: { x: number; y: number } }).to;
        const aimFrom = (offset: number): number => {
            let r: DownState = { ...s, players: s.players.map(p => p.id === 'away-CB1' ? { ...p, x: to.x + offset, y: to.y, vx: 0, vy: 0 } : p) };
            for (let t = 0; t < BALL_READ_TICKS + 2; t++) r = stepDown(farAway({ ...r, players: r.players.map(p => p.id === 'away-CB1' ? { ...p, x: to.x + offset, y: to.y, vx: 0, vy: 0 } : p) }, ['away-CB1']), idle);
            const spot = planTick({ ...r, players: r.players.map(p => p.id === 'away-CB1' ? { ...p, x: to.x + offset, y: to.y, vx: 0, vy: 0 } : p) }).intents.get('away-CB1')!.to!;
            return Math.hypot(spot.x - to.x, spot.y - to.y);
        };
        expect(aimFrom(1), 'with time to spare he goes to the ball').toBeLessThan(1.2);
        expect(aimFrom(14), 'too far to get there first: he plays it from beside').toBeGreaterThan(1.6);
    });
});

describe('a defender who reached the ball early stays on it', () => {
    it('one standing at the landing spot is still inside the interception radius when the ball arrives (he used to back out to the beside standoff)', () => {
        let s = farAway(run(start('go'), 30), ['away-CB1']);
        s = throwPass(s, 1);
        if (s.ball.kind !== 'flight') throw new Error('flight');
        const to = s.ball.to, clear = (r: DownState): DownState => parkBlockers(farAway(r, ['away-CB1']), ['home-QB1']);
        for (let t = 0; t < BALL_READ_TICKS + 2; t++) s = stepDown(clear(s), idle);
        s = { ...s, players: s.players.map(p => p.id === 'away-CB1' ? { ...p, x: to.x + 0.9, y: to.y, vx: 0, vy: 0 } : p) };
        let last = 99;
        while (s.ball.kind === 'flight') { const c = at(s, 'away-CB1'); last = Math.hypot(c.x - to.x, c.y - to.y); s = stepDown(clear(s), idle); }
        expect(last).toBeLessThan(CATCH_RADIUS);
    });
    it('and a defender who cannot get there still plays it from beside, not on it', () => {
        let s = farAway(run(start('slants'), 30), ['away-CB1']);
        s = throwPass(s, 1);
        const to = (s.ball as { to: { x: number; y: number } }).to;
        s = { ...s, players: s.players.map(p => p.id === 'away-CB1' ? { ...p, x: to.x + 14, y: to.y, vx: 0, vy: 0 } : p) };
        for (let t = 0; t < BALL_READ_TICKS + 2; t++) s = stepDown(farAway(s, ['away-CB1']), idle);
        const spot = planTick(s).intents.get('away-CB1')!.to!;
        expect(Math.hypot(spot.x - to.x, spot.y - to.y)).toBeGreaterThan(1.6);
    });
});

describe('mirrored plays', () => {
    const swap = (id: string) => id.startsWith('home') ? id.replace('home', 'away') : id.replace('away', 'home');
    it('every player is in the mirror-image place on every tick of a pass play, for either team (a zone defender used to sway by his raw x)', () => {
        for (const play of ['slants', 'go'] as const) for (const [target, tick] of [[1, 20], [2, 50], [3, 80]] as const) {
            let a = start(play), b = start(play, 'away', 80);
            for (let t = 0; t < 200 && (a.phase === 'live' || b.phase === 'live'); t++) {
                if (t === tick) { a = throwPass(a, target); b = throwPass(b, target); }
                for (const p of a.players) {
                    const q = b.players.find(x => x.id === swap(p.id))!;
                    expect(Math.abs((120 - q.x) - p.x) < 1e-6 && Math.abs(q.y - p.y) < 1e-6, `${play} ${target}@${tick} t${t} ${p.id}`).toBe(true);
                }
                a = stepDown(a, idle); b = stepDown(b, idle);
            }
        }
    });
});

describe('a defender\'s reading is saved with the game', () => {
    it('is stored and restored, and play resumes identically', () => {
        const s = run(start('slants'), 60);
        expect(defenders(s).some(d => d.read)).toBe(true);
        const loaded = decodeSave(encodeSave(s))!;
        expect(loaded).toEqual(s);
        expect(run(loaded, 60)).toEqual(run(s, 60));
    });
    it('an older save without it still loads, and a reading that is not a point is refused', () => {
        const s = run(start('slants'), 30);
        const stripped = { ...s, players: s.players.map(({ read: _read, ...p }) => p) } as unknown as DownState;
        expect(decodeSave(encodeSave(stripped))).not.toBeNull();
        expect(decodeSave(encodeSave({ ...s, players: s.players.map((p, i) => i === 0 ? { ...p, read: { x: NaN, y: 0 } } : p) }))).toBeNull();
        expect(decodeSave(JSON.stringify({ version: 6, state: { ...s, players: s.players.map((p, i) => i === 0 ? { ...p, read: 'fast' } : p) } }))).toBeNull();
    });
});
