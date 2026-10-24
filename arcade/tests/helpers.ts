import { expect } from 'vitest';
import { direction, kickBall, nextDown, snap, stepDown, type DownState } from '../core/down';
import { KICK_PERIOD_TICKS } from '../core/kick';
import type { Inputs, PlayerId } from '../core/simulation';

export const zero = { x: 0, y: 0 };
export const idle: Inputs = { home: zero, away: zero };
export const MID = 26.66666666665;
export const place = (state: DownState, id: PlayerId, x: number, y: number): DownState => ({ ...state, players: state.players.map(p => p.id === id ? { ...p, x, y } : p) });
export const farAway = (state: DownState, except: PlayerId[] = []): DownState => ({ ...state, players: state.players.map(p => p.team !== state.offense && !except.includes(p.id) ? { ...p, x: state.offense === 'home' ? 100 : 20, y: 5 } : p) });

/** Ends a rush with a tackle after exactly `gain` yards: the carrier stands there with a defender touching him. */
export function tackled(start: DownState, gain: number): DownState {
    const live = snap(start), dir = direction(live.offense), x = live.line + dir * gain;
    const placed = { ...live, players: live.players.map(p => p.id === live.possession.carrier ? { ...p, x, y: MID } : p.id === live.defender ? { ...p, x: x + dir * 1, y: MID } : p) };
    const dead = stepDown(farAway(placed, [live.defender]), idle);
    expect(dead.result?.reason).toBe('tackle');
    return dead;
}
/** A touchdown run: the carrier is a step from the goal line. */
export function touchdown(start: DownState): DownState {
    const team = start.offense;
    let s = farAway(snap(start));
    s = place(s, s.possession.carrier, team === 'home' ? 109.9 : 10.1, MID);
    const dead = stepDown(s, { ...idle, [team]: { x: team === 'home' ? 1 : -1, y: 0 } });
    expect(dead.result?.reason).toBe('touchdown');
    return dead;
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
