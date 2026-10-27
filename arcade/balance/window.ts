/**
 * The passing-window sweeper. It throws one pass at a time, from the same snapped play, at every chosen moment of the pocket and to
 * every eligible receiver, and records what happened and why: the outcome, how far the ball travelled, how open the receiver was
 * when the ball left and when it arrived, and the abilities of the receiver and of the defender nearest to him.
 *
 * It only observes. It drives the same `stepDown`, `throwPass` and defender policies the game and the other balance tools use, so a
 * change to the engine shows up here and nothing here changes the engine.
 */
import { DEFAULT_SEED } from '../core/seed';
import { maxSpeed, STEP_SECONDS } from '../core/simulation';
import type { CatchKind } from '../core/catch';
import { choosePlay, lineUp, snap, stepDown, TARGET_CODES, type DownState, type Play } from '../core/down';
import type { Abilities, Inputs, PlayerId, TeamId } from '../core/simulation';
import { control, DEFAULTS, fresh, type DefensePolicy, type OffensePolicy, type Options } from './sim';
import { longestRun, proportion, type Proportion } from './stats';

export type Target = 1 | 2 | 3;
export type Outcome = 'complete' | 'incomplete' | 'interception' | 'sack';
export const PASS_PLAYS: readonly Play[] = ['slants', 'go'];
export const TARGETS: readonly Target[] = [1, 2, 3];
/** The receiver each target number names, for reports. */
export const targetCode = (t: Target): string => TARGET_CODES[t - 1]!;

export interface ThrowSpec {
    readonly play: Play;
    readonly target: Target;
    /** Pocket ticks (1/60 s) between the snap and the throw. */
    readonly throwTick: number;
    readonly line?: number;
    readonly playNumber?: number;
    /** The game seed the pass is played under (every chance event in it is a function of this). */
    readonly seed?: number;
    readonly team?: TeamId;
    readonly defense?: DefensePolicy;
    readonly opts?: Options;
    /** Ability overrides for chosen players, applied after the snap (for rating-sensitivity sweeps). */
    readonly abilities?: Readonly<Partial<Record<PlayerId, Partial<Abilities>>>>;
    /** Start from this pre-snap state (a real drive's situation) instead of a fresh line-up at `line`. */
    readonly from?: DownState;
    /**
     * Stop when the ball arrives instead of playing the play out: the catch, break-up or interception is decided there, so this is
     * about twice as fast. The yards are then the signed distance to the landing point (an estimate, marked by `exact: false`): a catch
     * behind the line of scrimmage is a loss, as it is on the full play.
     */
    readonly stopAtArrival?: boolean;
}

export interface ThrowRecord {
    readonly play: Play;
    readonly target: Target;
    readonly receiver: PlayerId;
    readonly team: TeamId;
    readonly line: number;
    readonly playNumber: number;
    readonly defense: DefensePolicy;
    readonly throwTick: number;
    readonly outcome: Outcome;
    /** How the pass was decided at the catch point (null for a throw that never happened, a sack). */
    readonly catchKind: CatchKind | null;
    readonly seed: number;
    readonly touchdown: boolean;
    /** Yards gained on the play (0 for an incompletion or an interception). */
    readonly yards: number;
    /** Distance the ball travels, quarterback to landing point, in yards. */
    readonly airYards: number;
    /** Seconds the ball is in the air. */
    readonly flightSeconds: number;
    /** Receiver to his nearest defender, at the throw and at the moment the ball arrives (yards). */
    /** Yards past the line of scrimmage at which the ball lands (negative: behind the line). */
    readonly landDepth: number;
    /** The receiver's speed at the throw as a share of his top speed (1: still running his route flat out). */
    readonly running: number;
    readonly separationAtThrow: number;
    readonly separationAtArrival: number;
    /** Receiver to the landing point, and the nearest defender to it, when the ball arrives. */
    readonly receiverGap: number;
    readonly defenderGap: number;
    readonly nearestDefender: PlayerId;
    /** False when the throw was stopped at the catch point: `yards` is then the gain to the landing point, and `touchdown` means it landed in the end zone. */
    readonly exact: boolean;
    readonly receiverAbilities: Abilities;
    readonly defenderAbilities: Abilities;
}

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
const player = (s: DownState, id: PlayerId) => s.players.find(p => p.id === id)!;
const nearestOpponent = (s: DownState, to: { x: number; y: number }) => s.players.filter(p => p.team !== s.offense).reduce((a, b) => (dist(b, to) < dist(a, to) ? b : a));

