import { describe, expect, it } from 'vitest';
import { BREAKUP_RADIUS, CATCH_RADIUS, SAFETY_POINTS, TOUCHDOWN_POINTS, choosePlay, createDown, direction, lineUp, nextDown, situation, snap, stepDown, throwPass, type DownState } from '../core/down';
import { STEP_SECONDS, type Inputs, type PlayerId } from '../core/simulation';

const zero = { x: 0, y: 0 };
const idle: Inputs = { home: zero, away: zero };
const MID = 26.66666666665;
const place = (state: DownState, id: PlayerId, x: number, y: number): DownState => ({ ...state, players: state.players.map(p => p.id === id ? { ...p, x, y } : p) });
const farAway = (state: DownState, except: PlayerId[] = []): DownState => ({ ...state, players: state.players.map(p => p.team !== state.offense && !except.includes(p.id) ? { ...p, x: state.offense === 'home' ? 100 : 20, y: 5 } : p) });

/** Ends a rush with a tackle after exactly `gain` yards: the carrier stands there with a defender touching him. */
function tackled(start: DownState, gain: number): DownState {
    const live = snap(start), dir = direction(live.offense), x = live.line + dir * gain;
    const placed = { ...live, players: live.players.map(p => p.id === live.possession.carrier ? { ...p, x, y: MID } : p.id === live.defender ? { ...p, x: x + dir * 1, y: MID } : p) };
    const dead = stepDown(farAway(placed, [live.defender]), idle);
    expect(dead.result?.reason).toBe('tackle');
    return dead;
}

/** A pass that nobody catches: the target stands far from the landing circle. */
function incomplete(start: DownState): DownState {
    let s = farAway(throwPass(snap(choosePlay(start, 'slants')), 1));
    s = place(s, 'home-3', 60, 5);
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
        expect(next.possession).toEqual({ team: 'away', carrier: 'away-1' });
        expect(next.defender).toBe('home-1');
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
        let s = farAway(throwPass(snap(choosePlay(createDown(), 'slants')), 1), ['away-3']);
        if (s.ball.kind !== 'flight') throw Error('flight');
        s = place(s, 'away-3', s.ball.to.x, s.ball.to.y);
        while (s.phase === 'live') s = stepDown(s, idle);
        expect(s.result).toMatchObject({ reason: 'interception', turnover: true, turnoverOnDowns: false, firstDown: false, yards: 0 });
        const next = nextDown(s);
        expect(next).toMatchObject({ offense: 'away', down: 1 });
        expect(next.line).toBeCloseTo(s.players.find(p => p.id === 'away-3')!.x, 10);
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
        return stepDown(s, { ...idle, [team]: { x: team === 'home' ? 1 : -1, y: 0 } });
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
        expect(s).toBe(dead);
        const next = nextDown(dead);
        expect(next.score).toEqual({ home: 6, away: 0 });
        expect(nextDown(next)).toBe(next);
        expect(stepDown(next, idle)).toBe(next);
        expect(next.terminalCount).toBe(dead.terminalCount);
    });
    it('after a score the other team gets the ball at its own 28, 1st and 10, attacking the other way', () => {
        const home = nextDown(touchdown('home'));
        expect(home).toMatchObject({ offense: 'away', line: 82, down: 1, firstDownLine: 72, phase: 'pre-snap', result: null });
        expect(home.possession).toEqual({ team: 'away', carrier: 'away-1' });
        const away = nextDown(touchdown('away'));
        expect(away).toMatchObject({ offense: 'home', line: 38, down: 1, firstDownLine: 48 });
    });
    it('a safety gives the defense two points and the ball back to the other side', () => {
        let s = farAway(snap(lineUp('home', 14)));
        s = place(s, s.possession.carrier, 10.05, MID);
        const dead = stepDown(s, { ...idle, home: { x: -1, y: 0 } });
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
        expect(again).toBe(dead);
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
        expect(s.score).toEqual({ home: 6, away: 0 });
        expect(s).toMatchObject({ offense: 'away', down: 1, line: 82 });
        expect(lines).toEqual([...lines].sort((a, b) => a - b));
    });
    it('an offense that goes nowhere loses the ball on downs after exactly four plays', () => {
        let s = createDown();
        for (let play = 1; play <= 4; play++) {
            expect(s.down).toBe(play);
            s = snap(s);
            while (s.phase === 'live') s = stepDown(s, idle);
            expect(s.result?.yards).toBe(0);
            s = nextDown(s);
        }
        expect(s).toMatchObject({ offense: 'away', down: 1, line: 38 });
    });
});

describe('pass boundaries', () => {
    /** One tick before arrival; every defender but away-3 is far away and away-3 is parked, so a test places who matters. */
    function arrival(play: 'slants' | 'go' = 'slants') {
        let s = farAway(throwPass(snap(choosePlay(createDown(), play)), 1), ['away-3']);
        if (s.ball.kind !== 'flight') throw Error('flight');
        const to = s.ball.to;
        s = { ...s, ball: { ...s.ball, elapsed: s.ball.duration - STEP_SECONDS } };
        return { base: place(s, 'away-3', 110, 5), to };
    }
    const resolve = (s: DownState) => stepDown(s, idle);
    it('a receiver inside the catch radius catches; outside it the pass is incomplete', () => {
        const { base, to } = arrival();
        const caught = resolve(place(base, 'home-3', to.x - (CATCH_RADIUS - 0.3), to.y));
        expect(caught.phase).toBe('live');
        expect(caught.possession.carrier).toBe('home-3');
        expect(resolve(place(base, 'home-3', to.x - (CATCH_RADIUS + 0.4), to.y)).result?.reason).toBe('incomplete');
    });
    it('a covering defender inside the catch radius intercepts; just outside it can only break the pass up', () => {
        const { base, to } = arrival();
        const open = place(base, 'home-3', to.x, to.y);
        expect(resolve(place(open, 'away-3', to.x + CATCH_RADIUS - 0.3, to.y)).result?.reason).toBe('interception');
        expect(resolve(place(open, 'away-3', to.x + CATCH_RADIUS + 0.4, to.y)).result?.reason).toBe('incomplete');
    });
    it('a defender within the break-up radius spoils a clean catch; beyond it the catch stands', () => {
        const { base, to } = arrival();
        const open = place(base, 'home-3', to.x, to.y);
        expect(resolve(place(open, 'away-3', to.x + BREAKUP_RADIUS - 0.3, to.y)).phase).toBe('dead');
        expect(resolve(place(open, 'away-3', to.x + BREAKUP_RADIUS + 0.4, to.y)).possession.carrier).toBe('home-3');
    });
    it('nobody far from the landing point can intercept', () => {
        const { base, to } = arrival();
        const open = place(base, 'home-3', to.x, to.y);
        for (const d of [5, 12, 40]) expect(resolve(place(open, 'away-3', to.x + d, to.y)).possession.team).toBe('home');
    });
});
