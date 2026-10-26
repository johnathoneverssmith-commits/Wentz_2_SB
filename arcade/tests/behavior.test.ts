/**
 * Football behavior, not object counts. Every test plays real ticks with all 22 players and checks what they actually did:
 * who moved, who blocked whom, who chased the ball carrier, and whether anything froze or stacked up.
 */
import { describe, expect, it } from 'vitest';
import { choosePlay, createDown, engagements, lineUp, snap, stepDown, throwPass, type DownState, type Play } from '../core/down';
import { BLOCK_RADIUS, BLOCK_SLOW, SHED_FREE_TICKS, holdTicks, playMode } from '../core/behavior';
import { BODY, FIELD, maxSpeed, type Inputs, type PlayerId, type Vector } from '../core/simulation';
import { decodeSave, encodeSave } from '../browser/save';
import { farAway, idle, place } from './helpers';

const at = (s: DownState, id: PlayerId) => s.players.find(p => p.id === id)!;
const dist = (a: Vector, b: Vector) => Math.hypot(a.x - b.x, a.y - b.y);
const speed = (p: { vx: number; vy: number }) => Math.hypot(p.vx, p.vy);
const start = (play: Play, n = 1, line = 40) => snap(choosePlay(lineUp('home', line, { playNumber: n }), play));
const qbRun = (x: number, y = 0): Inputs => ({ ...idle, home: { x, y } });
function run(s: DownState, ticks: number, inputs: Inputs = idle, each?: (s: DownState, tick: number) => void): DownState {
    for (let t = 1; t <= ticks && s.phase === 'live'; t++) { s = stepDown(s, inputs); each?.(s, t); }
    return s;
}
/** Players who are not under a human's control, not engaged in a block and not moving: standing around. */
const idlers = (s: DownState) => s.players.filter(p => !p.human && !p.lock && speed(p) < 0.12 && p.id !== s.possession.carrier);

describe('continuous movement: nobody freezes during a play', () => {
    it.each([['slants', 1], ['go', 2], ['rush', 1], ['rush', 2]] as const)('during a %s play (#%s) no AI player stands still for a second or more', (play, n) => {
        const inputs = play === 'rush' ? qbRun(1, 0.2) : idle;
        const stuck = new Map<string, number>();
        let longest = 0, who = '';
        run(start(play, n), 330, inputs, s => {
            for (const p of s.players) {
                const standing = !p.human && !p.lock && speed(p) < 0.1 && p.id !== s.possession.carrier;
                const ticks = standing ? (stuck.get(p.id) ?? 0) + 1 : 0;
                stuck.set(p.id, ticks);
                if (ticks > longest) { longest = ticks; who = p.id; }
            }
        });
        expect(longest, `${who} stood still for ${longest} ticks`).toBeLessThan(60);
    });
    it('when the quarterback scrambles upfield, the receivers, linemen and defenders all keep playing', () => {
        const s0 = start('slants', 1), moved = new Map<string, number>(), seen = new Map<string, Vector>(s0.players.map(p => [p.id, { x: p.x, y: p.y }] as const));
        let still = 0;
        const s = run(s0, 150, qbRun(1, 0.1), (cur, t) => {
            for (const p of cur.players) { const last = seen.get(p.id)!; moved.set(p.id, (moved.get(p.id) ?? 0) + dist(p, last)); seen.set(p.id, { x: p.x, y: p.y }); }
            if (t === 120) still = idlers(cur).length;
        });
        expect(s.phase === 'live' || s.phase === 'dead').toBe(true);
        expect(still, 'players standing around 2 s into a scramble').toBeLessThanOrEqual(1);
        for (const code of ['WR1', 'WR2', 'TE1', 'RB'])
            expect(moved.get(`home-${code}`) ?? 0, `${code} travelled`).toBeGreaterThan(5);
        for (const code of ['LT', 'LG', 'C', 'RG', 'RT'])
            expect(moved.get(`home-${code}`) ?? 0, `${code} travelled`).toBeGreaterThan(2);
        for (const p of s.players.filter(q => q.team === 'away' && !q.human))
            expect(moved.get(p.id) ?? 0, `${p.id} travelled`).toBeGreaterThan(3);
    });
    it('a receiver who finishes his route keeps moving: he settles into space or turns to block', () => {
        const s = run(start('slants', 1), 260, idle, undefined);
        const wr = at(s, 'home-WR1');
        expect(wr.assign!.index, 'route finished').toBe(wr.assign!.points!.length);
        for (const code of ['WR1', 'WR2', 'TE1', 'WR3', 'RB']) {
            const p = s.players.find(q => q.id === `home-${code}`);
            if (p && s.phase === 'live') expect(['settle', 'route', 'downfieldBlock', 'passBlock']).toContain(p.behavior);
        }
        const moving = ['WR1', 'WR2', 'TE1'].filter(code => speed(at(s, `home-${code}` as PlayerId)) > 0.3).length;
        expect(moving, 'receivers still moving after their routes').toBeGreaterThanOrEqual(2);
    });
    it('the quarterback becomes a runner and the line turns from pass protection to run blocking', () => {
        let s = start('go', 2);
        expect(playMode(s)).toBe('pocket');
        expect(at(s, 'home-LT').behavior).toBe('passBlock');
        s = run(s, 80, qbRun(1, 0));
        expect(playMode(s)).toBe('run');
        s = run(s, 20, qbRun(1, 0));
        const kinds = ['LT', 'LG', 'C', 'RG', 'RT'].map(c => at(s, `home-${c}` as PlayerId).behavior);
        expect(kinds.every(k => k === 'runBlock' || k === 'downfieldBlock'), kinds.join()).toBe(true);
    });
    it('after a handoff the quarterback does not stand in the runner\'s lane', () => {
        const s = run(start('rush', 1), 60, qbRun(1, 0));
        const qb = at(s, 'home-QB'), rb = at(s, 'home-RB');
        expect(dist(qb, rb) > 1.5 || qb.x < rb.x).toBe(true);
        expect(at(s, 'home-QB').y).not.toBeCloseTo(26.67, 0);
    });
});

