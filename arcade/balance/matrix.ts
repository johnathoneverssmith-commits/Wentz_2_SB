/**
 * Runs the strategy matrix (offenses x defenses x seeds x starting spots) and turns the drives into statistics: rates with confidence
 * intervals, scoring distributions, comparisons between strategies, and a flag for any strategy that dominates the others.
 *
 * Everything is a pure function of its inputs. The engine is deterministic, so the same seeds always give the same report.
 */
import { drive, game, DEFAULTS, type DefensePolicy, type GameResult, type Options, type OffensePolicy } from './sim';
import { compareMeans, distribution, proportion, summarize, type Proportion, type Summary } from './stats';
import { driveSeed, gameSeedOf, type Strategy } from './strategies';

/** Where drives start, in yards from the offense's own goal line (the same spots the existing balance report uses). */
export const STARTS: readonly number[] = [28, 38, 50, 62, 74, 86, 98];

export interface DriveRecord {
    readonly strategy: string;
    readonly defense: DefensePolicy;
    readonly seed: number;
    readonly team: 'home' | 'away';
    readonly start: number;
    readonly end: string;
    readonly points: number;
    readonly touchdown: boolean;
    readonly plays: number;
    readonly passes: number;
    readonly completions: number;
    readonly interceptions: number;
    readonly incompletions: number;
    readonly sacks: number;
    readonly rushes: number;
    readonly passYards: number;
}

export interface MatrixSpec {
    readonly strategies: readonly Strategy[];
    readonly defenses: readonly DefensePolicy[];
    readonly seeds: readonly number[];
    readonly starts?: readonly number[];
    readonly opts?: Options;
}

/** Every drive of the matrix, in a fixed order. Every strategy runs under every seed: a strategy whose choices ignore its stream seed (the best response) still meets different chance in each game, because the game's own seed is derived from the matrix seed. */
export function runMatrix(spec: MatrixSpec): DriveRecord[] {
    const out: DriveRecord[] = [], opts = spec.opts ?? DEFAULTS;
    for (const strategy of spec.strategies) for (const defense of spec.defenses) {
        for (const seed of spec.seeds) for (const team of ['home', 'away'] as const) for (const start of spec.starts ?? STARTS) {
            const line = team === 'home' ? start : 120 - start;
            const policy = strategy.make(driveSeed(seed, team, start), { defense, opts });
            const r = drive(team, line, policy, defense, opts, gameSeedOf(driveSeed(seed, team, start))), st = r.stats;
            out.push({
                strategy: strategy.id, defense, seed, team, start, end: r.end, points: st.points, touchdown: r.end === 'touchdown', plays: st.plays, passes: st.passes, completions: st.completions,
                interceptions: st.interceptions, incompletions: st.incompletions, sacks: st.sacks, rushes: st.rushes, passYards: st.passYards,
            });
        }
    }
    return out;
}

export interface Cell {
    readonly strategy: string;
    readonly defense: DefensePolicy;
    readonly drives: number;
    readonly points: Summary;
    readonly touchdownDrives: Proportion;
    readonly scoringDrives: Proportion;
    readonly completion: Proportion;
    readonly interception: Proportion;
    readonly playsPerDrive: number;
    readonly pointsDistribution: { value: number; count: number; share: number }[];
    readonly ends: Record<string, number>;
}

export function summarizeCell(records: readonly DriveRecord[]): Cell {
    if (!records.length) throw new Error('a cell needs at least one drive');
    const sum = (f: (r: DriveRecord) => number) => records.reduce((a, r) => a + f(r), 0);
    const ends: Record<string, number> = {};
    for (const r of records) ends[r.end] = (ends[r.end] ?? 0) + 1;
    return {
        strategy: records[0]!.strategy, defense: records[0]!.defense, drives: records.length, points: summarize(records.map(r => r.points)),
        touchdownDrives: proportion(records.filter(r => r.touchdown).length, records.length), scoringDrives: proportion(records.filter(r => r.points > 0).length, records.length),
        completion: proportion(sum(r => r.completions), sum(r => r.passes)), interception: proportion(sum(r => r.interceptions), sum(r => r.passes)),
        playsPerDrive: sum(r => r.plays) / records.length, pointsDistribution: distribution(records.map(r => r.points)), ends,
    };
}

/** One cell per (strategy, defense), in the order the strategies and defenses were first seen. */
export function cells(records: readonly DriveRecord[]): Cell[] {
    const groups = new Map<string, DriveRecord[]>();
    for (const r of records) { const k = `${r.strategy}|${r.defense}`; (groups.get(k) ?? groups.set(k, []).get(k)!).push(r); }
    return [...groups.values()].map(summarizeCell);
}

