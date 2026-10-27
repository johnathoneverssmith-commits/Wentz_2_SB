import { describe, expect, it } from 'vitest';
import { BREAKUP_RADIUS, CATCH_RADIUS, SAFETY_POINTS, TOUCHDOWN_POINTS, choosePlay, createDown, direction, lineUp, nextDown, situation, snap, stepDown, throwPass, type DownState } from '../core/down';
import { STEP_SECONDS, type Inputs } from '../core/simulation';
import { CENTRE, MID, expectOnlyClockMoved, farAway, kickAtTick, place, seedShare, seedWhere, tackled, zero } from './helpers';

const idle: Inputs = { home: zero, away: zero };

/** A pass that nobody catches: the target stands far from the landing circle. */
function incomplete(start: DownState): DownState {
    let s = farAway(throwPass(snap(choosePlay(start, 'slants')), 1));
    s = place(s, 'home-WR1', 60, 5);
    while (s.phase === 'live') s = stepDown(s, idle);
    expect(s.result?.reason).toBe('incomplete');
    return s;
}

describe('four downs to gain ten yards', () => {
    it('begins 1st and 10 from the 38 with the marker at the 48', () => {
        const s = createDown();
        expect(s.down).toBe(1);
        expect(s.firstDownLine).toBe(48);
        expect(situation(s)).toEqual({ down: 1, toGo: 10, goalToGo: false });
        expect(s.score).toEqual({ home: 0, away: 0 });
    });
    it('a short gain uses a down, keeps the ball and keeps the marker', () => {
        const dead = tackled(createDown(), 4);
        expect(dead.result).toMatchObject({ yards: 4, firstDown: false, turnoverOnDowns: false, turnover: false });
        const next = nextDown(dead);
        expect(next).toMatchObject({ offense: 'home', down: 2, line: 42, firstDownLine: 48 });
        expect(situation(next)).toEqual({ down: 2, toGo: 6, goalToGo: false });
    });
    it('gaining the full ten gives a first down and a fresh marker', () => {
        const dead = tackled(createDown(), 10);
        expect(dead.result?.firstDown).toBe(true);
        const next = nextDown(dead);
        expect(next).toMatchObject({ offense: 'home', down: 1, line: 48, firstDownLine: 58 });
    });
    it('judges the marker at the displayed yardage: 9.94 is short, 9.96 shows 10.0 and converts', () => {
        expect(tackled(createDown(), 9.94).result).toMatchObject({ yards: 9.9, firstDown: false });
        expect(tackled(createDown(), 9.96).result).toMatchObject({ yards: 10, firstDown: true });
    });
    it('an incomplete pass uses a down at the same spot', () => {
        const next = nextDown(incomplete(createDown()));
        expect(next).toMatchObject({ offense: 'home', down: 2, line: 38, firstDownLine: 48 });
    });
    it('a negative play moves the spot back and leaves the marker', () => {
        const dead = tackled(createDown(), -3);
        const next = nextDown(dead);
        expect(next).toMatchObject({ down: 2, line: 35, firstDownLine: 48 });
        expect(situation(next).toGo).toBe(13);
    });
    it('fourth down short turns the ball over at the spot to the other team, 1st and 10 toward the other goal', () => {
        const dead = tackled(lineUp('home', 40, { down: 4 }), 4);
        expect(dead.result).toMatchObject({ turnoverOnDowns: true, turnover: false, firstDown: false, touchdown: false });
        const next = nextDown(dead);
        expect(next).toMatchObject({ offense: 'away', down: 1, line: 44, firstDownLine: 34 });
        expect(next.possession.team).toBe('away');
        expect(next.defender.startsWith('home-')).toBe(true);
    });
    it('fourth down converted keeps the ball', () => {
        const dead = tackled(lineUp('home', 40, { down: 4 }), 10);
        expect(dead.result).toMatchObject({ firstDown: true, turnoverOnDowns: false });
        expect(nextDown(dead)).toMatchObject({ offense: 'home', down: 1, line: 50, firstDownLine: 60 });
    });
    it('an incomplete pass on fourth down turns the ball over where it was snapped', () => {
        const dead = incomplete(lineUp('home', 40, { down: 4 }));
        expect(dead.result).toMatchObject({ reason: 'incomplete', turnoverOnDowns: true });
        expect(nextDown(dead)).toMatchObject({ offense: 'away', down: 1, line: 40, firstDownLine: 30 });
    });
    it('the away team counts yards and the marker toward the left end zone', () => {
        const dead = tackled(lineUp('away', 80), 7);
        expect(dead.result?.yards).toBe(7);
        expect(nextDown(dead)).toMatchObject({ offense: 'away', down: 2, line: 73, firstDownLine: 70 });
    });
    it('goal to go: the marker stops at the goal line and the distance is to the goal', () => {
        const s = lineUp('home', 105);
        expect(s.firstDownLine).toBe(110);
        expect(situation(s)).toEqual({ down: 1, toGo: 5, goalToGo: true });
        expect(situation(lineUp('away', 14))).toEqual({ down: 1, toGo: 4, goalToGo: true });
        expect(nextDown(tackled(s, 3))).toMatchObject({ down: 2, line: 108, firstDownLine: 110 });
    });
    it('an interception is a turnover: the interceptor spot, 1st and 10 for the new offense, no down used', () => {
        // staged under a seed on which the defender on the spot takes the ball (whether he does is chance: core/catch.ts)
        const stage = (seed: number) => {
            let s = farAway(throwPass(snap(choosePlay(createDown(seed), 'slants')), 1), ['away-CB1']);
            if (s.ball.kind !== 'flight') throw Error('flight');
            // the interceptor is on the spot as the ball arrives (a covering defender reacts to the pass, so he is put there one tick before it lands)
            while (s.ball.kind === 'flight' && s.ball.elapsed < s.ball.duration - STEP_SECONDS - 1e-9) s = stepDown(farAway(s, ['away-CB1']), idle);
            if (s.ball.kind !== 'flight') throw Error('flight');
            s = place(s, 'away-CB1', s.ball.to.x, s.ball.to.y);
            while (s.phase === 'live') s = stepDown(s, idle);
            return s;
        };
        const s = stage(seedWhere(stage, e => e.result?.reason === 'interception'));
        expect(s.result).toMatchObject({ reason: 'interception', turnover: true, turnoverOnDowns: false, firstDown: false, yards: 0 });
        const next = nextDown(s);
        expect(next).toMatchObject({ offense: 'away', down: 1 });
        expect(next.line).toBeCloseTo(s.players.find(p => p.id === 'away-CB1')!.x, 10);
        expect(next.firstDownLine).toBeCloseTo(next.line - 10, 10);
    });
    it('a long pass on fourth down that is caught but tackled short is a turnover on downs', () => {
        const dead = tackled(lineUp('home', 60, { down: 4 }), 6);
        expect(dead.result?.turnoverOnDowns).toBe(true);
        expect(nextDown(dead)).toMatchObject({ offense: 'away', line: 66, down: 1 });
    });
});

