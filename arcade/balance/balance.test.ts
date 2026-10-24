/**
 * Gameplay-balance regression suite. These are measurements of the rules against scripted players, kept apart from the
 * technical-correctness tests in tests/. They assert broad invariants (ranges and orderings), never exact scores, so tuning that
 * keeps the game healthy does not break them; a failure means a balance property the project documented has been lost.
 */
import { describe, expect, it } from 'vitest';
import { DEFENSES, OFFENSES, drive, game, minutes, type Team } from './sim';
import { STARTS, driveStats } from './report';

const team = (off: string, def: Team['def']): Team => ({ off: OFFENSES[off]!, def });

describe('passing balance', () => {
    it('a late deep pass is no longer an automatic touchdown, and is still a viable play', () => {
        for (const def of ['idle', 'chase', 'attentive'] as const) {
            const r = driveStats(OFFENSES['late']!, def);
            expect(r.td, `late vs ${def}`).toBeLessThan(0.8);
            expect(r.st.completions / r.st.passes, `late vs ${def} completions`).toBeGreaterThan(0.5);
            expect(r.st.interceptions, `late vs ${def}: the safety can take the ball`).toBeGreaterThan(0);
        }
    });
    it('a defender who covers the deep route stops the late pass more than one who ignores it', () => {
        const covered = driveStats(OFFENSES['late']!, 'cover').pointsPerDrive;
        expect(covered).toBeLessThan(driveStats(OFFENSES['late']!, 'idle').pointsPerDrive);
    });
    it('early and intermediate passes still work against a defense that ignores them', () => {
        for (const style of ['early', 'intermediate'])
            for (const def of ['idle', 'chase'] as const) {
                const r = driveStats(OFFENSES[style]!, def);
                expect(r.st.completions / r.st.passes, `${style} vs ${def}`).toBeGreaterThan(0.7);
                expect(r.st.passYards / r.st.completions, `${style} yards per catch`).toBeGreaterThan(5);
            }
    });
    it('a defender who plays the ball stops early and intermediate passes', () => {
        for (const style of ['early', 'intermediate'])
            expect(driveStats(OFFENSES[style]!, 'attentive').pointsPerDrive, style).toBeLessThan(driveStats(OFFENSES[style]!, 'idle').pointsPerDrive + 1e-9);
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
    it('running scores against a defense that does nothing and is slowed by one that chases', () => {
        const idle = driveStats(OFFENSES['rush']!, 'idle');
        const chase = driveStats(OFFENSES['rush']!, 'chase');
        expect(idle.pointsPerDrive).toBeGreaterThan(chase.pointsPerDrive);
        expect(chase.st.rushYards / chase.st.rushes, 'chasing defenders hold the run to a modest gain').toBeLessThan(idle.st.rushYards / idle.st.rushes);
    });
    it('every offense scores something against an idle defense from some starting spot', () => {
        for (const [key, off] of Object.entries(OFFENSES)) {
            const pts = STARTS.reduce((n, l) => n + drive('home', l, off, 'idle').stats.points, 0);
            expect(pts, key).toBeGreaterThan(0);
        }
    });
    it('a mixed offense against a covering defense still moves the ball', () => {
        const r = driveStats(OFFENSES['balanced']!, 'cover');
        expect(r.st.plays / r.n).toBeGreaterThan(3);
        expect(r.pointsPerDrive).toBeGreaterThan(0);
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
        for (const key of ['rush', 'balanced']) for (const def of ['idle', 'chase'] as const) {
            const near = drive('home', 98, OFFENSES[key]!, def).stats.points;
            const far = drive('home', 28, OFFENSES[key]!, def).stats.points;
            expect(near, `${key} vs ${def}`).toBeGreaterThanOrEqual(far);
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
        expect(slow.regulationClockTicks).toBeLessThanOrEqual(4 * 3 * 60 * 60);
    });
});

describe('known imbalance (documented, not asserted away)', () => {
    it('a late deep passer still out-scores an early passer against a defense that does not switch to the ball', () => {
        const late = driveStats(OFFENSES['late']!, 'idle').pointsPerDrive;
        const early = driveStats(OFFENSES['early']!, 'idle').pointsPerDrive;
        expect(late).toBeGreaterThan(early);
    });
});
