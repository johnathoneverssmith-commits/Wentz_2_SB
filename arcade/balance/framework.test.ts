/**
 * Tests of the balance framework itself (Phase A): the sweeper's telemetry, reproducibility, the strategy matrix, field-position
 * handling, the statistics on real data and the registry of known imbalances. None of these decide what the game SHOULD do. The
 * golden window maps at the end describe what the engine does today; the pull requests that change passing update them on purpose.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { choosePlay, lineUp, snap, stepDown, throwPass, type DownState, type Play } from '../core/down';
import type { Inputs, PlayerId } from '../core/simulation';
import { EVIDENCE_SEEDS, KNOWN_IMBALANCES, gatherEvidence, type Evidence } from './imbalances';
import { STARTS, cells, dominance, readBenchmarks, runGames, runMatrix, summarizeCell, type DriveRecord } from './matrix';
import { hashSeed } from './rng';
import { BALANCED, BEST_RESPONSE, DEEP, EVAL_SEEDS, OPEN_SEPARATION, SHORT, STRATEGIES, TIMING_AWARE, bestCall, driveSeed, gameSeedOf, predictions, throwValue, type Strategy } from './strategies';
import { isDeep, byDistance, byRoute, byTiming, rates, sweep, targetCode, throwOnce, throwOutcomes, tickRange, windowMap, type Target, type ThrowRecord } from './window';

const Z = { x: 0, y: 0 }, IDLE: Inputs = { home: Z, away: Z };
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
const ctx = { defense: 'idle', opts: { reaction: 12, thinkTicks: 0 } } as const;
/** Letters with touchdowns counted as catches: the shape of a window, whatever happens to the ball after it is caught. */
/** The window map with a touchdown or a contested catch counted as a catch and a knocked-down pass as an incompletion: what happened, not how. */
const shape = (records: readonly ThrowRecord[]) => windowMap(records).replace(/[Tc]/g, 'C').replace(/b/g, 'x');
const differing = (a: string, b: string) => [...a].filter((c, i) => c !== b[i]).length;

let evidence: Evidence;
beforeAll(() => { evidence = gatherEvidence(); }, 120_000);

