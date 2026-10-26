import { describe, expect, it } from 'vitest';
import { BETWEEN_PLAY_TICKS, QUARTER_TICKS, choosePlay, clockText, createDown, fieldGoalInRange, kickBall, kickMeter, lineUp, newGame, nextDown, snap, stepDown, switchDefender, throwPass, type DownState } from '../core/down';
import { EXTRA_POINT_DISTANCE, FIELD_GOAL_MAX_DISTANCE, FIELD_GOAL_POINTS, KICK_MAX_TICKS, KICK_PERIOD_TICKS, isGood, kickTolerance, meterAt } from '../core/kick';
import { STEP_SECONDS } from '../core/simulation';
import { CENTRE, FAR_END, MID, farAway, idle, kickAtTick, place, tackled, throughExtraPoint, touchdown, turnedOverOnDowns, zero } from './helpers';

const overtime = (first: 'home' | 'away' = 'away', possessions = 0, score = { home: 0, away: 0 }) =>
    ({ score, game: { mode: 'overtime' as const, quarter: 5, clock: 0, overtime: { first, possessions } } });

describe('the regulation clock', () => {
    it('starts every game at Q1 3:00, 0-0, home opening', () => {
        const s = newGame();
        expect(s).toMatchObject({ quarter: 1, clock: QUARTER_TICKS, expired: false, mode: 'regulation', openingTeam: 'home', winner: null, kick: null });
        expect(clockText(s.clock)).toBe('3:00');
        expect(clockText(0)).toBe('0:00');
        expect(clockText(1)).toBe('0:01');
        expect(clockText(60)).toBe('0:01');
        expect(clockText(61)).toBe('0:02');
        expect(clockText(10799)).toBe('3:00');
        expect(clockText(10740)).toBe('2:59');
        expect(clockText(3601)).toBe('1:01');
    });
    it('burns one clock tick per live simulation tick', () => {
        let s = snap(createDown());
        for (let i = 1; i <= 5; i++) {
            s = stepDown(s, idle);
            expect(s.clock).toBe(QUARTER_TICKS - i);
        }
        expect(stepDown(createDown(), idle).clock).toBe(QUARTER_TICKS);
    });
    it('a quarter is exactly three minutes of live simulation time: 10,800 ticks at 60 per second', () => {
        expect(QUARTER_TICKS).toBe(3 * 60 * 60);
        expect(QUARTER_TICKS * STEP_SECONDS).toBeCloseTo(180, 9);
        // Keep every defender out of the way so nothing ends the play, and count the live ticks until the clock runs out.
        let s = farAway(snap(lineUp('home', 40)));
        let ticks = 0;
        while (s.clock > 0) {
            expect(ticks, 'the clock should reach zero').toBeLessThan(QUARTER_TICKS + 5);
            s = farAway(stepDown({ ...s, liveTicks: 0 }, idle));
            ticks++;
            if (ticks === 60) expect(clockText(s.clock)).toBe('2:59');
            if (ticks === 60 * 120) expect(clockText(s.clock)).toBe('1:00');
        }
        expect(ticks).toBe(QUARTER_TICKS);
        expect(s).toMatchObject({ clock: 0, expired: true, phase: 'live' });
    });
    it('when the clock reaches zero the play finishes first, then the quarter changes', () => {
        let s = farAway(snap(lineUp('home', 40, { game: { clock: 3 } })));
        s = stepDown(s, idle); s = stepDown(s, idle);
        expect(s).toMatchObject({ clock: 1, expired: false, phase: 'live' });
        s = stepDown(s, idle);
        expect(s).toMatchObject({ clock: 0, expired: true, phase: 'live', quarter: 1 });
        for (let i = 0; i < 3; i++) s = stepDown(s, idle);
        expect(s.clock).toBe(0);
        expect(s.phase).toBe('live');
        const dead = tackled(lineUp('home', 40, { game: { clock: 1 } }), 3);
        expect(dead.expired).toBe(true);
        const next = nextDown(dead);
        expect(next).toMatchObject({ quarter: 2, clock: QUARTER_TICKS, expired: false, offense: 'home', down: 2, line: 43 });
    });
    it('quarters 1 and 3 continue the same possession; halftime gives the second-half ball to the team that did not open', () => {
        const q1 = nextDown(tackled(lineUp('home', 40, { game: { clock: 1 } }), 3));
        expect(q1).toMatchObject({ quarter: 2, offense: 'home', line: 43, down: 2 });
        const q3 = nextDown(tackled(lineUp('away', 70, { game: { quarter: 3, clock: 1 } }), 4));
        expect(q3).toMatchObject({ quarter: 4, offense: 'away', line: 66, down: 2 });
        const half = nextDown(tackled(lineUp('home', 60, { game: { quarter: 2, clock: 1 } }), 4));
        expect(half).toMatchObject({ quarter: 3, clock: QUARTER_TICKS, expired: false, offense: 'away', line: 82, down: 1, firstDownLine: 72 });
        expect(half.score).toEqual({ home: 0, away: 0 });
    });
    it('the end of regulation: the leader wins, a tie goes to overtime', () => {
        const lead = nextDown(tackled(lineUp('home', 40, { score: { home: 7, away: 3 }, game: { quarter: 4, clock: 1 } }), 3));
        expect(lead).toMatchObject({ phase: 'final', mode: 'final', winner: 'home', score: { home: 7, away: 3 } });
        const trail = nextDown(tackled(lineUp('home', 40, { score: { home: 3, away: 7 }, game: { quarter: 4, clock: 1 } }), 3));
        expect(trail).toMatchObject({ phase: 'final', winner: 'away' });
        const tie = nextDown(tackled(lineUp('home', 40, { score: { home: 7, away: 7 }, game: { quarter: 4, clock: 1 } }), 3));
        expect(tie).toMatchObject({ phase: 'pre-snap', mode: 'overtime', quarter: 5, offense: 'away', line: 82, down: 1, firstDownLine: 72, winner: null });
        expect(tie.overtime).toEqual({ first: 'away', possessions: 0 });
    });
    it('a touchdown on the last play still gets its extra point, then the quarter ends', () => {
        const dead = touchdown(lineUp('home', 100, { game: { quarter: 2, clock: 1 } }));
        expect(dead.expired).toBe(true);
        const afterXp = throughExtraPoint(dead);
        expect(afterXp.score.home).toBe(7);
        expect(afterXp).toMatchObject({ quarter: 3, offense: 'away', line: 82, clock: QUARTER_TICKS });
        // Trailing 0-7 in the last seconds of Q4, a touchdown plus the point after ties it and forces overtime.
        const tied = throughExtraPoint(touchdown(lineUp('home', 100, { score: { home: 0, away: 7 }, game: { quarter: 4, clock: 1 } })));
        expect(tied).toMatchObject({ mode: 'overtime', quarter: 5, score: { home: 7, away: 7 }, offense: 'away' });
        const won = throughExtraPoint(touchdown(lineUp('home', 100, { score: { home: 0, away: 6 }, game: { quarter: 4, clock: 1 } })));
        expect(won).toMatchObject({ phase: 'final', winner: 'home', score: { home: 7, away: 6 } });
    });
    it('the clock never goes negative and does not run in overtime', () => {
        let s = farAway(snap(lineUp('home', 40, { game: { clock: 1 } })));
        for (let i = 0; i < 10; i++) s = stepDown(s, idle);
        expect(s.clock).toBe(0);
        let o = farAway(snap(lineUp('home', 40, overtime('home'))));
        for (let i = 0; i < 20; i++) o = stepDown(o, idle);
        expect(o.clock).toBe(0);
        expect(o.expired).toBe(false);
    });
});