describe('scoring', () => {
    function touchdown(team: 'home' | 'away' = 'home', score = { home: 0, away: 0 }) {
        const start = lineUp(team, team === 'home' ? 100 : 20, { score });
        let s = farAway(snap(start));
        s = place(s, s.possession.carrier, team === 'home' ? 109.9 : 10.1, MID);
        for (let i = 0; i < 30 && s.phase === 'live'; i++) s = stepDown(s, { ...idle, [team]: { x: team === 'home' ? 1 : -1, y: 0 } });
        return s;
    }
    it('a touchdown is worth six, credited once to the scoring team', () => {
        const dead = touchdown();
        expect(dead.result).toMatchObject({ reason: 'touchdown', touchdown: true, turnover: false });
        expect(dead.score).toEqual({ home: TOUCHDOWN_POINTS, away: 0 });
        expect(touchdown('away').score).toEqual({ home: 0, away: 6 });
        expect(touchdown('home', { home: 13, away: 7 }).score).toEqual({ home: 19, away: 7 });
    });
    it('further simulation, repeated Next down and a rebuilt next snap never change the score', () => {
        const dead = touchdown();
        let s = dead;
        for (let i = 0; i < 120; i++) s = stepDown(s, idle);
        expectOnlyClockMoved(s, dead);
        const next = nextDown(dead);
        expect(next).toMatchObject({ phase: 'kick', score: { home: 6, away: 0 } });
        expect(nextDown(next)).toBe(next);
        let swinging = next;
        for (let i = 0; i < 50; i++) swinging = stepDown(swinging, idle);
        expect(swinging.score).toEqual({ home: 6, away: 0 });
        expect(next.terminalCount).toBe(dead.terminalCount);
    });
    it('after a score the other team gets the ball at its own 28, 1st and 10, attacking the other way', () => {
        const home = nextDown(kickAtTick(nextDown(touchdown('home')), CENTRE));
        expect(home).toMatchObject({ offense: 'away', line: 82, down: 1, firstDownLine: 72, phase: 'pre-snap', result: null });
        expect(home.possession.team).toBe('away');
        const away = nextDown(kickAtTick(nextDown(touchdown('away')), CENTRE));
        expect(away).toMatchObject({ offense: 'home', line: 38, down: 1, firstDownLine: 48 });
    });
    it('a safety gives the defense two points and the ball back to the other side', () => {
        let s = farAway(snap(lineUp('home', 14)));
        s = place(s, s.possession.carrier, 10.05, MID);
        let dead = s;
        for (let i = 0; i < 30 && dead.phase === 'live'; i++) dead = stepDown(dead, { ...idle, home: { x: -1, y: 0 } });
        expect(dead.result).toMatchObject({ reason: 'safety', turnover: true, touchdown: false });
        expect(dead.score).toEqual({ home: 0, away: SAFETY_POINTS });
        expect(nextDown(dead)).toMatchObject({ offense: 'away', line: 82, down: 1 });
    });
    it('non-scoring plays leave both scores alone', () => {
        const dead = tackled(createDown(), 5);
        expect(dead.score).toEqual({ home: 0, away: 0 });
        expect(nextDown(dead).score).toEqual({ home: 0, away: 0 });
    });
    it('a play that ends one way cannot also end another: one terminal event, one score', () => {
        const dead = touchdown();
        expect(dead.terminalCount).toBe(1);
        const again = stepDown(dead, { ...idle, home: { x: -1, y: 0 } });
        expectOnlyClockMoved(again, dead);
    });
});