describe('the window sweeper records correct telemetry', () => {
    /** The same throw made by hand with the engine's own functions, with nobody controlled. */
    function byHand(play: Play, target: Target, tick: number) {
        let s: DownState = snap(choosePlay(lineUp('home', 40, { playNumber: 1 }), play));
        for (let t = 0; t < tick; t++) s = stepDown(s, IDLE);
        const qb = s.players.find(p => p.id === s.possession.carrier)!;
        s = throwPass(s, target);
        if (s.ball.kind !== 'flight') throw new Error('no throw');
        const to = s.ball.to, rec0 = s.players.find(p => p.id === (s.ball as { target: PlayerId }).target)!;
        const sepThrow = Math.min(...s.players.filter(p => p.team === 'away').map(p => dist(p, rec0)));
        let flightTicks = 0;
        while (s.ball.kind === 'flight') { s = stepDown(s, IDLE); flightTicks++; }
        const rec = s.players.find(p => p.id === rec0.id)!;
        const nearest = Math.min(...s.players.filter(p => p.team === 'away').map(p => dist(p, rec)));
        const nearToBall = Math.min(...s.players.filter(p => p.team === 'away').map(p => dist(p, to)));
        return { air: dist(qb, to), flightTicks, sepThrow, sepArrival: nearest, receiverGap: dist(rec, to), defenderGap: nearToBall, receiver: rec0.id };
    }
    it.each([['go', 1, 90], ['go', 2, 40], ['slants', 2, 80], ['slants', 3, 20], ['slants', 1, 0]] as const)('%s to target %i at tick %i agrees with the same throw made by hand', (play, target, tick) => {
        const r = throwOnce({ play, target, throwTick: tick }), h = byHand(play, target, tick);
        expect(r.receiver).toBe(h.receiver);
        expect(r.airYards).toBeCloseTo(h.air, 9);
        expect(Math.round(r.flightSeconds * 60)).toBe(h.flightTicks);
        expect(r.separationAtThrow).toBeCloseTo(h.sepThrow, 9);
        expect(r.separationAtArrival).toBeCloseTo(h.sepArrival, 9);
        expect(r.receiverGap).toBeCloseTo(h.receiverGap, 9);
        expect(r.defenderGap).toBeCloseTo(h.defenderGap, 9);
    });
    it('classifies each outcome from the engine\'s own result, and every outcome is one of the catch kinds', () => {
        const seen: Record<string, Set<string | null>> = { complete: new Set(), incomplete: new Set(), interception: new Set() };
        for (let seed = 1; seed <= 80; seed++) for (const [play, target, tick] of [['slants', 1, 4], ['go', 3, 4], ['slants', 1, 100], ['go', 1, 90], ['go', 3, 120]] as const) {
            const r = throwOnce({ play, target, throwTick: tick, seed });
            expect(r.seed).toBe(seed);
            seen[r.outcome]!.add(r.catchKind);
        }
        expect([...seen.complete!].sort()).toEqual(['catch', 'contested-catch']);
        expect([...seen.incomplete!].sort()).toEqual(['breakup', 'incomplete']);
        expect([...seen.interception!]).toEqual(['interception']);
        const sack = throwOnce({ play: 'slants', target: 2, throwTick: 9999 });
        expect(sack.outcome).toBe('sack'); expect(sack.catchKind).toBeNull(); expect(sack.airYards).toBe(0); expect(sack.separationAtThrow).toBeNaN();
        for (let seed = 1; seed <= 30; seed++) { const r = throwOnce({ play: 'slants', target: 2, throwTick: 8, line: 106, seed }); expect(r.touchdown).toBe(r.outcome === 'complete'); }
    });
    it('deciding a throw under many seeds from one run up to the catch gives exactly the records of playing it once per seed (nothing reads the seed before the catch)', () => {
        const seeds = [1, 2, 3, 17, 4096];
        for (const [play, target, tick] of [['slants', 1, 40], ['go', 2, 100], ['slants', 3, 20], ['go', 1, 9999]] as const) {
            const forked = throwOutcomes({ play, target, throwTick: tick, stopAtArrival: true }, seeds);
            expect(forked).toHaveLength(seeds.length);
            forked.forEach((r, k) => expect(r, `${play} ${target} @${tick} seed ${seeds[k]}`).toEqual(throwOnce({ play, target, throwTick: tick, seed: seeds[k], stopAtArrival: true })));
        }
        const swept = sweep({ plays: ['go'], targets: [1], ticks: [20, 100], seeds, stopAtArrival: true });
        expect(swept).toEqual(seeds.flatMap(seed => [20, 100].map(tick => throwOnce({ play: 'go', target: 1, throwTick: tick, seed, stopAtArrival: true }))));
    });
    it('records yards only for completions, and the incomplete and intercepted throws gain nothing', () => {
        for (const r of evidence.pocket) { if (r.outcome !== 'complete') expect(r.yards).toBe(0); else expect(Number.isFinite(r.yards)).toBe(true); }
    });
    it('records the receiver and nearest-defender abilities, and applies ability overrides', () => {
        const base = throwOnce({ play: 'go', target: 1, throwTick: 90 });
        expect(base.receiver).toBe('home-WR1'); expect(base.nearestDefender).toMatch(/^away-/);
        expect(base.receiverAbilities.speed).toBe(70); expect(base.defenderAbilities).toHaveProperty('coverage');
        const fast = throwOnce({ play: 'go', target: 1, throwTick: 90, abilities: { 'home-WR1': { speed: 80, hands: 99 } } });
        expect(fast.receiverAbilities).toMatchObject({ speed: 80, hands: 99 });
        expect(fast.receiverAbilities.accel).toBe(base.receiverAbilities.accel);
        const slowCb = throwOnce({ play: 'go', target: 1, throwTick: 90, abilities: { 'away-CB1': { speed: 50 } } });
        expect(slowCb.defenderAbilities.speed).toBe(50);
    });
    it('every throw in a sweep has coherent numbers', () => {
        for (const r of evidence.pocket) {
            expect(['home']).toContain(r.team);
            if (r.outcome === 'sack') continue;
            expect(r.airYards).toBeGreaterThan(0); expect(r.flightSeconds).toBeGreaterThan(0);
            for (const v of [r.separationAtThrow, r.separationAtArrival, r.receiverGap, r.defenderGap]) { expect(Number.isFinite(v)).toBe(true); expect(v).toBeGreaterThanOrEqual(0); }
            expect(r.defenderGap).toBeLessThanOrEqual(r.receiverGap + r.separationAtArrival + 1e-9);
        }
    });
    it('stopping at the catch point agrees with the full play on what happened to the ball', () => {
        let compared = 0;
        for (const play of ['slants', 'go'] as const) for (const target of [1, 2, 3] as const) for (const tick of [8, 40, 72, 104, 136]) {
            const full = throwOnce({ play, target, throwTick: tick }), quick = throwOnce({ play, target, throwTick: tick, stopAtArrival: true });
            expect(quick.exact).toBe(false); expect(full.exact).toBe(true);
            expect(quick.outcome).toBe(full.outcome); expect(quick.separationAtArrival).toBeCloseTo(full.separationAtArrival, 9); expect(quick.airYards).toBeCloseTo(full.airYards, 9);
            compared++;
        }
        expect(compared).toBe(30);
    });
    it('a throw can start from a real pre-snap situation', () => {
        const s = lineUp('home', 40, { playNumber: 1 });
        expect(windowMap(sweep({ plays: ['go'], targets: [1], ticks: tickRange(0, 60, 4) }))).toBe(windowMap(tickRange(0, 60, 4).map(t => throwOnce({ play: 'go', target: 1, throwTick: t, from: s }))));
        expect(throwOnce({ play: 'go', target: 1, throwTick: 90, from: lineUp('away', 80, { playNumber: 1 }) }).team).toBe('away');
    });
});