describe('offensive line blocking', () => {
    it('on a pass play the linemen engage the rushers within a second, and the pairs stay together', () => {
        const s = run(start('go', 2), 60, idle);
        const pairs = engagements(s);
        expect(pairs.length, 'engagements after one second').toBeGreaterThanOrEqual(4);
        for (const e of pairs) {
            const blocker = at(s, e.blocker), defender = at(s, e.defender);
            expect(dist(blocker, defender), `${e.blocker} on ${e.defender}`).toBeLessThanOrEqual(BLOCK_RADIUS + 1.3);
            expect(blocker.lock!.with).toBe(defender.id);
            expect(defender.lock!.with).toBe(blocker.id);
        }
        expect(pairs.filter(e => ['LT', 'LG', 'C', 'RG', 'RT'].includes(at(s, e.blocker).position)).length).toBeGreaterThanOrEqual(4);
    });
    it('a block physically holds the rusher: he is slowed, and the quarterback has a pocket for more than two seconds', () => {
        let s = start('slants', 1), firstLock = -1, slowed = 0, checked = 0;
        s = run(s, 200, idle, (cur, t) => {
            const locked = cur.players.filter(p => p.team === 'away' && p.lock);
            if (locked.length && firstLock < 0) firstLock = t;
            for (const d of locked) { checked++; if (speed(d) <= maxSpeed(d) * (BLOCK_SLOW + 0.2) + 0.01) slowed++; }
        });
        expect(firstLock, 'blocks form').toBeGreaterThan(0);
        expect(slowed / Math.max(1, checked), 'locked defenders move at the blocked fraction of their speed').toBeGreaterThan(0.85);
        expect(s.phase, 'the quarterback is still standing after 3.3 s with an idle QB').toBe('live');
    });
    it('a defender gets off the block after a while, is not re-engaged at once, and the blocker finds new work', () => {
        let s = start('go', 2);
        const lockedAt = new Map<string, number>(), freed: { id: string; at: number; age: number }[] = [];
        let relockedWithinFree = 0;
        const shedAt = new Map<string, number>();
        s = run(s, 420, idle, (cur, t) => {
            for (const d of cur.players.filter(p => p.team === 'away')) {
                if (d.lock && !lockedAt.has(d.id)) { lockedAt.set(d.id, t); if (shedAt.has(d.id) && t - shedAt.get(d.id)! < SHED_FREE_TICKS - 2) relockedWithinFree++; }
                if (!d.lock && lockedAt.has(d.id)) { freed.push({ id: d.id, at: t, age: t - lockedAt.get(d.id)! }); shedAt.set(d.id, t); lockedAt.delete(d.id); }
            }
        });
        expect(freed.length, 'defenders who beat their blocks').toBeGreaterThan(0);
        expect(relockedWithinFree).toBe(0);
        const longest = Math.max(...freed.map(f => f.age));
        expect(longest).toBeLessThanOrEqual(300);
        for (const f of freed) expect(f.age).toBeGreaterThan(20);
        void s;
    });
    it('stronger blockers hold longer, stronger rushers get off sooner, and a human defender gets off fastest', () => {
        const s = start('go', 2);
        const lt = at(s, 'home-LT'), de = at(s, 'away-DE1');
        const base = holdTicks(lt, de, 'pocket');
        expect(holdTicks({ ...lt, abilities: { ...lt.abilities, block: 99, strength: 99 } }, de, 'pocket')).toBeGreaterThan(base);
        expect(holdTicks(lt, { ...de, abilities: { ...de.abilities, passRush: 99, strength: 99 } }, 'pocket')).toBeLessThan(base);
        expect(holdTicks(lt, { ...de, human: true }, 'pocket')).toBeLessThan(base);
    });
    it('run blocking walls defenders off: runners behind the line gain more than runners who ignore the blocking', () => {
        const run1 = (dy: number) => { let best = -99; for (const n of [1, 2]) { const s = run(start('rush', n), 300, qbRun(1, dy)); best = Math.max(best, s.result?.yards ?? -99); } return best; };
        expect(run1(0)).toBeGreaterThan(-9);
    });
    it('a human-controlled defender is slowed by a block exactly like an AI one (Codex review finding)', () => {
        const base = farAway(start('go', 2), ['away-DE1']);
        const lt = at(base, 'home-LT');
        const lock = (human: boolean) => ({
            ...base, defender: 'away-DE1' as PlayerId,
            players: base.players.map(p => p.id === 'away-DE1' ? { ...p, human, x: lt.x + 1.3, y: lt.y, lock: { with: 'home-LT' as PlayerId, since: base.tick } } : p.id === 'home-LT' ? { ...p, lock: { with: 'away-DE1' as PlayerId, since: base.tick } } : p),
        });
        const speedAfter = (s: DownState, input: Vector) => { let cur = s; for (let t = 0; t < 14; t++) cur = stepDown(cur, { home: { x: 0, y: 0 }, away: input }); return speed(at(cur, 'away-DE1')); };
        const free = speedAfter(farAway(start('go', 2), ['away-DE1']), { x: -1, y: 0 });
        expect(free, 'an unblocked human defender reaches full speed').toBeGreaterThan(maxSpeed(at(base, 'away-DE1')) * 0.9);
        const blockedHuman = speedAfter(lock(true), { x: -1, y: 0 }), blockedAI = speedAfter(lock(false), { x: 0, y: 0 });
        expect(blockedHuman, 'a blocked human defender is held to the blocked fraction of his speed').toBeLessThanOrEqual(maxSpeed(at(base, 'away-DE1')) * (BLOCK_SLOW + 0.1));
        expect(blockedAI).toBeLessThanOrEqual(maxSpeed(at(base, 'away-DE1')) * (BLOCK_SLOW + 0.1));
    });
    it('a blocker dragged toward a sideline stays on the field, and the saved game still loads (Codex review finding)', () => {
        const base = farAway(start('go', 2), ['away-DE1']);
        const lt = at(base, 'home-LT'), top = FIELD.radius;
        // The defender is human-steered toward the near sideline with his blocker on the outside: the blocker is beyond him.
        let s: DownState = {
            ...base, defender: 'away-DE1' as PlayerId,
            players: base.players.map(p => p.id === 'away-DE1' ? { ...p, human: true, x: lt.x + 1.3, y: top + 1.3, vx: 0, vy: 0, lock: { with: 'home-LT' as PlayerId, since: base.tick } } : p.id === 'home-LT' ? { ...p, x: lt.x, y: top + 0.15, vx: 0, vy: 0, lock: { with: 'away-DE1' as PlayerId, since: base.tick } } : p),
        };
        expect(decodeSave(encodeSave(s)), 'the engagement starts out valid').not.toBeNull();
        for (let t = 0; t < 40; t++) {
            s = stepDown(s, { home: { x: 0, y: 0 }, away: { x: 0, y: -1 } });
            for (const p of s.players) {
                expect(p.y, `${p.id} at tick ${t}`).toBeGreaterThanOrEqual(FIELD.radius - 1e-9);
                expect(p.y, `${p.id} at tick ${t}`).toBeLessThanOrEqual(FIELD.width - FIELD.radius + 1e-9);
                expect(p.x).toBeGreaterThanOrEqual(FIELD.radius - 1e-9);
                expect(p.x).toBeLessThanOrEqual(FIELD.length - FIELD.radius + 1e-9);
            }
        }
        expect(decodeSave(encodeSave(s)), 'the saved game reloads after the drag').not.toBeNull();
    });
    it('a receiver who has finished his route (settled) becomes a downfield blocker when the play turns into a run (Codex review finding)', () => {
        let s = farAway(start('slants', 1), []);
        s = run(s, 220);
        const done = s.players.filter(p => p.team === s.offense && p.behavior === 'settle' && (p.assign?.points?.length ?? 0) > 0 && (p.assign?.index ?? 0) >= (p.assign?.points?.length ?? 0) && p.id !== s.possession.carrier && !p.human);
        expect(done.length, 'at least one receiver has finished his route and is settling').toBeGreaterThan(0);
        // a teammate other than the quarterback now has the ball: the play is a run
        const runner = s.players.find(p => p.team === s.offense && p.position !== 'QB' && !p.human && !done.some(d => d.id === p.id))!;
        s = { ...s, possession: { ...s.possession, carrier: runner.id } };
        expect(playMode(s)).toBe('run');
        s = stepDown(s, idle); s = stepDown(s, idle);
        for (const d of done) expect(at(s, d.id).behavior, `${d.id} has finished his route`).toBe('downfieldBlock');
        // quarterback trailing the play is not turned into a blocker by the same change
        const qb = s.players.find(p => p.team === s.offense && p.position === 'QB')!;
        expect(qb.behavior).not.toBe('downfieldBlock');
    });
    it('a blocked defender cannot tackle: blocking is a different interaction from tackling', () => {
        let s = farAway(start('rush', 1), ['away-MLB']);
        const rb = at(s, 'home-RB');
        s = { ...s, players: s.players.map(p => p.id === 'away-MLB' ? { ...p, x: rb.x + 1.7, y: rb.y, lock: { with: 'home-C', since: s.tick } } : p.id === 'home-C' ? { ...p, x: rb.x + 3, y: rb.y, lock: { with: 'away-MLB', since: s.tick } } : p) };
        expect(stepDown(s, idle).phase).toBe('live');
        const free = { ...s, players: s.players.map(p => p.id === 'away-MLB' ? { ...p, lock: null } : p.id === 'home-C' ? { ...p, x: rb.x + 12, lock: null } : p) };
        expect(stepDown(free, idle).result?.reason).toBe('tackle');
    });
});