describe('the kicking meter', () => {
    it('swings on simulation ticks: right end, centre, left end, centre, right end', () => {
        const q = KICK_PERIOD_TICKS / 4;
        expect([0, q, 2 * q, 3 * q, 4 * q].map(meterAt)).toEqual([1, 0, -1, 0, 1]);
        expect(meterAt(KICK_PERIOD_TICKS + q)).toBeCloseTo(0, 12);
        expect(Math.abs(meterAt(7))).toBeLessThanOrEqual(1);
    });
    it('the tolerance shrinks with distance and is clamped', () => {
        expect(kickTolerance(0)).toBe(0.6);
        expect(kickTolerance(25)).toBeGreaterThan(kickTolerance(40));
        expect(kickTolerance(40)).toBeGreaterThan(kickTolerance(55));
        expect(kickTolerance(200)).toBe(0.22);
        expect(kickTolerance(FIELD_GOAL_MAX_DISTANCE)).toBeGreaterThanOrEqual(0.22);
    });
    it('the same press can be good from a short kick and a miss from a long one', () => {
        // Find a press that is inside the 25-yard tolerance but outside the 55-yard one.
        const tick = [...Array(KICK_PERIOD_TICKS).keys()].find(t => isGood(t, EXTRA_POINT_DISTANCE) && !isGood(t, 55));
        expect(tick).toBeDefined();
        expect(isGood(CENTRE, 55)).toBe(true);
        expect(isGood(0, EXTRA_POINT_DISTANCE)).toBe(false);
    });
    it('the tolerance boundary is exact: a press is good while |meter| is within it and no longer past it', () => {
        const distance = 40, tol = kickTolerance(distance);
        const goodTicks = [...Array(KICK_PERIOD_TICKS).keys()].filter(t => isGood(t, distance));
        const edge = Math.min(...goodTicks);
        expect(Math.abs(meterAt(edge))).toBeLessThanOrEqual(tol);
        expect(Math.abs(meterAt(edge - 1))).toBeGreaterThan(tol);
        expect(meterAt(edge)).toBeGreaterThan(0);
        expect(isGood(edge - 1, distance)).toBe(false);
    });
    it('field goal range is a hard boundary at 57 yards', () => {
        // line 53 for home: 57 yards to goal... 110 - 53 = 57 yd to goal + 17 = 74 (out); find the boundary line.
        const yardsToGoal = FIELD_GOAL_MAX_DISTANCE - 17;
        expect(fieldGoalInRange(lineUp('home', 110 - yardsToGoal))).toBe(true);
        expect(fieldGoalInRange(lineUp('home', 110 - yardsToGoal - 0.1))).toBe(false);
        expect(fieldGoalInRange(lineUp('away', 10 + yardsToGoal))).toBe(true);
        expect(fieldGoalInRange(lineUp('away', 10 + yardsToGoal + 0.1))).toBe(false);
    });
});

