import { expect, it } from 'vitest';
import { createDown, snap, choosePlay, throwPass, stepDown, nextDown, switchDefender, contestPass, GO_REACT_TICKS, type DownState } from '../core/down';
import { decodeSave, encodeSave } from '../browser/save';
import type { Inputs } from '../core/simulation';
const zero = { x: 0, y: 0 };
const idle: Inputs = { home: zero, away: zero };
function pass(defense: 'idle' | 'breakup' | 'hands', start = createDown()) {
    let s = throwPass(snap(choosePlay(start, 'slants')), 1);
    for (let tick = 0; s.phase === 'live' && s.ball.kind === 'flight' && tick < 100; tick++) {
        if (defense === 'hands' && tick === 40)
            s = contestPass(s, 'away');
        // The landing point is up and to the left of Orange #1: hold Up+Left for 40 ticks (about 0.67 s), then stand.
        s = stepDown(s, { home: zero, away: defense === 'idle' || tick >= 40 ? zero : { x: -1, y: -1 } });
    }
    return s;
}
function rush(home = { x: 1, y: 0 }, away = { x: -1, y: 0 }) {
    let s = snap(createDown());
    while (s.phase === 'live')
        s = stepDown(s, { home, away });
    return s;
}
it('the same ordinary pass completes, breaks up or is intercepted based only on human defense', () => {
    const complete = pass('idle'), broken = pass('breakup'), picked = pass('hands');
    expect(complete.possession.carrier).toBe('home-3');
    expect(complete.phase).toBe('live');
    expect(broken.result?.reason).toBe('incomplete');
    expect(picked.result).toMatchObject({ reason: 'interception', yards: 0, turnover: true });
    expect(picked.possession.team).toBe('away');
    expect(picked.terminalCount).toBe(1);
    expect(pass('hands')).toEqual(picked);
});
it('human pursuit stops the same rush sooner and offensive evasion gains more yards', () => {
    const early = rush(), late = rush({ x: 1, y: 0 }, { x: 1, y: 0 }), evade = rush({ x: 1, y: -1 });
    // Initial separation 7 yd; combined closing speed 6.25+7 yd/s;
    // contact radius 1.8 yd => ceil((7-1.8)/13.25*60) = 24 ticks.
    // RB runs 6.25 * 24 / 60 = 2.5 yards. This oracle does not read result/coordinates.
    expect(early.liveTicks).toBe(24);
    expect(early.result?.yards).toBe(2.5);
    expect(late.liveTicks).toBeGreaterThan(early.liveTicks);
    expect(late.result!.yards).toBeGreaterThan(2.5);
    expect(evade.result!.yards).toBeGreaterThan(2.5);
});
it('an expired hands attempt cannot intercept, but a well-timed one can', () => {
    let s = contestPass(throwPass(snap(choosePlay(createDown(), 'slants')), 1), 'away');
    for (let tick = 0; s.phase === 'live' && s.ball.kind === 'flight'; tick++)
        s = stepDown(s, { home: zero, away: tick >= 40 ? zero : { x: -1, y: -1 } });
    expect(s.result?.reason).toBe('incomplete');
    expect(pass('hands').result?.reason).toBe('interception');
});
it('AI covers the receiver, then breaks on the ball once it reacts, rather than continuing to chase the QB', () => {
    let s = snap(choosePlay(createDown(), 'go'));
    for (let i = 0; i < 12; i++)
        s = stepDown(s, idle);
    s = throwPass(s, 1);
    const point = s.ball.kind === 'flight' ? s.ball.to : zero;
    const gap = (state: DownState) => { const p = state.players.find(q => q.id === 'away-3')!; return Math.hypot(p.x - point.x, p.y - point.y); };
    for (let i = 0; i < GO_REACT_TICKS; i++)
        s = stepDown(s, idle);
    const reacting = gap(s);
    expect(gap(stepDown(s, idle))).toBeLessThan(reacting);
    while (s.phase === 'live' && s.ball.kind === 'flight')
        s = stepDown(s, idle);
    expect(s.result?.reason).toBe('interception');
});
it('turnover retains both teams control and rejects commands from the wrong team', () => {
    let s = snap(choosePlay(nextDown(pass('hands')), 'slants'));
    expect(throwPass(s, 1, 'home')).toBe(s);
    expect(switchDefender(s, 'away')).toBe(s);
    expect(contestPass(s, 'away')).toBe(s);
    const before = s.players.find(p => p.id === 'away-1')!;
    s = stepDown(s, { home: { x: 1, y: 0 }, away: { x: -1, y: 0 } });
    expect(s.players.find(p => p.id === 'away-1')!.x).toBeLessThan(before.x);
    expect(throwPass(s, 1, 'away').ball.kind).toBe('flight');
    expect(switchDefender(s, 'home').defender).toBe('home-2');
});
it('airborne and completed snapshots round trip without changing the terminal count', () => {
    let air = throwPass(snap(choosePlay(createDown(), 'slants')), 1);
    for (let i = 0; i < 12; i++)
        air = stepDown(air, idle);
    expect(air.ball.kind).toBe('flight');
    expect(decodeSave(encodeSave(air))).toEqual(air);
    const dead = rush();
    expect(dead.terminalCount).toBe(1);
    let restored = decodeSave(encodeSave(dead))!;
    for (let i = 0; i < 60; i++)
        restored = stepDown(restored, idle);
    expect(restored).toEqual(dead);
    expect(nextDown(restored).terminalCount).toBe(1);
});
it('contact has a strict radius boundary', () => {
    // A focused collision-boundary setup, not a playability demonstration.
    const base = snap(createDown());
    const set = (gap: number): DownState => ({ ...base, players: base.players.map(p => p.team === 'away' ? { ...p, x: p.id === base.defender ? 38 + gap : 100, y: 26.66666666665 } : p) });
    expect(stepDown(set(1.81), idle).phase).toBe('live');
    expect(stepDown(set(1.79), idle).result?.reason).toBe('tackle');
});
it.each([['slants', 1], ['slants', 2], ['go', 1], ['go', 2]] as const)('both ordinary receiver targets are playable: %s #%s', (play, target) => {
    let s = throwPass(snap(choosePlay(createDown(), play)), target);
    while (s.phase === 'live' && s.ball.kind === 'flight')
        s = stepDown(s, idle);
    expect(s.phase).toBe('live');
    expect(s.possession.carrier).toBe(`home-${target + 2}`);
});
it('an out-of-field landing cannot be intercepted by an in-bounds defender', () => {
    let s = throwPass(snap(choosePlay(createDown(), 'go')), 1);
    if (s.ball.kind !== 'flight')
        throw Error('flight');
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