export interface Dominance {
    readonly defense: DefensePolicy;
    /** The strategy that scores significantly more per drive than every other one against this defense, if there is one. */
    readonly dominant: string | null;
    readonly ranking: { strategy: string; mean: number; ci: { lo: number; hi: number } }[];
    /** For each other strategy, the dominant one's lead in points per drive with its 95% interval. */
    readonly leads: { versus: string; diff: number; lo: number; hi: number }[];
}

/**
 * A strategy dominates against a defense when it out-scores every other strategy there by more than chance: the 95% interval of each
 * difference in points per drive lies above zero. The best response is included as an upper bound; pass `include` to leave it out and
 * ask whether any *practicable* strategy dominates.
 */
export function dominance(all: readonly Cell[], defense: DefensePolicy, include?: (strategy: string) => boolean): Dominance {
    const here = all.filter(c => c.defense === defense && (!include || include(c.strategy))).sort((a, b) => b.points.mean - a.points.mean);
    const ranking = here.map(c => ({ strategy: c.strategy, mean: c.points.mean, ci: c.points.ci }));
    const top = here[0];
    if (!top) return { defense, dominant: null, ranking, leads: [] };
    const leads = here.slice(1).map(o => { const d = compareMeans(top.points, o.points); return { versus: o.strategy, diff: d.diff, lo: d.ci.lo, hi: d.ci.hi }; });
    const dominant = here.length > 1 && leads.every(l => l.lo > 0) ? top.strategy : null;
    return { defense, dominant, ranking, leads };
}

/** Provisional benchmarks from the design review: reference ranges for the report, never limits the tests enforce. */
export const PROVISIONAL_BENCHMARKS = {
    completion: { lo: 0.45, hi: 0.65, text: 'completion rate over a strategy\'s passes' },
    interception: { lo: 0.03, hi: 0.08, text: 'interception rate over a strategy\'s passes' },
    touchdownDrives: { lo: 0, hi: 0.45, text: 'share of drives that end in a touchdown' },
} as const;
export type BenchmarkName = keyof typeof PROVISIONAL_BENCHMARKS;
export interface BenchmarkReading { readonly metric: BenchmarkName; readonly value: number; readonly ci: { lo: number; hi: number }; readonly range: { lo: number; hi: number }; readonly status: 'within' | 'above' | 'below' | 'overlaps' }
/** Where a cell sits against each provisional range: 'above' and 'below' mean the whole 95% interval is outside it, 'overlaps' that it straddles an edge. */
export function readBenchmarks(c: Cell): BenchmarkReading[] {
    const read = (metric: BenchmarkName, p: Proportion): BenchmarkReading => {
        const range = PROVISIONAL_BENCHMARKS[metric];
        const status = p.ci.lo > range.hi ? 'above' : p.ci.hi < range.lo ? 'below' : p.ci.lo >= range.lo && p.ci.hi <= range.hi ? 'within' : 'overlaps';
        return { metric, value: p.p, ci: p.ci, range: { lo: range.lo, hi: range.hi }, status };
    };
    return [read('completion', c.completion), read('interception', c.interception), read('touchdownDrives', c.touchdownDrives)];
}

export interface GameSpec { readonly home: Strategy; readonly away: Strategy; readonly homeDefense: DefensePolicy; readonly awayDefense: DefensePolicy; readonly seeds: readonly number[]; readonly opts?: Options }
export interface GameRecord { readonly seed: number; readonly home: number; readonly away: number; readonly points: number; readonly plays: number; readonly ended: GameResult['ended'] }
/** Regulation games between two strategies, one per seed. The score is the end of regulation (a tie is reported as a tie, not played on). */
export function runGames(spec: GameSpec): GameRecord[] {
    const opts = spec.opts ?? DEFAULTS;
    return spec.seeds.map(seed => {
        // A team's own defense is the one it plays; its offense faces the OTHER team's defense, which is what a searching strategy must be shown.
        const mk = (s: Strategy, own: DefensePolicy, facing: DefensePolicy, side: string): { off: OffensePolicy; def: DefensePolicy } => ({ off: s.make(driveSeed(seed, side, 0), { defense: facing, opts }), def: own });
        const g = game(mk(spec.home, spec.homeDefense, spec.awayDefense, 'home'), mk(spec.away, spec.awayDefense, spec.homeDefense, 'away'), opts, gameSeedOf(driveSeed(seed, 'game', 0)));
        return { seed, home: g.score.home, away: g.score.away, points: g.score.home + g.score.away, plays: g.stats.plays, ended: g.ended };
    });
}
