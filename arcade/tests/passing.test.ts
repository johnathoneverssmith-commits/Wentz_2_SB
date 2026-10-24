import { describe, expect, it } from 'vitest';
import { choosePlay, contestPass, createDown, snap, stepDown, throwPass, type Play } from '../core/down';
import { idle } from './helpers';

/** The pass at the moment the ball arrives: C caught, x incomplete, I intercepted, S sacked before the throw. */
function outcome(play: Play, target: 1 | 2, delay: number, defense: (tick: number) => { x: number; y: number } = () => ({ x: 0, y: 0 })): string {
    let s = snap(choosePlay(createDown(), play)), t = 0, thrown = false;
    while (s.phase === 'live' && t < 600) {
        if (t === delay) { s = throwPass(s, target); thrown = true; }
        const before = s;
        s = stepDown(s, { ...idle, away: thrown ? defense(t - delay) : { x: 0, y: 0 } });
        t++;
        if (thrown && before.ball.kind === 'flight' && s.ball.kind !== 'flight')
            break;
    }
    if (!thrown) return 'S';
    if (s.phase === 'dead' && s.result!.reason === 'interception') return 'I';
    if (s.phase === 'dead' && s.result!.reason === 'incomplete') return 'x';
    return 'C';
}
const row = (play: Play, target: 1 | 2) => Array.from({ length: 31 }, (_, i) => outcome(play, target, i * 4)).join('');

describe('pass timing against the AI defense', () => {
    // One letter per throw made 0, 4, 8 ... 120 ticks (two seconds) after the snap, humans idle.
    it('every route has its own windows: the same throw is open, covered or contested depending on when and to whom', () => {
        expect(row('slants', 1)).toBe('CCCCCCxxxxCCCCCxxxxxCCCCCCCCCCC');
        expect(row('slants', 2)).toBe('CCCCCCCCxIIIIIIIIIIIIIIIIIIIIII');
        expect(row('go', 1)).toBe('CCCCCxIIIIIIIIIxCCCCCCCCCCCCCCC');
        expect(row('go', 2)).toBe('CCCCCxIIIIIIIIIxCCCCCCCCCCCCCCC');
    });
    it('throwing early is not the only way to complete a pass: every play has an open window after one second', () => {
        for (const play of ['slants', 'go'] as const) {
            const late = [1, 2].flatMap(t => Array.from({ length: 16 }, (_, i) => outcome(play, t as 1 | 2, 60 + i * 4)));
            expect(late.filter(c => c === 'C').length, `${play} completions at or after tick 60`).toBeGreaterThanOrEqual(5);
        }
    });
    it('the covering defender, not luck, decides: the contested windows contain interceptions and break-ups, not just completions', () => {
        const all = (['slants', 'go'] as const).flatMap(p => [1, 2].flatMap(t => Array.from({ length: 31 }, (_, i) => outcome(p, t as 1 | 2, i * 4))));
        const count = (c: string) => all.filter(x => x === c).length;
        expect(count('C')).toBeGreaterThan(40);
        expect(count('I')).toBeGreaterThan(20);
        expect(count('x')).toBeGreaterThan(5);
        expect(count('S')).toBe(0);
    });
    it('a window that is open against the AI can be closed by a human defender who moves to the landing point', () => {
        expect(outcome('slants', 1, 0)).toBe('C');
        expect(outcome('slants', 1, 0, tick => (tick < 32 ? { x: 0, y: -1 } : { x: 0, y: 0 }))).toBe('x');
        expect(outcome('slants', 1, 24)).toBe('x');
    });
    it('hands matter only to a human: the AI intercepts by position, the human needs the timed press', () => {
        const withHands = (press: number) => {
            let s = throwPass(snap(choosePlay(createDown(), 'slants')), 1);
            for (let t = 0; s.phase === 'live' && s.ball.kind === 'flight' && t < 120; t++) {
                if (t === press) s = contestPass(s, 'away');
                s = stepDown(s, { ...idle, away: t < 32 ? { x: 0, y: -1 } : { x: 0, y: 0 } });
            }
            return s.result?.reason ?? 'caught';
        };
        expect(withHands(40)).toBe('interception');
        expect(withHands(0)).toBe('incomplete');
        expect(withHands(-1)).toBe('incomplete');
    });
});
