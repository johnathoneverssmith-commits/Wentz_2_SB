/**
 * The strategy matrix: scripted offenses whose choices (which play, which receiver, when to throw) come from a seeded stream, so a
 * seed reproduces a drive exactly while different seeds explore different choices. Nothing here touches the engine's rules.
 *
 *   deep specialist     only the deep route (go), a random target among the wideouts, a random moment
 *   short specialist    only the short route (slants), any target, an earlier random moment
 *   balanced            runs and both routes mixed, any target, a random moment
 *   timing-aware        waits until some receiver has room, then throws to the most open one
 *   best response       searches every play, receiver and throw moment from the real situation and takes the best
 *
 * The best response is an upper bound, not a player: it can see the whole engine. If it finds a window that scores nearly every time,
 * a person with a bit of practice will find it too.
 */
import type { DownState, Play } from '../core/down';
import { hashSeed, streamFor, type Rng } from './rng';
import type { DefensePolicy, OffensePolicy, Options } from './sim';
import { mix } from '../core/seed';
import { PASS_PLAYS, TARGETS, targetCode, throwOutcomes, tickRange, type Target, type ThrowRecord } from './window';

export interface StrategyContext { readonly defense: DefensePolicy; readonly opts: Options }
export interface Strategy {
    readonly id: string;
    readonly name: string;
    readonly description: string;
    /** True when the strategy ignores its seed (every seed makes the same choices), so a matrix runs it once. */
    readonly deterministic: boolean;
    /** A policy for one drive. Everything it will do is a function of `seed` and of the situation it is shown. */
    make(seed: number, ctx: StrategyContext): OffensePolicy;
}

interface Call { readonly play: Play; readonly target: Target; readonly tick: number }

/** A strategy that draws one call per snap from its stream; the call stays fixed for the whole play however often the harness asks. */
function drawn(id: string, name: string, description: string, decide: (r: Rng, s: DownState) => Call): Strategy {
    return {
        id, name, description, deterministic: false,
        make(seed) {
            const r = streamFor(seed, id);
            let call: Call = { play: 'slants', target: 1, tick: 60 };
            return { name, play: s => { call = decide(r, s); return call.play; }, throwAt: () => call.tick, fieldGoals: true, target: () => call.target };
        },
    };
}

export const DEEP: Strategy = drawn('deep', 'deep-pass specialist', 'only the go route, to a wideout, thrown at a random moment', r => ({ play: 'go', target: r.pick([1, 2] as const), tick: r.int(20, 160) }));
export const SHORT: Strategy = drawn('short', 'short-pass specialist', 'only slants, to any receiver, thrown at a random early-to-middle moment', r => ({ play: 'slants', target: r.pick(TARGETS), tick: r.int(12, 110) }));
export const BALANCED: Strategy = drawn('balanced', 'balanced offense', 'runs 30%, slants 35%, go 35%; any receiver, a random moment', r => {
    const x = r.next();
    return { play: x < 0.3 ? 'rush' : x < 0.65 ? 'slants' : 'go', target: r.pick(TARGETS), tick: r.int(12, 140) };
});

/**
 * A receiver counts as open when no defender is within this many yards of him. A defender breaks a pass up from inside 2.2 yd of the
 * landing point and needs a quarter of a second to see the ball, then runs about 7.7 yd/s for the rest of a flight of 0.5-0.8 s, so
 * about 2.2 + 0.4 s x 7.7 = 5.3 yd of room is what stops him arriving in time (BREAKUP_RADIUS and the corner's top speed, rounded).
 */
export const OPEN_SEPARATION = 5.5;
/** Whether the receiver is free: the nearest defender is at least OPEN_SEPARATION away (and `room` is how far). */
export function receiverIsOpen(s: DownState, t: Target): { open: boolean; room: number } {
    const rec = s.players.find(p => p.id === `${s.offense}-${targetCode(t)}`)!;
    const room = Math.min(...s.players.filter(p => p.team !== s.offense).map(p => Math.hypot(p.x - rec.x, p.y - rec.y)));
    return { open: room >= OPEN_SEPARATION, room };
}
export const TIMING_AWARE: Strategy = {
    id: 'timing', name: 'timing-aware offense', description: `waits until a receiver has ${OPEN_SEPARATION} yd of room (no defender closer), then throws to the most open one; gives up at 2.5 s`, deterministic: false,
    make(seed) {
        const r = streamFor(seed, 'timing');
        let chosen: Target = 1;
        return {
            name: 'timing-aware offense', play: () => r.pick(PASS_PLAYS), throwAt: () => 150, fieldGoals: true, target: () => chosen,
            throwNow(s) {
                if (s.liveTicks < 12) return false;
                const view = TARGETS.map(t => ({ t, ...receiverIsOpen(s, t) }));
                const open = view.filter(v => v.open).sort((x, y) => y.room - x.room)[0];
                if (open) { chosen = open.t; return true; }
                if (s.liveTicks >= 150) { chosen = view.sort((x, y) => y.room - x.room)[0]!.t; return true; }
                return false;
            },
        };
    },
};