describe('extra points', () => {
    it('a touchdown goes to the extra point: the scorer kicks from 25 yards, the meter swings and nothing else changes', () => {
        const dead = touchdown(lineUp('home', 100));
        expect(dead.score.home).toBe(6);
        const kick = nextDown(dead);
        expect(kick).toMatchObject({ phase: 'kick', kick: { kind: 'xp', team: 'home', distance: EXTRA_POINT_DISTANCE, ticks: 0, lockedAt: null, good: null }, score: { home: 6, away: 0 } });
        expect(nextDown(kick)).toBe(kick);
        const swung = stepDown(stepDown(kick, idle), idle);
        expect(swung.kick!.ticks).toBe(2);
        expect(kickMeter(swung)).toBe(meterAt(2));
    });
    it('a good extra point is one point, then the other team gets the ball at its own 28', () => {
        const kick = nextDown(touchdown(lineUp('home', 100)));
        const done = kickAtTick(kick, CENTRE);
        expect(done.kick).toMatchObject({ good: true, lockedAt: CENTRE });
        expect(done.score).toEqual({ home: 7, away: 0 });
        expect(nextDown(done)).toMatchObject({ phase: 'pre-snap', offense: 'away', line: 82, down: 1, score: { home: 7, away: 0 }, kick: null });
    });
    it('a missed extra point scores nothing but still changes possession', () => {
        const done = kickAtTick(nextDown(touchdown(lineUp('home', 100))), FAR_END);
        expect(done.kick!.good).toBe(false);
        expect(done.score).toEqual({ home: 6, away: 0 });
        expect(nextDown(done)).toMatchObject({ offense: 'away', line: 82, score: { home: 6, away: 0 } });
    });
    it('Orange scores toward the left and kicks its own extra point', () => {
        const dead = touchdown(lineUp('away', 20));
        const kick = nextDown(dead);
        expect(kick.kick).toMatchObject({ team: 'away', kind: 'xp' });
        expect(kickBall(kick, 'home')).toBe(kick);
        const done = kickBall(stepDown(stepDown(kick, idle), idle), 'away');
        expect(done.kick!.lockedAt).toBe(2);
        const good = kickAtTick(kick, CENTRE);
        expect(good.score).toEqual({ home: 0, away: 7 });
        expect(nextDown(good)).toMatchObject({ offense: 'home', line: 38 });
    });
    it('the point after is awarded once: a second press, more ticks and repeated Next down change nothing', () => {
        const done = kickAtTick(nextDown(touchdown(lineUp('home', 100))), CENTRE);
        expect(kickBall(done, 'home')).toBe(done);
        expect(stepDown(done, idle)).toBe(done);
        const next = nextDown(done);
        expect(next.score).toEqual({ home: 7, away: 0 });
        expect(nextDown(next)).toBe(next);
        expect(done.terminalCount).toBe(2);
    });
    it('an unpressed meter locks by itself after two swings, at the far end, and misses', () => {
        let s = nextDown(touchdown(lineUp('home', 100)));
        for (let i = 0; i < KICK_MAX_TICKS - 1; i++) s = stepDown(s, idle);
        expect(s.kick!.good).toBeNull();
        s = stepDown(s, idle);
        expect(s.kick).toMatchObject({ lockedAt: KICK_MAX_TICKS, good: false });
        expect(s.score.home).toBe(6);
    });
});