describe('a drive from real play', () => {
    it('an offense that keeps running right converts first downs and scores exactly once; the ball then changes sides', () => {
        let s = createDown();
        const firstDowns: number[] = [];
        const lines: number[] = [];
        for (let play = 1; play < 60 && s.offense === 'home' && s.score.home === 0; play++) {
            s = snap(s);
            while (s.phase === 'live') s = stepDown(s, { home: { x: 1, y: 0 }, away: zero });
            expect(s.terminalCount).toBe(play);
            if (s.result!.firstDown) firstDowns.push(play);
            lines.push(s.line);
            s = nextDown(s);
        }
        expect(firstDowns.length).toBeGreaterThanOrEqual(4);
        expect(s).toMatchObject({ phase: 'kick', score: { home: 6, away: 0 } });
        s = nextDown(kickAtTick(s, CENTRE));
        expect(s.score).toEqual({ home: 7, away: 0 });
        expect(s).toMatchObject({ offense: 'away', down: 1, line: 82 });
        expect(lines).toEqual([...lines].sort((a, b) => a - b));
    });
    it('an offense that goes nowhere loses the ball on downs after exactly four plays', () => {
        let s = createDown();
        for (let play = 1; play <= 4; play++) {
            expect(s.down).toBe(play);
            s = snap(s);
            while (s.phase === 'live') s = stepDown(s, idle);
            expect(s.result?.yards, 'a runner standing in the backfield loses ground').toBeLessThanOrEqual(0);
            s = nextDown(s);
        }
        expect(s).toMatchObject({ offense: 'away', down: 1 });
    });
});

