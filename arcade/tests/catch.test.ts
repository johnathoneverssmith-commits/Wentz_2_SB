/**
 * Phase C1b-1: who gets the ball when a pass arrives. `resolveCatch` is exercised directly on hand-placed players (so each property is
 * isolated from route running and coverage), then through the game for the properties that need the whole engine: exactly-once
 * resolution, a save during the flight, the human Hands window, and mirrored play.
 */
import { describe, expect, it } from 'vitest';
import { decodeSave, encodeSave } from '../browser/save';
import {
    CATCH_KINDS, DECISION, DEFENDER_REACH_SHIFT, defenderReach, playChance, receiverReach, resolveCatch, roleOf, secureChance, takeAwayChance, type CatchInput, type CatchKind,
} from '../core/catch';
import { BREAKUP_RADIUS, CATCH_RADIUS } from '../core/behavior';
import { choosePlay, contestPass, createDown, lineUp, snap, stepDown, throwPass, type DownState } from '../core/down';
import type { ArcadePlayer, PlayerId } from '../core/simulation';
import { roll } from '../core/seed';
import { farAway, idle, place } from './helpers';

const base = lineUp('home', 40, { playNumber: 1 });
const find = (id: PlayerId): ArcadePlayer => base.players.find(p => p.id === id)!;
const TO = { x: 70, y: 26 }, FROM = { x: 36, y: 26.6 };
/** A receiver `rd` yards from the landing point and defenders at the given distances (on the quarterback's side of it unless `behind`), standing still. */
function setup(rd: number, defenders: { id?: PlayerId; gap: number; behind?: boolean; abilities?: Partial<ArcadePlayer['abilities']>; human?: boolean; moving?: boolean }[] = [], receiverAbilities: Partial<ArcadePlayer['abilities']> = {}): Pick<CatchInput, 'receiver' | 'defenders' | 'to' | 'from'> {
    const receiver: ArcadePlayer = { ...find('home-WR1'), x: TO.x - rd, y: TO.y, vx: 0, vy: 0, abilities: { ...find('home-WR1').abilities, ...receiverAbilities } };
    const ids: PlayerId[] = ['away-CB1', 'away-CB2', 'away-FS', 'away-SS', 'away-OLB1', 'away-OLB2'];
    const list = defenders.map((d, i) => ({ ...find(d.id ?? ids[i]!), x: d.behind ? TO.x + d.gap : TO.x - d.gap, y: TO.y, vx: d.moving ? 7 : 0, vy: 0, human: !!d.human, abilities: { ...find(d.id ?? ids[i]!).abilities, ...d.abilities } }));
    return { receiver, defenders: list, to: TO, from: FROM };
}
const make = (s: ReturnType<typeof setup>, seed: number, over: Partial<CatchInput> = {}): CatchInput => ({ ...s, seed, playNumber: 7, tick: 123, mayIntercept: p => !p.human, ...over });
/** Share of each kind over many seeds. */
function tally(s: ReturnType<typeof setup>, n = 2000, over: Partial<CatchInput> = {}): Record<CatchKind, number> {
    const out: Record<CatchKind, number> = { catch: 0, 'contested-catch': 0, interception: 0, breakup: 0, incomplete: 0 };
    for (let seed = 1; seed <= n; seed++) out[resolveCatch(make(s, seed, over)).kind] += 1 / n;
    return out;
}
const completed = (t: Record<CatchKind, number>) => t.catch + t['contested-catch'];