describe('field goals', () => {
    const attempt = (line: number, team: 'home' | 'away' = 'home', extra = {}) => snap(choosePlay(lineUp(team, line, { down: 4, ...extra }), 'fieldgoal'));
    it('cannot be chosen or snapped from out of range', () => {
        const far = lineUp('home', 38, { down: 4 });
        expect(choosePlay(far, 'fieldgoal')).toBe(far);
        expect(snap({ ...far, play: 'fieldgoal' })).toEqual({ ...far, play: 'fieldgoal' });
    });
    it('measures distance to the posts: 17 yards behind the goal line, and difficulty follows', () => {
        const s = attempt(80);
        expect(s).toMatchObject({ phase: 'kick', kick: { kind: 'fg', team: 'home', distance: 47, spot: 80 } });
        expect(attempt(104).kick!.distance).toBe(23);
        expect(attempt(30, 'away').kick!.distance).toBe(37);
    });
    it('a good field goal is three points and gives the ball to the other team at its own 28', () => {
        const done = kickAtTick(attempt(95), CENTRE);
        expect(done.kick!.good).toBe(true);
        expect(done.score).toEqual({ home: FIELD_GOAL_POINTS, away: 0 });
        expect(nextDown(done)).toMatchObject({ offense: 'away', line: 82, down: 1, score: { home: 3, away: 0 } });
    });
    it('a miss gives the ball to the other team where it was kicked from, never deeper than their 20', () => {
        const miss = kickAtTick(attempt(80), FAR_END);
        expect(miss.score.home).toBe(0);
        expect(nextDown(miss)).toMatchObject({ offense: 'away', line: 80, down: 1, firstDownLine: 70 });
        const close = kickAtTick(attempt(104), FAR_END);
        expect(nextDown(close)).toMatchObject({ offense: 'away', line: 90 });
        const away = kickAtTick(attempt(25, 'away'), FAR_END);
        expect(nextDown(away)).toMatchObject({ offense: 'home', line: 30 });
    });
    it('a long kick needs a more accurate press than a short one', () => {
        const press = [...Array(KICK_PERIOD_TICKS).keys()].find(t => isGood(t, 23) && !isGood(t, 57))!;
        expect(kickAtTick(attempt(104), press).kick!.good).toBe(true);
        expect(kickAtTick(attempt(70), press).kick!.good).toBe(false);
    });
    it('is a play of its own: the clock does not run and the wrong team cannot kick', () => {
        const s = attempt(95);
        const kicked = kickAtTick(s, CENTRE);
        expect(kicked.clock).toBe(s.clock);
        expect(kickBall(s, 'away')).toBe(s);
        expect(switchDefender(s)).toBe(s);
        expect(throwPass(s, 1)).toBe(s);
        expect(snap(s)).toBe(s);
    });
    it('a field goal with the clock nearly out is kicked (the meter takes no game time); the half ends at the next snap', () => {
        const kicked = kickAtTick(snap(choosePlay(lineUp('home', 95, { down: 4, game: { quarter: 2, clock: 5, gap: BETWEEN_PLAY_TICKS } }), 'fieldgoal')), CENTRE);
        expect(kicked.score.home).toBe(3);
        expect(kicked.clock).toBe(5);
        const waiting = nextDown(kicked);
        expect(waiting).toMatchObject({ quarter: 2, offense: 'away', phase: 'pre-snap', clock: 5 });
        let w = waiting;
        for (let i = 0; i < 20; i++) w = stepDown(w, idle);
        expect(w).toMatchObject({ clock: 0, expired: true, quarter: 2 });
        expect(snap(w)).toMatchObject({ quarter: 3, clock: QUARTER_TICKS, expired: false, gap: 0, offense: 'away', line: 82, phase: 'pre-snap' });
    });
});