describe('results are reproducible', () => {
    it('a sweep repeated gives identical records, and the order is fixed (plays, receivers, lines, play numbers, ticks)', () => {
        const spec = { plays: ['slants', 'go'] as const, targets: [1, 3] as const, ticks: tickRange(0, 40, 8) };
        const a = sweep(spec), b = sweep(spec);
        expect(a).toEqual(b);
        expect(a.map(r => `${r.play}${r.target}@${r.throwTick}`).slice(0, 7)).toEqual(['slants1@0', 'slants1@8', 'slants1@16', 'slants1@24', 'slants1@32', 'slants1@40', 'slants3@0']);
    });
    it('the same seeds reproduce a matrix exactly; different seeds explore different choices', () => {
        const spec = { strategies: [BALANCED, DEEP], defenses: ['idle'] as const, starts: [38, 74] };
        const a = runMatrix({ ...spec, seeds: [1, 2] }), b = runMatrix({ ...spec, seeds: [1, 2] });
        expect(a).toEqual(b);
        const c = runMatrix({ ...spec, seeds: [3, 4] });
        expect(c).not.toEqual(a.map(r => ({ ...r, seed: r.seed + 2 })));
    });
    it('a strategy\'s choices for one play are fixed however often the harness asks, and come from its seed alone', () => {
        const s = lineUp('home', 40, { playNumber: 1 });
        for (const strategy of [DEEP, SHORT, BALANCED]) {
            const p = strategy.make(77, ctx), q = strategy.make(77, ctx), other = strategy.make(78, ctx);
            const playP = p.play(s), playQ = q.play(s);
            expect(playQ).toBe(playP);
            const t1 = p.throwAt(s), tgt = typeof p.target === 'function' ? p.target(s) : p.target;
            for (let i = 0; i < 5; i++) { expect(p.throwAt(s)).toBe(t1); expect(typeof p.target === 'function' ? p.target(s) : p.target).toBe(tgt); }
            expect(q.throwAt(s)).toBe(t1);
            const sequence = (policy: typeof p) => Array.from({ length: 40 }, () => { const x = policy.play(s); return `${x}${policy.throwAt(s)}`; });
            const same77 = sequence(strategy.make(77, ctx)), again77 = sequence(strategy.make(77, ctx)), seed78 = sequence(other);
            expect(new Set(seed78).size).toBeGreaterThan(1);
            expect(again77).toEqual(same77);
            expect(seed78).not.toEqual(same77);
        }
    });
    it('the choices of the best response ignore its stream seed, but a matrix still runs it under every seed: each game has its own dice', () => {
        const pre = lineUp('home', 60, { playNumber: 1 });
        const call = (seed: number) => { const p = BEST_RESPONSE.make(seed, ctx); const play = p.play(pre); return JSON.stringify([play, typeof p.target === 'function' ? p.target(pre) : p.target, typeof p.throwAt === 'function' ? p.throwAt(pre) : p.throwAt]); };
        expect(call(1)).toBe(call(2));
        const records = runMatrix({ strategies: [BEST_RESPONSE], defenses: ['idle'], seeds: [1, 2, 3], starts: [60] });
        expect(records).toHaveLength(2 * 3);
        expect(new Set(records.map(r => r.seed))).toEqual(new Set([1, 2, 3]));
        // a policy that ignores its seed, over the same drive under three game seeds, can end three different ways
        const fixed = { id: 'fixed', name: 'fixed', description: '', deterministic: true, make: () => ({ name: 'fixed', play: () => 'slants' as const, throwAt: () => 40, fieldGoals: true, target: 1 as const }) };
        const drives = runMatrix({ strategies: [fixed], defenses: ['idle'], seeds: [1, 2, 3, 4, 5, 6], starts: [50] });
        expect(drives).toHaveLength(2 * 6);
        expect(new Set(drives.map(d => `${d.points}/${d.plays}/${d.completions}`)).size, 'chance changes the drive').toBeGreaterThan(1);
    });
    it('each best-response prediction records the defense it was made against, so a report compares like with like', () => {
        predictions.length = 0;
        for (const defense of ['idle', 'cover'] as const) BEST_RESPONSE.make(1, { defense, opts: ctx.opts }).play(lineUp('home', 60, { playNumber: 1 }));
        expect(predictions.map(p => p.defense)).toEqual(['idle', 'cover']);
        predictions.length = 0;
    });
    it('every drive in a matrix gets its own derived seed', () => {
        expect(hashSeed(1, 'home', 38)).not.toBe(hashSeed(1, 'home', 50));
        expect(hashSeed(1, 'home', 38)).not.toBe(hashSeed(1, 'away', 38));
        expect(hashSeed(1, 'home', 38)).not.toBe(hashSeed(2, 'home', 38));
    });
});

