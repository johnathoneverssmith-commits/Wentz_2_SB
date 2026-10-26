/**
 * Deterministic scripted players for measuring gameplay balance. Nothing here is random: every policy decides from the
 * snapshot it is given, so a measurement is repeatable. The scripts are deliberately simple and are *not* a model of
 * human play; the numbers describe how the rules respond to clear strategies, not how a person will score.
 */
import { choosePlay, contestPass, direction, fieldGoalInRange, kickBall, lineUp, nextDown, snap, stepDown, switchDefender, throwPass, createDown, type DownState, type Play } from '../core/down';
import type { Inputs, Vector } from '../core/simulation';

export const MID = 26.67;
const ZERO: Vector = { x: 0, y: 0 };
export const at = (s: DownState, id: string) => s.players.find(p => p.id === id)!;
export const toward = (from: Vector, to: Vector, dead = 0.5): Vector => ({ x: Math.abs(to.x - from.x) > dead ? Math.sign(to.x - from.x) : 0, y: Math.abs(to.y - from.y) > dead ? Math.sign(to.y - from.y) : 0 });

export interface OffensePolicy {
    readonly name: string;
    play(s: DownState): Play;
    /** Ticks the quarterback waits in the pocket before throwing. */
    throwAt(s: DownState): number;
    /** Kick on fourth down when it is in range and the marker is far. */
    readonly fieldGoals: boolean;
    readonly target?: 1 | 2;
}
export type DefensePolicy = 'idle' | 'chase' | 'attentive' | 'cover';
export const DEFENSES: readonly DefensePolicy[] = ['idle', 'chase', 'attentive', 'cover'];
export const DEFENSE_TEXT: Record<DefensePolicy, string> = {
    idle: 'does nothing',
    chase: 'chases the carrier',
    attentive: 'chases, goes to the landing circle and presses Hands',
    cover: 'takes over the first receiver\'s defender, shadows him, then ball + Hands',
};
const byDown = <T,>(table: readonly [T, T, T, T]) => (s: DownState): T => table[Math.min(3, Math.max(0, s.down - 1))]!;
export const OFFENSES: Record<string, OffensePolicy> = {
    early: { name: 'early passes', play: byDown<Play>(['slants', 'go', 'slants', 'go']), throwAt: () => 16, fieldGoals: true, target: 2 },
    intermediate: { name: 'intermediate passes', play: () => 'slants', throwAt: () => 44, fieldGoals: true, target: 2 },
    late: { name: 'late deep passes', play: () => 'go', throwAt: () => 90, fieldGoals: true },
    rush: { name: 'rushing', play: () => 'rush', throwAt: () => 6, fieldGoals: true },
    balanced: { name: 'balanced', play: byDown<Play>(['rush', 'slants', 'go', 'rush']), throwAt: s => (s.play === 'go' ? 90 : 44), fieldGoals: true },
};

/** Defender reaction delay, in ticks after the throw, before he starts for the landing circle. */
export interface Options { readonly reaction: number; readonly thinkTicks: number }
export const DEFAULTS: Options = { reaction: 12, thinkTicks: 0 };

interface Memory { thrown: boolean; switched: boolean; throws: number }
const fresh = (): Memory => ({ thrown: false, switched: false, throws: 0 });