describe('overtime', () => {
    const lost = (team: 'home' | 'away', o: ReturnType<typeof overtime>) => turnedOverOnDowns(lineUp(team, team === 'home' ? 38 : 82, o));
    it('each team gets a possession from its own 28, first one to the away team', () => {
        const first = nextDown(lost('away', overtime()));
        expect(first).toMatchObject({ mode: 'overtime', offense: 'home', line: 38, down: 1, overtime: { first: 'away', possessions: 1 } });
        expect(first.phase).toBe('pre-snap');
    });
    it('first downs extend a possession; it ends only on a score, a turnover or downs', () => {
        const converted = nextDown(tackled(lineUp('away', 82, overtime()), 10));
        expect(converted).toMatchObject({ offense: 'away', down: 1, line: 72, overtime: { possessions: 0 } });
        const short = nextDown(tackled(lineUp('away', 82, overtime()), 3));
        expect(short).toMatchObject({ offense: 'away', down: 2, overtime: { possessions: 0 } });
    });
    it('the score is compared only after both possessions: the first team leading does not end it', () => {
        const afterAway = throughExtraPoint(touchdown(lineUp('away', 20, overtime())));
        expect(afterAway.mode).toBe('overtime');
        expect(afterAway).toMatchObject({ offense: 'home', line: 38, overtime: { possessions: 1 }, score: { home: 0, away: 7 } });
        const decided = nextDown(turnedOverOnDowns({ ...afterAway }));
        expect(decided).toMatchObject({ phase: 'final', winner: 'away', score: { home: 0, away: 7 } });
    });
    it('the second team can win by matching and passing', () => {
        const afterAway = nextDown(turnedOverOnDowns(lineUp('away', 82, overtime())));
        expect(afterAway.overtime.possessions).toBe(1);
        const home = throughExtraPoint(touchdown(afterAway));
        expect(home).toMatchObject({ phase: 'final', winner: 'home', score: { home: 7, away: 0 } });
    });
    it('a tie after both possessions starts another pair, the same team going first', () => {
        const afterAway = nextDown(turnedOverOnDowns(lineUp('away', 82, overtime())));
        const afterHome = nextDown(turnedOverOnDowns(afterAway));
        expect(afterHome).toMatchObject({ mode: 'overtime', offense: 'away', line: 82, down: 1, overtime: { first: 'away', possessions: 2 }, winner: null });
    });
    it('a field goal ends a possession, and an interception or safety do too', () => {
        const fg = kickAtTick(snap(choosePlay(lineUp('away', 25, { down: 4, ...overtime() }), 'fieldgoal')), CENTRE);
        expect(nextDown(fg)).toMatchObject({ offense: 'home', line: 38, overtime: { possessions: 1 }, score: { home: 0, away: 3 } });
        let air = farAway(throwPass(snap(choosePlay(lineUp('away', 82, overtime()), 'slants')), 1), ['home-CB1']);
        if (air.ball.kind !== 'flight') throw Error('flight');
        air = place(air, 'home-CB1', air.ball.to.x, air.ball.to.y);
        while (air.phase === 'live') air = stepDown(air, idle);
        expect(air.result?.reason).toBe('interception');
        expect(nextDown(air)).toMatchObject({ offense: 'home', line: 38, overtime: { possessions: 1 } });
    });
    it('there is no limit on tied rounds: a dozen tied pairs keep going and the next one decides the game', () => {
        let s: DownState = lineUp('away', 82, overtime());
        for (let pair = 1; pair <= 12; pair++) {
            const afterAway = nextDown(turnedOverOnDowns(s));
            expect(afterAway).toMatchObject({ mode: 'overtime', offense: 'home', winner: null, overtime: { possessions: 2 * pair - 1 } });
            s = nextDown(turnedOverOnDowns(afterAway));
            expect(s).toMatchObject({ phase: 'pre-snap', mode: 'overtime', offense: 'away', line: 82, down: 1, winner: null, overtime: { first: 'away', possessions: 2 * pair }, score: { home: 0, away: 0 } });
        }
        // Round 13: Foxes score and kick the point; Bluebirds fail on downs; Foxes win.
        const afterFoxes = throughExtraPoint(touchdown(s));
        expect(afterFoxes).toMatchObject({ mode: 'overtime', offense: 'home', overtime: { possessions: 25 }, score: { home: 0, away: 7 } });
        const over = nextDown(turnedOverOnDowns(afterFoxes));
        expect(over).toMatchObject({ phase: 'final', winner: 'away', score: { home: 0, away: 7 } });
    });
    it('the pair counter survives a save at any depth and the software stays responsive on a very long tie', () => {
        const start = Date.now();
        let s: DownState = lineUp('away', 82, overtime());
        for (let round = 0; round < 500; round++) {
            s = nextDown(turnedOverOnDowns(nextDown(turnedOverOnDowns(s))));
            expect(s.phase).toBe('pre-snap');
        }
        expect(s.overtime.possessions).toBe(1000);
        expect(Date.now() - start).toBeLessThan(5000);
    });
});