/**
 * One pass: the play is snapped, the quarterback waits `throwTick` ticks, throws to `target`, and the play is run to its end.
 * With `forkSeeds` the play is run only to the tick before the ball arrives and then decided once under each of those seeds (the
 * positions are the same, only the chance differs, because nothing reads the seed before the catch): one record per seed, for expectations.
 */
function throwRecords(spec: ThrowSpec, forkSeeds?: readonly number[]): ThrowRecord[] {
    const { play, target, throwTick, defense = 'idle', opts = DEFAULTS } = spec;
    const team = spec.from?.offense ?? spec.team ?? 'home', line = spec.from?.line ?? spec.line ?? 40, playNumber = spec.from?.playNumber ?? spec.playNumber ?? 1;
    let s: DownState = snap(choosePlay(spec.from ?? lineUp(team, line, { playNumber, seed: spec.seed }), play));
    if (spec.abilities) s = { ...s, players: s.players.map(p => spec.abilities![p.id] ? { ...p, abilities: { ...p.abilities, ...spec.abilities![p.id] } } : p) };
    const policy: OffensePolicy = { name: 'sweep', play: () => play, throwAt: () => throwTick, fieldGoals: false, target };
    const memory = fresh();
    let running = 0, thrown = false, receiver = '' as PlayerId, landing = { x: 0, y: 0 }, airYards = 0, flight = 0, sepThrow = NaN, sepArrival = NaN, recGap = NaN, defGap = NaN;
    let nearest: PlayerId = '' as PlayerId;
    const exact = !spec.stopAtArrival && !forkSeeds;
    const build = (end: DownState): ThrowRecord => {
        const reason = end.result?.reason;
        const outcome: Outcome = !thrown ? 'sack' : reason === 'interception' ? 'interception' : reason === 'incomplete' ? 'incomplete' : 'complete';
        const base = thrown ? receiver : player(end, `${team}-WR1` as PlayerId).id;
        const rAb = player(end, base).abilities;
        const dAb = thrown ? player(end, nearest).abilities : rAb;
        const dir = team === 'home' ? 1 : -1;
        const gain = Math.round((landing.x - line) * dir * 10) / 10, inEndZone = dir === 1 ? landing.x >= 110 : landing.x <= 10;
        return {
            play, target, receiver: base, team, line, playNumber, defense, throwTick, outcome, exact, catchKind: thrown ? end.catchKind ?? null : null, seed: end.seed,
            touchdown: exact ? !!end.result?.touchdown : outcome === 'complete' && inEndZone,
            yards: thrown && outcome === 'complete' ? (exact ? end.result?.yards ?? 0 : gain) : 0,
            landDepth: gain, running, airYards, flightSeconds: flight, separationAtThrow: sepThrow, separationAtArrival: sepArrival, receiverGap: recGap, defenderGap: defGap, nearestDefender: nearest,
            receiverAbilities: rAb, defenderAbilities: dAb,
        };
    };
    const arrival = (end: DownState) => {
        // the ball has just arrived: the players are where the catch was decided
        const r = player(end, receiver), d = nearestOpponent(end, r), dl = nearestOpponent(end, landing);
        sepArrival = dist(r, d); recGap = dist(r, landing); defGap = dist(dl, landing); nearest = d.id;
    };
    for (let guard = 0; guard < 4000 && s.phase === 'live'; guard++) {
        const c = control(s, policy, defense, opts, memory);
        if (!thrown && c.state.ball.kind === 'flight') {
            thrown = true;
            const ball = c.state.ball, qb = player(c.state, c.state.possession.carrier), r = player(c.state, ball.target);
            receiver = r.id; landing = ball.to; airYards = dist(qb, ball.to); flight = ball.duration;
            sepThrow = dist(r, nearestOpponent(c.state, r)); running = Math.hypot(r.vx, r.vy) / maxSpeed(r);
        }
        const inFlight = c.state.ball.kind === 'flight';
        if (forkSeeds && c.state.ball.kind === 'flight' && c.state.ball.elapsed + STEP_SECONDS + 1e-9 >= c.state.ball.duration) {
            const before = c.state;
            return forkSeeds.map(seed => { const end = stepDown({ ...before, seed }, c.inputs); arrival(end); return build(end); });
        }
        s = stepDown(c.state, c.inputs);
        if (inFlight && s.ball.kind !== 'flight') {
            arrival(s);
            if (spec.stopAtArrival) break;
        }
    }
    // a throw that was never made (the quarterback was sacked first) has no catch to fork: one record per seed all the same
    return forkSeeds ? forkSeeds.map(seed => build({ ...s, seed })) : [build(s)];
}
export const throwOnce = (spec: ThrowSpec): ThrowRecord => throwRecords(spec)[0]!;
/** The same throw decided under each of `seeds`: the chance of every outcome, from the real situation, without playing the game forward once per seed. */
export const throwOutcomes = (spec: ThrowSpec, seeds: readonly number[]): ThrowRecord[] => throwRecords(spec, seeds);