describe('pass boundaries', () => {
    // Catches are chance (core/catch.ts): these are about how the odds follow the geometry, so each scene is played under 200 seeds and the share counted.
    /** One tick before arrival; every defender but away-CB1 is far away, and CB1 is parked, so a test places who matters. */
    const arrival = (seed: number, play: 'slants' | 'go' = 'slants') => {
        let s = farAway(throwPass(snap(choosePlay(createDown(seed), play)), 1), ['away-CB1']);
        if (s.ball.kind !== 'flight') throw Error('flight');
        const to = s.ball.to;
        s = { ...s, ball: { ...s.ball, elapsed: s.ball.duration - STEP_SECONDS } };
        return { base: place(s, 'away-CB1', 110, 5), to };
    };
    const resolve = (s: DownState) => stepDown(s, idle);
    /** The share of seeds on which the scene `put` builds ends with `accept`. */
    const share = (put: (base: DownState, to: { x: number; y: number }) => DownState, accept: (end: DownState) => boolean) =>
        seedShare(seed => { const { base, to } = arrival(seed); return resolve(put(base, to)); }, accept);
    const caught = (s: DownState) => s.possession.carrier === 'home-WR1' && s.phase === 'live';
    it('a receiver on or near the ball catches it nearly always; the farther from it, the less often, and a receiver far from it never does', () => {
        const at = (d: number) => share((base, to) => place(base, 'home-WR1', to.x - d, to.y), caught);
        expect(at(CATCH_RADIUS - 1.3)).toBeGreaterThan(0.85);
        expect(at(CATCH_RADIUS - 0.3)).toBeGreaterThan(0.55);
        expect(at(CATCH_RADIUS + 0.4)).toBeLessThan(0.4);
        expect(at(CATCH_RADIUS + 0.4)).toBeLessThan(at(CATCH_RADIUS - 0.3));
        expect(at(4.5)).toBe(0);
    });
    it('a defender on the ball intercepts it sometimes, not always; one a long way off never does', () => {
        const picked = (gap: number) => share((base, to) => place(place(base, 'home-WR1', to.x, to.y), 'away-CB1', to.x - gap, to.y), s => s.result?.reason === 'interception');
        expect(picked(0.4)).toBeGreaterThan(0.05); expect(picked(0.4)).toBeLessThan(0.9);
        expect(picked(CATCH_RADIUS - 0.3)).toBeGreaterThan(0.03);
        expect(picked(5)).toBe(0);
    });
    it('a defender near the ball spoils a clean catch more often than not, and one far from it does not', () => {
        const spoiled = (gap: number) => share((base, to) => place(place(base, 'home-WR1', to.x, to.y), 'away-CB1', to.x - gap, to.y), s => s.phase === 'dead');
        expect(spoiled(0.6)).toBeGreaterThan(0.3);
        expect(spoiled(0.6)).toBeGreaterThan(spoiled(BREAKUP_RADIUS - 0.3));
        expect(spoiled(BREAKUP_RADIUS - 0.3)).toBeGreaterThan(spoiled(BREAKUP_RADIUS + 1.5) - 0.01);
        expect(spoiled(BREAKUP_RADIUS + 2.3), 'beyond his reach').toBeLessThan(0.15);
    });
    it('a defender who cannot reach the ball changes nothing for a receiver a little off the catch point', () => {
        const off = (gap?: number) => share((base, to) => { const r = place(base, 'home-WR1', to.x - (CATCH_RADIUS - 0.3), to.y); return gap === undefined ? r : place(r, 'away-CB1', to.x - gap, to.y); }, caught);
        expect(Math.abs(off(4.5) - off())).toBeLessThan(0.03);
        expect(off(0.6), 'a defender on the ball does').toBeLessThan(off() - 0.1);
    });
    it('nobody far from the landing point can intercept', () => {
        const { base, to } = arrival(1);
        const open = place(base, 'home-WR1', to.x, to.y);
        for (const d of [5, 12, 40]) expect(resolve(place(open, 'away-CB1', to.x + d, to.y)).possession.team).toBe('home');
    });
});
