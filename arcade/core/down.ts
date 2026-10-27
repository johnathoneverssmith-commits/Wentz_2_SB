import { EXTRA_POINT_DISTANCE, EXTRA_POINT_POINTS, FIELD_GOAL_MAX_DISTANCE, FIELD_GOAL_POINTS, KICK_MAX_TICKS, isGood, kickDistance, meterAt } from './kick';
import { DEFAULT_SEED } from './seed';
import { advance, distanceCovered, FIELD, STEP_SECONDS, maxSpeed, type ArcadePlayer, type Intent, type MatchSnapshot, type TeamId, type PlayerId, type Inputs, type Vector } from './simulation';
import { BALL_SPEED, BLOCK_RADIUS, CATCH_RADIUS, BREAKUP_RADIUS, CONTACT_RADIUS, MAX_FLIGHT, MIN_FLIGHT, PASS_LEAD, STUMBLE_TICKS, assignPlay, clampField, direction, opposite, planTick, playMode, pointAlong, resolveLocks, ROUTE_DEPTH, BLOCK_SLOW, SAFETY_DEPTH, BLOCK_HOLD_TICKS } from './behavior';
import { DEFENSE_FORMATIONS, OFFENSE_FORMATIONS, baseAbilities, chooseFormations, codeOf, playerId, positionOfCode, JERSEY, type Code, type DefenseFormation, type OffenseFormation, type Slot } from './personnel';
export { BALL_SPEED, BLOCK_RADIUS, CATCH_RADIUS, BREAKUP_RADIUS, CONTACT_RADIUS, MAX_FLIGHT, MIN_FLIGHT, PASS_LEAD, direction, opposite, ROUTE_DEPTH, BLOCK_SLOW, SAFETY_DEPTH, BLOCK_HOLD_TICKS };
export type Play = 'rush' | 'slants' | 'go' | 'fieldgoal';
export type EndReason = 'tackle' | 'out-of-bounds' | 'touchdown' | 'incomplete' | 'interception' | 'safety' | 'timeout';
export type Ball = {
    readonly kind: 'held';
} | {
    readonly kind: 'flight';
    readonly from: Vector;
    readonly to: Vector;
    readonly elapsed: number;
    readonly duration: number;
    readonly target: PlayerId;
};
export interface PlayResult {
    readonly playNumber: number;
    readonly reason: EndReason;
    readonly yards: number;
    readonly turnover: boolean;
    readonly touchdown: boolean;
    /** The offense reached the first-down marker on this play. */
    readonly firstDown: boolean;
    /** Fourth down failed: the ball changes sides at the spot. */
    readonly turnoverOnDowns: boolean;
}
export interface Score {
    readonly home: number;
    readonly away: number;
}
export const TOUCHDOWN_POINTS = 6;
export const SAFETY_POINTS = 2;
/** Game time is simulation time: a quarter is three minutes of live play, one clock tick per 1/60-second simulation tick. */
export const QUARTER_TICKS = 3 * 60 * 60;
/**
 * Between plays the clock keeps running, but only for this long (six game seconds) while the players choose and snap; once
 * it is used up the clock waits for the snap, however long that takes. A play that ends starts a fresh allowance; menu
 * actions, switching defenders and choosing a play never do.
 */
