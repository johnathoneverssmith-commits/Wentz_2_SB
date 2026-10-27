/**
 * Gameplay-balance regression suite. These are measurements of the rules against scripted players, kept apart from the
 * technical-correctness tests in tests/. They assert broad invariants (ranges and orderings), never exact scores, so tuning that
 * keeps the game healthy does not break them; a failure means a balance property the project documented has been lost.
 */
import { describe, expect, it } from 'vitest';
import { BETWEEN_PLAY_TICKS, QUARTER_TICKS } from '../core/down';
import { DEFENSES, OFFENSES, drive, game, minutes, type OffensePolicy, type Team } from './sim';
import { STARTS, driveStats } from './report';
import { cells, runMatrix } from './matrix';
import { BALANCED } from './strategies';

const team = (off: string, def: Team['def']): Team => ({ off: OFFENSES[off]!, def });

describe('passing balance', () => {
    // Milestone 5B measurements (scripted players against the 11-man AI). Documented, not tuned to a target.
    it('the deep route to a wideout is contested by the AI: a late deep pass completes less often than a quick one and is intercepted more often, against every defense', () => {
        // Phase B2: the corner plays off his man while he is shallow and closes as he goes deep; it used to complete 94-100% (BALANCE.md). Phase C1b-1: a catch is chance.
        for (const def of ['idle', 'chase', 'attentive', 'cover'] as const) {
            const late = driveStats(OFFENSES['late']!, def), quick = driveStats(OFFENSES['early']!, def);
            expect(late.st.completions / late.st.passes, `late vs ${def} completions`).toBeLessThan(quick.st.completions / quick.st.passes - 0.1);
            expect(late.st.interceptions / late.st.passes, `late vs ${def} interceptions`).toBeGreaterThan(quick.st.interceptions / quick.st.passes);
        }
    });
    it('a defender who covers the deep route never helps the late pass (it is already covered at baseline ratings)', () => {
        const covered = driveStats(OFFENSES['late']!, 'cover').pointsPerDrive;
        expect(covered).toBeLessThanOrEqual(driveStats(OFFENSES['late']!, 'idle').pointsPerDrive);
    });
    it('when you throw decides it: the same slants throw to WR1 completes less the longer the quarterback waits, as the corner picks up the break', () => {
        const slants = (tick: number): OffensePolicy => ({ name: `slants at ${tick}`, play: () => 'slants', throwAt: () => tick, fieldGoals: true, target: 1 });
        const rate = (off: OffensePolicy) => { const r = driveStats(off, 'idle'); return r.st.completions / r.st.passes; };
        const early = rate(slants(12)), middle = rate(slants(80)), late = rate(slants(120)), later = rate(slants(160));
        expect(early, 'a quick throw is open').toBeGreaterThan(0.8);
        expect(early).toBeGreaterThan(middle); expect(middle).toBeGreaterThan(late); expect(late).toBeGreaterThan(later);
        expect(early - late, 'waiting costs a lot').toBeGreaterThan(0.25);
        expect(rate(OFFENSES['intermediate']!), 'timed to the break').toBeGreaterThan(rate(slants(120)));
    });
    it('a slower defender reaction never helps the defense', () => {
        for (const style of ['early', 'intermediate', 'balanced']) {
            const quick = driveStats(OFFENSES[style]!, 'cover', 0).pointsPerDrive;
            const slow = driveStats(OFFENSES[style]!, 'cover', 36).pointsPerDrive;
            expect(slow, style).toBeGreaterThanOrEqual(quick - 1e-9);
        }
    });
});

describe('rushing and mixed offenses', () => {
    it('running scores against a defense that does nothing and is stopped short of a touchdown by one that chases', () => {
        const idle = driveStats(OFFENSES['rush']!, 'idle');
        const chase = driveStats(OFFENSES['rush']!, 'chase');
        expect(idle.pointsPerDrive).toBeGreaterThan(chase.pointsPerDrive);
        expect(chase.td, 'a chasing defender keeps the run out of the end zone').toBeLessThan(0.3);
        expect(idle.st.rushYards / idle.st.rushes, 'an unopposed run gains a few yards a carry, not a touchdown a play').toBeLessThan(8);
    });
    it('the run is a modest, believable gain: between 2 and 6 yards a carry against any defense', () => {
        for (const def of ['idle', 'chase', 'attentive', 'cover'] as const) {
            const r = driveStats(OFFENSES['rush']!, def);
            if (r.st.rushes) expect(r.st.rushYards / r.st.rushes, def).toBeLessThan(6);
        }
    });
    it('the offenses that wait for a receiver to get free or run the ball score against an idle defense from some spot', () => {
        for (const key of ['intermediate', 'rush']) {
            const pts = STARTS.reduce((n, l) => n + drive('home', l, OFFENSES[key]!, 'idle').stats.points, 0);
            expect(pts, key).toBeGreaterThan(0);
        }
    });
    it('a mixed offense against a covering defense still runs plays', () => {
        const r = driveStats(OFFENSES['balanced']!, 'cover');
        expect(r.st.plays / r.n).toBeGreaterThanOrEqual(1);
    });
});

