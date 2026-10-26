import { expect, it } from 'vitest';
import { createDown, snap, choosePlay, throwPass, stepDown, nextDown, switchDefender, contestPass, GO_REACT_TICKS, BREAKUP_RADIUS, type DownState } from '../core/down';
import { decodeSave, encodeSave } from '../browser/save';
import type { Inputs, PlayerId, Vector } from '../core/simulation';
import { expectOnlyClockMoved, farAway, parkBlockers, place, quiet } from './helpers';
const zero = { x: 0, y: 0 };
const idle: Inputs = { home: zero, away: zero };
const at = (s: DownState, id: PlayerId) => s.players.find(p => p.id === id)!;
const towards = (from: Vector, to: Vector): Vector => { const d = Math.hypot(to.x - from.x, to.y - from.y) || 1; return { x: (to.x - from.x) / d, y: (to.y - from.y) / d }; };
const withDefender = (s: DownState, id: PlayerId): DownState => ({ ...s, defender: id, players: s.players.map(p => ({ ...p, human: p.id === s.possession.carrier || p.id === id })) });

/** Home throws to WR1 on slants with only Orange's #CB1 able to react; he starts three yards off the landing point. */
function pass(defense: 'idle' | 'breakup' | 'hands' | 'earlyHands') {
    let s = withDefender(snap(choosePlay(createDown(), 'slants')), 'away-CB1');
    s = throwPass(s, 1);
    if (s.ball.kind !== 'flight') throw Error('flight');
    const to = s.ball.to;
    s = place(farAway(s, ['away-CB1']), 'away-CB1', to.x + 3, to.y);
    for (let tick = 0; s.phase === 'live' && s.ball.kind === 'flight' && tick < 100; tick++) {
        if (defense === 'hands' && tick === 40) s = contestPass(s, 'away');
        if (defense === 'earlyHands' && tick === 5) s = contestPass(s, 'away');
        const me = at(s, 'away-CB1'), gap = Math.hypot(me.x - to.x, me.y - to.y);
        // breakup: step in until he is inside the break-up circle but outside the catch circle, then stand; hands: go right to the ball.
        const target = defense === 'idle' ? -1 : defense === 'breakup' ? 1.95 : 1.0;
        const move = defense !== 'idle' && gap > target ? towards(me, to) : zero;
        s = stepDown(farAway(s, ['away-CB1']), { home: zero, away: move });
    }
    return s;
}
function rush(home: Vector, away: Vector) {
    let s = withDefender(snap(createDown()), 'away-MLB');
    while (s.phase === 'live') {
        const me = at(s, 'away-MLB'), rb = at(s, 'home-RB');
        s = stepDown(parkBlockers(farAway(s, ['away-MLB']), ['home-RB']), { home, away: away === zero ? zero : towards(me, rb) });
    }
    return s;
}
it('the same ordinary pass completes, breaks up or is intercepted based only on human defense', () => {
    const complete = pass('idle'), broken = pass('breakup'), picked = pass('hands');
    expect(complete.possession.carrier).toBe('home-WR1');
    expect(complete.phase).toBe('live');
    expect(broken.result?.reason).toBe('incomplete');
    expect(picked.result).toMatchObject({ reason: 'interception', yards: 0, turnover: true });
    expect(picked.possession.team).toBe('away');
    expect(picked.terminalCount).toBe(1);
    expect(pass('hands')).toEqual(picked);
});
it('human pursuit stops the run that an idle defender would let score, and the same pursuit is beaten by a faster angle', () => {
    const lane = { x: 1, y: -0.3 };
    const idleDefense = rush(lane, zero);
    expect(idleDefense.result?.reason).toBe('touchdown');
    const chased = rush(lane, { x: 1, y: 1 });
    expect(chased.result?.reason).toBe('tackle');
    expect(chased.result!.yards).toBeLessThan(45);
    expect(chased.liveTicks).toBeLessThan(idleDefense.liveTicks);
    // Straight at the pursuer is stopped sooner than slanting away from him.
    const head = rush({ x: 1, y: 0 }, { x: 1, y: 1 });
    expect(head.result?.reason).toBe('tackle');
    expect(head.liveTicks).toBeLessThan(chased.liveTicks);
});
it('an expired hands attempt cannot intercept, but a well-timed one can', () => {
    expect(pass('earlyHands').result?.reason).toBe('incomplete');
    expect(pass('hands').result?.reason).toBe('interception');
});
it('AI covers the receiver, then breaks on the ball once it reacts, rather than continuing to chase the QB', () => {
    let s = farAway(snap(choosePlay(createDown(), 'go')), ['away-CB1']);
    // an early throw, while the corner is still on his man: he must break on the ball to contest it (a late throw to a receiver who has beaten him is a catch)
    s = quiet(s, 4, idle, ['away-CB1']);
    s = throwPass(s, 1);
    const point = s.ball.kind === 'flight' ? s.ball.to : zero;
    const gap = (state: DownState) => { const p = at(state, 'away-CB1'); return Math.hypot(p.x - point.x, p.y - point.y); };
    for (let i = 0; i < GO_REACT_TICKS; i++) s = stepDown(farAway(s, ['away-CB1']), idle);
    // once he reacts he is on the ball, not on the quarterback: from here to the catch he stays inside the break-up radius of the landing point
    expect(gap(s)).toBeLessThanOrEqual(BREAKUP_RADIUS);
    while (s.phase === 'live' && s.ball.kind === 'flight') { s = stepDown(farAway(s, ['away-CB1']), idle); expect(gap(s)).toBeLessThanOrEqual(BREAKUP_RADIUS + 1e-9); }
    expect(['incomplete', 'interception']).toContain(s.result?.reason);
});
it('turnover retains both teams control and rejects commands from the wrong team', () => {
    let s = snap(choosePlay(nextDown(pass('hands')), 'slants'));
    expect(throwPass(s, 1, 'home')).toBe(s);
    expect(switchDefender(s, 'away')).toBe(s);
    expect(contestPass(s, 'away')).toBe(s);
    const before = at(s, 'away-QB');
    s = stepDown(s, { home: { x: 1, y: 0 }, away: { x: -1, y: 0 } });
    expect(at(s, 'away-QB').x).toBeLessThan(before.x);
    expect(throwPass(s, 1, 'away').ball.kind).toBe('flight');
    expect(switchDefender(s, 'home').defender.startsWith('home-')).toBe(true);
});
it('airborne and completed snapshots round trip without changing the terminal count', () => {
    let air = throwPass(snap(choosePlay(createDown(), 'slants')), 1);
    for (let i = 0; i < 12; i++) air = stepDown(air, idle);
    expect(air.ball.kind).toBe('flight');
    expect(decodeSave(encodeSave(air))).toEqual(air);
    const dead = rush({ x: 1, y: 0 }, { x: 1, y: 1 });
    expect(dead.terminalCount).toBe(1);
    let restored = decodeSave(encodeSave(dead))!;
    for (let i = 0; i < 60; i++) restored = stepDown(restored, idle);
    expectOnlyClockMoved(restored, dead);
    expect(nextDown(restored).terminalCount).toBe(1);
});
it('contact has a strict radius boundary', () => {
    // A focused collision-boundary setup, not a playability demonstration.
    const base = snap(createDown()), rb = at(base, 'home-RB');
    const set = (gap: number): DownState => place(farAway(base, [base.defender]), base.defender, rb.x + gap, rb.y);
    expect(stepDown(set(1.81), idle).phase).toBe('live');
    expect(stepDown(set(1.79), idle).result?.reason).toBe('tackle');
});
it.each([['slants', 1, 'WR1'], ['slants', 2, 'WR2'], ['go', 1, 'WR1'], ['go', 2, 'WR2'], ['slants', 3, 'TE1'], ['go', 3, 'TE1']] as const)('every pass target is playable: %s #%s', (play, target, code) => {
    let s = farAway(throwPass(snap(choosePlay(createDown(), play)), target));
    while (s.phase === 'live' && s.ball.kind === 'flight') s = stepDown(farAway(s), idle);
    expect(s.phase).toBe('live');
    expect(s.possession.carrier).toBe(`home-${code}`);
});
it('an out-of-field landing cannot be intercepted by an in-bounds defender', () => {
    let s = throwPass(snap(choosePlay(createDown(), 'go')), 1);
    if (s.ball.kind !== 'flight') throw Error('flight');
    // Focused boundary geometry; reachability is established by separate unmodified playthroughs.
    s = { ...s, ball: { ...s.ball, to: { x: 120.5, y: 26.66666666665 }, elapsed: 59 / 60 }, players: s.players.map(p => p.id === s.defender ? { ...p, x: 119.1 } : p) };
    s = stepDown(contestPass(s, 'away'), idle);
    expect(s.result?.reason).toBe('incomplete');
    expect(s.result?.turnover).toBe(false);
});
it('switching cancels the previous defenders timed hands window', () => {
    const armed = contestPass(throwPass(snap(choosePlay(createDown(), 'slants')), 1), 'away');
    expect(armed.contestUntil).toBeGreaterThan(armed.tick);
    const switched = switchDefender(armed);
    expect(switched.defender).not.toBe(armed.defender);
    expect(switched.contestUntil).toBe(0);
});
