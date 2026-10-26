import { expect } from 'vitest';
import { direction, kickBall, nextDown, snap, stepDown, type DownState } from '../core/down';
import { KICK_PERIOD_TICKS } from '../core/kick';
import type { Inputs, PlayerId } from '../core/simulation';

/** Between plays only the clock may move: nothing about the play, the score or the players changes. */
export const withoutClock = (s: DownState): DownState => ({ ...s, clock: 0, gap: 0, expired: false });
export function expectOnlyClockMoved(after: DownState, before: DownState) {
    expect(withoutClock(after)).toEqual(withoutClock(before));
    expect(after.clock).toBeLessThanOrEqual(before.clock);
    expect(after.gap).toBeLessThanOrEqual(before.gap);
}

export const zero = { x: 0, y: 0 };
export const idle: Inputs = { home: zero, away: zero };
export const MID = 26.66666666665;
export const place = (state: DownState, id: PlayerId, x: number, y: number): DownState => ({ ...state, players: state.players.map(p => p.id === id ? { ...p, x, y } : p) });
/** Every defender except `except` is parked in a corner far behind the offense's own backfield (they cannot reach the play in time). */
export const farAway = (state: DownState, except: PlayerId[] = []): DownState => {
    const dir = direction(state.offense), x = Math.max(3, Math.min(117, state.line - dir * 35));
    return { ...state, players: state.players.map((p, i) => p.team !== state.offense && !except.includes(p.id) ? { ...p, x, y: 2 + (i % 11) * 4.5, vx: 0, vy: 0, lock: null } : p) };
};
/** Moves every offensive player except the listed ones far behind the play, so nobody can block or collide with the runner. */
export const parkBlockers = (state: DownState, keep: PlayerId[]): DownState => {
    const dir = direction(state.offense), x = Math.max(3, Math.min(117, state.line - dir * 40));
    return { ...state, players: state.players.map((p, i) => p.team === state.offense && !keep.includes(p.id) ? { ...p, x, y: 2 + (i % 11) * 4.5, vx: 0, vy: 0, lock: null } : p) };
};
/** Steps `n` ticks while the (AI) defense is kept parked away from the play, so a route or a throw can be studied alone. */
export function quiet(state: DownState, n: number, inputs: Inputs = idle, except: PlayerId[] = []): DownState {
    let s = state;
    for (let i = 0; i < n && s.phase === 'live'; i++) s = stepDown(farAway(s, except), inputs);
    return s;
}

/** Ends a rush with a tackle after exactly `gain` yards: the carrier stands there with a defender touching him. */
export function tackled(start: DownState, gain: number): DownState {
    const live = snap(start), dir = direction(live.offense), x = live.line + dir * gain;
    // Everyone else is moved well clear, so no collision nudges the carrier off the exact spot.
    const placed = { ...live, players: live.players.map(p => p.id === live.possession.carrier ? { ...p, x, y: MID } : p.id === live.defender ? { ...p, x: x + dir * 1.7, y: MID } : p.team === live.offense ? { ...p, x: live.line - dir * 12, y: p.y < MID ? 3 : 50 } : p) };
    const dead = stepDown(farAway(placed, [live.defender]), idle);
    expect(dead.result?.reason).toBe('tackle');
    return dead;
}
/** A touchdown run: the carrier is a step from the goal line. */
export function touchdown(start: DownState): DownState {
    const team = start.offense;
    let s = farAway(snap(start));
    s = place(s, s.possession.carrier, team === 'home' ? 109.9 : 10.1, MID);
    for (let i = 0; i < 20 && s.phase === 'live'; i++) s = stepDown(s, { ...idle, [team]: { x: team === 'home' ? 1 : -1, y: 0 } });
    expect(s.result?.reason).toBe('touchdown');
    return s;
}
/** Runs the kick meter to `ticks` and presses Kick for `team`. */
export function kickAtTick(state: DownState, ticks: number): DownState {
    let s = state;
    for (let i = 0; s.kick!.ticks < ticks; i++) {
        expect(i, 'the kick meter should advance every tick').toBeLessThan(ticks + 5);
        s = stepDown(s, idle);
    }
    return kickBall(s, s.kick!.team);
}
/** A tick where the meter is centred (a quarter period in) and one where it is at the far end. */
export const CENTRE = KICK_PERIOD_TICKS / 4;
export const FAR_END = KICK_PERIOD_TICKS / 2;
/** Takes a finished touchdown through the point after (kicked dead centre) to the next snap. */
export function throughExtraPoint(dead: DownState, ticks = CENTRE): DownState {
    const kick = nextDown(dead);
    expect(kick.phase).toBe('kick');
    return nextDown(kickAtTick(kick, ticks));
}
/** A fourth-down failure that ends the possession. */
export const turnedOverOnDowns = (start: DownState): DownState => tackled({ ...start, down: 4 }, 1);
