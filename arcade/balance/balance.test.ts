/**
 * Gameplay-balance regression suite. These are measurements of the rules against scripted players, kept apart from the
 * technical-correctness tests in tests/. They assert broad invariants (ranges and orderings), never exact scores, so tuning that
 * keeps the game healthy does not break them; a failure means a balance property the project documented has been lost.
 */
import { describe, expect, it } from 'vitest';
import { BETWEEN_PLAY_TICKS, QUARTER_TICKS } from '../core/down';
import { DEFENSES, OFFENSES, drive, game, minutes, type Team } from './sim';
import { STARTS, driveStats } from './report';
import { cells, runMatrix } from './matrix';
import { BALANCED } from './strategies';

const team = (off: string, def: Team['def']): Team => ({ off: OFFENSES[off]!, def });

describe('passing balance', () => {
    // Milestone 5B measurements (scripted players against the 11-man AI). Documented, not tuned to a target.
    it('a late deep pass is still strong against a defense that ignores it but it is not free: the safety and corners take some of the throws', () => {
        for (const def of ['idle', 'chase', 'attentive'] as const) {
            const r = driveStats(OFFENSES['late']!, def);
            expect(r.st.completions / r.st.passes, `late vs ${def} completions`).toBeGreaterThan(0.5);
            expect(r.st.interceptions, `late vs ${def}: a defender can take the ball`).toBeGreaterThan(0);
            expect(r.td, `late vs ${def}: known imbalance, documented in PLAYTEST.md`).toBeLessThan(0.95);
        }
    });
    it('a defender who covers the deep route stops the late pass more than one who ignores it', () => {
        const covered = driveStats(OFFENSES['late']!, 'cover').pointsPerDrive;
        expect(covered).toBeLessThan(driveStats(OFFENSES['late']!, 'idle').pointsPerDrive);
    });
    it('throwing at once into coverage is punished, while a throw timed to the receiver getting free works about half the time', () => {
        const early = driveStats(OFFENSES['early']!, 'idle');
        expect(early.st.completions / early.st.passes, 'instant throws').toBeLessThan(0.3);
        expect(early.st.interceptions + early.st.incompletions).toBeGreaterThan(0);
        const mid = driveStats(OFFENSES['intermediate']!, 'idle');
        expect(mid.st.completions / mid.st.passes, 'timed throws').toBeGreaterThan(0.3);
        expect(mid.st.completions / mid.st.passes, 'timed throws').toBeLessThan(0.9);
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
        for (const key of ['intermediate', 'late', 'rush']) {
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
    it('a late deep passer still out-scores an early passer against a defense that does not switch to the ball', () => {
        const late = driveStats(OFFENSES['late']!, 'idle').pointsPerDrive;
        const early = driveStats(OFFENSES['early']!, 'idle').pointsPerDrive;
        expect(late).toBeGreaterThan(early);
    });
});