describe('the strategies do what they say', () => {
    const s = lineUp('home', 40, { playNumber: 1 });
    const calls = (strategy: typeof DEEP, n = 300) => { const p = strategy.make(5, ctx); return Array.from({ length: n }, () => { const play = p.play(s); return { play, target: typeof p.target === 'function' ? p.target(s) : p.target ?? 1, tick: p.throwAt(s) }; }); };
    it('the deep specialist only runs the go route, to a wideout, at moments across the pocket', () => {
        const c = calls(DEEP); expect(new Set(c.map(x => x.play))).toEqual(new Set(['go'])); expect(new Set(c.map(x => x.target))).toEqual(new Set([1, 2]));
        expect(Math.min(...c.map(x => x.tick))).toBeGreaterThanOrEqual(20); expect(Math.max(...c.map(x => x.tick))).toBeLessThanOrEqual(160); expect(new Set(c.map(x => x.tick)).size).toBeGreaterThan(40);
    });
    it('the short specialist only runs slants, to any receiver, earlier in the pocket', () => {
        const c = calls(SHORT); expect(new Set(c.map(x => x.play))).toEqual(new Set(['slants'])); expect(new Set(c.map(x => x.target))).toEqual(new Set([1, 2, 3]));
        expect(Math.min(...c.map(x => x.tick))).toBeGreaterThanOrEqual(12); expect(Math.max(...c.map(x => x.tick))).toBeLessThanOrEqual(110);
    });
    it('the balanced offense mixes runs and both routes in about the stated shares', () => {
        const c = calls(BALANCED, 3000), share = (play: string) => c.filter(x => x.play === play).length / c.length;
        expect(share('rush')).toBeGreaterThan(0.26); expect(share('rush')).toBeLessThan(0.34); expect(share('slants')).toBeGreaterThan(0.31); expect(share('slants')).toBeLessThan(0.39); expect(share('go')).toBeGreaterThan(0.31); expect(share('go')).toBeLessThan(0.39);
    });
    it('the timing-aware offense does not throw in the first 12 ticks, and throws to the receiver who is open once one is', () => {
        const p = TIMING_AWARE.make(1, ctx);
        p.play(s);
        let st: DownState = snap(choosePlay(s, 'go'));
        let threw = -1;
        for (let t = 0; t < 200 && st.phase === 'live'; t++) {
            if (p.throwNow!(st)) { threw = st.liveTicks; break; }
            st = stepDown(st, IDLE);
        }
        expect(threw).toBeGreaterThanOrEqual(12); expect(threw).toBeLessThanOrEqual(150);
        const chosen = typeof p.target === 'function' ? p.target(st) : p.target!;
        const rec = st.players.find(x => x.id === `home-${targetCode(chosen)}`)!;
        if (threw < 150) expect(Math.min(...st.players.filter(x => x.team === 'away').map(x => dist(x, rec)))).toBeGreaterThanOrEqual(OPEN_SEPARATION - 1e-9);
    });
    it('the best response takes the throw with the highest expected value: nothing on the search grid beats it, and its value is the average of what the throw earns under the evaluation seeds', () => {
        const pre = lineUp('home', 60, { playNumber: 1 });
        const best = bestCall(pre, ctx);
        const expected = (play: Play, target: Target, tick: number) => { const rs = throwOutcomes({ play, target, throwTick: tick, from: pre }, EVAL_SEEDS); return rs.reduce((a, r) => a + throwValue(r), 0) / rs.length; };
        let bruteMax = -Infinity;
        for (const play of ['slants', 'go'] as const) for (const target of [1, 2, 3] as const) for (const tick of tickRange(8, 160, 8)) bruteMax = Math.max(bruteMax, expected(play, target, tick));
        expect(best.value).toBeGreaterThanOrEqual(bruteMax - 1e-9);
        expect(expected(best.play, best.target, best.tick)).toBeCloseTo(best.value, 9);
        expect(best.value).toBeGreaterThan(0);
        expect(best.pComplete).toBeGreaterThan(0); expect(best.pComplete).toBeLessThanOrEqual(1);
    });
    it('the best response never looks at the seed of the game it is in: the same situation under any game seed gives the same call, and the oracle (which does) can differ', () => {
        const calls = [1, 2, 3, 0xbeef].map(seed => { const c = bestCall(lineUp('home', 60, { playNumber: 1, seed }), ctx); return JSON.stringify([c.play, c.target, c.tick, c.value]); });
        expect(new Set(calls).size).toBe(1);
        const oracle = [1, 2, 3, 4, 5, 6, 7, 8].map(seed => { const c = bestCall(lineUp('home', 60, { playNumber: 1, seed }), ctx, 8, 160, [seed]); return JSON.stringify([c.play, c.target, c.tick]); });
        expect(new Set(oracle).size, 'an oracle that sees each game\'s dice picks different throws in different games').toBeGreaterThan(1);
    });
    it('the evaluation seeds are fixed and distinct, and no game a matrix or a report plays uses one of them', () => {
        expect(new Set(EVAL_SEEDS).size).toBe(EVAL_SEEDS.length); expect(EVAL_SEEDS).toHaveLength(16);
        const used = new Set<number>();
        for (let seed = 1; seed <= 12; seed++) for (const team of ['home', 'away']) for (const start of STARTS) used.add(gameSeedOf(driveSeed(seed, team, start)));
        for (const e of EVAL_SEEDS) expect(used.has(e), `evaluation seed ${e}`).toBe(false);
    });
    it('on held-out games the expectation best response completes about as often as it predicted, and the oracle does better because it saw the dice', () => {
        const heldOut = Array.from({ length: 24 }, (_, k) => gameSeedOf(driveSeed(100 + k, 'home', 60)));
        const pre = (seed: number) => lineUp('home', 60, { playNumber: 1, seed });
        const call = bestCall(pre(1), ctx);
        const realized = throwOutcomes({ play: call.play, target: call.target, throwTick: call.tick, from: pre(1) }, heldOut);
        const completed = realized.filter(r => r.outcome === 'complete').length / realized.length;
        expect(Math.abs(completed - call.pComplete), `predicted ${call.pComplete.toFixed(2)}, realized ${completed.toFixed(2)}`).toBeLessThan(0.3);
        let expectedValue = 0, oracleValue = 0;
        for (const seed of heldOut) {
            const mine = bestCall(pre(seed), ctx), theirs = bestCall(pre(seed), ctx, 8, 160, [seed]);
            expectedValue += throwValue(throwOnce({ play: mine.play, target: mine.target, throwTick: mine.tick, from: pre(seed), stopAtArrival: true }));
            oracleValue += throwValue(throwOnce({ play: theirs.play, target: theirs.target, throwTick: theirs.tick, from: pre(seed), stopAtArrival: true }));
        }
        expect(oracleValue, 'seeing the dice is worth something').toBeGreaterThan(expectedValue);
    });
    it('throw values rank a touchdown above a gain above an incompletion above a loss above an interception', () => {
        const mk = (o: Partial<ThrowRecord>) => ({ outcome: 'complete', touchdown: false, yards: 0, ...o }) as ThrowRecord;
        expect(throwValue(mk({ touchdown: true }))).toBeGreaterThan(throwValue(mk({ yards: 40 })));
        expect(throwValue(mk({ yards: 5 }))).toBeGreaterThan(throwValue(mk({ outcome: 'incomplete' })));
        // a catch that loses ground is worse than an incompletion, which keeps the field position
        expect(throwValue(mk({ outcome: 'incomplete' }))).toBeGreaterThan(throwValue(mk({ yards: -2 })));
        expect(throwValue(mk({ yards: -2 }))).toBeGreaterThan(throwValue(mk({ outcome: 'interception' })));
    });
    it('a quick measurement keeps the sign of a catch behind the line, as the full play does', () => {
        // a slow tight end, thrown to at the snap, is caught behind the line of scrimmage
        const quick = throwOnce({ play: 'slants', target: 3, throwTick: 0, abilities: { 'home-TE1': { speed: 0 } }, stopAtArrival: true });
        expect(quick.outcome).toBe('complete'); expect(quick.yards).toBeLessThan(0); expect(quick.yards).toBeGreaterThan(-quick.airYards);
    });
    it('in a game each offense is shown the defense it will face, not the one its own team plays', () => {
        const seen: Record<string, string> = {};
        const spy = (label: string): Strategy => ({ ...DEEP, id: label, make: (seed, c) => { seen[label] = c.defense; return DEEP.make(seed, c); } });
        runGames({ home: spy('home'), away: spy('away'), homeDefense: 'idle', awayDefense: 'cover', seeds: [1] });
        expect(seen).toEqual({ home: 'cover', away: 'idle' });
    });
    it('lists every strategy once, by a unique id', () => { expect(new Set(STRATEGIES.map(x => x.id)).size).toBe(STRATEGIES.length); expect(STRATEGIES.map(x => x.id)).toEqual(['deep', 'short', 'balanced', 'timing', 'best']); });
});