/** What the best response is trying to maximise: touchdowns, then yards (a catch that loses ground is worth less than an incompletion, which keeps the field position), and an interception is the worst. */
export const throwValue = (r: ThrowRecord): number => r.touchdown ? 100 : r.outcome === 'complete' ? r.yards : r.outcome === 'interception' ? -60 : 0;

/** How many independent chance outcomes the best response imagines for each throw it considers. */
export const EVAL_SAMPLES = 16;
/**
 * The seeds the best response evaluates a throw under. They are fixed and have nothing to do with the seed of the game it is playing, so it
 * cannot learn how a particular catch will come out: it chooses the throw with the best expected result and then lives with the draw.
 */
export const EVAL_SEEDS: readonly number[] = Array.from({ length: EVAL_SAMPLES }, (_, k) => mix(0xe7a1, k));
/** The seed a drive or game is played under, derived from its strategy stream seed (a different number, so the two never coincide). */
export const gameSeedOf = (stream: number): number => mix(0x6a3e, stream);

interface Scored extends Call { readonly value: number; readonly pComplete: number; readonly pIntercept: number }
const mean = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/**
 * Every pass play, receiver and throw moment is tried from the real pre-snap situation (a coarse sweep, then the neighbouring ticks of
 * the best), against the defense it will face, and the throw with the best value is played. Ties go to the earlier play, receiver, tick.
 * `seeds` are the chance outcomes each throw is judged under: with the evaluation seeds it is an expectation (what a player who knows the
 * odds but not the dice can do); with the game's own seed it is an oracle that has seen the dice.
 */
export function bestCall(s: DownState, ctx: StrategyContext, coarse = 8, to = 160, seeds: readonly number[] = EVAL_SEEDS): Scored {
    let best: Scored | null = null;
    const consider = (play: Play, target: Target, tick: number) => {
        const rs = throwOutcomes({ play, target, throwTick: tick, from: s, defense: ctx.defense, opts: ctx.opts }, seeds);
        const value = mean(rs.map(throwValue));
        if (!best || value > best.value) best = { play, target, tick, value, pComplete: mean(rs.map(r => r.outcome === 'complete' ? 1 : 0)), pIntercept: mean(rs.map(r => r.outcome === 'interception' ? 1 : 0)) };
    };
    for (const play of PASS_PLAYS) for (const target of TARGETS) for (const tick of tickRange(coarse, to, coarse)) consider(play, target, tick);
    const first = best!;
    for (const tick of [first.tick - coarse / 2, first.tick + coarse / 2]) if (tick > 0) consider(first.play, first.target, tick);
    return best!;
}
/** What the best response predicted for each throw it chose (its belief), kept so a report can set it beside what happened. */
export interface Prediction { readonly pComplete: number; readonly pIntercept: number; readonly value: number }
export const predictions: Prediction[] = [];
export const BEST_RESPONSE: Strategy = {
    id: 'best', name: 'expectation best-response offense', description: 'searches every play, receiver and throw moment from the real situation, judges each over 16 imagined chance outcomes (not the game\'s own), and plays the best on average', deterministic: true,
    make(_seed, ctx) {
        let call: Call = { play: 'slants', target: 1, tick: 60 };
        return { name: 'expectation best-response offense', play: s => { const c = bestCall(s, ctx); call = c; predictions.push({ pComplete: c.pComplete, pIntercept: c.pIntercept, value: c.value }); return call.play; }, throwAt: () => call.tick, fieldGoals: true, target: () => call.target };
    },
};
/**
 * DIAGNOSTIC ONLY, not a player. It judges every throw under the seed of the game it is playing, so it knows how each catch will come out
 * (it can read the dice). It shows the best any offense could do against this defense if chance could be foreseen; it is not a measure of
 * what a player can achieve and must never be compared with practicable strategies as if it were.
 */
export const ORACLE_BEST_RESPONSE: Strategy = {
    id: 'oracle', name: 'ORACLE best-response (sees the dice)', description: 'DIAGNOSTIC: searches like the best response but judges each throw under the seed of the game it is in, so it knows the outcome of every catch', deterministic: true,
    make(_seed, ctx) {
        let call: Call = { play: 'slants', target: 1, tick: 60 };
        return { name: 'ORACLE best-response (sees the dice)', play: s => { call = bestCall(s, ctx, 8, 160, [s.seed]); return call.play; }, throwAt: () => call.tick, fieldGoals: true, target: () => call.target };
    },
};

export const STRATEGIES: readonly Strategy[] = [DEEP, SHORT, BALANCED, TIMING_AWARE, BEST_RESPONSE];
export const strategyById = (id: string): Strategy => { const s = STRATEGIES.find(x => x.id === id); if (!s) throw new Error(`unknown strategy ${id}`); return s; };
/** The stream seed for one drive: every drive of a matrix gets its own, derived from the matrix seed and where the drive started. */
export const driveSeed = (seed: number, team: string, line: number): number => hashSeed(seed, team, line);