describe('reach: who can get to the ball at all', () => {
    it('falls smoothly with distance, is a half at the old radius, and is exactly zero a long way off (no draw is made for a player who cannot reach)', () => {
        const r = (d: number) => receiverReach({ ...find('home-WR1'), x: TO.x - d, y: TO.y }, TO);
        expect(r(0)).toBeGreaterThan(0.99);
        expect(r(CATCH_RADIUS)).toBeCloseTo(0.5, 5);
        for (let d = 0; d < 2.5; d += 0.1) expect(r(d + 0.1), `at ${d.toFixed(1)}`).toBeLessThan(r(d));
        expect(r(3)).toBeLessThan(0.001);
        expect(r(CATCH_RADIUS + 5)).toBe(0);
        const dr = (d: number) => defenderReach({ ...find('away-CB1'), x: TO.x - d, y: TO.y }, TO);
        expect(dr(BREAKUP_RADIUS + DEFENDER_REACH_SHIFT)).toBeCloseTo(0.5, 5);
        expect(dr(0.5)).toBeGreaterThan(0.99);
        expect(dr(BREAKUP_RADIUS + 5)).toBe(0);
        for (let d = 0; d < 4; d += 0.1) expect(dr(d + 0.1)).toBeLessThanOrEqual(dr(d));
    });
    it('a defender who cannot reach the ball never takes it or knocks it down, however many times it is thrown', () => {
        for (const gap of [4.5, 6, 12, 40]) {
            const t = tally(setup(0.3, [{ gap }]), 1500);
            expect(t.interception, `${gap} yd away`).toBe(0);
            expect(t.breakup, `${gap} yd away`).toBe(0);
            expect(t['contested-catch'], `${gap} yd away`).toBe(0);
        }
    });
    it('and a receiver who cannot reach it never catches it', () => {
        for (const rd of [3.8, 5, 12]) { const t = tally(setup(rd), 1500); expect(completed(t), `${rd} yd away`).toBe(0); expect(t.incomplete).toBeCloseTo(1, 9); }
    });
    it('is made for every player who could reach, and for nobody else (steps list the draws)', () => {
        const s = setup(0.5, [{ gap: 1 }, { gap: 1.5 }, { gap: 9 }]);
        const reach = resolveCatch(make(s, 5)).steps.filter(x => x.action === 'reach').map(x => x.player);
        expect(reach).toEqual(['home-WR1', 'away-CB1', 'away-CB2']);
    });
});

describe('reaching the ball is not making the play', () => {
    it('a receiver right on the ball does not always catch it: he drops some, fewer with better hands, none with perfect hands', () => {
        const average = completed(tally(setup(0.2), 4000)), poor = completed(tally(setup(0.2, [], { hands: 20 }), 4000)), elite = completed(tally(setup(0.2, [], { hands: 99 }), 4000));
        expect(average).toBeLessThan(0.99); expect(average).toBeGreaterThan(0.85);
        expect(poor).toBeLessThan(average - 0.02);
        expect(elite).toBeGreaterThan(average); expect(elite).toBeGreaterThan(0.985);
    });
    it('a defender on the ball does not always take it or knock it down: he misses some, and when he plays it he takes it away only some of the time', () => {
        const t = tally(setup(1.2, [{ gap: 0.4 }]), 4000);
        expect(t.interception).toBeGreaterThan(0); expect(t.interception).toBeLessThan(0.9);
        expect(t.breakup).toBeGreaterThan(0);
        expect(t.interception + t.breakup).toBeLessThan(1);
        expect(completed(t)).toBeGreaterThan(0);
    });
    it('a defender within the old interception radius does not automatically intercept, and a receiver nearer the ball does not automatically complete', () => {
        const t = tally(setup(0.3, [{ gap: 1.2 }]), 4000);
        expect(t.interception).toBeLessThan(0.5); expect(t.interception).toBeGreaterThan(0);
        expect(completed(t)).toBeGreaterThan(0.3); expect(completed(t)).toBeLessThan(0.99);
    });
    it('a defender who only knocks the ball down does not intercept it, and the play is over once he has (exactly one terminal step)', () => {
        for (let seed = 1; seed <= 400; seed++) {
            const r = resolveCatch(make(setup(0.4, [{ gap: 1.5 }]), seed));
            const terminal = r.steps.filter(x => (x.action === 'secure' || x.action === 'take') && x.ok);
            if (r.kind === 'breakup') { expect(r.steps.at(-1)!.action).toBe('take'); expect(r.steps.at(-1)!.ok).toBe(false); expect(r.interceptor).toBeNull(); }
            if (r.kind === 'interception') { expect(r.interceptor).not.toBeNull(); expect(terminal).toHaveLength(1); expect(r.steps.at(-1)!.ok).toBe(true); }
            if (r.kind === 'catch' || r.kind === 'contested-catch') { expect(r.steps.at(-1)!.action).toBe('secure'); expect(r.steps.at(-1)!.ok).toBe(true); expect(r.interceptor).toBeNull(); }
            if (r.kind === 'incomplete') expect(terminal).toHaveLength(0);
        }
    });
    it('a contested catch is a catch with a defender who also reached the ball; a clean catch is not', () => {
        for (let seed = 1; seed <= 300; seed++) {
            const withDefender = resolveCatch(make(setup(0.3, [{ gap: 1 }]), seed)), alone = resolveCatch(make(setup(0.3), seed));
            expect(withDefender.kind).not.toBe('catch');
            expect(alone.kind).not.toBe('contested-catch');
            if (withDefender.kind === 'contested-catch') expect(withDefender.steps.some(x => x.action === 'reach' && x.player.startsWith('away-') && x.ok)).toBe(true);
        }
    });
});