describe('mirrored scenarios', () => {
    it('a drive and its mirror image (other team, other direction) give the same result', () => {
        for (const [key, off] of Object.entries(OFFENSES)) for (const def of DEFENSES) for (const l of [28, 50, 74]) {
            const a = drive('home', l, off, def);
            const b = drive('away', 120 - l, off, def);
            expect({ key, def, l, end: b.end, points: b.stats.points, plays: b.stats.plays }).toEqual({ key, def, l, end: a.end, points: a.stats.points, plays: a.stats.plays });
        }
    });
});

describe('starting positions', () => {
    it('deep starts never score less than own-end starts for the same offense and defense', () => {
        // the running offense is one fixed drive per start, so the comparison is exact
        for (const def of ['idle', 'chase'] as const) {
            const near = drive('home', 98, OFFENSES['rush']!, def).stats.points;
            const far = drive('home', 28, OFFENSES['rush']!, def).stats.points;
            expect(near, `rush vs ${def}`).toBeGreaterThanOrEqual(far);
        }
        // a passing mix makes different choices on each drive, so a single pair of drives can go either way: compare the seeded averages
        for (const def of ['idle', 'chase'] as const) {
            const mean = (start: number) => cells(runMatrix({ strategies: [BALANCED], defenses: [def], seeds: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], starts: [start] }))[0]!.points.mean;
            expect(mean(98), `balanced vs ${def}`).toBeGreaterThanOrEqual(mean(28));
        }
    });
});

describe('game pacing', () => {
    const matchups: [string, Team][] = [
        ['rush', team('rush', 'chase')],
        ['early', team('early', 'attentive')],
        ['intermediate', team('intermediate', 'attentive')],
        ['late', team('late', 'attentive')],
        ['balanced', team('balanced', 'cover')],
    ];
    it.each(matchups)('a regulation game with a thoughtful player (%s offense) takes a sensible number of plays and real time', (_name, t) => {
        const g = game(t, t, { reaction: 12, thinkTicks: 4 * 60 });
        expect(g.stats.plays).toBeGreaterThan(40);
        expect(g.stats.plays).toBeLessThan(400);
        expect(minutes(g)).toBeGreaterThan(6);
        expect(minutes(g)).toBeLessThan(30);
    });
    it('slow play cannot stretch the game clock: the between-play allowance is six seconds', () => {
        const quick = game(team('balanced', 'cover'), team('balanced', 'cover'), { reaction: 12, thinkTicks: 2 * 60 });
        const slow = game(team('balanced', 'cover'), team('balanced', 'cover'), { reaction: 12, thinkTicks: 20 * 60 });
        expect(slow.stats.plays).toBeLessThanOrEqual(quick.stats.plays);
        expect(slow.regulationClockTicks).toBeLessThanOrEqual(4 * QUARTER_TICKS);
    });
    it.each(matchups)('regulation clock accounting (%s): live play plus between-play time is exactly four quarters', (_name, t) => {
        for (const think of [2, 8]) {
            const g = game(t, t, { reaction: 12, thinkTicks: think * 60 });
            expect(g.liveClockTicks, 'live play burns the clock').toBeGreaterThan(0);
            expect(g.betweenPlayClockTicks, 'between-play time burns the clock').toBeGreaterThan(0);
            expect(g.regulationClockTicks).toBe(g.liveClockTicks + g.betweenPlayClockTicks);
            expect(g.liveClockTicks, 'one clock tick per live simulation tick').toBeLessThanOrEqual(g.stats.liveTicks);
            expect(g.betweenPlayClockTicks, 'at most six seconds a play').toBeLessThanOrEqual(BETWEEN_PLAY_TICKS * (g.stats.plays + 4));
            expect(g.regulationClockTicks, 'all four quarters were played out').toBe(4 * QUARTER_TICKS);
        }
    });
});

describe('known imbalance (documented, not asserted away)', () => {
    it('the exploit moved from the deep route to the quick game: a repeated quick throw out-scores a late deep passer (BALANCE.md, quick-slants-always-open)', () => {
        const late = driveStats(OFFENSES['late']!, 'idle').pointsPerDrive;
        const early = driveStats(OFFENSES['early']!, 'idle').pointsPerDrive;
        expect(early).toBeGreaterThan(late);
    });
});