/** Both players' movement and commands for this tick. Returns the state with any command already applied. */
function control(s: DownState, off: OffensePolicy, def: DefensePolicy, opts: Options, m: Memory): { state: DownState; inputs: Inputs } {
    const offTeam = s.offense, defTeam = offTeam === 'home' ? 'away' : 'home';
    // the cover policy takes control of the defender who is covering the first receiver
    if (def === 'cover' && !m.switched && s.liveTicks === 0) {
        const cb = at(s, `${defTeam}-CB1`).id;
        for (let i = 0; i < 11 && s.defender !== cb; i++) s = switchDefender(s);
        m.switched = true;
    }
    const carrier = at(s, s.possession.carrier), defender = at(s, s.defender);
    const inPocket = s.ball.kind === 'held' && carrier.position === 'QB' && s.play !== 'rush';
    const offIn = inPocket ? ZERO : toward(carrier, { x: offTeam === 'home' ? 112 : 8, y: Math.abs(carrier.y - MID) > 5 ? MID : carrier.y }, 0.6);
    let defIn = ZERO;
    if (def !== 'idle') {
        if (s.ball.kind === 'flight' && (def === 'attentive' || def === 'cover')) defIn = s.ball.elapsed * 60 >= opts.reaction ? toward(defender, s.ball.to, 0.4) : ZERO;
        else if (!inPocket) defIn = toward(defender, carrier, 0.4);
        else if (def === 'cover') { const r = at(s, `${offTeam}-WR1`); defIn = toward(defender, { x: r.x + direction(offTeam) * 2, y: r.y }, 0.4); }
    }
    if (inPocket && !m.thrown && s.liveTicks >= off.throwAt(s)) { s = throwPass(s, off.target ?? 1); m.thrown = true; m.throws++; }
    if ((def === 'attentive' || def === 'cover') && s.ball.kind === 'flight' && s.ball.elapsed > 0.45 && s.contestUntil < s.tick) s = contestPass(s, defTeam);
    return { state: s, inputs: offTeam === 'home' ? { home: offIn, away: defIn } : { home: defIn, away: offIn } };
}
/** The kicker presses as the meter crosses the centre. */
function kickStep(s: DownState): DownState {
    const ph = s.kick!.ticks % 100;
    return Math.abs(ph - 25) <= 3 || Math.abs(ph - 75) <= 3 ? kickBall(s, s.kick!.team) : stepDown(s, { home: ZERO, away: ZERO });
}
const IDLE: Inputs = { home: ZERO, away: ZERO };
function choose(s: DownState, off: OffensePolicy): Play {
    const toGo = Math.abs(s.firstDownLine - s.line), yardsToGoal = s.offense === 'home' ? 110 - s.line : s.line - 10;
    return off.fieldGoals && s.down === 4 && fieldGoalInRange(s) && (toGo > 3 || yardsToGoal < 35) ? 'fieldgoal' : off.play(s);
}
/** The players take `opts.thinkTicks` of real time choosing a play before the snap; the clock rules decide what that costs. */
function think(s: DownState, opts: Options): { state: DownState; burned: number } {
    let burned = 0;
    for (let i = 0; i < opts.thinkTicks; i++) { const next = stepDown(s, IDLE); if (next !== s) burned++; s = next; }
    return { state: s, burned };
}

export interface Stats {
    plays: number; liveTicks: number; thinkTicks: number; kicks: number; passes: number; completions: number; interceptions: number; incompletions: number; sacks: number;
    rushes: number; rushYards: number; passYards: number; touchdowns: number; fieldGoals: number; fieldGoalsTried: number; extraPoints: number;
    turnoversOnDowns: number; safeties: number; firstDowns: number; possessions: number; points: number; clockBurnedBetweenPlays: number;
}
export const emptyStats = (): Stats => ({ plays: 0, liveTicks: 0, thinkTicks: 0, kicks: 0, passes: 0, completions: 0, interceptions: 0, incompletions: 0, sacks: 0, rushes: 0, rushYards: 0, passYards: 0, touchdowns: 0, fieldGoals: 0, fieldGoalsTried: 0, extraPoints: 0, turnoversOnDowns: 0, safeties: 0, firstDowns: 0, possessions: 0, points: 0, clockBurnedBetweenPlays: 0 });
export const sum = (a: Stats, b: Stats): Stats => { const o = { ...a } as Record<string, number>; for (const k of Object.keys(b)) o[k] = (o[k] ?? 0) + (b as unknown as Record<string, number>)[k]!; return o as unknown as Stats; };
function record(st: Stats, s: DownState) {
    const r = s.result!;
    st.plays++;
    if (s.play === 'rush') { st.rushes++; st.rushYards += r.yards; }
    if (r.firstDown) st.firstDowns++;
    if (r.reason === 'incomplete') st.incompletions++;
    if (r.reason === 'interception') st.interceptions++;
    if (r.reason === 'safety') st.safeties++;
    if (r.turnoverOnDowns) st.turnoversOnDowns++;
    if (r.touchdown) st.touchdowns++;
    const quarterback = s.possession.carrier.endsWith('-1');
    if (s.play !== 'rush' && quarterback && r.reason === 'tackle') st.sacks++;
    else if (s.play !== 'rush' && !['incomplete', 'interception', 'safety'].includes(r.reason)) { st.completions++; st.passYards += r.yards; }
}