describe('geometry: position decides, in odds and not in switches', () => {
    it('the closer a defender is to the ball, the less often the receiver completes, steadily and with no cliff', () => {
        const gaps = [4, 3, 2.6, 2.2, 1.8, 1.4, 1.0, 0.6, 0.2];
        const rates = gaps.map(g => completed(tally(setup(0.3, [{ gap: g }]), 3000)));
        for (let i = 1; i < rates.length; i++) expect(rates[i]!, `defender ${gaps[i]} yd`).toBeLessThanOrEqual(rates[i - 1]! + 0.015);
        expect(rates[0]! - rates.at(-1)!).toBeGreaterThan(0.3);
        for (let i = 1; i < rates.length; i++) expect(rates[i - 1]! - rates[i]!, `no cliff between ${gaps[i - 1]} and ${gaps[i]} yd`).toBeLessThan(0.3);
    });
    it('the closer the receiver is to the ball, the more often he completes, and a receiver a long way from it never does', () => {
        const dists = [0.2, 0.8, 1.4, 1.8, 2.4, 3.2];
        const rates = dists.map(d => completed(tally(setup(d), 3000)));
        for (let i = 1; i < rates.length; i++) expect(rates[i]!).toBeLessThanOrEqual(rates[i - 1]! + 0.015);
        expect(rates[0]).toBeGreaterThan(0.9); expect(rates.at(-1)).toBeLessThan(0.05);
    });
    it('a defender nearer the ball than the receiver wins it more often than the receiver does, and the reverse', () => {
        const defenderCloser = tally(setup(1.2, [{ gap: 0.4 }]), 4000), receiverCloser = tally(setup(0.4, [{ gap: 1.2 }]), 4000);
        expect(completed(defenderCloser)).toBeLessThan(completed(receiverCloser));
        expect(defenderCloser.interception + defenderCloser.breakup).toBeGreaterThan(receiverCloser.interception + receiverCloser.breakup);
    });
    it('who is at the ball first is a matter of odds in position: the nearer of two players goes first more often, the farther less often, and neither always', () => {
        const defenderFirst = (s: ReturnType<typeof setup>) => { let n = 0; for (let seed = 1; seed <= 3000; seed++) { const first = resolveCatch(make(s, seed)).steps.find(x => x.action !== 'reach'); if (first && first.player.startsWith('away-')) n++; } return n / 3000; };
        const nearer = defenderFirst(setup(1.3, [{ gap: 0.4 }])), level = defenderFirst(setup(0.8, [{ gap: 0.8 }])), farther = defenderFirst(setup(0.4, [{ gap: 1.3 }]));
        expect(nearer).toBeGreaterThan(0.6); expect(nearer).toBeLessThan(0.95);
        expect(farther).toBeLessThan(0.4); expect(farther).toBeGreaterThan(0.05);
        expect(Math.abs(level - 0.5)).toBeLessThan(0.12);
        expect(nearer).toBeGreaterThan(level); expect(level).toBeGreaterThan(farther);
    });
    it('a defender in front of the ball (facing it) and one set when it arrives play it better than one with his back to it or still running', () => {
        const at = (o: { behind?: boolean; moving?: boolean }) => tally(setup(0.4, [{ gap: 1, ...o }]), 5000);
        const facing = at({}), turned = at({ behind: true }), running = at({ moving: true });
        expect(facing.interception + facing.breakup).toBeGreaterThan(turned.interception + turned.breakup);
        expect(facing.interception + facing.breakup).toBeGreaterThan(running.interception + running.breakup);
        expect(facing.interception).toBeGreaterThan(turned.interception);
    });
});