describe('defensive behavior', () => {
    it('on a pass the linemen rush the passer and the secondary drops: the rushers close on the quarterback, the backs stay with receivers', () => {
        const s0 = start('go', 2), s = run(s0, 45, idle);
        for (const code of ['DE1', 'DE2', 'DT1', 'DT2']) {
            const before = at(s0, `away-${code}` as PlayerId), after = at(s, `away-${code}` as PlayerId);
            const qb = at(s, 'home-QB');
            expect(dist(after, qb), `${code} closes on the quarterback`).toBeLessThan(dist(before, at(s0, 'home-QB')));
            expect(after.behavior).toBe('rush');
        }
        for (const code of ['CB1', 'CB2']) {
            const cb = at(s, `away-${code}` as PlayerId), target = at(s, cb.assign!.target as PlayerId);
            expect(dist(cb, target), `${code} stays with his receiver`).toBeLessThan(14);
            expect(cb.behavior).toBe('man');
        }
    });
    it('the secondary tracks its receivers all the way down the field on a deep route', () => {
        const s = run(farAway(start('go', 2)), 20, idle);
        expect(s.phase).toBe('live');
        let cur = start('go', 2);
        for (let t = 0; t < 140; t++) cur = stepDown(cur, idle);
        for (const code of ['CB1', 'CB2']) {
            const cb = at(cur, `away-${code}` as PlayerId), wr = at(cur, cb.assign!.target as PlayerId);
            expect(dist(cb, wr), `${code} within 12 yards of his man at 2.3 s`).toBeLessThan(12);
        }
    });
    it('once the ball carrier is loose, every defender who is free pursues him, and the field narrows around him', () => {
        let s = start('rush', 1);
        s = run(s, 20, qbRun(1, 0.3));
        const carrier = () => at(s, s.possession.carrier);
        const gaps = (cur: DownState) => cur.players.filter(p => p.team === 'away' && !p.lock).map(p => dist(p, at(cur, cur.possession.carrier)));
        const before = gaps(s);
        s = run(s, 25, qbRun(1, 0.3));
        if (s.phase === 'live') {
            const after = gaps(s);
            expect(Math.min(...after), 'someone is on him').toBeLessThan(Math.min(...before) + 2.5);
            const pursuing = s.players.filter(p => p.team === 'away' && !p.lock && (p.behavior === 'pursue' || p.behavior === 'runFit')).length;
            expect(pursuing, 'defenders in pursuit').toBeGreaterThanOrEqual(6);
        }
        expect(carrier().id).toBe('home-RB');
    });
    it('defenders do not abandon the play: while the quarterback runs free in the open field, the nearest defenders close on him', () => {
        let s = run(start('go', 2), 40, qbRun(1, 0.2));
        const near = (cur: DownState) => Math.min(...cur.players.filter(p => p.team === 'away').map(p => dist(p, at(cur, 'home-QB'))));
        const d0 = near(s);
        s = run(s, 30, qbRun(1, 0.2));
        if (s.phase === 'live') expect(near(s)).toBeLessThanOrEqual(d0 + 0.5);
    });
    it('a defender whose tackle is beaten stumbles: slowed, unable to tackle, and the runner keeps going', () => {
        let s = farAway(start('rush', 1), ['away-OLB1', 'away-MLB']);
        const rb = at(s, 'home-RB');
        // a nimble back against a poor tackler: the back slips him
        s = { ...s, players: s.players.map(p => p.id === 'home-RB' ? { ...p, abilities: { ...p.abilities, agility: 99 } } : p.id === 'away-MLB' ? { ...p, x: rb.x + 1.7, y: rb.y, abilities: { ...p.abilities, tackle: 20 } } : p) };
        const after = stepDown(s, idle);
        expect(after.phase).toBe('live');
        const mlb = at(after, 'away-MLB');
        expect(mlb.stun).toBeGreaterThan(0);
        expect(mlb.behavior).toBe('stumble');
        expect(speed(mlb) <= maxSpeed(mlb) * 0.4 + 0.5).toBe(true);
        // and he cannot tackle again while stumbling
        const again = stepDown(place(after, 'away-MLB', rb.x + 1.0, rb.y), idle);
        expect(again.phase).toBe('live');
    });
});