export interface SweepSpec {
    readonly plays?: readonly Play[];
    readonly targets?: readonly Target[];
    readonly ticks?: readonly number[];
    readonly lines?: readonly number[];
    readonly playNumbers?: readonly number[];
    /** Game seeds to play each throw under (default: one, the default seed). Records come seed by seed. */
    readonly seeds?: readonly number[];
    /** Stop each throw when the ball arrives (about three times faster): the outcome is the same, the yards after the catch are not played. */
    readonly stopAtArrival?: boolean;
    readonly team?: TeamId;
    readonly defense?: DefensePolicy;
    readonly abilities?: ThrowSpec['abilities'];
}
/** Throw ticks from `from` to `to` inclusive, every `step` (default 4, as the existing golden tables use). */
export const tickRange = (from = 0, to = 160, step = 4): number[] => { const out: number[] = []; for (let t = from; t <= to; t += step) out.push(t); return out; };

/** Every combination, in a fixed order (seeds, plays, targets, lines, play numbers, ticks) so a sweep is repeatable. */
export function sweep(spec: SweepSpec = {}): ThrowRecord[] {
    const seeds = spec.seeds ?? [DEFAULT_SEED];
    // Several seeds with the throw stopped at the catch: the play up to the catch does not depend on the seed (nothing reads it before then), so each throw is played
    // once and decided under every seed, which is the same records for a fraction of the work.
    if (spec.stopAtArrival && seeds.length > 1) {
        const bySeed: ThrowRecord[][] = seeds.map(() => []);
        for (const play of spec.plays ?? PASS_PLAYS) for (const target of spec.targets ?? TARGETS) for (const line of spec.lines ?? [40]) for (const playNumber of spec.playNumbers ?? [1])
            for (const throwTick of spec.ticks ?? tickRange())
                throwOutcomes({ play, target, throwTick, line, playNumber, team: spec.team, defense: spec.defense, abilities: spec.abilities, stopAtArrival: true }, seeds).forEach((r, k) => bySeed[k]!.push(r));
        return bySeed.flat();
    }
    const out: ThrowRecord[] = [];
    for (const seed of seeds) for (const play of spec.plays ?? PASS_PLAYS) for (const target of spec.targets ?? TARGETS) for (const line of spec.lines ?? [40]) for (const playNumber of spec.playNumbers ?? [1])
        for (const throwTick of spec.ticks ?? tickRange())
            out.push(throwOnce({ play, target, throwTick, line, playNumber, seed, team: spec.team, defense: spec.defense, abilities: spec.abilities, stopAtArrival: spec.stopAtArrival }));
    return out;
}

/** A deep throw: it lands at least 20 yards past the line while the receiver is still running his route at pace (not one thrown after he has finished it). */
export const isDeep = (r: ThrowRecord): boolean => r.landDepth >= 20 && r.running >= 0.8;

/** One letter per throw: C caught cleanly, c caught with a defender at the ball, T caught for a touchdown, x incomplete, b knocked down, I intercepted, S sacked before the throw. */
export const letter = (r: ThrowRecord): string => r.outcome === 'sack' ? 'S' : r.outcome === 'interception' ? 'I' : r.outcome === 'incomplete' ? (r.catchKind === 'breakup' ? 'b' : 'x') : r.touchdown ? 'T' : r.catchKind === 'contested-catch' ? 'c' : 'C';
export const windowMap = (records: readonly ThrowRecord[]): string => records.map(letter).join('');

