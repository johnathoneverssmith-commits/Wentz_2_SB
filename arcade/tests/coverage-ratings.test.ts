/**
 * Coverage ratings and room (Phase C1b-2a). What a coverage point, a speed point and a hands point each buy a defender, as smooth relationships
 * with no thresholds and no caps, plus negative controls for the defects this phase fixed.
 */
import { describe, expect, it } from 'vitest';
import { choosePlay, lineUp, snap, stepDown, type DownState, type Play } from '../core/down';
import { ANTICIPATION_SECONDS, COVERAGE_REFERENCE, REACTION_SECONDS, anticipationSeconds, contestSkill, manRoom, reactionSeconds } from '../core/coverage';
import { baseAbilities } from '../core/personnel';
import type { Abilities, PlayerId } from '../core/simulation';
import { sweep, tickRange, type ThrowRecord } from '../balance/window';
import { farAway, idle } from './helpers';

const ab = (patch: Partial<Abilities>) => ({ abilities: { ...baseAbilities('CB'), ...patch } });
const wr = (patch: Partial<Abilities> = {}) => ({ abilities: { ...baseAbilities('WR'), ...patch } });
const DEF: PlayerId[] = ['DE1', 'DT1', 'DT2', 'DE2', 'OLB1', 'MLB', 'OLB2', 'CB1', 'CB2', 'CB3', 'FS', 'SS'].map(c => `away-${c}` as PlayerId);
const all = (patch: Partial<Abilities>) => Object.fromEntries(DEF.map(id => [id, patch]));
const rate = (rs: ThrowRecord[], f: (r: ThrowRecord) => boolean) => rs.filter(f).length / rs.length;
const play = (rs: ThrowRecord[]) => rs.filter(r => r.outcome !== 'sack');
const run = (abilities: Record<string, Partial<Abilities>>, extra: Partial<Parameters<typeof sweep>[0]> = {}) =>
    play(sweep({ ticks: tickRange(0, 160, 8), seeds: [1, 2, 3], stopAtArrival: true, abilities, ...extra }));
const start = (p: Play): DownState => snap(choosePlay(lineUp('home', 40, { playNumber: 1 }), p));
const at = (s: DownState, id: PlayerId) => s.players.find(p => p.id === id)!;

describe('what a coverage rating means is smooth and monotone', () => {
    it('the average corner reads and anticipates exactly as Phase B2 did, and 60 points below him reads twice as slowly', () => {
        expect(reactionSeconds(ab({ coverage: COVERAGE_REFERENCE }))).toBeCloseTo(REACTION_SECONDS, 12);
        expect(anticipationSeconds(ab({ coverage: COVERAGE_REFERENCE }))).toBeCloseTo(ANTICIPATION_SECONDS, 12);
        expect(reactionSeconds(ab({ coverage: COVERAGE_REFERENCE - 60 })) / REACTION_SECONDS).toBeCloseTo(2, 9);
    });
    it('a better coverage rating reads sooner, aims further ahead, needs less room and contests more, at every rating, with no jump anywhere', () => {
        let last = { read: Infinity, ahead: -Infinity, room: Infinity, contest: -Infinity };
        for (let c = 0; c <= 99; c++) {
            const d = ab({ coverage: c }), now = { read: reactionSeconds(d), ahead: anticipationSeconds(d), room: manRoom(d, wr()), contest: contestSkill(d) };
            expect(now.read, `read ${c}`).toBeLessThan(last.read); expect(now.ahead, `ahead ${c}`).toBeGreaterThan(last.ahead);
            expect(now.room, `room ${c}`).toBeLessThan(last.room); expect(now.contest, `contest ${c}`).toBeGreaterThan(last.contest);
            if (c > 0) { expect(last.room - now.room, `no jump in room at ${c}`).toBeLessThan(0.15); expect(now.contest - last.contest, `no jump in contest at ${c}`).toBeLessThan(0.03); }
            last = now;
        }
    });
    it('NEGATIVE CONTROL: a defender with no coverage skill no longer gets a hand on the ball more than half the time (the old 55% floor)', () => {
        expect(contestSkill(ab({ coverage: 0 }))).toBeLessThan(0.2);
        expect(contestSkill(ab({ coverage: 99 }))).toBeGreaterThan(0.9);
    });
    it('the room a corner keeps follows the matchup: a faster receiver or a slower corner lengthens it, a faster corner shortens it', () => {
        const base = manRoom(ab({}), wr());
        expect(manRoom(ab({}), wr({ speed: 90 }))).toBeGreaterThan(base);
        expect(manRoom(ab({ speed: 55 }), wr())).toBeGreaterThan(base);
        expect(manRoom(ab({ speed: 95 }), wr())).toBeLessThan(base);
        // a corner who can run with the receiver is not asked to give more room for being faster (the deficit term is zero, not negative)
        expect(manRoom(ab({ speed: 99 }), wr({ speed: 40 }))).toBeGreaterThan(0);
    });
});