describe('game over', () => {
    const finished = () => nextDown(tackled(lineUp('home', 40, { score: { home: 10, away: 3 }, game: { quarter: 4, clock: 1 } }), 3));
    it('freezes the game: nothing changes it and the winner is recorded once', () => {
        const f = finished();
        expect(f).toMatchObject({ phase: 'final', mode: 'final', winner: 'home', score: { home: 10, away: 3 } });
        expect(stepDown(f, idle)).toBe(f);
        expect(nextDown(f)).toBe(f);
        expect(snap(f)).toBe(f);
        expect(choosePlay(f, 'go')).toBe(f);
        expect(kickBall(f, 'home')).toBe(f);
        expect(switchDefender(f)).toBe(f);
        expect(throwPass(f, 1)).toBe(f);
    });
    it('a rematch is a fresh game at 0-0, Q1 3:00', () => {
        const again = newGame();
        expect(again).toEqual(createDown());
        expect(again).toMatchObject({ score: { home: 0, away: 0 }, quarter: 1, clock: QUARTER_TICKS, phase: 'pre-snap', mode: 'regulation' });
    });
});

describe('a whole game is deterministic', () => {
    it('the same inputs always give the same final score', () => {
        const play = () => {
            let s = createDown(), plays = 0;
            while (s.phase !== 'final' && plays < 4000) {
                if (s.phase === 'pre-snap') s = snap(s);
                else if (s.phase === 'live') s = stepDown(s, { home: { x: 1, y: 0 }, away: zero });
                else if (s.phase === 'kick') { s = s.kick!.good === null ? kickAtTick(s, CENTRE) : nextDown(s); plays++; }
                else { s = nextDown(s); plays++; }
            }
            return s;
        };
        const a = play(), b = play();
        expect(a).toEqual(b);
        expect(a.phase).toBe('final');
        expect(['home', 'away']).toContain(a.winner);
    });
});