export const BETWEEN_PLAY_TICKS = 6 * 60;
export type GameMode = 'regulation' | 'overtime' | 'final';
export interface KickState {
    readonly kind: 'xp' | 'fg';
    readonly team: TeamId;
    /** Yards from the kicker to the goal posts. */
    readonly distance: number;
    /** Where the ball was snapped from (for a miss). */
    readonly spot: number;
    readonly ticks: number;
    /** Meter ticks at the moment of the kick; null while the meter is still swinging. */
    readonly lockedAt: number | null;
    readonly good: boolean | null;
}
export interface DownState extends MatchSnapshot {
    readonly phase: 'pre-snap' | 'live' | 'dead' | 'kick' | 'final';
    /** 1-4 regulation, 5 overtime. */
    readonly quarter: number;
    /** Simulation ticks of live play left in the quarter (60 per second). */
    readonly clock: number;
    /** The quarter's clock ran out: any play in progress finishes, then the quarter ends. */
    readonly expired: boolean;
    /** Ticks of between-play clock still available before the next snap (0 = the clock is waiting for the snap). */
    readonly gap: number;
    readonly mode: GameMode;
    /** The team that took the opening possession; the other team receives the second half. */
    readonly openingTeam: TeamId;
    readonly overtime: { readonly first: TeamId; readonly possessions: number };
    readonly winner: TeamId | null;
    readonly kick: KickState | null;
    /** The game's random seed: every chance event is a hash of it and the event's identity (`core/seed.ts`), so a game replays exactly. */
    readonly seed: number;
    readonly play: Play;
    readonly playNumber: number;
    readonly line: number;
    readonly offense: TeamId;
    readonly liveTicks: number;
    readonly terminalCount: number;
    readonly contestUntil: number;
    readonly score: Score;
    /** 1-4 */
    readonly down: number;
    /** World x of the first-down marker (clamped to the goal line). */
    readonly firstDownLine: number;
    readonly defender: PlayerId;
    /** The formations both teams lined up in for this snap. */
    readonly formation: { readonly offense: OffenseFormation; readonly defense: DefenseFormation };
    readonly ball: Ball;
    readonly result: PlayResult | null;
}
const distance = (a: Vector, b: Vector) => Math.hypot(a.x - b.x, a.y - b.y);
const player = (state: DownState, key: PlayerId) => state.players.find(p => p.id === key)!;
export const firstDownMarker = (team: TeamId, line: number) => Math.max(10, Math.min(110, line + direction(team) * 10));
export interface Situation {
    readonly down: number;
    readonly toGo: number;
    readonly goalToGo: boolean;
}
export function situation(state: DownState): Situation {
    const dir = direction(state.offense);
    return { down: state.down, toGo: Math.max(0, Math.round((state.firstDownLine - state.line) * dir * 10) / 10), goalToGo: dir === 1 ? state.firstDownLine >= 110 : state.firstDownLine <= 10 };
}
export const ownTwentyEight = (team: TeamId) => team === 'home' ? 38 : 82;
interface Carry {
    readonly score: Score;
    readonly down: number;
    readonly firstDownLine: number;
    readonly quarter: number;
    readonly clock: number;
    readonly expired: boolean;
    readonly gap: number;
    readonly mode: GameMode;
    readonly openingTeam: TeamId;
    readonly overtime: { readonly first: TeamId; readonly possessions: number };
    readonly winner: TeamId | null;
    readonly kick: KickState | null;
    readonly seed: number;
}
const freshGame = (score: Score = { home: 0, away: 0 }, seed = DEFAULT_SEED): Omit<Carry, 'down' | 'firstDownLine'> => ({ seed, score, quarter: 1, clock: QUARTER_TICKS, expired: false, gap: 0, mode: 'regulation', openingTeam: 'home', overtime: { first: 'away', possessions: 0 }, winner: null, kick: null });
/** Builds the 22 players for a snap: the offense and defense in the formations chosen for this play. */
function layout(team: TeamId, line: number, play: Play, playNumber: number): { players: ArcadePlayer[]; formation: DownState['formation'] } {
    const formation = chooseFormations(play, playNumber), dir = direction(team), center = FIELD.width / 2;
    const build = (owner: TeamId, slot: Slot, attacking: boolean): ArcadePlayer => {
        const pos = positionOfCode(slot.code);
        return {
            id: playerId(owner, slot.code), team: owner, number: JERSEY[slot.code], position: pos, human: false, abilities: baseAbilities(pos),
            // Backs never start inside their own end zone (that would be an instant safety): near the goal line the formation is squeezed.
            x: Math.max(attacking ? 11.2 : FIELD.radius, Math.min(attacking ? FIELD.length - 11.2 : FIELD.length - FIELD.radius, line + dir * (attacking ? -slot.depth : slot.depth))),
            y: center + slot.lane, vx: 0, vy: 0, behavior: 'stance', assign: null, lock: null, stun: 0, free: 0,
        };
    };
    const players = [...OFFENSE_FORMATIONS[formation.offense].map(slot => build(team, slot, true)), ...DEFENSE_FORMATIONS[formation.defense].map(slot => build(opposite(team), slot, false))];
    return { players, formation };
}
function formationState(team: TeamId, line: number, playNumber: number, play: Play, carry: Carry): DownState {
    const { players, formation } = layout(team, line, play, playNumber);
    const defense = players.find(p => p.team !== team && p.position === 'MLB') ?? players.find(p => p.team !== team && p.position === 'OLB')!;
    const state: DownState = { tick: 0, players, possession: { team, carrier: playerId(team, play === 'rush' ? 'RB' : 'QB') }, offense: team, phase: 'pre-snap', play, playNumber, line, liveTicks: 0, terminalCount: 0, contestUntil: 0, ...carry, defender: defense.id, formation, ball: { kind: 'held' }, result: null };
    return controls(state);
}
/** A pre-snap formation at an arbitrary spot: the entry point for reaching a situation without playing to it. */
export function lineUp(team: TeamId, line: number, options: { down?: number; score?: Score; play?: Play; playNumber?: number; seed?: number; game?: Partial<Carry> } = {}): DownState {
    return formationState(team, line, options.playNumber ?? 1, options.play ?? 'rush', { ...freshGame(options.score, options.seed), down: options.down ?? 1, firstDownLine: firstDownMarker(team, line), ...options.game });
}
export const createDown = (seed = DEFAULT_SEED): DownState => lineUp('home', 38, { seed });
/** Choosing a play changes the formation the team lines up in. */
export function choosePlay(state: DownState, play: Play): DownState {
    if (state.phase !== 'pre-snap' || (play === 'fieldgoal' && !fieldGoalInRange(state)))
        return state;
    if (play === state.play)
        return state;
    const { players, formation } = layout(state.offense, state.line, play, state.playNumber);
    const carrier = playerId(state.offense, play === 'rush' ? 'RB' : 'QB');
    const keep = players.find(p => p.id === state.defender) ? state.defender : (players.find(p => p.team !== state.offense && p.position === 'MLB') ?? players.find(p => p.team !== state.offense && p.position === 'OLB')!).id;
    return controls({ ...state, play, players, formation, defender: keep, possession: { team: state.offense, carrier } });
}
/** The human controls the ball carrier and one selected defender; everyone else follows their assignment. */
function controls(state: DownState): DownState {
    return { ...state, players: state.players.map(p => ({ ...p, human: p.id === state.possession.carrier || p.id === state.defender })) };
}
export function snap(state: DownState): DownState {
    if (state.phase !== 'pre-snap')
        return state;
    // The clock ran out while the players were choosing: the snap the next play would take starts the next period instead.
    if (state.expired && state.mode === 'regulation')
        return proceed(state, { team: state.offense, line: state.line, down: state.down, firstDownLine: state.firstDownLine, ended: false });
    if (state.play === 'fieldgoal')
        return fieldGoalInRange(state) ? { ...state, phase: 'kick', kick: kickSpec(state, 'fg') } : state;
    const carrier = playerId(state.offense, state.play === 'rush' ? 'RB' : 'QB');
    return controls({ ...state, phase: 'live', possession: { team: state.offense, carrier }, players: assignPlay({ ...state, possession: { team: state.offense, carrier } }) });
}
/** Selects the next-closest defender to the ball (deterministic: ties by id). */
export function switchDefender(state: DownState, team = opposite(state.offense)): DownState {
    if (state.phase === 'dead' || state.phase === 'kick' || state.phase === 'final' || team !== opposite(state.offense))
        return state;
    const ball = player(state, state.possession.carrier);
    const order = state.players.filter(p => p.team === team).sort((a, b) => distance(a, ball) - distance(b, ball) || a.id.localeCompare(b.id));
    const at = order.findIndex(p => p.id === state.defender);
    return controls({ ...state, defender: order[(at + 1) % order.length]!.id, contestUntil: 0 });
}
/** A short hands window belongs to the selected human defender, not every teammate. */
export function contestPass(state: DownState, team: TeamId): DownState {
    if (state.phase !== 'live' || state.ball.kind !== 'flight' || team !== opposite(state.offense))
        return state;
    return { ...state, contestUntil: state.tick + 36 };
}
/** The pass targets in key order: WR1, WR2, and the tight end. */
export const TARGET_CODES = ['WR1', 'WR2', 'TE1'] as const;
export function throwPass(state: DownState, target: 1 | 2 | 3, team = state.offense): DownState {
    const qb = state.players.find(p => p.id === state.possession.carrier);
    if (team !== state.offense || state.phase !== 'live' || state.play === 'rush' || state.ball.kind !== 'held' || !qb || qb.position !== 'QB')
        return state;
    const receiver = state.players.find(p => p.id === playerId(state.offense, TARGET_CODES[target - 1]!));
    if (!receiver)
        return state;
    const points = receiver.assign?.points ?? [], index = receiver.assign?.index ?? 0;
    // Where the receiver will be `seconds` from now, running his route (or carrying on as he is once it is done).
    const spotAt = (seconds: number): Vector => clampField(index < points.length
        ? pointAlong(points, receiver, index, distanceCovered(receiver, seconds) * PASS_LEAD)
        : { x: receiver.x + receiver.vx * seconds, y: receiver.y + receiver.vy * seconds });
    // The flight time depends on how far the ball goes and the distance on where the receiver will be when it lands, so settle both
    // together. The ball is faster than any receiver, so this converges in a few passes; the time is a whole number of ticks, which is
    // when arrival is checked, so the receiver is exactly where the ball lands on that tick.
    const ticksFor = (to: Vector) => Math.ceil(Math.min(MAX_FLIGHT, Math.max(MIN_FLIGHT, Math.hypot(to.x - qb.x, to.y - qb.y) / BALL_SPEED)) * 60 - 1e-9);
    let ticks = Math.ceil(MIN_FLIGHT * 60), to = spotAt(ticks / 60);
    for (let i = 0; i < 24; i++) {
        const next = ticksFor(to);
        if (next === ticks) break;
        ticks = next; to = spotAt(ticks / 60);
    }
    return { ...state, ball: { kind: 'flight', from: { x: qb.x, y: qb.y }, to, elapsed: 0, duration: ticks / 60, target: receiver.id } };
}
function finish(state: DownState, reason: EndReason): DownState {
    if (state.phase !== 'live')
        return state;
    const carrier = player(state, state.possession.carrier), dir = direction(state.offense);
    const yards = reason === 'incomplete' || reason === 'interception' ? 0 : Math.round((carrier.x - state.line) * dir * 10) / 10;
    const touchdown = reason === 'touchdown', safety = reason === 'safety', interception = reason === 'interception';
    const ordinary = !touchdown && !safety && !interception;
    // Reaching the marker is judged at the spot where the play ended, never on an earlier frame.
    const firstDown = ordinary && reason !== 'incomplete' && (state.line + yards * dir - state.firstDownLine) * dir >= -1e-9;
    const turnoverOnDowns = ordinary && !firstDown && state.down >= 4;
    const score = touchdown ? { ...state.score, [state.offense]: state.score[state.offense] + TOUCHDOWN_POINTS }
        : safety ? { ...state.score, [opposite(state.offense)]: state.score[opposite(state.offense)] + SAFETY_POINTS } : state.score;
    return { ...state, phase: 'dead', gap: BETWEEN_PLAY_TICKS, terminalCount: state.terminalCount + 1, score, ball: { kind: 'held' }, result: { playNumber: state.playNumber, reason, yards, turnover: interception || safety, touchdown, firstDown, turnoverOnDowns } };
}
const kickSpec = (state: DownState, kind: 'xp' | 'fg'): KickState => {
    const yardsToGoal = state.offense === 'home' ? 110 - state.line : state.line - 10;
    return { kind, team: state.offense, distance: kind === 'xp' ? EXTRA_POINT_DISTANCE : kickDistance(yardsToGoal), spot: state.line, ticks: 0, lockedAt: null, good: null };
};
/** A field goal is only offered when the kick is inside the longest distance the meter allows. */
export const fieldGoalInRange = (state: DownState): boolean => kickSpec(state, 'fg').distance <= FIELD_GOAL_MAX_DISTANCE;
/** A missed field goal gives the ball to the other team where it was snapped, but no deeper than their own 20. */
const missedFieldGoalSpot = (team: TeamId, spot: number) => team === 'home' ? Math.min(spot, 90) : Math.max(spot, 30);
const fullClock = { clock: QUARTER_TICKS, expired: false, gap: 0 };
function final(state: DownState, winner: TeamId): DownState {
    return { ...state, phase: 'final', mode: 'final', winner, kick: null, expired: false };
}
interface Next {
    readonly team: TeamId;
    readonly line: number;
    readonly down: number;
    readonly firstDownLine: number;
    /** The possession that just ended (touchdown and point after, field goal, turnover, safety, downs). */
    readonly ended: boolean;
}
/**
 * Builds the snap that follows a finished down or kick, applying the quarter, halftime, overtime and game-over
 * rules. The score was already recorded when the play or kick ended; this never changes it.
 */