describe('field position is handled consistently', () => {
    // The windows depend on where the play is only at the edges of the field. In the interior a route has the same windows wherever the
    // line of scrimmage is, up to a throw or two flipping at a boundary tick; near the goal lines the end zone and the dead-ball line change them.
    const ticks = tickRange(0, 200, 8), lines = [24, 30, 50, 60, 66, 74, 82];
    const at = (play: Play, target: Target, line: number, team: 'home' | 'away' = 'home') => shape(sweep({ plays: [play], targets: [target], ticks, lines: [line], team }));
    it.each([['slants', 1], ['slants', 2], ['slants', 3], ['go', 1], ['go', 2], ['go', 3]] as const)('%s to target %i has the same windows (within a throw or two) from every interior spot', (play, target) => {
        const reference = at(play, target, 40);
        // a defense with more decisions (when to read the ball, who to follow) has more boundary ticks where a hair of float difference flips one throw
        for (const line of lines) expect(differing(reference, at(play, target, line)), `line ${line}`).toBeLessThanOrEqual(5);
    });
    it('a play from the other end of the field, mirrored, has the same windows', () => {
        for (const [play, target] of [['slants', 2], ['go', 1], ['slants', 3]] as const)
            for (const line of [40, 60]) expect(differing(at(play, target, line), at(play, target, 120 - line, 'away')), `${play} ${target} @${line}`).toBeLessThanOrEqual(1);
    });
    it('a catch is a touchdown exactly when the ball is thrown into the end zone', () => {
        const quickGame = (line: number) => [0, 8, 16].map(t => throwOnce({ play: 'slants', target: 2, throwTick: t, line }));
        for (const r of quickGame(40)) expect(r.touchdown).toBe(false);
        const near = quickGame(106);
        expect(near.some(x => x.outcome === 'complete')).toBe(true);
        for (const r of near.filter(x => x.outcome === 'complete')) expect(r.touchdown).toBe(true);
        for (const r of near.filter(x => x.outcome !== 'complete')) expect(r.touchdown).toBe(false);
        const quick = throwOnce({ play: 'slants', target: 2, throwTick: 8, line: 106, stopAtArrival: true }), full = throwOnce({ play: 'slants', target: 2, throwTick: 8, line: 106 });
        expect(quick.touchdown).toBe(full.touchdown);
    });
    it('and the edges are different: at the own goal line the windows are not the interior ones (documented, so a sweep there is not mistaken for an interior one)', () => {
        const interior = at('slants', 1, 40);
        expect(differing(interior, at('slants', 1, 8))).toBeGreaterThanOrEqual(8);
    });
});

