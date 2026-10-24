import { expect, it } from 'vitest';
import { BLOCK_RADIUS, BLOCK_SLOW, createDown, engagements, snap, stepDown, switchDefender, type DownState } from '../core/down';
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
/** Every defender parked far from the play, so a test places exactly the ones it needs. */
const parked = (state: DownState): DownState => ({ ...state, players: state.players.map((p, i) => p.team === 'away' ? { ...p, x: 100 + (i % 3), y: 5 + 8 * (i % 5) } : p) });
const speedOf = (state: DownState, id: PlayerId, inputs: Inputs = idle) => { const a = at(state, id), b = at(stepDown(state, inputs), id); return Math.hypot(b.x - a.x, b.y - a.y); };

it('an engaged defender moves at the blocked fraction of his speed, an unengaged one at full speed', () => {
    const far = parked(live());
    // The closest defender goes to the first blocker (QB #1 on a handoff); stand that blocker beside him.
    const free = place(far, 'away-2', 60, MID);
    const engaged = place(free, 'home-1', 60 - BLOCK_RADIUS + 0.4, MID);
    expect(speedOf(free, 'away-2')).toBeCloseTo(stride(free, 'away-2'), 10);
    expect(speedOf(engaged, 'away-2')).toBeCloseTo(stride(engaged, 'away-2') * BLOCK_SLOW, 10);
});
it('the blocker one step outside the block radius does not slow him', () => {
    const near = place(place(parked(live()), 'away-2', 60, MID), 'home-1', 60 - BLOCK_RADIUS - 0.4, MID);
    expect(speedOf(near, 'away-2')).toBeCloseTo(stride(near, 'away-2'), 10);
});
it('a blocker holds only the defender assigned to him: a second defender beside the same blocker runs free', () => {
    const base = place(place(parked(live()), 'away-2', 60, MID - 0.5), 'away-3', 60, MID + 0.5);
    const crowded = place(base, 'home-1', 60 - BLOCK_RADIUS + 0.5, MID);
    // away-2 is closer to the carrier than away-3, so QB #1 is assigned to away-2 and #5 (far away) to away-3.
    expect(speedOf(crowded, 'away-2')).toBeCloseTo(stride(crowded, 'away-2') * BLOCK_SLOW, 10);
    expect(speedOf(crowded, 'away-3')).toBeCloseTo(stride(crowded, 'away-3'), 10);
});
it('a human defender who is not assigned to the nearby blocker is not slowed; his assigned block does slow him', () => {
    const base = place(place(parked(live()), 'away-2', 60, MID - 0.5), 'away-1', 60, MID + 0.5);
    // Make away-2 the closer one to the carrier, so QB #1 holds away-2 and the human away-1 is unassigned.
    const setup = place(place(base, 'away-2', 59, MID - 0.5), 'home-1', 59 - BLOCK_RADIUS + 0.5, MID);
    const move = { ...idle, away: { x: -1, y: 0 } };
    expect(setup.defender).toBe('away-1');
    expect(speedOf(setup, 'away-1', move)).toBeCloseTo(stride(setup, 'away-1'), 10);
    // Now the human is the closest defender, so he is the one held.
    const held = place(place(setup, 'away-1', 58, MID), 'home-1', 58 - BLOCK_RADIUS + 0.5, MID);
    expect(speedOf(held, 'away-1', move)).toBeCloseTo(stride(held, 'away-1') * BLOCK_SLOW, 10);
    // Switching to the free teammate restores full speed.
    const switched = switchDefender(held);
    expect(switched.defender).toBe('away-2');
    expect(speedOf(switched, 'away-2', move)).toBeCloseTo(stride(switched, 'away-2'), 10);
});
it('the field bars list only a blocker and his own assignment', () => {
    const crowded = place(place(place(parked(live()), 'away-2', 60, MID - 0.5), 'away-3', 60, MID + 0.5), 'home-1', 60 - BLOCK_RADIUS + 0.5, MID);
    expect(engagements(crowded)).toEqual([{ blocker: 'home-1', defender: 'away-2' }]);
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
