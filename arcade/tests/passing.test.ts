import { describe, expect, it } from 'vitest';
import { choosePlay, contestPass, createDown, snap, stepDown, switchDefender, throwPass, type DownState, type Play } from '../core/down';
import type { CatchKind } from '../core/catch';
import type { PlayerId, Vector } from '../core/simulation';
import { farAway, idle, place } from './helpers';

/** How the pass was decided on the tick the ball arrived (or 'sack' if it was never thrown), for one game seed. */
function kindOf(play: Play, target: 1 | 2 | 3, delay: number, seed: number): CatchKind | 'sack' {
    let s = snap(choosePlay(createDown(seed), play)), t = 0, thrown = false;
    while (s.phase === 'live' && t < 600) {
        if (t === delay) { s = throwPass(s, target); thrown = true; }
        const before = s;
        s = stepDown(s, idle);
        t++;
        if (thrown && before.ball.kind === 'flight' && s.ball.kind !== 'flight') break;
    }
    return thrown ? s.catchKind! : 'sack';
}
const SEEDS = Array.from({ length: 16 }, (_, i) => i + 1);
const completes = (k: string) => k === 'catch' || k === 'contested-catch';
const kindsCache = new Map<string, string[][]>();
/** For each throw (0, 4, 8 ... 120 ticks after the snap) how it was decided under each of the 16 seeds. Played once per route and kept. */
const kinds = (play: Play, target: 1 | 2 | 3): string[][] => {
    const key = `${play}-${target}`;
    if (!kindsCache.has(key)) kindsCache.set(key, Array.from({ length: 31 }, (_, i) => SEEDS.map(seed => kindOf(play, target, i * 4, seed))));
    return kindsCache.get(key)!;
};
/** One digit per throw: the tenths of the 16 games in which `pick` held. The windows are chances now, not certainties. */
const chance = (play: Play, target: 1 | 2 | 3, pick: (k: string) => boolean) => kinds(play, target).map(row => Math.min(9, Math.floor(10 * row.filter(pick).length / row.length))).join('');
const toward = (from: Vector, to: Vector): Vector => { const d = Math.hypot(to.x - from.x, to.y - from.y) || 1; return { x: (to.x - from.x) / d, y: (to.y - from.y) / d }; };
const at = (s: DownState, id: PlayerId) => s.players.find(p => p.id === id)!;