describe('the statistics add up on real data', () => {
    it('rates partition the throws and their intervals contain the estimates', () => {
        const r = rates(evidence.pocket.filter(x => x.outcome !== 'sack'));
        expect(r.complete.k + r.incomplete.k + r.interception.k).toBe(r.throws);
        for (const p of [r.complete, r.incomplete, r.interception, r.touchdown]) { expect(p.ci.lo).toBeLessThanOrEqual(p.p); expect(p.ci.hi).toBeGreaterThanOrEqual(p.p); }
        expect(r.complete.p + r.incomplete.p + r.interception.p).toBeCloseTo(1, 12);
    });
    it('the by-route, by-timing and by-distance groupings each cover every throw exactly once', () => {
        const thrown = evidence.pocket.filter(x => x.outcome !== 'sack');
        expect([...byRoute(evidence.pocket).values()].reduce((a, r) => a + r.throws, 0)).toBe(evidence.pocket.length);
        expect(byRoute(evidence.pocket).size).toBe(6);
        expect(byTiming(evidence.pocket).reduce((a, b) => a + b.rates.throws, 0)).toBe(evidence.pocket.length);
        expect(byDistance(evidence.pocket).reduce((a, b) => a + b.rates.throws, 0)).toBe(thrown.length);
    });
    it('the sweep covers every pass play and eligible receiver across the whole pocket', () => {
        const keys = new Set(evidence.pocket.map(r => `${r.play}-${r.target}`));
        expect(keys).toEqual(new Set(['slants-1', 'slants-2', 'slants-3', 'go-1', 'go-2', 'go-3']));
        expect(evidence.pocket).toHaveLength(6 * 61 * EVIDENCE_SEEDS.length);
        expect(Math.max(...evidence.pocket.map(r => r.throwTick))).toBe(240);
        expect(evidence.ticksToSack).toBe(245);
    });
    it('the longest open run counts consecutive completions in throw order', () => {
        const row = evidence.pocket.filter(r => r.play === 'go' && r.target === 1);
        expect(rates(row).openRun).toBe(row.map(r => r.outcome === 'complete' ? 'C' : '.').join('').split('.').reduce((m, run) => Math.max(m, run.length), 0));
    });
});

describe('strategy comparisons are computed correctly', () => {
    const rec = (strategy: string, points: number, extra: Partial<DriveRecord> = {}): DriveRecord => ({
        strategy, defense: 'idle', seed: 1, team: 'home', start: 28, end: points ? 'touchdown' : 'downs', points, touchdown: points >= 6, plays: 3, passes: 3, completions: 2, interceptions: 0, incompletions: 1, sacks: 0, rushes: 0, passYards: 20, ...extra,
    });
    const many = (strategy: string, values: number[]) => values.map(v => rec(strategy, v));
    it('summarises a cell exactly: drives, mean points, shares, rates and the points distribution', () => {
        const c = summarizeCell([rec('a', 7), rec('a', 0), rec('a', 3, { touchdown: false }), rec('a', 7)]);
        expect(c.drives).toBe(4); expect(c.points.mean).toBe(4.25); expect(c.touchdownDrives.k).toBe(2); expect(c.scoringDrives.k).toBe(3);
        expect(c.completion).toMatchObject({ k: 8, n: 12 }); expect(c.playsPerDrive).toBe(3);
        expect(c.pointsDistribution.map(d => [d.value, d.count])).toEqual([[0, 1], [3, 1], [7, 2]]);
        expect(Object.values(c.ends).reduce((a, b) => a + b, 0)).toBe(4);
        expect(() => summarizeCell([])).toThrow();
    });
    it('names the dominant strategy only when it out-scores every other by more than chance', () => {
        const spread = (centre: number) => Array.from({ length: 60 }, (_, i) => centre + (i % 5) - 2);
        const all = cells([...many('A', spread(6)), ...many('B', spread(2)), ...many('C', spread(2.4))]);
        const d = dominance(all, 'idle');
        expect(d.dominant).toBe('A'); expect(d.ranking.map(r => r.strategy)).toEqual(['A', 'C', 'B']); expect(d.leads.every(l => l.lo > 0)).toBe(true);
        const close = dominance(cells([...many('A', spread(3)), ...many('B', spread(2.9))]), 'idle');
        expect(close.dominant).toBeNull(); expect(close.leads[0]!.lo).toBeLessThan(0);
        expect(dominance(cells(many('A', spread(3))), 'idle').dominant).toBeNull();
        expect(dominance(all, 'cover').dominant).toBeNull();
    });
    it('can leave a strategy out (the best response) and ask whether any practicable strategy dominates', () => {
        const spread = (centre: number) => Array.from({ length: 60 }, (_, i) => centre + (i % 5) - 2);
        const all = cells([...many('best', spread(7)), ...many('A', spread(3)), ...many('B', spread(2.8))]);
        expect(dominance(all, 'idle').dominant).toBe('best');
        expect(dominance(all, 'idle', s => s !== 'best').dominant).toBeNull();
    });
    it('reads a cell against the provisional ranges: within, above, below or straddling', () => {
        const c = (k: number, n: number) => summarizeCell(Array.from({ length: n }, (_, i) => rec('a', 0, { passes: 1, completions: i < k ? 1 : 0, incompletions: i < k ? 0 : 1 })));
        const status = (cell: ReturnType<typeof summarizeCell>) => readBenchmarks(cell).find(b => b.metric === 'completion')!.status;
        expect(status(c(550, 1000))).toBe('within'); expect(status(c(900, 1000))).toBe('above'); expect(status(c(100, 1000))).toBe('below'); expect(status(c(11, 20))).toBe('overlaps');
    });
    it('a real matrix is internally consistent: every pass is a completion, an incompletion or an interception, and ends add up', () => {
        const records = runMatrix({ strategies: [DEEP, SHORT, BALANCED, TIMING_AWARE], defenses: ['idle', 'cover'], seeds: [1], starts: [38, 74] });
        expect(records).toHaveLength(4 * 2 * 1 * 2 * 2);
        for (const r of records) { expect(r.completions + r.incompletions + r.interceptions).toBe(r.passes); expect(r.points).toBeGreaterThanOrEqual(0); expect(r.plays).toBeGreaterThan(0); }
        for (const c of cells(records)) { expect(c.drives).toBe(4); expect(Object.values(c.ends).reduce((a, b) => a + b, 0)).toBe(4); expect(c.pointsDistribution.reduce((a, d) => a + d.share, 0)).toBeCloseTo(1, 12); }
        expect(cells(records)).toEqual(cells(records));
        expect(cells(records).map(c => `${c.strategy}/${c.defense}`)).toEqual(['deep/idle', 'deep/cover', 'short/idle', 'short/cover', 'balanced/idle', 'balanced/cover', 'timing/idle', 'timing/cover']);
    });
});