function proceed(state: DownState, next: Next): DownState {
    let { team, line, down, firstDownLine } = next;
    let game = { quarter: state.quarter, clock: state.clock, expired: state.expired, gap: state.gap, mode: state.mode, overtime: state.overtime };
    const fresh = (t: TeamId) => { team = t; line = ownTwentyEight(t); down = 1; firstDownLine = firstDownMarker(t, line); };
    if (game.mode === 'overtime') {
        if (next.ended) {
            const possessions = game.overtime.possessions + 1;
            if (possessions % 2 === 0 && state.score.home !== state.score.away)
                return final(state, state.score.home > state.score.away ? 'home' : 'away');
            game = { ...game, overtime: { ...game.overtime, possessions } };
            fresh(possessions % 2 === 0 ? game.overtime.first : opposite(game.overtime.first));
        }
    }
    else if (game.expired) {
        if (game.quarter === 2) {
            // Halftime: the team that did not open the game receives, from its own 28.
            game = { ...game, quarter: 3, ...fullClock };
            fresh(opposite(state.openingTeam));
        }
        else if (game.quarter === 4) {
            if (state.score.home !== state.score.away)
                return final(state, state.score.home > state.score.away ? 'home' : 'away');
            game = { quarter: 5, clock: 0, expired: false, gap: 0, mode: 'overtime', overtime: { ...state.overtime, possessions: 0 } };
            fresh(game.overtime.first);
        }
        else
            game = { ...game, quarter: game.quarter + 1, ...fullClock };
    }
    const carry: Carry = { seed: state.seed, score: state.score, down, firstDownLine, ...game, openingTeam: state.openingTeam, winner: null, kick: null };
    return { ...formationState(team, line, state.playNumber + 1, state.play === 'fieldgoal' ? 'rush' : state.play, carry), terminalCount: state.terminalCount };
}
/** Builds the next snap: after a play (a touchdown first goes to the extra point) or after a kick. */
export function nextDown(state: DownState): DownState {
    if (state.phase === 'kick') {
        const k = state.kick;
        if (!k || k.good === null)
            return state;
        const other = opposite(k.team);
        const line = k.kind === 'fg' && !k.good ? missedFieldGoalSpot(k.team, k.spot) : ownTwentyEight(other);
        return proceed(state, { team: other, line, down: 1, firstDownLine: firstDownMarker(other, line), ended: true });
    }
    if (state.phase !== 'dead' || !state.result)
        return state;
    const r = state.result, dir = direction(state.offense);
    if (r.touchdown)
        return { ...state, phase: 'kick', kick: kickSpec(state, 'xp') };
    const change = r.turnover || r.turnoverOnDowns;
    const team = change ? opposite(state.offense) : state.offense;
    const spot = Math.max(12, Math.min(108, player(state, state.possession.carrier).x));
    const line = r.reason === 'safety' ? ownTwentyEight(team)
        : r.reason === 'incomplete' ? state.line
            : r.turnoverOnDowns ? Math.max(12, Math.min(108, state.line + r.yards * dir)) : spot;
    const fresh = change || r.firstDown;
    return proceed(state, { team, line, down: fresh ? 1 : state.down + 1, firstDownLine: fresh ? firstDownMarker(team, line) : state.firstDownLine, ended: change });
}
/** Presses Kick: the meter locks where it is now. Only the kicking team's key counts, and only once. */
export function kickBall(state: DownState, team: TeamId): DownState {
    const k = state.kick;
    if (state.phase !== 'kick' || !k || k.good !== null || k.team !== team)
        return state;
    return resolveKick(state, k.ticks);
}
function resolveKick(state: DownState, lockedAt: number): DownState {
    const k = state.kick!, good = isGood(lockedAt, k.distance);
    const points = !good ? 0 : k.kind === 'xp' ? EXTRA_POINT_POINTS : FIELD_GOAL_POINTS;
    return { ...state, terminalCount: state.terminalCount + 1, score: { ...state.score, [k.team]: state.score[k.team] + points }, kick: { ...k, lockedAt, good } };
}
/** The meter position the kicker would lock right now. */
export const kickMeter = (state: DownState): number => state.kick ? meterAt(state.kick.ticks) : 0;
/** Clock text for a number of ticks, e.g. 10800 -> "3:00". */
export const clockText = (ticks: number): string => { const s = Math.ceil(ticks / 60); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
/** A new game from the opening snap. */
export const newGame = (seed = DEFAULT_SEED): DownState => createDown(seed);
/** Blocker/defender pairs currently locked together (for the on-screen effect; the same lock slows the defender). */
export function engagements(state: DownState): { readonly blocker: PlayerId; readonly defender: PlayerId }[] {
    return state.players.filter(p => p.team !== state.offense && p.lock).map(d => ({ blocker: d.lock!.with, defender: d.id }));
}
/** One simulation tick. Live play also burns game clock: a tenth of a second per tick, in regulation only. */
export function stepDown(state: DownState, inputs: Inputs): DownState {
    if (state.phase === 'kick') {
        const k = state.kick;
        if (!k || k.good !== null)
            return state;
        const ticks = k.ticks + 1;
        const moving = { ...state, kick: { ...k, ticks } };
        return ticks >= KICK_MAX_TICKS ? resolveKick(moving, ticks) : moving;
    }
    if (state.phase === 'dead' || state.phase === 'pre-snap') {
        // Awaiting the next snap: the clock runs for the rest of the six-second allowance and then waits.
        if (state.mode !== 'regulation' || state.gap <= 0 || state.clock <= 0)
            return state;
        const clock = state.clock - 1;
        return { ...state, clock, gap: state.gap - 1, expired: state.expired || clock === 0 };
    }
    if (state.phase !== 'live')
        return state;
    const next = stepPlay(state, inputs);
    if (next.mode !== 'regulation' || next.clock <= 0)
        return next;
    const clock = next.clock - 1;
    return { ...next, clock, expired: next.expired || clock === 0 };
}
/** The first eligible defender close enough to bring the carrier down, or undefined. A defender who is blocked or stumbling cannot tackle. */
function tackler(state: DownState, runner: ArcadePlayer): { winner?: ArcadePlayer; missed: ArcadePlayer[] } {
    const missed: ArcadePlayer[] = [];
    const candidates = state.players.filter(p => p.team !== state.possession.team && !p.lock && p.stun === 0 && distance(p, runner) <= CONTACT_RADIUS)
        .sort((a, b) => distance(a, runner) - distance(b, runner) || a.id.localeCompare(b.id));
    for (const d of candidates) {
        // Closing speed toward the runner decides the wrap: head-on beats from-behind and side-on lunges, and a quick back can slip a weaker tackler.
        const dx = runner.x - d.x, dy = runner.y - d.y, n = Math.hypot(dx, dy) || 1;
        const closing = (d.vx * dx + d.vy * dy) / n / Math.max(1, maxSpeed(d));
        const wrap = d.abilities.tackle + 30 * Math.max(-0.5, Math.min(1, closing));
        const resist = runner.abilities.agility * 0.8 + (runner.human ? 10 : 0) + (runner.position === 'QB' ? -15 : 0);
        if (wrap >= resist)
            return { winner: d, missed };
        missed.push(d);
    }
    return { missed };
}
function stepPlay(state: DownState, inputs: Inputs): DownState {
    if (state.phase !== 'live')
        return state;
    const mode = playMode(state);
    const plan = planTick(state);
    const slow = new Map(plan.slow);
    let players = advance(plan.players, inputs, plan.intents, slow, state.possession.carrier);
    players = resolveLocks(players, state, mode);
    let moved: DownState = { ...state, tick: state.tick + 1, players, liveTicks: state.liveTicks + 1 };
    if (state.ball.kind === 'flight') {
        const ball = { ...state.ball, elapsed: state.ball.elapsed + STEP_SECONDS };
        moved = { ...moved, ball };
        if (ball.elapsed + 1e-9 >= ball.duration) {
            if (ball.to.x < FIELD.radius || ball.to.x > FIELD.length - FIELD.radius || ball.to.y < FIELD.radius || ball.to.y > FIELD.width - FIELD.radius)
                return finish(moved, 'incomplete');
            // Position decides. A receiver wins the ball cleanly only with BREAKUP_RADIUS to spare over the nearest
            // defender; a defender inside CATCH_RADIUS intercepts (a human defender also needs Hands), otherwise he breaks it up.
            const receiver = player(moved, ball.target), rd = distance(receiver, ball.to);
            const contesting = moved.players.filter(p => p.team !== state.offense && distance(p, ball.to) <= BREAKUP_RADIUS)
                .sort((a, b) => distance(a, ball.to) - distance(b, ball.to) || a.id.localeCompare(b.id));
            const interceptor = contesting.find(p => distance(p, ball.to) <= CATCH_RADIUS && (!p.human || state.contestUntil >= moved.tick));
            if (interceptor)
                return finish(controls({ ...moved, ball: { kind: 'held' }, possession: { team: interceptor.team, carrier: interceptor.id } }), 'interception');
            if (contesting.length)
                return finish(moved, 'incomplete');
            if (rd > CATCH_RADIUS)
                return finish(moved, 'incomplete');
            moved = controls({ ...moved, ball: { kind: 'held' }, possession: { team: state.offense, carrier: receiver.id } });
        }
        else
            return moved.liveTicks >= 900 ? finish(moved, 'timeout') : moved;
    }
    const runner = player(moved, moved.possession.carrier), dir = direction(state.offense);
    if (dir === 1 ? runner.x >= 110 : runner.x <= 10)
        return finish(moved, 'touchdown');
    if (dir === 1 ? runner.x <= 10 : runner.x >= 110)
        return finish(moved, 'safety');
    if (runner.y <= FIELD.radius || runner.y >= FIELD.width - FIELD.radius || runner.x <= FIELD.radius || runner.x >= FIELD.length - FIELD.radius)
        return finish(moved, 'out-of-bounds');
    const attempt = tackler(moved, runner);
    if (attempt.missed.length)
        moved = { ...moved, players: moved.players.map(p => attempt.missed.some(m => m.id === p.id) ? { ...p, stun: STUMBLE_TICKS, behavior: 'stumble' } : p) };
    if (attempt.winner)
        return finish(moved, 'tackle');
    return moved.liveTicks >= 900 ? finish(moved, 'timeout') : moved;
}