describe('ratings', () => {
    it('better receiver hands never mean fewer catches, in the open or contested, and the difference between poor and elite hands is real', () => {
        for (const defenders of [[], [{ gap: 1.2 }]] as const) {
            const rates = [0, 30, 55, 78, 90, 99].map(h => completed(tally(setup(0.4, [...defenders], { hands: h }), 4000)));
            for (let i = 1; i < rates.length; i++) expect(rates[i]!).toBeGreaterThanOrEqual(rates[i - 1]! - 0.012);
            expect(rates.at(-1)! - rates[0]!).toBeGreaterThan(0.1);
        }
    });
    it('receiver hands keep paying all the way to 99 when the ball is in his hands: the limit on a completion is the reach, not the rating', () => {
        // the chance to hold the ball is linear in hands to 99; what stops a completion rate from rising with hands is that the receiver must first reach the ball
        const ratings = [60, 78, 90, 99];
        const secure = ratings.map(h => secureChance({ ...find('home-WR1'), abilities: { ...find('home-WR1').abilities, hands: h } }));
        for (let i = 1; i < secure.length; i++) expect(secure[i]!).toBeGreaterThan(secure[i - 1]!);
        expect(secure.at(-1)).toBe(1);
        const farBall = ratings.map(h => completed(tally(setup(2.2, [], { hands: h }), 6000)));
        const reach = receiverReach({ ...find('home-WR1'), x: TO.x - 2.2, y: TO.y }, TO);
        for (const r of farBall) expect(r).toBeLessThan(reach + 0.02);
    });
    it('better defender coverage never means more completions, and a great corner gives up clearly fewer than a poor one', () => {
        const rates = [0, 30, 55, 76, 90, 99].map(c => completed(tally(setup(0.4, [{ gap: 1, abilities: { coverage: c } }]), 4000)));
        for (let i = 1; i < rates.length; i++) expect(rates[i]!).toBeLessThanOrEqual(rates[i - 1]! + 0.012);
        expect(rates[0]! - rates.at(-1)!).toBeGreaterThan(0.08);
    });
    it('better defender hands mean more interceptions when he is on the ball, and no interceptions at all with no hands', () => {
        const picks = [0, 30, 55, 80, 99].map(h => tally(setup(1.2, [{ gap: 0.5, abilities: { hands: h } }]), 5000).interception);
        expect(picks[0]).toBe(0);
        for (let i = 1; i < picks.length; i++) expect(picks[i]!).toBeGreaterThan(picks[i - 1]! - 0.01);
        expect(picks.at(-1)! - picks[1]!).toBeGreaterThan(0.1);
    });
    it('defender hands change interceptions into breakups and not the reverse: with poor hands he knocks it down instead', () => {
        const poor = tally(setup(1.2, [{ gap: 0.5, abilities: { hands: 10 } }]), 5000), good = tally(setup(1.2, [{ gap: 0.5, abilities: { hands: 90 } }]), 5000);
        expect(poor.breakup).toBeGreaterThan(good.breakup);
        expect(Math.abs(poor.interception + poor.breakup - (good.interception + good.breakup))).toBeLessThan(0.02);
    });
    it('large rating differences behave sensibly at the extremes', () => {
        const best = tally(setup(0.2, [], { hands: 99 }), 3000), worst = tally(setup(0.2, [{ gap: 0.2, abilities: { coverage: 99, hands: 99 } }], { hands: 0 }), 3000);
        expect(completed(best)).toBeGreaterThan(0.99);
        expect(completed(worst)).toBeLessThan(0.45);
        const unskilled = tally(setup(0.2, [{ gap: 0.2, abilities: { coverage: 0, hands: 0 } }], { hands: 99 }), 3000);
        expect(completed(unskilled)).toBeGreaterThan(completed(worst) + 0.3);
        expect(playChance({ ...find('away-CB1'), abilities: { ...find('away-CB1').abilities, coverage: 0 }, x: TO.x, y: TO.y }, { to: TO, from: FROM })).toBeGreaterThan(0.5);
        expect(takeAwayChance({ ...find('away-CB1'), abilities: { ...find('away-CB1').abilities, hands: 99 }, x: TO.x, y: TO.y }, { to: TO, from: FROM })).toBeGreaterThan(0.95);
    });
});

