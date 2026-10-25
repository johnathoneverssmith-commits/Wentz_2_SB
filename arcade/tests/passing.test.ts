import { describe, expect, it } from 'vitest';
import { choosePlay, contestPass, createDown, snap, stepDown, switchDefender, throwPass, type DownState, type Play } from '../core/down';
import type { PlayerId, Vector } from '../core/simulation';
import { farAway, idle, place } from './helpers';

/** The pass at the moment the ball arrives: C caught, x incomplete, I intercepted, S sacked before the throw. */
function outcome(play: Play, target: 1 | 2 | 3, delay: number, n = 1): string {
    let s = snap(choosePlay(createDown(), play)), t = 0, thrown = false;
    s = { ...s, playNumber: n, formation: s.formation };
    while (s.phase === 'live' && t < 600) {
        if (t === delay) { s = throwPass(s, target); thrown = true; }
        const before = s;
        s = stepDown(s, idle);
        t++;
        if (thrown && before.ball.kind === 'flight' && s.ball.kind !== 'flight') break;
    }
    if (!thrown) return 'S';
    if (s.phase === 'dead' && s.result!.reason === 'interception') return 'I';
    if (s.phase === 'dead' && s.result!.reason === 'incomplete') return 'x';
    return 'C';
}
const row = (play: Play, target: 1 | 2 | 3) => Array.from({ length: 31 }, (_, i) => outcome(play, target, i * 4)).join('');
const toward = (from: Vector, to: Vector): Vector => { const d = Math.hypot(to.x - from.x, to.y - from.y) || 1; return { x: (to.x - from.x) / d, y: (to.y - from.y) / d }; };
const at = (s: DownState, id: PlayerId) => s.players.find(p => p.id === id)!;

describe('pass timing against the AI defense', () => {
    // One letter per throw made 0, 4, 8 ... 120 ticks (two seconds) after the snap, humans idle.
    it('every route has its own windows: the same throw is open, covered or contested depending on when and to whom', () => {
        expect(row('slants', 1)).toMatchSnapshot();
        expect(row('slants', 2)).toMatchSnapshot();
        expect(row('go', 1)).toMatchSnapshot();
        expect(row('go', 2)).toMatchSnapshot();
        expect(row('go', 3)).toMatchSnapshot();
    });
    it('throwing early into coverage is not rewarded, and every play has an open window after the receivers get free', () => {
        const all = (['slants', 'go'] as const).flatMap(p => [1, 2, 3].map(t => ({ play: p, t, r: row(p, t as 1 | 2 | 3) })));
        for (const play of ['slants', 'go'] as const) expect(all.filter(a => a.play === play && /C/.test(a.r)).length, `${play}: receivers with an open window`).toBeGreaterThanOrEqual(2);
        expect(all.filter(a => /C/.test(a.r)).length).toBeGreaterThanOrEqual(4);
        const late = all.flatMap(a => [...a.r.slice(15)]);
        expect(late.filter(c => c === 'C').length).toBeGreaterThan(late.length * 0.25);
    });
    it('the covering defense, not luck, decides: contested windows contain interceptions and break-ups, not just completions', () => {
        const letters = (['slants', 'go'] as const).flatMap(p => [1, 2, 3].flatMap(t => row(p, t as 1 | 2 | 3).split('')));
        const count = (c: string) => letters.filter(x => x === c).length;
        expect(count('C')).toBeGreaterThan(30);
        expect(count('x')).toBeGreaterThan(30);
        expect(count('I')).toBeGreaterThan(10);
        expect(count('S')).toBe(0);
    });
    it('a window that is open against the AI can be closed by a human defender who goes to the landing point', () => {
        const openAt = (() => { for (let d = 0; d < 124; d += 4) if (outcome('slants', 2, d, 2) === 'C') return d; return -1; })();
        expect(openAt, 'an open window exists').toBeGreaterThan(0);
        let s = snap(choosePlay(createDown(), 'slants'));
        s = { ...s };
        for (let i = 0; i < openAt; i++) s = stepDown(s, idle);
        s = throwPass(s, 2);
        const to = (s.ball as { to: Vector }).to;
        // the cornerback who covers the second receiver becomes the human, and stands 3 yards off the landing point
        const cb = at(s, 'away-CB2').id;
        for (let i = 0; i < 11 && s.defender !== cb; i++) s = switchDefender(s);
        s = place(farAway(s, [cb]), cb, to.x + 3, to.y);
        const run = (move: boolean) => { let r = s; while (r.phase === 'live' && r.ball.kind === 'flight') { const me = at(r, cb); r = stepDown(farAway(r, [cb]), { home: { x: 0, y: 0 }, away: move && Math.hypot(me.x - to.x, me.y - to.y) > 1.9 ? toward(me, to) : { x: 0, y: 0 } }); } return r; };
        expect(run(false).possession.carrier).toBe('home-WR2');
        expect(run(true).result?.reason).toBe('incomplete');
    });
    it('hands matter only to a human: the AI intercepts by position, the human needs the timed press', () => {
        const withHands = (press: number) => {
            let s = throwPass(snap(choosePlay(createDown(), 'slants')), 1);
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
        expect(withHands(40)).toBe('interception');
        expect(withHands(0)).toBe('incomplete');
        expect(withHands(-1)).toBe('incomplete');
    });
});