describe('every known imbalance is documented honestly', () => {
    it('lists each once, with an explanation', () => {
        expect(new Set(KNOWN_IMBALANCES.map(k => k.id)).size).toBe(KNOWN_IMBALANCES.length);
        for (const k of KNOWN_IMBALANCES) { expect(k.title.length).toBeGreaterThan(10); expect(k.why.length).toBeGreaterThan(30); expect(['open', 'fixed']).toContain(k.status); }
    });
    it.each(KNOWN_IMBALANCES.map(k => [k.id, k] as const))('%s: an open entry is detected today with evidence, a fixed one is not', (_id, k) => {
        const d = k.detect(evidence);
        expect(d.evidence.length).toBeGreaterThan(10);
        expect(d.present, `${k.id}: ${d.evidence}`).toBe(k.status === 'open');
    });
});

describe('baseline characterization of today\'s engine (an intended change to passing updates these on purpose)', () => {
    // Pocket ticks 0, 4, ... 240, line 40, AI defense, humans idle. Any engine change to passing or coverage shows up here first.
    // Updated for Phase C1b-1 (seeded catch resolution); the Phase A, B1 and B2 maps are in BALANCE.md. Each route has two maps. The first is one game, seed 1: a letter
    // per throw (C caught cleanly, c caught with a defender at the ball, x incomplete, b knocked down, I intercepted). The second is the chance:
    // a digit per throw, the tenths of the six evidence games (seeds 1-6) in which that throw was caught.
    const GOLDEN: Record<string, [string, string]> = {
        'slants-1': ['CCCCCCCCxxCcCxcbcccxccccxcccCccIcIcIcbbbbIbbIbxxbxxbIxIxxxbCC', '8998869988999895699688996896568661136310000000065100851000199'],
        'slants-2': ['CcCCCCCxcCCCccccccCcccccxbccccCccbcxcccCccbbbbbIxbbIbbbbxbbbb', '9998999869886989899968966899688885866689551000000000000000000'],
        'slants-3': ['xcbcCCCxCCCcbccbbbcxbcbIbxbbxIxCccccbcCCCCCCCCCCCCCCCCCxCxxCx', '8558989889586686856311000000016898686688888699899899899658530'],
        'go-1': ['ccCcCcCcCbcccccccccccccbbccbbIcxcICxCccCCccIccIcbcIxxIbbIbbII', '9888988888968999898698961613358365866988869898685100000000000'],
        'go-2': ['cbbccxCccccccccCccccccccIccIcIccCbbcccCCcbCccccccIcCbbIbbIbbb', '8868869999988866685589956633316166688969988699986885611000000'],
        'go-3': ['xcbcccccccIbIxxbIxbxbbbbxbbbIbbbbxcIcbIIbbbbbIbxccbcccIbcbxcc', '8558869689110001000000000000000011538100000000039869565658589'],
    };
    it.each(Object.entries(GOLDEN))('%s window maps', (key, [letters, chance]) => {
        const [play, target] = key.split('-') as [Play, string];
        const route = evidence.pocket.filter(r => r.play === play && r.target === Number(target));
        expect(windowMap(route.filter(r => r.seed === EVIDENCE_SEEDS[0]))).toBe(letters);
        const digits = tickRange(0, 240, 4).map(tick => { const at = route.filter(r => r.throwTick === tick); return Math.min(9, Math.floor(10 * at.filter(r => r.outcome === 'complete').length / at.length)); }).join('');
        expect(digits).toBe(chance);
    });
    it('the pocket lasts 245 ticks and a pass flies for its distance over the ball speed, between the shortest and longest flight', () => {
        expect(evidence.ticksToSack).toBe(245);
        const flights = evidence.pocket.filter(r => r.outcome !== 'sack').map(r => r.flightSeconds);
        expect(new Set(flights).size).toBeGreaterThan(10);
        expect(Math.min(...flights)).toBeGreaterThanOrEqual(0.35); expect(Math.max(...flights)).toBeLessThanOrEqual(2);
    });
});