describe('human defenders', () => {
    it('a human outside his Hands window can knock the ball down but never intercepts it; inside the window he can', () => {
        const s = setup(1.2, [{ gap: 0.4, human: true }]);
        const closed = tally(s, 3000, { mayIntercept: p => !p.human }), open = tally(s, 3000, { mayIntercept: () => true });
        expect(closed.interception).toBe(0);
        expect(closed.breakup).toBeGreaterThan(0.2);
        expect(open.interception).toBeGreaterThan(0.1);
        expect(open.breakup).toBeLessThan(closed.breakup);
        expect(completed(open)).toBeCloseTo(completed(closed), 1);
    });
    it('the window is asked about the human only, and only after he has got a hand on the ball', () => {
        const asked: string[] = [];
        resolveCatch(make(setup(0.4, [{ id: 'away-CB1', gap: 0.4 }, { id: 'away-CB2', gap: 9 }]), 3, { mayIntercept: p => { asked.push(p.id); return true; } }));
        for (const id of asked) expect(id).toBe('away-CB1');
    });
});

describe('random events: identity, independence and replay', () => {
    it('the same input always gives the same result, step by step', () => {
        const s = setup(0.6, [{ gap: 1.1 }, { gap: 1.9 }]);
        for (let seed = 1; seed <= 200; seed++) expect(resolveCatch(make(s, seed))).toEqual(resolveCatch(make(s, seed)));
    });
    it('the seed, the play, the tick and the receiver each identify the pass: changing any one of them re-rolls it', () => {
        const s = setup(0.6, [{ gap: 1.1 }]), distinct = (f: (i: number) => CatchInput) => new Set(Array.from({ length: 300 }, (_, i) => resolveCatch(f(i)).steps.map(x => `${x.player}${x.action}${x.ok}`).join('|')));
        expect(distinct(i => make(s, i + 1)).size).toBeGreaterThan(2);
        const rolls = (f: (i: number) => CatchInput) => Array.from({ length: 400 }, (_, i) => { const c = f(i); return roll(c.seed, c.playNumber, c.tick, roleOf(c.receiver), DECISION.secure, roleOf(c.receiver)); });
        const same = (a: number[], b: number[]) => a.filter((x, i) => x === b[i]).length;
        const ref = rolls(i => make(s, 9, { playNumber: i + 1 }));
        expect(same(ref, rolls(i => make(s, 9, { playNumber: i + 2 })))).toBeLessThan(5);
        expect(same(rolls(i => make(s, 9, { tick: i })), rolls(i => make(s, 9, { tick: i + 1 })))).toBeLessThan(5);
        expect(same(rolls(i => make(s, i)), rolls(i => make(s, i + 1)))).toBeLessThan(5);
        const wr2 = { ...s, receiver: { ...s.receiver, id: 'home-WR2' as PlayerId } };
        expect(same(rolls(i => make(s, i)), rolls(i => make(wr2, i)))).toBeLessThan(5);
    });
    it('every decision has its own name and so its own draw: no two decisions of one pass share a number', () => {
        const names = Object.values(DECISION);
        expect(new Set(names).size).toBe(names.length);
        const draws = names.flatMap(d => [0, 1, 2, 3].map(subject => roll(11, 7, 123, 5, d, subject)));
        expect(new Set(draws).size).toBe(draws.length);
    });
    it('a decision does not change when another is added: a player who cannot reach the ball leaves everyone else\'s outcome exactly as it was', () => {
        const near = setup(0.6, [{ id: 'away-CB1', gap: 1.1 }]), crowded = setup(0.6, [{ id: 'away-CB1', gap: 1.1 }, { id: 'away-FS', gap: 15 }, { id: 'away-SS', gap: 30 }]);
        for (let seed = 1; seed <= 300; seed++) {
            const a = resolveCatch(make(near, seed)), b = resolveCatch(make(crowded, seed));
            expect(b.kind, `seed ${seed}`).toBe(a.kind);
            expect(b.steps).toEqual(a.steps);
        }
    });
    it('a second defender who can reach the ball does change the pass, since he is part of the contest, but not the receiver\'s own reach draw', () => {
        const one = setup(0.6, [{ id: 'away-CB1', gap: 1.1 }]), two = setup(0.6, [{ id: 'away-CB1', gap: 1.1 }, { id: 'away-FS', gap: 1.4 }]);
        let differ = 0;
        for (let seed = 1; seed <= 300; seed++) {
            const a = resolveCatch(make(one, seed)), b = resolveCatch(make(two, seed));
            expect(b.steps.find(x => x.player === 'home-WR1' && x.action === 'reach')).toEqual(a.steps.find(x => x.player === 'home-WR1' && x.action === 'reach'));
            expect(b.steps.find(x => x.player === 'away-CB1' && x.action === 'reach')).toEqual(a.steps.find(x => x.player === 'away-CB1' && x.action === 'reach'));
            if (a.kind !== b.kind) differ++;
        }
        expect(differ).toBeGreaterThan(0);
    });
    it('the order the defenders are listed in does not matter', () => {
        const s = setup(0.6, [{ id: 'away-CB1', gap: 1.1 }, { id: 'away-FS', gap: 1.4 }, { id: 'away-SS', gap: 2 }]);
        for (let seed = 1; seed <= 200; seed++) expect(resolveCatch(make({ ...s, defenders: [...s.defenders].reverse() }, seed))).toEqual(resolveCatch(make(s, seed)));
    });
    it('a mirrored pass (the other team, the other way, x reflected) gets the same outcome and the same steps', () => {
        const s = setup(0.6, [{ id: 'away-CB1', gap: 1.1 }, { id: 'away-FS', gap: 1.9, behind: true }]);
        const mirrorP = (p: ArcadePlayer): ArcadePlayer => ({ ...p, id: (p.team === 'home' ? p.id.replace('home', 'away') : p.id.replace('away', 'home')) as PlayerId, team: p.team === 'home' ? 'away' : 'home', x: 120 - p.x, vx: -p.vx });
        const m = { receiver: mirrorP(s.receiver), defenders: s.defenders.map(mirrorP), to: { x: 120 - s.to.x, y: s.to.y }, from: { x: 120 - s.from.x, y: s.from.y } };
        for (let seed = 1; seed <= 300; seed++) {
            const a = resolveCatch(make(s, seed)), b = resolveCatch(make(m, seed));
            expect(b.kind).toBe(a.kind);
            expect(b.steps.map(x => [x.role, x.action, x.chance, x.ok])).toEqual(a.steps.map(x => [x.role, x.action, x.chance, x.ok]));
        }
    });
});