describe('coverage is positioning and contest, hands is taking the ball away', () => {
    it('the same throw against a better-covering defense is completed less often, and the receiver is closer to a defender when it is thrown', () => {
        const poor = run(all({ coverage: 20 })), good = run(all({ coverage: 99 }));
        expect(rate(poor, r => r.outcome === 'complete') - rate(good, r => r.outcome === 'complete'), 'completion gap between coverage 20 and 99').toBeGreaterThan(0.06);
        const mean = (rs: ThrowRecord[]) => rs.reduce((a, r) => a + r.separationAtThrow, 0) / rs.length;
        expect(mean(poor) - mean(good), 'separation at the throw').toBeGreaterThan(0.2);
    });
    it('NEGATIVE CONTROL: the defenders\' hands change interceptions into knock-downs and change neither where they stand nor how often the pass is completed', () => {
        const none = run(all({ hands: 0 })), great = run(all({ hands: 99 }));
        expect(rate(great, r => r.outcome === 'interception')).toBeGreaterThan(rate(none, r => r.outcome === 'interception') + 0.05);
        expect(Math.abs(rate(great, r => r.outcome === 'complete') - rate(none, r => r.outcome === 'complete'))).toBeLessThan(0.01);
        expect(none.map(r => r.separationAtThrow)).toEqual(great.map(r => r.separationAtThrow));
        expect(none.map(r => r.separationAtArrival)).toEqual(great.map(r => r.separationAtArrival));
    });
    it('a faster corner covers a deep route better, and a faster receiver makes the corner give him more room before the throw', () => {
        // 12 seeds: with the receiver reaching the ball the corner's speed buys about half of what it did when contact knocked the receiver off it (C1b-2b), so the
        // effect is a few points and needs the sample (252 throws a cell)
        const goes = (a: Record<string, Partial<Abilities>>) => run(a, { plays: ['go'], targets: [1], seeds: Array.from({ length: 12 }, (_, k) => k + 1) });
        const slow = goes({ 'away-CB1': { speed: 55 } }), fast = goes({ 'away-CB1': { speed: 95 } });
        expect(rate(slow, r => r.outcome === 'complete') - rate(fast, r => r.outcome === 'complete'), 'completion').toBeGreaterThan(0.03);
        expect(rate(fast, r => r.outcome === 'interception') - rate(slow, r => r.outcome === 'interception'), 'interceptions').toBeGreaterThan(0.01);
        const sep = (rs: ThrowRecord[]) => rs.reduce((a, r) => a + r.separationAtArrival, 0) / rs.length;
        expect(sep(slow) - sep(fast), 'yards of separation at arrival').toBeGreaterThan(0.15);
        const room = (speed: number) => { let s = start('go'); s = { ...s, players: s.players.map(p => p.id === 'home-WR1' ? { ...p, abilities: { ...p.abilities, speed } } : p) }; for (let i = 0; i < 20; i++) s = stepDown(s, idle); return Math.hypot(at(s, 'away-CB1').x - at(s, 'home-WR1').x, at(s, 'away-CB1').y - at(s, 'home-WR1').y); };
        expect(room(95)).toBeGreaterThan(room(50));
    });
});

describe('the passing game keeps both of its halves', () => {
    it('a quick throw to an open slant is still the safest pass, and a deep window still opens against equal athletes', () => {
        const slants = run({}, { plays: ['slants'], targets: [1] }), goes = run({}, { plays: ['go'], targets: [1] });
        const quick = slants.filter(r => r.throwTick <= 48), deepAtPace = goes.filter(r => r.landDepth >= 15 && r.running >= 0.8);
        expect(rate(quick, r => r.outcome === 'complete'), 'quick slants').toBeGreaterThan(0.7);
        expect(deepAtPace.length).toBeGreaterThan(5);
        expect(rate(deepAtPace, r => r.outcome === 'complete'), 'deep routes at pace').toBeGreaterThan(0.4);
        expect(rate(quick, r => r.outcome === 'complete')).toBeGreaterThan(rate(deepAtPace, r => r.outcome === 'complete'));
        expect(rate(deepAtPace, r => r.outcome === 'interception'), 'deep interceptions stay a minority').toBeLessThan(0.25);
    });
    it('receivers are no longer 9 yards clear of the defense for the first second and a half', () => {
        let s = start('go');
        const room = () => Math.min(...s.players.filter(p => p.team !== s.offense).map(p => Math.hypot(p.x - at(s, 'home-WR1').x, p.y - at(s, 'home-WR1').y)));
        expect(room(), 'at the snap').toBeLessThan(7.5);
        for (let i = 0; i < 60; i++) s = stepDown(s, idle);
        expect(room(), 'one second in').toBeLessThan(7.5);
    });
});

describe('the lane defect: a corner who stands in the receiver\'s path must not stop him', () => {
    it('NEGATIVE CONTROL: with the corner close, the receiver still runs his route (he is not pushed back by the corner)', () => {
        const cover = (parked: boolean) => { let s = start('go'); for (let i = 0; i < 90; i++) s = stepDown(parked ? farAway(s) : s, idle); return at(s, 'home-WR1'); };
        const free = cover(true), covered = cover(false);
        expect((free.x - covered.x) * 1, 'yards the receiver loses to the corner by tick 90').toBeLessThan(1.2);
    });
});
