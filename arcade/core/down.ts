import { createMatch, step, FIELD, STEP_SECONDS, type MatchSnapshot, type TeamId, type PlayerId, type Inputs, type Vector } from './simulation';
export type Play = 'rush' | 'slants' | 'go';
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
}
export interface DownState extends MatchSnapshot {
    readonly phase: 'pre-snap' | 'live' | 'dead';
    readonly play: Play;
    readonly playNumber: number;
    readonly line: number;
    readonly offense: TeamId;
    readonly liveTicks: number;
    readonly terminalCount: number;
    readonly contestUntil: number;
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
const distance = (a: Vector, b: Vector) => Math.hypot(a.x - b.x, a.y - b.y);
const player = (state: DownState, key: PlayerId) => state.players.find(p => p.id === key)!;
function formation(team: TeamId, line: number, playNumber: number, play: Play): DownState {
    const dir = direction(team), center = FIELD.width / 2;
    const players = createMatch().players.map(p => {
        const attacking = p.team === team;
        const offsets = attacking ? [0, -2, 0, 0, -1] : [7, 12, 16, 16, 20];
        const lanes = attacking ? [center, center, center - 26 / 3, center + 26 / 3, center + 5] : [center, center, center - 26 / 3, center + 26 / 3, center - 8];
        return { ...p, x: Math.max(FIELD.radius, Math.min(FIELD.length - FIELD.radius, line + dir * offsets[p.number - 1]!)), y: lanes[p.number - 1]!, human: p.number === 1 };
    });
    return { tick: 0, players, possession: { team, carrier: id(team, 1) }, offense: team, phase: 'pre-snap', play, playNumber, line, liveTicks: 0, terminalCount: 0, contestUntil: 0, defender: id(opposite(team), 1), ball: { kind: 'held' }, result: null };
}
export const createDown = (): DownState => formation('home', 38, 1, 'rush');
export const choosePlay = (state: DownState, play: Play): DownState => state.phase === 'pre-snap' ? { ...state, play } : state;
function controls(state: DownState): DownState {
    return { ...state, players: state.players.map(p => ({ ...p, human: p.id === state.possession.carrier || p.id === state.defender })) };
}
export function snap(state: DownState): DownState {
    if (state.phase !== 'pre-snap')
        return state;
    const carrier = id(state.offense, state.play === 'rush' ? 2 : 1), qb = player(state, id(state.offense, 1));
    return controls({ ...state, phase: 'live', possession: { team: state.offense, carrier }, players: state.players.map(p => p.id === carrier ? { ...p, x: qb.x, y: qb.y } : p) });
}
export function switchDefender(state: DownState, team = opposite(state.offense)): DownState {
    if (state.phase === 'dead' || team !== opposite(state.offense))
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
    return { x: state.line + dir * 22, y: state.play === 'slants' ? FIELD.width / 2 : FIELD.width / 2 + (p.number === 3 ? -26 / 3 : 26 / 3) };
}
export function throwPass(state: DownState, target: 1 | 2, team = state.offense): DownState {
    if (team !== state.offense || state.phase !== 'live' || state.play === 'rush' || state.ball.kind !== 'held' || state.possession.carrier !== id(state.offense, 1))
        return state;
    const receiver = player(state, id(state.offense, target + 2)), goal = route(state, receiver.id);
    const length = Math.max(1, distance(receiver, goal)), duration = 1;
    const lead = Math.min(length, (4 + receiver.abilities.speed / 20) * duration);
    const to = { x: receiver.x + (goal.x - receiver.x) / length * lead, y: receiver.y + (goal.y - receiver.y) / length * lead };
    const qb = player(state, state.possession.carrier);
    return { ...state, ball: { kind: 'flight', from: { x: qb.x, y: qb.y }, to, elapsed: 0, duration, target: receiver.id } };
}
function finish(state: DownState, reason: EndReason): DownState {
    if (state.phase !== 'live')
        return state;
    const carrier = player(state, state.possession.carrier);
    return { ...state, phase: 'dead', terminalCount: state.terminalCount + 1, ball: { kind: 'held' }, result: { playNumber: state.playNumber, reason, yards: reason === 'incomplete' || reason === 'interception' ? 0 : Math.round((carrier.x - state.line) * direction(state.offense) * 10) / 10, turnover: reason === 'interception' || reason === 'safety', touchdown: reason === 'touchdown' } };
}
export function nextDown(state: DownState): DownState {
    if (state.phase !== 'dead' || !state.result)
        return state;
    const team = state.result.turnover ? opposite(state.offense) : state.offense;
    const line = state.result.touchdown || state.result.reason === 'safety' ? (team === 'home' ? 38 : 82)
        : state.result.reason === 'incomplete' ? state.line : Math.max(12, Math.min(108, player(state, state.possession.carrier).x));
    return { ...formation(team, line, state.playNumber + 1, state.play), terminalCount: state.terminalCount };
}
export function stepDown(state: DownState, inputs: Inputs): DownState {
    if (state.phase !== 'live')
        return state;
    const carrier = player(state, state.possession.carrier), targets = new Map<PlayerId, Vector>();
    for (const p of state.players) {
        let target: Vector;
        if (p.team === state.offense)
            target = p.number === 3 || p.number === 4 ? route(state, p.id) : { x: carrier.x + direction(state.offense) * 3, y: carrier.y + (p.number === 5 ? 5 : -5) };
        else if (state.ball.kind === 'flight')
            target = state.ball.to;
        else if (state.play !== 'rush' && carrier.number === 1 && (p.number === 3 || p.number === 4)) {
            const receiver = player(state, id(state.offense, p.number));
            target = { x: receiver.x + direction(state.offense) * 5, y: receiver.y };
        }
        else
            target = carrier;
        targets.set(p.id, target);
    }
    let moved: DownState = { ...state, ...step(state, inputs, targets), liveTicks: state.liveTicks + 1 };
    if (state.ball.kind === 'flight') {
        const ball = { ...state.ball, elapsed: state.ball.elapsed + STEP_SECONDS };
        moved = { ...moved, ball };
        if (ball.elapsed + 1e-9 >= ball.duration) {
            if (ball.to.x < FIELD.radius || ball.to.x > FIELD.length - FIELD.radius || ball.to.y < FIELD.radius || ball.to.y > FIELD.width - FIELD.radius)
                return finish(moved, 'incomplete');
            // Position can break up a pass; an interception additionally needs hands.
            // AI contests when reachable. Human hands last 36 ticks and expire deterministically.
            const defenders = moved.players.filter(p => p.team !== state.offense && distance(p, ball.to) <= BREAKUP_RADIUS)
                .sort((a, b) => distance(a, ball.to) - distance(b, ball.to) || a.id.localeCompare(b.id));
            const interceptor = defenders.find(p => distance(p, ball.to) <= CATCH_RADIUS && (!p.human || state.contestUntil >= moved.tick));
            if (interceptor)
                return finish(controls({ ...moved, ball: { kind: 'held' }, possession: { team: interceptor.team, carrier: interceptor.id } }), 'interception');
            if (defenders.length)
                return finish(moved, 'incomplete');
            const receiver = player(moved, ball.target);
            if (distance(receiver, ball.to) > CATCH_RADIUS)
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