describe('inside the game', () => {
    const arrive = (state: DownState): DownState => { let s = state; while (s.phase === 'live' && s.ball.kind === 'flight') s = stepDown(s, idle); return s; };
    const thrownWith = (seed: number, defenderAt?: number): DownState => {
        let s = snap(choosePlay(createDown(seed), 'slants'));
        for (let i = 0; i < 30; i++) s = stepDown(farAway(s), idle);
        s = throwPass(s, 1);
        if (defenderAt !== undefined && s.ball.kind === 'flight') s = place(farAway(s, ['away-CB1']), 'away-CB1', s.ball.to.x - defenderAt, s.ball.to.y);
        return s;
    };
    it('a pass is resolved once, on the tick it arrives: the kind is set, the ball is no longer in the air, and nothing changes it afterwards', () => {
        for (let seed = 1; seed <= 40; seed++) {
            const flying = thrownWith(seed, 1.2);
            expect(flying.catchKind).toBeUndefined();
            let s = flying, resolvedAt = -1;
            for (let t = 0; t < 200 && s.phase === 'live'; t++) {
                const before = s;
                s = stepDown(s, idle);
                if (before.ball.kind === 'flight' && s.ball.kind !== 'flight') { expect(resolvedAt).toBe(-1); resolvedAt = t; expect(s.catchKind).toBeDefined(); }
                if (resolvedAt < 0) expect(s.catchKind).toBeUndefined();
            }
            expect(resolvedAt).toBeGreaterThanOrEqual(0);
            expect(CATCH_KINDS).toContain(s.catchKind);
            const kind = s.catchKind;
            for (let t = 0; t < 30; t++) { s = stepDown(s, idle); expect(s.catchKind).toBe(kind); }
        }
    });
    it('the kind explains the result: a catch leaves the receiver with the ball, an interception gives it to the defense, a breakup or an incompletion ends the down', () => {
        const seen = new Set<CatchKind>();
        for (let seed = 1; seed <= 150; seed++) {
            const s = arrive(thrownWith(seed, 1.1));
            seen.add(s.catchKind!);
            if (s.catchKind === 'catch' || s.catchKind === 'contested-catch') { expect(s.possession).toEqual({ team: 'home', carrier: 'home-WR1' }); expect(s.phase).toBe('live'); }
            if (s.catchKind === 'interception') { expect(s.result).toMatchObject({ reason: 'interception', turnover: true }); expect(s.possession.team).toBe('away'); }
            if (s.catchKind === 'breakup' || s.catchKind === 'incomplete') { expect(s.result).toMatchObject({ reason: 'incomplete', turnover: false }); expect(s.phase).toBe('dead'); }
        }
        expect(seen.size).toBeGreaterThanOrEqual(4);
    });
    it('the same seed and the same actions give the same result, and different seeds give different ones', () => {
        const outcomes = Array.from({ length: 60 }, (_, i) => arrive(thrownWith(i + 1, 1.1)).catchKind);
        expect(outcomes).toEqual(Array.from({ length: 60 }, (_, i) => arrive(thrownWith(i + 1, 1.1)).catchKind));
        expect(new Set(outcomes).size).toBeGreaterThan(2);
    });
    it('a game saved while the ball is in the air resolves exactly as the unsaved one does, from any tick of the flight', () => {
        for (let seed = 1; seed <= 25; seed++) {
            const flying = thrownWith(seed, 1.1);
            if (flying.ball.kind !== 'flight') throw new Error('flight');
            const ticks = Math.round(flying.ball.duration * 60);
            for (const after of [0, Math.floor(ticks / 2), ticks - 1]) {
                let a = flying;
                for (let t = 0; t < after; t++) a = stepDown(a, idle);
                const b = decodeSave(encodeSave(a))!;
                expect(b).toEqual(a);
                const ra = arrive(a), rb = arrive(b);
                expect(rb.catchKind, `seed ${seed} saved after ${after}`).toBe(ra.catchKind);
                expect(rb).toEqual(ra);
            }
        }
    });
    it('a saved game remembers how its last pass was decided, and a save naming an unknown kind is refused', () => {
        const s = arrive(thrownWith(3, 1.1));
        expect(decodeSave(encodeSave(s))!.catchKind).toBe(s.catchKind);
        expect(decodeSave(JSON.stringify({ version: 7, state: { ...s, catchKind: 'dropped' } }))).toBeNull();
        const { catchKind: _k, ...without } = s;
        expect(decodeSave(JSON.stringify({ version: 7, state: without }))).not.toBeNull();
    });
    it('the next down starts without a catch kind', () => {
        const s = arrive(thrownWith(2, 1.1));
        if (s.phase === 'dead') expect(lineUp('home', 40).catchKind).toBeUndefined();
        expect(createDown(5).catchKind).toBeUndefined();
    });
    it('a human defender who has not pressed Hands never intercepts, pressed in time he can, and the AI needs no press', () => {
        const human = (seed: number, press: boolean): CatchKind => {
            let s = thrownWith(seed, 0.5);
            s = { ...s, defender: 'away-CB1', players: s.players.map(p => ({ ...p, human: p.id === s.possession.carrier || p.id === 'away-CB1' })) };
            // the press comes partway through the flight, so the window (36 ticks) is open when the ball arrives
            for (let t = 0; s.phase === 'live' && s.ball.kind === 'flight'; t++) {
                if (press && t === 20) s = contestPass(s, 'away');
                s = stepDown(s, idle);
            }
            return s.catchKind!;
        };
        const closed = Array.from({ length: 200 }, (_, i) => human(i + 1, false)), open = Array.from({ length: 200 }, (_, i) => human(i + 1, true));
        expect(closed).not.toContain('interception');
        expect(open).toContain('interception');
        const ai = Array.from({ length: 200 }, (_, i) => arrive(thrownWith(i + 1, 0.5)).catchKind!);
        expect(ai).toContain('interception');
    });
    it('mirrored in the game: the same pass for the other team, running the other way, is decided the same', () => {
        const run = (team: 'home' | 'away', seed: number) => {
            const line = team === 'home' ? 40 : 80, off = team, def = team === 'home' ? 'away' : 'home';
            let s = snap(choosePlay(lineUp(team, line, { playNumber: 3, seed }), 'slants'));
            for (let i = 0; i < 30; i++) s = stepDown(farAway(s), idle);
            s = throwPass(s, 1, off);
            if (s.ball.kind !== 'flight') throw new Error('flight');
            s = place(farAway(s, [`${def}-CB1` as PlayerId]), `${def}-CB1` as PlayerId, team === 'home' ? s.ball.to.x - 1.1 : s.ball.to.x + 1.1, s.ball.to.y);
            return arrive(s).catchKind;
        };
        for (let seed = 1; seed <= 60; seed++) expect(run('away', seed), `seed ${seed}`).toBe(run('home', seed));
    });
});