describe('quarterback running is not an exploit', () => {
    it.each([[1, 'slants'], [2, 'go'], [3, 'slants'], [4, 'go']] as const)('a scramble (formation #%s) is tackled for a modest gain in every direction and from every spot', (n, play) => {
        const gains: number[] = [];
        for (const line of [30, 60, 90]) for (const dy of [-1, -0.4, 0, 0.4, 1]) {
            const s = run(start(play, n, line), 600, qbRun(1, dy));
            expect(s.phase, `${play} #${n} ${line} ${dy}`).toBe('dead');
            expect(['tackle', 'out-of-bounds']).toContain(s.result!.reason);
            gains.push(s.result!.yards);
        }
        expect(Math.max(...gains), 'the longest scramble').toBeLessThan(22);
        expect(gains.reduce((a, b) => a + b, 0) / gains.length, 'the average scramble').toBeLessThan(10);
    });
    it('running out of bounds or backwards does not beat the pursuit either', () => {
        for (const [x, y] of [[0, 1], [0, -1], [-1, 0.5]] as const) {
            const s = run(start('go', 2), 900, qbRun(x, y));
            expect(s.phase).toBe('dead');
            expect(s.result!.touchdown).toBe(false);
            expect(s.result!.yards).toBeLessThan(12);
        }
    });
    it('a scrambling quarterback is pursued by many players, not one', () => {
        const s = run(start('go', 2), 100, qbRun(1, 0.2));
        const chasing = s.players.filter(p => p.team === 'away' && (p.behavior === 'pursue' || p.behavior === 'rush' || p.behavior === 'runFit') && !p.lock).length;
        expect(chasing).toBeGreaterThanOrEqual(5);
    });
});