export interface Rates { readonly throws: number; readonly complete: Proportion; readonly interception: Proportion; readonly incomplete: Proportion; readonly breakup: Proportion; readonly contested: Proportion; readonly touchdown: Proportion; readonly yardsPerCompletion: number; readonly openRun: number }
/** The records grouped by the seed they were played under, in order: a run of completions never spans two games. */
const bySeed = (records: readonly ThrowRecord[]): ThrowRecord[][] => { const g = new Map<number, ThrowRecord[]>(); for (const r of records) (g.get(r.seed) ?? g.set(r.seed, []).get(r.seed)!).push(r); return [...g.values()]; };
/** Completion, interception and touchdown rates (with 95% intervals) over a set of throws; `openRun` is the longest unbroken run of completions in the given order within one seed. */
export function rates(records: readonly ThrowRecord[]): Rates {
    const n = records.length, count = (f: (r: ThrowRecord) => boolean) => records.filter(f).length;
    const done = records.filter(r => r.outcome === 'complete');
    return {
        throws: n, complete: proportion(done.length, n), interception: proportion(count(r => r.outcome === 'interception'), n), incomplete: proportion(count(r => r.outcome === 'incomplete'), n), breakup: proportion(count(r => r.catchKind === 'breakup'), n), contested: proportion(count(r => r.catchKind === 'contested-catch'), n),
        touchdown: proportion(count(r => r.touchdown), n), yardsPerCompletion: done.length ? done.reduce((a, r) => a + r.yards, 0) / done.length : 0, openRun: bySeed(records).reduce((m, g) => Math.max(m, longestRun(g.map(r => r.outcome === 'complete'))), 0),
    };
}

export const routeKey = (r: Pick<ThrowRecord, 'play' | 'target'>): string => `${r.play} -> ${targetCode(r.target)}`;
/** Rates for each route (play and receiver). */
export function byRoute(records: readonly ThrowRecord[]): Map<string, Rates> {
    const groups = new Map<string, ThrowRecord[]>();
    for (const r of records) { const k = routeKey(r); (groups.get(k) ?? groups.set(k, []).get(k)!).push(r); }
    return new Map([...groups.entries()].map(([k, v]) => [k, rates(v)]));
}
/** Throw-timing buckets in ticks: [from, to) with a label. */
export const TIMING_BUCKETS: readonly { label: string; from: number; to: number }[] = [
    { label: '0-23 (before 0.4 s)', from: 0, to: 24 }, { label: '24-47', from: 24, to: 48 }, { label: '48-71', from: 48, to: 72 }, { label: '72-95', from: 72, to: 96 },
    { label: '96-119', from: 96, to: 120 }, { label: '120+', from: 120, to: Infinity },
];
export function byTiming(records: readonly ThrowRecord[]): { label: string; rates: Rates }[] {
    return TIMING_BUCKETS.map(b => ({ label: b.label, rates: rates(records.filter(r => r.throwTick >= b.from && r.throwTick < b.to)) })).filter(b => b.rates.throws > 0);
}
/** Air-distance bins in yards. */
export const DISTANCE_BINS: readonly { label: string; from: number; to: number }[] = [{ label: 'short (<12 yd)', from: 0, to: 12 }, { label: 'medium (12-22 yd)', from: 12, to: 22 }, { label: 'deep (22+ yd)', from: 22, to: Infinity }];
export function byDistance(records: readonly ThrowRecord[]): { label: string; rates: Rates }[] {
    const thrown = records.filter(r => r.outcome !== 'sack');
    return DISTANCE_BINS.map(b => ({ label: b.label, rates: rates(thrown.filter(r => r.airYards >= b.from && r.airYards < b.to)) })).filter(b => b.rates.throws > 0);
}

/** How many ticks a pass play lasts when the quarterback never throws and nobody is controlled: the pocket's real length (it ends in a sack). */
export function ticksToSack(play: Play, line = 40): number {
    const none: Inputs = { home: { x: 0, y: 0 }, away: { x: 0, y: 0 } };
    let s: DownState = snap(choosePlay(lineUp('home', line, { playNumber: 1 }), play)), t = 0;
    for (; t < 2000 && s.phase === 'live'; t++) s = stepDown(s, none);
    return t;
}