describe('ratings move the passing game the right way (Phase B2, remeasured for the seeded catches of C1b-1)', () => {
    // Catches are chance, so everything here is taken over four game seeds and compared with a tolerance for what is left of the noise.
    const SEEDS = [1, 2, 3, 4];
    const edge = (id: string, speed: number) => ({ [id]: { speed, accel: speed } });
    // Completion over the whole pocket for the route to WR1, by the receiver's and the corner's speed.
    const rate = (play: Play, wr: number, cb: number) => rates(sweep({ plays: [play], targets: [1], ticks: tickRange(0, 240, 8), seeds: SEEDS.slice(0, 3), stopAtArrival: true, abilities: { ...edge('home-WR1', wr), ...edge('away-CB1', cb) } })).complete.p;
    it('a faster corner never lets the receiver complete more', () => {
        for (const play of ['slants', 'go'] as const) {
            const cbs = [60, 74, 90].map(c => rate(play, 80, c));
            for (let i = 1; i < cbs.length; i++) expect(cbs[i]!, `${play}: corner speed up`).toBeLessThanOrEqual(cbs[i - 1]! + 0.04);
            expect(cbs[0]! - cbs[2]!, `${play}: and a fast corner does take something away`).toBeGreaterThan(0.015);
        }
    });
    // Deep = lands 20+ yd downfield; the sweep runs both wideouts and every throw moment. `peak` is the average tick of a caught deep throw (when the window is open)
    // and `best` is the chance of a catch at its best moment (by throw tick, smoothed over its neighbours); `first` and `last` are the first and last tick of a caught throw.
    const DEEP_TICKS = tickRange(0, 240, 12), DEEP_SEEDS = [1, 2, 3, 4];
    const memo = new Map<string, ReturnType<typeof measure>>();
    const deep = (wr: number, cb: number) => { const k = `${wr}/${cb}`; if (!memo.has(k)) memo.set(k, measure(wr, cb)); return memo.get(k)!; };
    const measure = (wr: number, cb: number) => {
        const all = sweep({ plays: ['go'], targets: [1, 2], ticks: DEEP_TICKS, seeds: DEEP_SEEDS, stopAtArrival: true, abilities: { ...edge('home-WR1', wr), ...edge('home-WR2', wr), ...edge('away-CB1', cb), ...edge('away-CB2', cb) } }).filter(r => r.landDepth >= 20);
        const ticks = DEEP_TICKS;
        const byTick = ticks.map(tick => { const at = all.filter(r => r.throwTick === tick); return at.length ? at.filter(r => r.outcome === 'complete').length / at.length : 0; });
        const smooth = byTick.map((v, i) => ((byTick[i - 1] ?? v) + v + (byTick[i + 1] ?? v)) / 3);
        const best = Math.max(...smooth), caught = all.filter(r => r.outcome === 'complete');
        return { rate: caught.length / all.length, best, peak: caught.reduce((a, r) => a + r.throwTick, 0) / Math.max(1, caught.length), first: Math.min(...caught.map(r => r.throwTick)), last: Math.max(...caught.map(r => r.throwTick)), intercepted: all.filter(r => r.outcome === 'interception').length / all.length };
    };
    it('deep passing is possible against equal athletes: there is a window, and it is contested (not the open door of the quick game, not closed)', () => {
        const d = deep(70, 74);
        expect(d.rate).toBeGreaterThan(0.15); expect(d.rate).toBeLessThan(0.7);
        expect(d.best).toBeGreaterThan(0.25);
        expect(d.intercepted).toBeGreaterThan(0.05); expect(d.intercepted).toBeLessThan(0.4);
    });
    it('a faster receiver is open sooner, whoever covers him, and a faster corner makes him later', { timeout: 180_000 }, () => {
        for (const cb of [60, 74, 90]) {
            const slow = deep(60, cb), mid = deep(80, cb), fast = deep(99, cb);
            expect(fast.peak, `corner ${cb}: the window is open sooner for a burner`).toBeLessThan(slow.peak - 20);
            expect(mid.first).toBeLessThan(slow.first);
            expect(fast.first).toBeLessThan(mid.first);
            expect(fast.last).toBeLessThan(slow.last);
        }
        expect(deep(70, 90).best, 'a faster corner never makes the best moment better').toBeLessThanOrEqual(deep(70, 60).best + 0.04);
    });
    it('beyond a point more speed buys an earlier window, not a bigger one: the receiver runs out of route sooner, and the chance of a catch at its best barely moves', () => {
        // Documented in BALANCE.md: speed moves when the window opens, and how well a trailing corner can still reach the ball sets how big it is.
        const slow = deep(80, 74), fast = deep(99, 74);
        expect(fast.first).toBeLessThan(slow.first);
        expect(fast.last).toBeLessThan(slow.last);
        expect(Math.abs(fast.best - slow.best)).toBeLessThan(0.12);
    });
    it('the quick game is open and the window narrows as the corner picks up the break: the first half-second beats the second, and waiting costs', () => {
        const slants = sweep({ plays: ['slants'], targets: [1, 2], ticks: tickRange(0, 240, 4), seeds: SEEDS, stopAtArrival: true });
        const share = (rs: ThrowRecord[]) => rs.filter(r => r.outcome === 'complete').length / rs.length;
        expect(share(slants.filter(r => r.throwTick < 24))).toBeGreaterThanOrEqual(0.8);
        expect(share(slants.filter(r => r.throwTick < 24)) - share(slants.filter(r => r.throwTick >= 120))).toBeGreaterThan(0.25);
        expect(rates(slants.filter(r => r.target === 1)).interception.p).toBeLessThan(0.15);
    });
});
