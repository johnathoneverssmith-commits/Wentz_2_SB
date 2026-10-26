import { describe, expect, it } from 'vitest';
import { ACCEL_SECONDS, BODY, FIELD, STEP_SECONDS, advance, maxSpeed, type ArcadePlayer, type Inputs, type Intent, type PlayerId } from '../core/simulation';
import { baseAbilities } from '../core/personnel';
import { createClock, advance as advanceClock } from '../core/clock';
import { createDown, snap } from '../core/down';

const idle: Inputs = { home: { x: 0, y: 0 }, away: { x: 0, y: 0 } };
const mk = (id: PlayerId, x: number, y: number, over: Partial<ArcadePlayer> = {}): ArcadePlayer => ({
    id, team: id.startsWith('home') ? 'home' : 'away', number: 1, position: 'WR', human: false, abilities: baseAbilities('WR'), x, y, vx: 0, vy: 0,
    behavior: 'stance', assign: null, lock: null, stun: 0, free: 0, ...over,
});
const go = (to: { x: number; y: number }, speed = 1): Intent => ({ to, speed });
const run = (players: ArcadePlayer[], ticks: number, intents: Map<PlayerId, Intent>, inputs = idle, carrier?: PlayerId) => {
    let list = players;
    for (let i = 0; i < ticks; i++) list = advance(list, inputs, intents, new Map(), carrier);
    return list;
};

describe('movement', () => {
    it('accelerates from rest to top speed instead of jumping to it, and never exceeds it', () => {
        const p = mk('home-WR1', 20, 26);
        const first = advance([p], idle, new Map([[p.id, go({ x: 100, y: 26 })]]), new Map())[0]!;
        expect(first.vx).toBeGreaterThan(0);
        expect(first.vx).toBeLessThan(maxSpeed(p) * 0.2);
        let list: ArcadePlayer[] = [p];
        const intents = new Map([[p.id, go({ x: 110, y: 26 })]]);
        for (let i = 0; i < Math.ceil(ACCEL_SECONDS * 60 * 2); i++) list = advance(list, idle, intents, new Map());
        expect(list[0]!.vx).toBeCloseTo(maxSpeed(p), 5);
        for (let i = 0; i < 120; i++) { list = advance(list, idle, intents, new Map()); expect(Math.hypot(list[0]!.vx, list[0]!.vy)).toBeLessThanOrEqual(maxSpeed(p) + 1e-9); }
    });
    it('slows to a stop at its destination instead of orbiting it', () => {
        const p = mk('home-WR1', 20, 26);
        const list = run([p], 240, new Map([[p.id, go({ x: 30, y: 26 })]]));
        expect(Math.hypot(list[0]!.x - 30, list[0]!.y - 26)).toBeLessThan(0.3);
        expect(Math.hypot(list[0]!.vx, list[0]!.vy)).toBeLessThan(0.5);
    });
    it('a human follows the input direction, and diagonals are not faster than straight lines', () => {
        const a = mk('home-QB', 40, 26, { human: true, position: 'QB', abilities: baseAbilities('QB') });
        const straight = run([a], 60, new Map(), { ...idle, home: { x: 1, y: 0 } })[0]!;
        const diagonal = run([a], 60, new Map(), { ...idle, home: { x: 1, y: 1 } })[0]!;
        expect(Math.hypot(diagonal.x - 40, diagonal.y - 26)).toBeCloseTo(straight.x - 40, 6);
        expect(() => run([a], 1, new Map(), { ...idle, home: { x: NaN, y: 0 } })).toThrow();
    });
    it('keeps every player inside the field', () => {
        let list = [mk('home-WR1', 5, 5), mk('away-CB1', 115, 50)];
        const intents = new Map<PlayerId, Intent>([['home-WR1', go({ x: -50, y: -50 })], ['away-CB1', go({ x: 200, y: 200 })]]);
        list = run(list, 600, intents);
        for (const p of list) {
            expect(p.x).toBeGreaterThanOrEqual(FIELD.radius); expect(p.x).toBeLessThanOrEqual(FIELD.length - FIELD.radius);
            expect(p.y).toBeGreaterThanOrEqual(FIELD.radius); expect(p.y).toBeLessThanOrEqual(FIELD.width - FIELD.radius);
        }
    });
    it('does not mutate its input and gives the same result whatever order the players are in', () => {
        const a = mk('home-WR1', 30, 26), b = mk('away-CB1', 30.5, 26), c = mk('home-TE1', 31, 27);
        const intents = new Map<PlayerId, Intent>([[a.id, go({ x: 40, y: 26 })], [b.id, go({ x: 20, y: 26 })], [c.id, go({ x: 31, y: 40 })]]);
        const frozen = JSON.stringify([a, b, c]);
        const one = run([a, b, c], 30, intents), two = run([c, a, b], 30, intents);
        expect(JSON.stringify([a, b, c])).toBe(frozen);
        for (const p of one) { const q = two.find(r => r.id === p.id)!; expect(q.x).toBeCloseTo(p.x, 6); expect(q.y).toBeCloseTo(p.y, 6); }
    });
});
describe('collision', () => {
    it('two players walking into each other end up apart, not stacked', () => {
        const a = mk('home-WR1', 30, 26), b = mk('away-CB1', 34, 26);
        const list = run([a, b], 120, new Map<PlayerId, Intent>([[a.id, go({ x: 40, y: 26 })], [b.id, go({ x: 24, y: 26 })]]));
        expect(Math.hypot(list[0]!.x - list[1]!.x, list[0]!.y - list[1]!.y)).toBeGreaterThanOrEqual(BODY - 0.05);
    });
    it('a crowd sent to one spot spreads out instead of piling into a single point', () => {
        const codes = ['DE1', 'DT1', 'DT2', 'DE2', 'OLB1', 'MLB', 'OLB2', 'CB1', 'CB2', 'FS', 'SS'];
        const crowd = codes.map((c, i) => mk(`away-${c}` as PlayerId, 60 + (i % 4) * 3, 14 + Math.floor(i / 4) * 12));
        const intents = new Map<PlayerId, Intent>(crowd.map(p => [p.id, go({ x: 50, y: 26 })]));
        const list = run(crowd, 400, intents);
        let tight = 0;
        for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) if (Math.hypot(list[i]!.x - list[j]!.x, list[i]!.y - list[j]!.y) < BODY * 0.7) tight++;
        expect(tight).toBe(0);
    });
    it('the ball carrier is not shoved aside by his own teammates, who make way', () => {
        const carrier = mk('home-RB', 30, 26), mate = mk('home-C', 30.4, 26, { position: 'C' });
        const list = run([carrier, mate], 60, new Map<PlayerId, Intent>([[carrier.id, go({ x: 30, y: 26 }, 0)], [mate.id, go({ x: 30.4, y: 26 }, 0)]]), idle, carrier.id);
        expect(list[0]!.x).toBeCloseTo(30, 5);
        expect(list[1]!.x).toBeGreaterThan(30.4);
    });
});
describe('clock', () => {
    it('does not run while paused and steps in whole 1/60 s ticks', () => {
        const live = snap(createDown());
        const paused = { ...createClock(), match: live, paused: true };
        expect(advanceClock(paused, 5, idle).match).toBe(live);
        const clock = { ...createClock(), match: live };
        expect(advanceClock(clock, STEP_SECONDS * 3.5, idle).match.tick).toBe(live.tick + 3);
    });
});