describe('pass timing against the AI defense', () => {
    // A digit per throw (0, 4, 8 ... 120 ticks after the snap, humans idle): the tenths of 16 games in which it was caught, and in which it was intercepted.
    it('every route has its own windows: the chance of the same throw being caught, covered or intercepted depends on when and to whom', () => {
        for (const [play, target] of [['slants', 1], ['slants', 2], ['go', 1], ['go', 2], ['go', 3]] as const) {
            expect(chance(play, target, completes)).toMatchSnapshot(`${play} ${target} caught`);
            expect(chance(play, target, k => k === 'interception')).toMatchSnapshot(`${play} ${target} intercepted`);
        }
    }, 120_000);
    it('every underneath receiver has a window, and it narrows: once the defense has picked up the break the same throw is caught less often', () => {
        for (const target of [1, 2, 3] as const) {
            const r = chance('slants', target, completes);
            expect(Math.max(...[...r].map(Number)), `slants to ${target}: a window`).toBeGreaterThanOrEqual(8);
            expect(Math.min(...[...r.slice(12)].map(Number)), `slants to ${target}: it narrows`).toBeLessThanOrEqual(6);
        }
        // a deep route against equal athletes is contested far more than the quick one
        const quick = chance('slants', 1, completes), deep = chance('go', 1, completes);
        const mean = (s: string) => [...s].reduce((a, c) => a + Number(c), 0) / s.length;
        expect(mean(deep.slice(8))).toBeLessThan(mean(quick.slice(0, 8)) + 1);
    });
    it('the covering defense, not luck, decides: over the windows the passes are caught, knocked down, intercepted and fall incomplete, in that order of frequency', () => {
        const all = (['slants', 'go'] as const).flatMap(p => [1, 2, 3].flatMap(t => kinds(p, t as 1 | 2 | 3).flat()));
        const count = (f: (k: string) => boolean) => all.filter(f).length;
        expect(count(completes)).toBeGreaterThan(count(k => k === 'breakup'));
        expect(count(k => k === 'breakup')).toBeGreaterThan(count(k => k === 'interception'));
        expect(count(k => k === 'interception')).toBeGreaterThan(0);
        expect(count(k => k === 'sack')).toBe(0);
        expect(count(k => k === 'contested-catch'), 'some are caught with a defender at the ball').toBeGreaterThan(100);
        expect(count(k => k === 'catch'), 'some are caught clean').toBeGreaterThan(100);
    });
    it('a window that is open against the AI can be closed by a human defender who goes to the landing point', () => {
        // the quick route to the first receiver, while he is clear of his corner: a throw at tick 8
        const stage = (seed: number, move: boolean) => {
            let s = snap(choosePlay(createDown(seed), 'slants'));
            for (let i = 0; i < 8; i++) s = stepDown(s, idle);
            s = throwPass(s, 1);
            const to = (s.ball as { to: Vector }).to;
            // the cornerback who covers the first receiver becomes the human, and stands 3 yards off the landing point
            const cb = at(s, 'away-CB1').id;
            for (let i = 0; i < 11 && s.defender !== cb; i++) s = switchDefender(s);
            s = place(farAway(s, [cb]), cb, to.x + 3, to.y);
            while (s.phase === 'live' && s.ball.kind === 'flight') { const me = at(s, cb); s = stepDown(farAway(s, [cb]), { home: { x: 0, y: 0 }, away: move && Math.hypot(me.x - to.x, me.y - to.y) > 0.9 ? toward(me, to) : { x: 0, y: 0 } }); }
            return s;
        };
        const share = (move: boolean, accept: (s: DownState) => boolean) => SEEDS.concat(SEEDS.map(x => x + 100)).filter(seed => accept(stage(seed, move))).length / 32;
        const caught = (s: DownState) => s.possession.carrier === 'home-WR1' && s.phase === 'live';
        expect(share(false, caught), 'left alone, the window is open').toBeGreaterThan(0.8);
        expect(share(true, caught), 'a human who goes to the ball closes it').toBeLessThan(share(false, caught) - 0.2);
    });
    it('hands matter only to a human: the AI needs no press, the human needs the timed press to intercept', () => {
        const withHands = (press: number, seed: number) => {
            let s = throwPass(snap(choosePlay(createDown(seed), 'slants')), 1);
            const to = (s.ball as { to: Vector }).to, cb = at(s, 'away-CB1').id;
            for (let i = 0; i < 11 && s.defender !== cb; i++) s = switchDefender(s);
            s = place(farAway(s, [cb]), cb, to.x + 3, to.y);
            for (let t = 0; s.phase === 'live' && s.ball.kind === 'flight' && t < 120; t++) {
                if (t === press) s = contestPass(s, 'away');
                const me = at(s, cb);
                s = stepDown(farAway(s, [cb]), { home: { x: 0, y: 0 }, away: Math.hypot(me.x - to.x, me.y - to.y) > 1.0 ? toward(me, to) : { x: 0, y: 0 } });
            }
            return s.result?.reason ?? 'caught';
        };
        const picks = (press: number) => SEEDS.concat(SEEDS.map(x => x + 100)).filter(seed => withHands(press, seed) === 'interception').length;
        expect(picks(40), 'a timed press can intercept').toBeGreaterThan(2);
        expect(picks(0), 'a press that has run out cannot').toBe(0);
        expect(picks(-1), 'no press cannot').toBe(0);
    });
});
