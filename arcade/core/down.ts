import { EXTRA_POINT_DISTANCE, EXTRA_POINT_POINTS, FIELD_GOAL_MAX_DISTANCE, FIELD_GOAL_POINTS, KICK_MAX_TICKS, isGood, kickDistance, meterAt } from './kick';
import { createMatch, step, FIELD, STEP_SECONDS, type ArcadePlayer, type MatchSnapshot, type TeamId, type PlayerId, type Inputs, type Vector } from './simulation';
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
    /** The quarter's clock ran out during a play: it finishes, then the quarter ends. */
    readonly expired: boolean;
    readonly mode: GameMode;
    /** The team that took the opening possession; the other team receives the second half. */
    readonly openingTeam: TeamId;
    readonly overtime: { readonly first: TeamId; readonly possessions: number };
    readonly winner: TeamId | null;
    readonly kick: KickState | null;
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
    readonly ball: Ball;
    readonly result: PlayResult | null;
}
export const opposite = (team: TeamId): TeamId => team === 'home' ? 'away' : 'home';
export const direction = (team: TeamId) => team === 'home' ? 1 : -1;
const id = (team: TeamId, n: number) => `${team}-${n}` as PlayerId;
export const CONTACT_RADIUS = FIELD.radius * 2;
export const CATCH_RADIUS = 1.6;
export const BREAKUP_RADIUS = 2.2;
/** A covering defender holds his coverage this many ticks into a throw before breaking on the ball. */
export const REACT_TICKS = 18;
/** Route depths in yards past the line of scrimmage, by play and receiver number. */
export const ROUTE_DEPTH = { slants: { 3: 10, 4: 18 }, go: { 3: 31, 4: 34 } } as const;
/** Receivers are a touch quicker than defenders (50 against 45), and the ball leads them a bit further than a step. */
export const RECEIVER_SPEED = 50;
export const PASS_LEAD = 1.2;
/** The two covering defenders line up this many yards past the line. */
export const COVER_DEPTH = 20;
/** Man coverage sits this far ahead of the receiver. */
export const COVER_CUSHION = 9;
/** An offensive blocker this close to a defender has him engaged. */
export const BLOCK_RADIUS = 1.8;
/** An engaged defender, human or AI, moves at this fraction of his speed. */
export const BLOCK_SLOW = 0.4;
const BLOCK_SHIELD = 1.2;
export const GO_CUSHION = -2;
export const GO_REACT_TICKS = 36;
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
    readonly mode: GameMode;
    readonly openingTeam: TeamId;
    readonly overtime: { readonly first: TeamId; readonly possessions: number };
    readonly winner: TeamId | null;
    readonly kick: KickState | null;
}
const freshGame = (score: Score = { home: 0, away: 0 }): Omit<Carry, 'down' | 'firstDownLine'> => ({ score, quarter: 1, clock: QUARTER_TICKS, expired: false, mode: 'regulation', openingTeam: 'home', overtime: { first: 'away', possessions: 0 }, winner: null, kick: null });
function formation(team: TeamId, line: number, playNumber: number, play: Play, carry: Carry): DownState {
    const dir = direction(team), center = FIELD.width / 2;
    const players = createMatch().players.map(p => {
        const attacking = p.team === team;
        const offsets = attacking ? [0, -2, 0, 0, -1] : [7, 12, COVER_DEPTH, COVER_DEPTH, 20];
        const lanes = attacking ? [center, center, center - 26 / 3, center + 26 / 3, center + 5] : [center, center, center - 26 / 3, center + 26 / 3, center - 8];
        return { ...p, abilities: { speed: attacking && (p.number === 3 || p.number === 4) ? RECEIVER_SPEED : p.abilities.speed }, x: Math.max(FIELD.radius, Math.min(FIELD.length - FIELD.radius, line + dir * offsets[p.number - 1]!)), y: lanes[p.number - 1]!, human: p.number === 1 };
    });
    return { tick: 0, players, possession: { team, carrier: id(team, 1) }, offense: team, phase: 'pre-snap', play, playNumber, line, liveTicks: 0, terminalCount: 0, contestUntil: 0, ...carry, defender: id(opposite(team), 1), ball: { kind: 'held' }, result: null };
}
/** A pre-snap formation at an arbitrary spot: the entry point for reaching a situation without playing to it. */
export function lineUp(team: TeamId, line: number, options: { down?: number; score?: Score; play?: Play; playNumber?: number; game?: Partial<Carry> } = {}): DownState {
    return formation(team, line, options.playNumber ?? 1, options.play ?? 'rush', { ...freshGame(options.score), down: options.down ?? 1, firstDownLine: firstDownMarker(team, line), ...options.game });
}
export const createDown = (): DownState => lineUp('home', 38);
export const choosePlay = (state: DownState, play: Play): DownState => state.phase !== 'pre-snap' || (play === 'fieldgoal' && !fieldGoalInRange(state)) ? state : { ...state, play };
function controls(state: DownState): DownState {
    return { ...state, players: state.players.map(p => ({ ...p, human: p.id === state.possession.carrier || p.id === state.defender })) };
}
export function snap(state: DownState): DownState {
    if (state.phase !== 'pre-snap')
        return state;
    if (state.play === 'fieldgoal')
        return fieldGoalInRange(state) ? { ...state, phase: 'kick', kick: kickSpec(state, 'fg') } : state;
    const carrier = id(state.offense, state.play === 'rush' ? 2 : 1), qb = player(state, id(state.offense, 1));
    return controls({ ...state, phase: 'live', possession: { team: state.offense, carrier }, players: state.players.map(p => p.id === carrier ? { ...p, x: qb.x, y: qb.y } : p) });
}
export function switchDefender(state: DownState, team = opposite(state.offense)): DownState {
    if (state.phase === 'dead' || state.phase === 'kick' || state.phase === 'final' || team !== opposite(state.offense))
        return state;
    const n = player(state, state.defender).number % 5 + 1;
    return controls({ ...state, defender: id(opposite(state.offense), n), contestUntil: 0 });
}
/** A short hands window belongs to the selected human defender, not every teammate. */
export function contestPass(state: DownState, team: TeamId): DownState {
    if (state.phase !== 'live' || state.ball.kind !== 'flight' || team !== opposite(state.offense))
        return state;
    return { ...state, contestUntil: state.tick + 36 };
}
/** Routes are world-space destinations. AI reads only the previous tick. */
function route(state: DownState, key: PlayerId): Vector {
    const p = player(state, key), dir = direction(state.offense);
    const depth = ROUTE_DEPTH[state.play === 'go' ? 'go' : 'slants'][p.number === 3 ? 3 : 4];
    // A route ends in the end zone at the deepest: near either goal line a deep route is still a catchable pass.
    return { x: Math.max(2, Math.min(FIELD.length - 2, state.line + dir * depth)), y: state.play === 'slants' ? FIELD.width / 2 : FIELD.width / 2 + (p.number === 3 ? -26 / 3 : 26 / 3) };
}
export function throwPass(state: DownState, target: 1 | 2, team = state.offense): DownState {
    if (team !== state.offense || state.phase !== 'live' || state.play === 'rush' || state.ball.kind !== 'held' || state.possession.carrier !== id(state.offense, 1))
        return state;
    const receiver = player(state, id(state.offense, target + 2)), goal = route(state, receiver.id);
    const length = Math.max(1, distance(receiver, goal)), duration = 1;
    const lead = Math.min(length, (4 + receiver.abilities.speed / 20) * duration * PASS_LEAD);
    const to = { x: receiver.x + (goal.x - receiver.x) / length * lead, y: receiver.y + (goal.y - receiver.y) / length * lead };
    const qb = player(state, state.possession.carrier);
    return { ...state, ball: { kind: 'flight', from: { x: qb.x, y: qb.y }, to, elapsed: 0, duration, target: receiver.id } };
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
    return { ...state, phase: 'dead', terminalCount: state.terminalCount + 1, score, ball: { kind: 'held' }, result: { playNumber: state.playNumber, reason, yards, turnover: interception || safety, touchdown, firstDown, turnoverOnDowns } };
}
const kickSpec = (state: DownState, kind: 'xp' | 'fg'): KickState => {
    const yardsToGoal = state.offense === 'home' ? 110 - state.line : state.line - 10;
    return { kind, team: state.offense, distance: kind === 'xp' ? EXTRA_POINT_DISTANCE : kickDistance(yardsToGoal), spot: state.line, ticks: 0, lockedAt: null, good: null };
};
/** A field goal is only offered when the kick is inside the longest distance the meter allows. */
export const fieldGoalInRange = (state: DownState): boolean => kickSpec(state, 'fg').distance <= FIELD_GOAL_MAX_DISTANCE;
/** A missed field goal gives the ball to the other team where it was snapped, but no deeper than their own 20. */
const missedFieldGoalSpot = (team: TeamId, spot: number) => team === 'home' ? Math.min(spot, 90) : Math.max(spot, 30);
const fullClock = { clock: QUARTER_TICKS, expired: false };
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
    let game = { quarter: state.quarter, clock: state.clock, expired: state.expired, mode: state.mode, overtime: state.overtime };
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
            game = { quarter: 5, clock: 0, expired: false, mode: 'overtime', overtime: { ...state.overtime, possessions: 0 } };
            fresh(game.overtime.first);
        }
        else
            game = { ...game, quarter: game.quarter + 1, ...fullClock };
    }
    const carry: Carry = { score: state.score, down, firstDownLine, ...game, openingTeam: state.openingTeam, winner: null, kick: null };
    return { ...formation(team, line, state.playNumber + 1, state.play === 'fieldgoal' ? 'rush' : state.play, carry), terminalCount: state.terminalCount };
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
export const newGame = (): DownState => createDown();
/** Two blockers per play (QB and #5 on a handoff, RB and #5 on a pass), each taking the next-closest defender to the carrier. */
const blockerNumbers = (play: Play) => play === 'rush' ? [1, 5] : [2, 5];
function blocking(state: DownState, carrier: ArcadePlayer): { readonly assignments: ReadonlyMap<PlayerId, ArcadePlayer>; readonly slow: ReadonlyMap<PlayerId, number> } {
    const blockers = state.players.filter(p => p.team === state.offense && p.id !== carrier.id && !p.human && blockerNumbers(state.play).includes(p.number)).sort((a, b) => a.number - b.number);
    const threats = state.players.filter(p => p.team !== state.offense).sort((a, b) => distance(a, carrier) - distance(b, carrier) || a.id.localeCompare(b.id));
    const assignments = new Map<PlayerId, ArcadePlayer>();
    blockers.forEach((b, i) => { if (threats[i]) assignments.set(b.id, threats[i]!); });
    // Only a blocker's own assignment is held, and only while the two are within blocking range.
    const slow = new Map<PlayerId, number>();
    for (const b of blockers) {
        const d = assignments.get(b.id);
        if (d && distance(b, d) <= BLOCK_RADIUS)
            slow.set(d.id, BLOCK_SLOW);
    }
    return { assignments, slow };
}
/** Blocker/defender pairs currently engaged (for the on-screen bars; the same test slows the defender). */
export function engagements(state: DownState): { readonly blocker: PlayerId; readonly defender: PlayerId }[] {
    const { assignments } = blocking(state, player(state, state.possession.carrier));
    return [...assignments].filter(([b, d]) => distance(player(state, b), d) <= BLOCK_RADIUS).map(([blocker, d]) => ({ blocker, defender: d.id }));
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
    if (state.phase !== 'live')
        return state;
    const next = stepPlay(state, inputs);
    if (next.mode !== 'regulation' || next.clock <= 0)
        return next;
    const clock = next.clock - 1;
    return { ...next, clock, expired: next.expired || clock === 0 };
}
function stepPlay(state: DownState, inputs: Inputs): DownState {
    if (state.phase !== 'live')
        return state;
    const carrier = player(state, state.possession.carrier), targets = new Map<PlayerId, Vector>();
    const { assignments, slow } = blocking(state, carrier);
    for (const p of state.players) {
        let target: Vector;
        if (p.team === state.offense) {
            if (assignments.has(p.id)) {
                // Stand between the defender and the carrier, a step off the defender, so he stays engaged.
                const d = assignments.get(p.id)!, gap = distance(d, carrier);
                target = gap < 0.5 ? p : { x: d.x + (carrier.x - d.x) / gap * BLOCK_SHIELD, y: d.y + (carrier.y - d.y) / gap * BLOCK_SHIELD };
            }
            else
                target = p.number === 3 || p.number === 4 ? route(state, p.id) : { x: carrier.x + direction(state.offense) * 3, y: carrier.y + (p.number === 5 ? 5 : -5) };
        }
        else if (state.ball.kind === 'flight' && state.ball.target.endsWith(`-${p.number}`) && state.ball.elapsed * 60 >= (state.play === 'go' ? GO_REACT_TICKS : REACT_TICKS) - 1e-9)
            target = state.ball.to;
        else if (state.play !== 'rush' && (state.ball.kind === 'flight' || carrier.number === 1) && (p.number === 3 || p.number === 4)) {
            const receiver = player(state, id(state.offense, p.number));
            target = { x: receiver.x + direction(state.offense) * (state.play === 'go' ? GO_CUSHION : COVER_CUSHION), y: receiver.y };
        }
        else
            target = carrier;
        targets.set(p.id, target);
    }
    let moved: DownState = { ...state, ...step(state, inputs, targets, slow), liveTicks: state.liveTicks + 1 };
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
    if (moved.players.some(p => p.team !== state.offense && distance(p, runner) <= CONTACT_RADIUS))
        return finish(moved, 'tackle');
    return moved.liveTicks >= 900 ? finish(moved, 'timeout') : moved;
}