export interface DriveResult { stats: Stats; end: 'touchdown' | 'field goal' | 'missed field goal' | 'interception' | 'downs' | 'safety' | 'limit' }
/** One possession by `team` from `line`, until it scores or loses the ball. Points count the touchdown and the kick. */
export function drive(team: 'home' | 'away', line: number, off: OffensePolicy, def: DefensePolicy, opts: Options = DEFAULTS): DriveResult {
    const stats = emptyStats();
    let s: DownState = lineUp(team, line), m = fresh(), counted = 0, end: DriveResult['end'] = 'limit';
    stats.possessions = 1;
    for (let guard = 0; guard < 400_000; guard++) {
        if (s.phase === 'pre-snap') {
            const t = think(s, opts); s = t.state; stats.thinkTicks += opts.thinkTicks; stats.clockBurnedBetweenPlays += t.burned;
            const play = choose(s, off);
            if (play === 'fieldgoal') stats.fieldGoalsTried++;
            s = snap(choosePlay(s, play)); m = fresh(); counted = 0;
        }
        else if (s.phase === 'live') {
            const c = control(s, off, def, opts, m);
            if (m.throws > counted) { stats.passes++; counted = m.throws; }
            s = stepDown(c.state, c.inputs); stats.liveTicks++;
        }
        else if (s.phase === 'dead') {
            record(stats, s);
            const r = s.result!;
            if (!r.touchdown && (r.turnover || r.turnoverOnDowns)) { end = r.reason === 'safety' ? 'safety' : r.turnoverOnDowns ? 'downs' : 'interception'; stats.points += r.reason === 'safety' ? 0 : 0; break; }
            s = nextDown(s);
        }
        else if (s.phase === 'kick') {
            if (s.kick!.good === null) s = kickStep(s);
            else {
                stats.kicks++;
                if (s.kick!.kind === 'xp') { stats.extraPoints += s.kick!.good ? 1 : 0; end = 'touchdown'; }
                else { stats.fieldGoals += s.kick!.good ? 1 : 0; end = s.kick!.good ? 'field goal' : 'missed field goal'; }
                stats.points = s.score[team];
                break;
            }
        }
        else break;
    }
    return { stats, end };
}

export interface Team { readonly off: OffensePolicy; readonly def: DefensePolicy }
export interface GameResult { score: { home: number; away: number }; ended: 'final' | 'overtime'; stats: Stats; possessions: { home: number; away: number }; byTeam: Record<'home' | 'away', Stats>; quarterPlays: number[]; liveClockTicks: number; betweenPlayClockTicks: number; regulationClockTicks: number }
/** Regulation only (up to the end of the fourth quarter), with identical or different scripted teams. */
export function game(home: Team, away: Team, opts: Options = DEFAULTS): GameResult {
    let s: DownState = createDown(), m = fresh(), counted = 0, lastEnded = true, lastOff = '';
    const total = emptyStats();
    const byTeam = { home: emptyStats(), away: emptyStats() };
    const possessions = { home: 0, away: 0 };
    const quarterPlays = [0, 0, 0, 0];
    let clockLive = 0, clockBetween = 0;
    for (let guard = 0; guard < 4_000_000 && s.mode === 'regulation'; guard++) {
        const me = s.offense === 'home' ? home : away, opp = s.offense === 'home' ? away : home;
        if (s.phase === 'pre-snap') {
            if (lastEnded || lastOff !== s.offense) { possessions[s.offense]++; byTeam[s.offense].possessions++; }
            lastOff = s.offense; lastEnded = false;
            const before = s.clock;
            const t = think(s, opts); s = t.state;
            total.thinkTicks += opts.thinkTicks; clockBetween += before - s.clock; total.clockBurnedBetweenPlays += before - s.clock;
            const play = choose(s, me.off);
            if (play === 'fieldgoal') { total.fieldGoalsTried++; byTeam[s.offense].fieldGoalsTried++; }
            s = snap(choosePlay(s, play)); m = fresh(); counted = 0;
        }
        else if (s.phase === 'live') {
            const c = control(s, me.off, opp.def, opts, m);
            if (m.throws > counted) { total.passes++; byTeam[s.offense].passes++; counted = m.throws; }
            const before = c.state.clock;
            s = stepDown(c.state, c.inputs); total.liveTicks++;
            if (s.quarter === c.state.quarter) clockLive += before - s.clock;
        }
        else if (s.phase === 'dead') {
            record(total, s); record(byTeam[s.offense], s);
            quarterPlays[Math.min(3, s.quarter - 1)]!++;
            const r = s.result!;
            if (r.turnover || r.turnoverOnDowns || r.touchdown) lastEnded = true;
            s = nextDown(s);
        }
        else if (s.phase === 'kick') {
            if (s.kick!.good === null) s = kickStep(s);
            else { total.kicks++; if (s.kick!.kind === 'fg' && s.kick!.good) { total.fieldGoals++; byTeam[s.kick!.team].fieldGoals++; } if (s.kick!.kind === 'xp' && s.kick!.good) { total.extraPoints++; byTeam[s.kick!.team].extraPoints++; } lastEnded = true; s = nextDown(s); }
        }
        else break;
    }
    total.points = s.score.home + s.score.away;
    return { score: s.score, ended: s.phase === 'final' ? 'final' : 'overtime', stats: total, possessions, byTeam, quarterPlays, liveClockTicks: clockLive, betweenPlayClockTicks: clockBetween, regulationClockTicks: clockLive + clockBetween };
}
/** Estimated minutes of real time for a game: live action, the players' thinking time, and a few seconds per kick. */
export const minutes = (g: GameResult, kickSeconds = 3): number => (g.stats.liveTicks + g.stats.thinkTicks) / 3600 + (g.stats.kicks * kickSeconds) / 60;
