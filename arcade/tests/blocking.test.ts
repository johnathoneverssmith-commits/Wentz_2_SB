import { expect, it } from 'vitest';
import { BLOCK_RADIUS, BLOCK_SLOW, createDown, snap, stepDown, switchDefender, type DownState } from '../core/down';
import { STEP_SECONDS, type Inputs, type PlayerId } from '../core/simulation';

const zero = { x: 0, y: 0 };
const idle: Inputs = { home: zero, away: zero };
const MID = 26.66666666665;
const place = (state: DownState, id: PlayerId, x: number, y: number): DownState => ({ ...state, players: state.players.map(p => p.id === id ? { ...p, x, y } : p) });
const at = (state: DownState, id: PlayerId) => state.players.find(p => p.id === id)!;
const gap = (state: DownState, a: PlayerId, b: PlayerId) => Math.hypot(at(state, a).x - at(state, b).x, at(state, a).y - at(state, b).y);
/** The ground an idle-AI defender covers in one tick, from his speed rating. */
const stride = (state: DownState, id: PlayerId) => (4 + at(state, id).abilities.speed / 20) * STEP_SECONDS;

/** A handoff in progress: carrier #2 at the line; blocker #5 is the second blocker, QB #1 the first. */
const live = () => snap(createDown());

it('the two blockers take the two closest defenders and close on them', () => {
    const s = live();
    const next = stepDown(s, idle);
    // Handoff: QB #1 blocks the closest defender (#1), #5 the next (#2).
    expect(gap(next, 'home-1', 'away-1')).toBeLessThan(gap(s, 'home-1', 'away-1'));
    expect(gap(next, 'home-5', 'away-2')).toBeLessThan(gap(s, 'home-5', 'away-2'));
    // Receivers #3/#4 are not blockers: they keep running routes.
    expect(at(next, 'home-3').x).toBeGreaterThan(at(s, 'home-3').x);
});
it('an engaged defender moves at the blocked fraction of his speed, an unengaged one at full speed', () => {
    const base = live();
    // Park the defender #2 by itself, and put blocker #5 beside him; the other defenders are far away.
    const far = place(place(place(place(base, 'away-1', 100, 5), 'away-3', 100, 40), 'away-4', 90, 5), 'away-5', 90, 45);
    const engaged = place(place(far, 'away-2', 60, MID), 'home-5', 60 - BLOCK_RADIUS + 0.4, MID);
    const free = place(far, 'away-2', 60, MID);
    const move = (state: DownState) => { const a = at(state, 'away-2'), b = at(stepDown(state, idle), 'away-2'); return Math.hypot(b.x - a.x, b.y - a.y); };
    expect(move(free)).toBeCloseTo(stride(free, 'away-2'), 10);
    expect(move(engaged)).toBeCloseTo(stride(engaged, 'away-2') * BLOCK_SLOW, 10);
});
it('the blocker one step outside the block radius does not slow him', () => {
    const base = live();
    const far = place(place(place(place(base, 'away-1', 100, 5), 'away-3', 100, 40), 'away-4', 90, 5), 'away-5', 90, 45);
    const near = place(place(far, 'away-2', 60, MID), 'home-5', 60 - BLOCK_RADIUS - 0.4, MID);
    const a = at(near, 'away-2'), b = at(stepDown(near, idle), 'away-2');
    expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeCloseTo(stride(near, 'away-2'), 10);
});
it('a human defender is slowed by a block too, and switching to a free teammate restores full speed', () => {
    const base = live();
    const engaged = place(place(base, 'away-1', 60, MID), 'home-1', 60 - BLOCK_RADIUS + 0.4, MID);
    const step = (state: DownState, id: PlayerId) => { const a = at(state, id), b = at(stepDown(state, { ...idle, away: { x: -1, y: 0 } }), id); return Math.hypot(b.x - a.x, b.y - a.y); };
    expect(step(engaged, 'away-1')).toBeCloseTo(stride(engaged, 'away-1') * BLOCK_SLOW, 10);
    const switched = switchDefender(engaged);
    expect(switched.defender).toBe('away-2');
    expect(step(switched, 'away-2')).toBeCloseTo(stride(switched, 'away-2'), 10);
});
it('running behind the blockers gains more than running straight at the defenders, with the defense playing the same way', () => {
    const rush = (home: { x: number; y: number }, away: { x: number; y: number }) => {
        let s = live();
        while (s.phase === 'live') s = stepDown(s, { home, away });
        return s.result!.yards;
    };
    const straight = rush({ x: 1, y: 0 }, zero), behind = rush({ x: 1, y: -0.6 }, zero);
    expect(behind).toBeGreaterThanOrEqual(straight + 1.5);
    // A defender chasing from the front is held up by his blocker, so the same chase gains more when the carrier cuts behind it.
    expect(rush({ x: 1, y: -0.6 }, { x: -1, y: 0 })).toBeGreaterThan(rush({ x: 1, y: 0 }, { x: -1, y: 0 }));
});
it('blocking is deterministic: the same play twice is identical, whatever the player array order', () => {
    const run = (reverse: boolean) => {
        let s = live();
        if (reverse) s = { ...s, players: [...s.players].reverse() };
        for (let i = 0; i < 40; i++) s = stepDown(s, { home: { x: 1, y: -0.6 }, away: zero });
        return [...s.players].sort((a, b) => a.id.localeCompare(b.id));
    };
    expect(run(false)).toEqual(run(false));
    expect(run(true)).toEqual(run(false));
});