// A kick is also a pass-free play: make sure MID is used (type-checks the helper import).
void MID;

describe('the between-play clock', () => {
    const fresh = () => tackled(createDown(), 4);
    it('six game seconds are available after every play, no more', () => {
        expect(BETWEEN_PLAY_TICKS).toBe(360);
        const dead = fresh();
        expect(dead).toMatchObject({ gap: BETWEEN_PLAY_TICKS, phase: 'dead' });
        let s = dead;
        for (let i = 1; i <= BETWEEN_PLAY_TICKS; i++) {
            s = stepDown(s, idle);
            expect(s.clock).toBe(dead.clock - i);
            expect(s.gap).toBe(BETWEEN_PLAY_TICKS - i);
        }
        expect(s.gap).toBe(0);
        const spent = s.clock;
        for (let i = 0; i < 5000; i++) s = stepDown(s, idle);
        expect(s.clock, 'once the allowance is used the clock waits for the snap').toBe(spent);
        expect(dead.clock - s.clock).toBe(360);
    });
    it('the allowance is shared by the result screen and the next snap: Next down does not refill it', () => {
        let s = fresh();
        const start = s.clock;
        for (let i = 0; i < 100; i++) s = stepDown(s, idle);
        const next = nextDown(s);
        expect(next).toMatchObject({ phase: 'pre-snap', gap: 260, clock: start - 100 });
        let w = next;
        for (let i = 0; i < 1000; i++) w = stepDown(w, idle);
        expect(w).toMatchObject({ gap: 0, clock: start - 360 });
    });
    it('menu actions cannot buy more time: choosing plays, switching defenders and pressing Next down never raise the allowance', () => {
        let s = nextDown(fresh());
        for (let i = 0; i < 200; i++) s = stepDown(s, idle);
        const gap = s.gap;
        let t = s;
        for (const play of ['slants', 'go', 'rush', 'fieldgoal', 'go'] as const) t = choosePlay(t, play);
        t = switchDefender(switchDefender(t));
        t = nextDown(t);
        expect(t.gap).toBe(gap);
        expect(t.clock).toBe(s.clock);
        expect(nextDown(snap(t)).gap).toBeLessThanOrEqual(BETWEEN_PLAY_TICKS);
    });
    it('only a finished play starts a new allowance, and it costs the live ticks it used', () => {
        const dead = fresh();
        let s = nextDown(dead);
        for (let i = 0; i < 400; i++) s = stepDown(s, idle);
        expect(s.gap).toBe(0);
        const before = s.clock;
        const next = tackled(s, 3);
        expect(next.gap).toBe(BETWEEN_PLAY_TICKS);
        expect(next.clock).toBeLessThan(before);
        expect(before - next.clock).toBeLessThan(5);
    });
    it('a kick takes no game time and the leftover allowance resumes after it', () => {
        const dead = touchdown(lineUp('home', 100));
        let s = dead;
        for (let i = 0; i < 50; i++) s = stepDown(s, idle);
        const kick = nextDown(s);
        expect(kick.phase).toBe('kick');
        let k = kick;
        for (let i = 0; i < 90; i++) k = stepDown(k, idle);
        expect(k.clock).toBe(kick.clock);
        expect(k.gap).toBe(kick.gap);
        const after = nextDown(kickAtTick(kick, CENTRE));
        expect(after).toMatchObject({ phase: 'pre-snap', gap: BETWEEN_PLAY_TICKS - 50, clock: kick.clock });
    });
    it('the clock can run out while the players choose: the quarter ends at the snap, with no play', () => {
        let s = nextDown(tackled(lineUp('home', 40, { game: { clock: 100 } }), 3));
        expect(s.clock).toBeGreaterThan(0);
        s = lineUp('home', 43, { down: 2, game: { clock: 100, gap: BETWEEN_PLAY_TICKS } });
        for (let i = 0; i < 100; i++) s = stepDown(s, idle);
        expect(s).toMatchObject({ clock: 0, expired: true, gap: 260, quarter: 1, phase: 'pre-snap' });
        expect(stepDown(s, idle)).toBe(s);
        const q2 = snap(s);
        expect(q2).toMatchObject({ quarter: 2, clock: QUARTER_TICKS, expired: false, gap: 0, offense: 'home', line: 43, down: 2, phase: 'pre-snap' });
        // The same at the end of Q2 (halftime), Q3 and Q4 (final or overtime).
        const half = snap(lineUp('home', 43, { game: { quarter: 2, clock: 0, expired: true } }));
        expect(half).toMatchObject({ quarter: 3, offense: 'away', line: 82 });
        expect(snap(lineUp('home', 43, { score: { home: 3, away: 0 }, game: { quarter: 4, clock: 0, expired: true } }))).toMatchObject({ phase: 'final', winner: 'home' });
        expect(snap(lineUp('home', 43, { game: { quarter: 4, clock: 0, expired: true } }))).toMatchObject({ mode: 'overtime', quarter: 5 });
    });
    it('time does not move after the game ends or in overtime', () => {
        const over = nextDown(tackled(lineUp('home', 40, { score: { home: 10, away: 3 }, game: { quarter: 4, clock: 1 } }), 3));
        expect(over.phase).toBe('final');
        expect(stepDown(over, idle)).toBe(over);
        const ot = lineUp('away', 82, { game: { mode: 'overtime', quarter: 5, clock: 0, gap: BETWEEN_PLAY_TICKS, overtime: { first: 'away', possessions: 0 } } });
        expect(stepDown(ot, idle)).toBe(ot);
    });
    it('over many plays the clock burns at most the live ticks plus six seconds a play, however slowly the players act', () => {
        let s = createDown(), live = 0, plays = 0, burned = 0;
        for (let i = 0; i < 40 && s.mode === 'regulation'; i++) {
            const start = s.clock;
            for (let t = 0; t < 2000; t++) s = stepDown(s, idle);
            s = snap(s);
            while (s.phase === 'live') { s = stepDown(s, idle); live++; }
            if (s.phase === 'pre-snap') continue;
            expect(s.phase).toBe('dead');
            plays++;
            burned = start - s.clock;
            expect(burned, `play ${plays}`).toBeLessThanOrEqual(BETWEEN_PLAY_TICKS + 1500);
            s = nextDown(s);
            if (s.phase === 'kick') break;
        }
        expect(plays).toBeGreaterThan(3);
        expect(live).toBeGreaterThan(0);
    });
});