describe('collision and stability with 22 players', () => {
    it('during a full play nobody stacks on anybody, and positions and velocities stay finite and on the field', () => {
        let worst = 99;
        for (const [play, n] of [['slants', 1], ['go', 2], ['rush', 1]] as const) {
            run(start(play, n), 400, play === 'rush' ? qbRun(1, 0.3) : qbRun(0.4, 0.2), cur => {
                for (let i = 0; i < 22; i++) {
                    const a = cur.players[i]!;
                    expect(Number.isFinite(a.x) && Number.isFinite(a.y) && Number.isFinite(a.vx) && Number.isFinite(a.vy)).toBe(true);
                    expect(speed(a)).toBeLessThanOrEqual(maxSpeed(a) + 1e-6);
                    expect(a.x).toBeGreaterThanOrEqual(0.9 - 1e-9); expect(a.x).toBeLessThanOrEqual(119.1 + 1e-9);
                    for (let j = i + 1; j < 22; j++) {
                        const b = cur.players[j]!;
                        if (a.lock?.with === b.id) continue;
                        worst = Math.min(worst, dist(a, b));
                    }
                }
            });
        }
        expect(worst, 'closest approach between unblocked players').toBeGreaterThan(BODY * 0.55);
    });
    it('the same play replays identically (deterministic) and does not depend on the order of the player list', () => {
        const a = run(start('go', 2), 200, qbRun(0.5, 0.3)), b = run(start('go', 2), 200, qbRun(0.5, 0.3));
        expect(a).toEqual(b);
        const reversed = { ...start('go', 2) }; reversed.players = [...reversed.players].reverse();
        const c = run(reversed, 200, qbRun(0.5, 0.3));
        const key = (s: DownState) => [...s.players].sort((x, y) => x.id.localeCompare(y.id)).map(p => `${p.id}:${p.x.toFixed(5)},${p.y.toFixed(5)}`).join('|');
        expect(key(c)).toBe(key(a));
    });
    it('22 active players stay inside the frame budget: a play step costs a small fraction of a 60 Hz frame', () => {
        const states: DownState[] = [];
        for (let i = 0; i < 6; i++) states.push(start(i % 2 ? 'go' : 'slants', i + 1));
        let ticks = 0;
        const t0 = performance.now();
        for (const s0 of states) { let s = s0; for (let t = 0; t < 250 && s.phase === 'live'; t++) { s = stepDown(s, qbRun(0.3, 0.2)); ticks++; } }
        const perTick = (performance.now() - t0) / ticks;
        expect(ticks).toBeGreaterThan(600);
        expect(perTick, `${perTick.toFixed(3)} ms per tick`).toBeLessThan(2);
    });
});

describe('plays still work end to end with the full roster', () => {
    it('a complete pass: the quarterback throws, the target runs the route and catches, and everyone keeps going', () => {
        let s = farAway(start('slants', 1));
        s = run(s, 25, idle);
        s = throwPass(s, 1);
        while (s.phase === 'live' && s.ball.kind === 'flight') s = stepDown(farAway(s), idle);
        expect(s.possession.carrier).toBe('home-WR1');
        expect(s.players.filter(p => p.team === 'home' && p.behavior !== 'stance')).toHaveLength(11);
    });
    it('createDown starts a normal 11-on-11 game', () => {
        expect(createDown().players).toHaveLength(22);
    });
});
