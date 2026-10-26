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
import { PASS_PLAYS, TARGETS, targetCode, throwOnce, tickRange, type Target, type ThrowRecord } from './window';

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

/** Room around a receiver (yards to the nearest defender) that counts as open, once no defender is between him and the ball's destination. */
export const OPEN_SEPARATION = 2;
/** A defender is "in front" of a receiver when he is downfield of him, within this many yards sideways and this far ahead. */
const IN_FRONT = { lateral: 3, ahead: 14 } as const;
/** Whether the receiver is free: nobody is downfield of him in his lane, and the nearest defender is at least OPEN_SEPARATION away. */
export function receiverIsOpen(s: DownState, t: Target): { open: boolean; room: number } {
    const rec = s.players.find(p => p.id === `${s.offense}-${targetCode(t)}`)!, dir = s.offense === 'home' ? 1 : -1;
    const defenders = s.players.filter(p => p.team !== s.offense);
    const room = Math.min(...defenders.map(p => Math.hypot(p.x - rec.x, p.y - rec.y)));
    const blocked = defenders.some(p => (p.x - rec.x) * dir > 0 && (p.x - rec.x) * dir <= IN_FRONT.ahead && Math.abs(p.y - rec.y) < IN_FRONT.lateral);
    return { open: !blocked && room >= OPEN_SEPARATION, room };
}
export const TIMING_AWARE: Strategy = {
    id: 'timing', name: 'timing-aware offense', description: 'waits until a receiver is free (nobody downfield of him in his lane and room around him), then throws to the most open one; gives up at 2.5 s', deterministic: false,
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

/** What the best response is trying to maximise: touchdowns, then yards; interceptions and incompletions cost. */
export const throwValue = (r: ThrowRecord): number => r.touchdown ? 100 : r.outcome === 'complete' ? r.yards : r.outcome === 'interception' ? -60 : -3;

/**
 * Every pass play, receiver and throw moment is tried from the real pre-snap situation (a coarse sweep, then the neighbouring ticks of
 * the best), against the defense it will face, and the best-scoring throw is played. Ties go to the earlier play, receiver, tick.
 */
export function bestCall(s: DownState, ctx: StrategyContext, coarse = 8, to = 160): Call & { value: number } {
    let best: (Call & { value: number }) | null = null;
    const consider = (play: Play, target: Target, tick: number) => {
        const value = throwValue(throwOnce({ play, target, throwTick: tick, from: s, defense: ctx.defense, opts: ctx.opts, stopAtArrival: true }));
        if (!best || value > best.value) best = { play, target, tick, value };
    };
    for (const play of PASS_PLAYS) for (const target of TARGETS) for (const tick of tickRange(coarse, to, coarse)) consider(play, target, tick);
    const first = best!;
    for (const tick of [first.tick - coarse / 2, first.tick + coarse / 2]) if (tick > 0) consider(first.play, first.target, tick);
    return best!;
}
export const BEST_RESPONSE: Strategy = {
    id: 'best', name: 'best-response offense', description: 'searches every play, receiver and throw moment from the real situation and plays the best', deterministic: true,
    make(_seed, ctx) {
        let call: Call = { play: 'slants', target: 1, tick: 60 };
        return { name: 'best-response offense', play: s => { call = bestCall(s, ctx); return call.play; }, throwAt: () => call.tick, fieldGoals: true, target: () => call.target };
    },
};

export const STRATEGIES: readonly Strategy[] = [DEEP, SHORT, BALANCED, TIMING_AWARE, BEST_RESPONSE];
export const strategyById = (id: string): Strategy => { const s = STRATEGIES.find(x => x.id === id); if (!s) throw new Error(`unknown strategy ${id}`); return s; };
/** The stream seed for one drive: every drive of a matrix gets its own, derived from the matrix seed and where the drive started. */
export const driveSeed = (seed: number, team: string, line: number): number => hashSeed(seed, team, line);
