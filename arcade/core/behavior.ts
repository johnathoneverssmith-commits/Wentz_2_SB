/**
 * What all 22 players do, every tick. A play gives each player an assignment (a route, a man to cover, a zone, a block); each tick
 * the engine reads the previous snapshot, picks a behavior for every player from the assignment and what the play has become (a
 * pocket pass, a scramble, a catch, a run), and returns where each one is heading. Nobody has a "finished" state: a receiver who
 * completes his route settles into open space or blocks; a lineman whose man is gone finds another; every defender pursues once
 * the ball is loose. Everything is a pure function of the snapshot, so the simulation stays deterministic.
 */
import { FIELD, STEP_SECONDS, maxSpeed, unit, type ArcadePlayer, type Behavior, type Intent, type PlayerId, type TeamId, type Vector } from './simulation';
import { codeOf, type Code } from './personnel';
import type { DownState, Play } from './down';

export const opposite = (team: TeamId): TeamId => team === 'home' ? 'away' : 'home';
export const direction = (team: TeamId) => team === 'home' ? 1 : -1;
export const CONTACT_RADIUS = FIELD.radius * 2;
export const CATCH_RADIUS = 1.6;
export const BREAKUP_RADIUS = 2.2;
/** Route depths in yards past the line of scrimmage for the two primary targets (WR1, WR2). */
export const ROUTE_DEPTH = { slants: { WR1: 10, WR2: 18 }, go: { WR1: 31, WR2: 34 } } as const;
/**
 * How far past the receiver's projected position the ball is thrown, as a multiple of the ground he will cover while it flies. 1 puts
 * the ball exactly where he will be (it used to be 1.2, which left every receiver 20% short of his own pass).
 */
export const PASS_LEAD = 1;
/** The ball's speed in yards per second: a pass is in the air for as long as its distance needs. */
export const BALL_SPEED = 26;
/** The shortest and longest time a pass is in the air, in seconds. The longest is also what a saved game may hold (see `browser/save.ts`). */
export const MIN_FLIGHT = 0.35;
export const MAX_FLIGHT = 2;
/** An offensive blocker this close to a defender has him engaged. */
export const BLOCK_RADIUS = 1.8;
/** An engaged defender, human or AI, moves at this fraction of his speed. */
export const BLOCK_SLOW = 0.35;
export const BLOCK_SHIELD = 1.2;
/** Ticks a block holds before the defender can get off it, for equally rated players. Ratings scale it. */
export const BLOCK_HOLD_TICKS = 60;
/** Run blocks do not hold as long as pass protection: the defender sheds to find the ball. */
export const RUN_HOLD_FACTOR = 0.9;
/** A defender who has just beaten a block cannot be engaged again for this long. */
export const SHED_FREE_TICKS = 50;
/** Missed-tackle stumble, in ticks. */
export const STUMBLE_TICKS = 24;
/** Yards a defense reads the play before committing to the run. */
export const READ_TICKS = 2;
/** The deep safety plays at least this deep, and stays `SAFETY_OVER_THE_TOP` yards over the deepest receiver who is running vertically. */
export const SAFETY_DEPTH = 22;
export const SAFETY_OVER_THE_TOP = 5;
export const POCKET_LATERAL = 9;

// ----- what a defender can see, and how long it takes him -----
// Coverage reacts to what is observable (where the receivers are and how they are moving, where the ball is going) and never to
// the call: a defender cannot know whether a receiver will run a go route or a slant until the receiver does it.
/** Seconds a defender takes to see his man change direction: his reading of the man's velocity catches up with the real one this slowly, so a cut costs him a step. */
export const READ_SECONDS = 0.15;
/** A defender aims where his man will be this many seconds from now, along the direction he reads. */
export const ANTICIPATE_SECONDS = 0.15;
/** The depth (yards past the line) a receiver must reach before his man starts to close the cushion, and the depth by which it is closed. */
export const MAN_COMMIT_FROM = 8;
export const MAN_COMMIT_TO = 18;
/** A corner plays off a faster receiver by more and a slower one by less, in proportion to the speed ratio, within these bounds (he respects a burner). */
export const RESPECT = { min: 0.85, max: 1.25 } as const;
/** Where a man defender plays a receiver who has gone deep, in yards downfield of him: negative is behind him. A corner who started ten yards off and is beaten by the stem turns and trails at the receiver's hip rather than staying in front, where he would be nearer every ball led to the receiver than the receiver is. */
export const MAN_STACK = -2.5;
/** Yards a man defender plays off a receiver who is shallow, about the depth he lines up at (9.7 yd), so he does not jump forward at the snap; the cushion closes to MAN_STACK as the receiver goes from MAN_COMMIT_FROM to MAN_COMMIT_TO yards deep. */
export const MAN_CUSHION = 10;
/** Yards a man defender plays to the inside of his receiver (toward the middle of the field), so the two run side by side instead of one standing in the other's lane. */
export const MAN_LEVERAGE = 1.2;
/** How much of his cushion a man defender gives up when his man breaks off the vertical stem: at a full sideways break he closes this share of it (route recognition). */
export const BREAK_CLOSE = 0.8;
/** The share of his speed a man defender has while backpedaling (going downfield with his man still behind him); once he has turned and is level or beaten he runs flat out. */
export const BACKPEDAL = 0.85;
/** Ticks a defender needs to see which way the ball is going before he breaks on it, when he is facing the quarterback (level with his man or in front of him): a quarter of a second, about a person's reaction to a release... */
export const BALL_READ_TICKS = 15;
/** ...and when he is behind his man, running with his back to the ball, so he has to turn and find it first. */
export const LOOK_BACK_TICKS = 21;
/** A defender who can reach the ball's landing point within this many seconds of its arrival goes for it. */
export const REACH_SLACK = 0.25;
/** Yards of the zone around its landmark inside which a defender picks up a receiver, and how far behind that receiver he plays (linebacker, strong safety, free safety). */
export const ZONE_RANGE = 6;
/** ...and how far from his landmark a defender follows the receiver assigned to him (a linebacker with the tight end). */
export const ZONE_TRACK = 10;
export const ZONE_CUSHION = { LB: 1, SS: 2.5, FS: 4 } as const;
/** A defender who can reach the landing point this many seconds before the ball arrives is on the ball (he can intercept it); otherwise he can only break the pass up. */
export const ON_BALL_MARGIN = 0.15;
/** Yards from the landing point an AI defender plays it from: on the ball (inside the interception radius), or beside it (inside the break-up circle only). */
export const ON_BALL_STANDOFF = 0.9;
export const BEHIND_STANDOFF = 1.9;
/**
 * Where an AI defender goes to play a thrown ball, on the side of the landing point he is coming from. One who can get there before the
 * ball does goes right to it, where he intercepts it; one who cannot gets close enough to break the catch up (the break-up circle is
 * wider than the interception circle) but is not on the ball. Human defenders intercept only with Hands.
 */
const contestPoint = (d: ArcadePlayer, to: Vector, secondsToArrival: number): Vector => {
    const away = unit({ x: d.x - to.x, y: d.y - to.y });
    const reach = Math.max(0, dist(d, to)) / maxSpeed(d) + 0.1;
    // a defender already standing on the spot stays there: the margin test compares time to arrive, and one who has arrived early must not
    // be pushed out of interception range as the ball comes down
    const onTheSpot = dist(d, to) <= ON_BALL_STANDOFF + 0.05;
    const standoff = onTheSpot || reach + ON_BALL_MARGIN <= secondsToArrival ? ON_BALL_STANDOFF : BEHIND_STANDOFF;
    return { x: to.x + away.x * standoff, y: to.y + away.y * standoff };
};
const dist = (a: Vector, b: Vector) => Math.hypot(a.x - b.x, a.y - b.y);
const CENTER = FIELD.width / 2;
export const clampField = (v: Vector): Vector => ({ x: Math.max(1.2, Math.min(FIELD.length - 1.2, v.x)), y: Math.max(1.2, Math.min(FIELD.width - 1.2, v.y)) });

export interface Plan {
    readonly players: ArcadePlayer[];
    readonly intents: Map<PlayerId, Intent>;
    readonly slow: Map<PlayerId, number>;
}
export type Mode = 'pocket' | 'air' | 'run';
/** What the play currently is: the quarterback behind a protected pocket, the ball in the air, or a runner with the ball. */
export function playMode(state: DownState): Mode {
    if (state.ball.kind === 'flight')
        return 'air';
    const carrier = state.players.find(p => p.id === state.possession.carrier)!;
    // a back with the ball (a handoff) is a run; so is a quarterback who has crossed the line or left the pocket (below)
    if (carrier.position !== 'QB' || state.possession.team !== state.offense)
        return 'run';
    const dir = direction(state.offense), progress = (carrier.x - state.line) * dir;
    const line = state.players.filter(p => p.team === state.offense && ['LT', 'LG', 'C', 'RG', 'RT'].includes(p.position));
    const mid = line.length ? line.reduce((s, p) => s + p.y, 0) / line.length : CENTER;
    return progress > 1.5 || Math.abs(carrier.y - mid) > POCKET_LATERAL ? 'run' : 'pocket';
}
const isLineman = (p: ArcadePlayer) => p.position === 'LT' || p.position === 'LG' || p.position === 'C' || p.position === 'RG' || p.position === 'RT';

// ---------- play setup: routes, coverage, zones ----------
const CODES_ROUTE_PASS: readonly Code[] = ['WR1', 'WR2', 'WR3', 'TE1', 'RB'];
function routeFor(play: Play, code: Code, p: ArcadePlayer, line: number, dir: number): Vector[] {
    const at = (depth: number, y: number): Vector => clampField({ x: Math.max(2, Math.min(FIELD.length - 2, line + dir * depth)), y });
    const side = p.y < CENTER ? -1 : 1;
    if (play === 'slants') {
        if (code === 'WR1') return [at(3, p.y), at(ROUTE_DEPTH.slants.WR1, p.y - side * 12)];
        if (code === 'WR2') return [at(3, p.y), at(ROUTE_DEPTH.slants.WR2, p.y - side * 12)];
        if (code === 'WR3') return [at(7, p.y), at(8, p.y - side * 5)];
        if (code === 'TE1') return [at(2, p.y), at(4, p.y + 7)];
        return [at(1.5, p.y + 6), at(2, p.y + 10)];
    }
    if (code === 'WR1') return [at(ROUTE_DEPTH.go.WR1, p.y)];
    if (code === 'WR2') return [at(ROUTE_DEPTH.go.WR2, p.y)];
    if (code === 'WR3') return [at(8, p.y), at(20, p.y + 11)];
    if (code === 'TE1') return [at(14, p.y)];
    return [at(1.5, p.y + 6), at(2, p.y + 10)];
}
/** Gives every player his assignment for this play and sets his starting behavior. */
export function assignPlay(state: DownState): ArcadePlayer[] {
    const dir = direction(state.offense), line = state.line, passing = state.play === 'slants' || state.play === 'go';
    const offense = state.players.filter(p => p.team === state.offense), defense = state.players.filter(p => p.team !== state.offense);
    const by = (list: ArcadePlayer[], code: Code) => list.find(p => codeOf(p.id) === code);
    const next = new Map<PlayerId, Partial<ArcadePlayer>>();
    const set = (p: ArcadePlayer, behavior: Behavior, assign: ArcadePlayer['assign'] = null) => next.set(p.id, { behavior, assign, lock: null, stun: 0, free: 0, vx: 0, vy: 0, read: null });
    const receivers = offense.filter(p => passing && (CODES_ROUTE_PASS as readonly string[]).includes(codeOf(p.id)));
    for (const p of offense) {
        const code = codeOf(p.id);
        if (p.id === state.possession.carrier) { set(p, 'carry'); continue; }
        if (receivers.includes(p)) { set(p, 'route', { points: routeFor(state.play, code, p, line, dir), index: 0 }); continue; }
        if (isLineman(p) || code === 'FB' || code === 'TE2' || code === 'TE1' || (code === 'RB')) { set(p, passing ? 'passBlock' : 'runBlock'); continue; }
        // The quarterback drops straight back on a pass, and steps aside after handing off so the runner has the lane.
        if (code === 'QB') { set(p, 'dropback', { spot: passing ? clampField({ x: line - dir * Math.max(3.5, (line - p.x) * dir), y: p.y }) : clampField({ x: line - dir * 2.5, y: p.y + 5 }) }); continue; }
        set(p, passing ? 'route' : 'downfieldBlock', passing ? { points: routeFor(state.play, code, p, line, dir), index: 0 } : null);
    }
    // Defense: man on the wideouts, shaded underneath on the tight ends and back, zones for the rest.
    const wr = offense.filter(p => p.position === 'WR').sort((a, b) => a.y - b.y), te = offense.filter(p => p.position === 'TE').sort((a, b) => a.y - b.y);
    const back = offense.find(p => p.position === 'RB');
    const cbs = defense.filter(p => p.position === 'CB').sort((a, b) => a.y - b.y);
    for (const d of defense) {
        const code = codeOf(d.id);
        if (d.position === 'DE' || d.position === 'DT') { set(d, 'rush', { spot: { x: line + dir * 0.5, y: d.y } }); continue; }
        if (d.position === 'CB') {
            const mine = wr.length ? wr.reduce((best, w) => Math.abs(w.y - d.y) < Math.abs(best.y - d.y) ? w : best, wr[0]!) : undefined;
            set(d, 'man', { target: mine?.id }); continue;
        }
        if (d.position === 'FS') { set(d, 'zone', { spot: clampField({ x: line + dir * SAFETY_DEPTH, y: CENTER - 5 }) }); continue; }
        if (d.position === 'SS') { set(d, 'zone', { spot: clampField({ x: line + dir * 12, y: CENTER + 6 }) }); continue; }
        if (d.position === 'MLB') { set(d, 'zone', { spot: clampField({ x: line + dir * 8, y: CENTER }), target: back?.id }); continue; }
        // outside linebackers: cover the tight end on their side (or drop to a hook zone)
        const mate = te.length ? te.reduce((best, t) => Math.abs(t.y - d.y) < Math.abs(best.y - d.y) ? t : best, te[0]!) : undefined;
        set(d, 'zone', { spot: clampField({ x: line + dir * 7.5, y: d.y + (d.y < CENTER ? 1 : -1) * 0 }), target: mate && Math.abs(mate.y - d.y) < 9 ? mate.id : undefined });
        void code; void cbs;
    }
    return state.players.map(p => ({ ...p, ...(next.get(p.id) ?? {}) }));
}

// ---------- the per-tick plan ----------
function pointAlong(points: readonly Vector[], from: Vector, index: number, length: number): Vector {
    let cur = from, left = length;
    for (let i = index; i < points.length; i++) {
        const seg = dist(cur, points[i]!);
        if (seg >= left) return { x: cur.x + (points[i]!.x - cur.x) / (seg || 1) * left, y: cur.y + (points[i]!.y - cur.y) / (seg || 1) * left };
        left -= seg; cur = points[i]!;
    }
    return cur;
}
export { pointAlong };
/** Where to run to catch a runner: his position plus where he will be by the time we arrive (capped, so nobody chases a ghost). */
function intercept(d: ArcadePlayer, target: ArcadePlayer): Vector {
    const t = Math.min(0.9, dist(d, target) / Math.max(1, maxSpeed(d)));
    return clampField({ x: target.x + target.vx * t, y: target.y + target.vy * t });
}
const nearest = <T extends Vector>(from: Vector, list: readonly T[]): T | undefined => list.reduce<T | undefined>((best, p) => !best || dist(from, p) < dist(from, best) ? p : best, undefined);

/** Greedy nearest-pair assignment, stable under ties (by id), so every tick yields the same answer. */
function match(blockers: readonly ArcadePlayer[], threats: readonly ArcadePlayer[]): Map<PlayerId, ArcadePlayer> {
    const pairs: { b: ArcadePlayer; t: ArcadePlayer; d: number }[] = [];
    for (const b of blockers) for (const t of threats) pairs.push({ b, t, d: dist(b, t) });
    pairs.sort((x, y) => x.d - y.d || x.b.id.localeCompare(y.b.id) || x.t.id.localeCompare(y.t.id));
    const out = new Map<PlayerId, ArcadePlayer>(), taken = new Set<PlayerId>();
    for (const { b, t } of pairs) if (!out.has(b.id) && !taken.has(t.id)) { out.set(b.id, t); taken.add(t.id); }
    return out;
}
/** How long a block holds, in ticks: stronger, better-rated blockers hold longer against weaker rushers. */
export function holdTicks(blocker: ArcadePlayer, defender: ArcadePlayer, mode: Mode): number {
    const attack = (blocker.abilities.block + blocker.abilities.strength) / (defender.abilities.strength + (mode === 'pocket' ? defender.abilities.passRush : defender.abilities.tackle));
    // A human-controlled defender works free twice as fast: he should never feel pinned for a whole play.
    return Math.max(30, Math.min(300, Math.round(BLOCK_HOLD_TICKS * attack * 1.35 * (defender.human ? 0.5 : 1) * (mode === 'pocket' ? 1 : RUN_HOLD_FACTOR))));
}
/** Drops finished or broken locks and creates new ones where a blocker has reached a defender who is not free. */
type Mut<T> = { -readonly [K in keyof T]: T[K] };
function updateLocks(state: DownState, mode: Mode): ArcadePlayer[] {
    const ps: Mut<ArcadePlayer>[] = state.players.map(p => ({ ...p }));
    const byId = new Map(ps.map(p => [p.id, p] as const));
    for (const p of ps) {
        if (!p.lock) continue;
        const other = byId.get(p.lock.with);
        const blocker = p.team === state.offense ? p : other, defender = p.team === state.offense ? other : p;
        if (!other || !blocker || !defender || other.lock?.with !== p.id || dist(p, other) > BLOCK_RADIUS + 1.2 || state.tick - p.lock.since >= holdTicks(blocker, defender, mode)) {
            const shed = other && blocker && defender && state.tick - p.lock.since >= holdTicks(blocker, defender, mode);
            p.lock = null;
            if (shed && p.team !== state.offense) p.free = SHED_FREE_TICKS;
        }
    }
    const blockers = ps.filter(p => p.team === state.offense && !p.lock && !p.human && (p.behavior === 'passBlock' || p.behavior === 'runBlock' || p.behavior === 'downfieldBlock'));
    const defenders = ps.filter(p => p.team !== state.offense && !p.lock && p.free === 0 && p.stun === 0);
    const pairs: { b: Mut<ArcadePlayer>; d: Mut<ArcadePlayer>; k: number }[] = [];
    for (const b of blockers) for (const d of defenders) { const k = dist(b, d); if (k <= BLOCK_RADIUS) pairs.push({ b, d, k }); }
    pairs.sort((x, y) => x.k - y.k || x.b.id.localeCompare(y.b.id) || x.d.id.localeCompare(y.d.id));
    for (const { b, d } of pairs) if (!b.lock && !d.lock) { b.lock = { with: d.id, since: state.tick }; d.lock = { with: b.id, since: state.tick }; }
    return ps;
}

/** The whole tick's plan: every player's behavior and destination, from the previous snapshot only. */
export function planTick(state: DownState): Plan {
    const mode = playMode(state), dir = direction(state.offense), line = state.line;
    const players = updateLocks(state, mode);
    const carrier = players.find(p => p.id === state.possession.carrier)!;
    const offense = players.filter(p => p.team === state.offense), defense = players.filter(p => p.team !== state.offense);
    const intents = new Map<PlayerId, Intent>(), slow = new Map<PlayerId, number>();
    const setIntent = (p: ArcadePlayer, behavior: Behavior, to: Vector | null, speed = 1) => { const i = players.findIndex(q => q.id === p.id); players[i] = { ...players[i]!, behavior }; intents.set(p.id, { to: to ? clampField(to) : null, speed }); };
    const qb = players.find(p => p.team === state.offense && p.position === 'QB')!;
    const passing = state.play === 'slants' || state.play === 'go';
    const tickIn = state.liveTicks;
    const flight = state.ball.kind === 'flight' ? state.ball : null;
    const lineOf = offense.filter(isLineman);
    // ----- blocks: who each unlocked blocker is heading for -----
    const rushers = defense.filter(d => d.position === 'DE' || d.position === 'DT' || (mode !== 'run' && d.behavior === 'rush'));
    const blockers = offense.filter(p => !p.human && p.id !== carrier.id && (p.behavior === 'passBlock' || p.behavior === 'runBlock' || p.behavior === 'downfieldBlock'));
    const lockedPartner = (p: ArcadePlayer) => p.lock ? players.find(q => q.id === p.lock!.with) : undefined;
    const free = blockers.filter(b => !b.lock);
    let threats: ArcadePlayer[];
    if (mode === 'pocket') threats = rushers.filter(d => !d.lock && d.free === 0);
    else threats = defense.filter(d => !d.lock && d.free === 0 && dist(d, carrier) < 30);
    const assigned = match(free, threats);
    for (const p of offense) {
        if (p.human || p.id === carrier.id) continue;
        const code = codeOf(p.id);
        // --- blockers ---
        if (p.behavior === 'passBlock' || p.behavior === 'runBlock' || p.behavior === 'downfieldBlock') {
            const partner = lockedPartner(p);
            const kind: Behavior = mode === 'pocket' && passing ? 'passBlock' : mode === 'pocket' ? 'runBlock' : (lineOf.includes(p) && (p.x - line) * dir < 8 ? 'runBlock' : 'downfieldBlock');
            if (partner) { setIntent(p, kind, null); continue; }
            const t = assigned.get(p.id);
            if (t) {
                if (mode === 'pocket') {
                    const guard = { x: t.x - dir * 0, y: t.y }, to = unit({ x: qb.x - guard.x, y: qb.y - guard.y });
                    setIntent(p, kind, { x: guard.x + to.x * BLOCK_SHIELD, y: guard.y + to.y * BLOCK_SHIELD });
                }
                else setIntent(p, kind, { x: t.x - dir * 0.6, y: t.y });
                continue;
            }
            // nobody left to block: help the pocket, or move toward the ball carrier's defenders
            if (mode === 'pocket') setIntent(p, 'passBlock', { x: qb.x + dir * 1.2, y: p.y + (qb.y - p.y) * 0.5 }, 0.8);
            else {
                const threat = nearest(carrier, defense.filter(d => d.free === 0));
                setIntent(p, kind, threat ? { x: threat.x - dir * 0.6, y: threat.y } : { x: carrier.x + dir * 3, y: carrier.y }, 1);
            }
            continue;
        }
        if (p.behavior === 'dropback') {
            // the quarterback who is not a human: take the drop and hold, then drift with the pocket
            const spot = p.assign?.spot ?? p;
            if (dist(p, spot) >= 0.6) { setIntent(p, 'dropback', spot, 0.9); continue; }
            // Hold the spot, then follow the play at a distance (a quarterback who has handed off trails the runner as an extra blocker).
            const trail = mode === 'run' ? { x: carrier.x - dir * 5, y: carrier.y + (p.y < carrier.y ? -2 : 2) } : { x: p.x + Math.sin(tickIn / 25 + p.y) * 0.8, y: p.y };
            setIntent(p, mode === 'run' ? 'settle' : 'dropback', trail, mode === 'run' ? 0.8 : 0.4);
            continue;
        }
        if (p.behavior === 'route' || p.behavior === 'settle') {
            const pts = p.assign?.points ?? [], idx = p.assign?.index ?? 0;
            // a receiver whose quarterback has scrambled past the line, or whose teammate has the ball, becomes a blocker (one who has already settled too:
            // a settled receiver still has his route points; the trailing quarterback, who has none, stays as he is)
            if (mode === 'run' && idx >= pts.length && (p.behavior === 'route' || (p.behavior === 'settle' && pts.length > 0))) { const t = nearest(carrier, defense); setIntent(p, 'downfieldBlock', t ? { x: t.x - dir * 0.6, y: t.y } : carrier); continue; }
            if (idx < pts.length) {
                const goal = pts[idx]!;
                const reached = dist(p, goal) < 1.2;
                const at = players.findIndex(q => q.id === p.id);
                if (reached) players[at] = { ...players[at]!, assign: { ...p.assign, index: idx + 1 } };
                setIntent(p, 'route', goal, 1);
                continue;
            }
            // route done: settle into open space (keeps moving, away from the nearest defender, toward the ball)
            const d = nearest(p, defense);
            const away = d ? unit({ x: p.x - d.x, y: p.y - d.y }) : { x: 0, y: 0 };
            const toBall = unit({ x: carrier.x - p.x, y: carrier.y - p.y });
            const drift = mode === 'run' ? { x: toBall.x, y: toBall.y } : { x: away.x * 0.8 + toBall.x * 0.3, y: away.y * 0.8 + toBall.y * 0.3 };
            setIntent(p, 'settle', { x: p.x + drift.x * 4, y: p.y + drift.y * 4 }, 0.7);
            continue;
        }
        if (code === 'QB') { setIntent(p, 'settle', null); continue; }
        setIntent(p, 'settle', { x: carrier.x + dir * 3, y: carrier.y }, 0.8);
    }
    // ----- defense -----
    // Nothing below reads the play call. A defender sees where the receivers are and how they are moving (through a short reading
    // delay, so a change of direction costs him a step), where the ball is going once it is thrown, and who has it.
    const receivers = offense.filter(p => p.position === 'WR' || p.position === 'TE' || p.position === 'RB');
    /** The velocity this defender believes his man has: his last reading, moved toward the real one. */
    const reading = (d: ArcadePlayer, man: ArcadePlayer): Vector => {
        const was = d.read ?? { x: man.vx, y: man.vy }, k = STEP_SECONDS / READ_SECONDS;
        return { x: was.x + (man.vx - was.x) * k, y: was.y + (man.vy - was.y) * k };
    };
    const remember = (d: ArcadePlayer, v: Vector) => { const i = players.findIndex(q => q.id === d.id); players[i] = { ...players[i]!, read: v }; };
    /** Receivers running downfield at pace: what a deep safety has to stay over the top of. */
    const vertical = receivers.filter(r => (r.x - line) * dir > 4 && r.vx * dir > 0.6 * maxSpeed(r));
    const deepest = vertical.reduce<ArcadePlayer | undefined>((a, b) => !a || (b.x - line) * dir > (a.x - line) * dir ? b : a, undefined);
    const landmark = (d: ArcadePlayer): Vector => {
        const base = d.assign?.spot ?? d;
        if (d.position !== 'FS' || !deepest) return base;
        return { x: line + dir * Math.max((base.x - line) * dir, (deepest.x - line) * dir + SAFETY_OVER_THE_TOP), y: vertical.reduce((s, r) => s + r.y, 0) / vertical.length };
    };
    /** Plays his man (man coverage) or the receiver in his zone, as the receiver is seen to move. */
    const cover = (d: ArcadePlayer) => {
        const mine = d.assign?.target ? players.find(p => p.id === d.assign!.target) : undefined;
        if ((d.behavior === 'man' || d.position === 'CB') && mine) {
            const v = reading(d, mine), s = Math.min(1, Math.hypot(v.x, v.y) / maxSpeed(mine));
            remember(d, v);
            // He keeps his cushion while the receiver is shallow and closes it as the receiver goes deep: an underneath route can beat him, a deep one cannot.
            const committed = Math.max(0, Math.min(1, ((mine.x - line) * dir - MAN_COMMIT_FROM) / (MAN_COMMIT_TO - MAN_COMMIT_FROM)));
            // And he attacks a receiver who breaks off the stem: the more of his velocity (as he reads it) is sideways, the more of the cushion he closes.
            const speedRead = Math.hypot(v.x, v.y), sideways = speedRead > 1 ? Math.abs(v.y) / speedRead : 0;
            const respect = Math.max(RESPECT.min, Math.min(RESPECT.max, maxSpeed(mine) / maxSpeed(d)));
            const cushion = (MAN_CUSHION * respect + (MAN_STACK - MAN_CUSHION * respect) * committed) * (1 - BREAK_CLOSE * sideways);
            const to = { x: mine.x + v.x * ANTICIPATE_SECONDS + dir * cushion, y: mine.y + v.y * ANTICIPATE_SECONDS + (mine.y < CENTER ? 1 : -1) * MAN_LEVERAGE * s * committed };
            const backpedaling = (d.x - mine.x) * dir > 0.5 && (to.x - d.x) * dir > 0;
            setIntent(d, 'man', to, backpedaling ? BACKPEDAL : 1);
            return;
        }
        const spot = landmark(d), assigned = d.assign?.target ? receivers.find(r => r.id === d.assign!.target) : undefined;
        // a zone defender with a receiver assigned to him follows that receiver while he is anywhere near his area; otherwise he picks up whoever enters it
        const intruder = assigned && dist(assigned, spot) < ZONE_TRACK && (assigned.x - line) * dir > 0 ? assigned : nearest(spot, receivers.filter(r => dist(r, spot) < ZONE_RANGE && (r.x - line) * dir > 1));
        if (intruder) {
            const v = reading(d, intruder), cushion = d.position === 'FS' ? ZONE_CUSHION.FS : d.position === 'SS' ? ZONE_CUSHION.SS : ZONE_CUSHION.LB;
            remember(d, v);
            setIntent(d, 'zone', { x: intruder.x + v.x * ANTICIPATE_SECONDS + dir * cushion, y: intruder.y + v.y * ANTICIPATE_SECONDS }, 0.95);
            return;
        }
        // A zone is not a statue: the defender shades toward the quarterback's side and works within his area (by depth along the play, so a mirrored play moves the same way).
        const sway = { x: spot.x + dir * Math.sin(tickIn / 30 + d.y) * 0.9, y: spot.y + (qb.y - CENTER) * 0.25 + Math.cos(tickIn / 37 + (d.x - line) * dir) * 0.7 };
        setIntent(d, 'zone', sway, 0.85);
    };
    for (const d of defense) {
        // A blocked defender is slowed whoever steers him: the slowdown applies to a human-controlled defender too.
        const partner = lockedPartner(d);
        if (partner) slow.set(d.id, BLOCK_SLOW);
        if (d.human) continue;
        if (mode === 'run') {
            // everyone pursues the ball; the secondary keeps outside leverage a beat, then closes (once the ball is seen to be in a back's hands)
            const delay = carrier.position !== 'QB' && tickIn < READ_TICKS && d.position !== 'DE' && d.position !== 'DT';
            if (delay) setIntent(d, 'runFit', { x: line + dir * 3, y: d.y + (carrier.y - d.y) * 0.3 }, 0.9);
            else setIntent(d, 'pursue', intercept(d, carrier), 1);
            continue;
        }
        if (d.behavior === 'rush' || d.position === 'DE' || d.position === 'DT') { setIntent(d, 'rush', mode === 'air' ? { x: flight!.to.x, y: flight!.to.y } : { x: qb.x, y: qb.y }, mode === 'air' ? 0.8 : 1); continue; }
        if (mode === 'air') {
            // The ball is in the air: whoever is covering the target goes for it, and so does anyone who can get there before it lands.
            const f = flight!, elapsed = f.elapsed * 60, remaining = f.duration - f.elapsed;
            const covering = d.assign?.target === f.target, contest = contestPoint(d, f.to, remaining);
            const reach = Math.max(0, dist(d, contest) - 0.5) / maxSpeed(d) + 0.15;
            // a defender behind the man he is covering is running with his back to the ball and takes longer to find it
            const mine = d.assign?.target ? players.find(p => p.id === d.assign!.target) : undefined;
            const read = mine && (d.x - mine.x) * dir < -0.25 ? LOOK_BACK_TICKS : BALL_READ_TICKS;
            if (elapsed >= read - 1e-9 && (covering || reach <= remaining + REACH_SLACK)) { setIntent(d, 'pursue', contest, 1); continue; }
        }
        cover(d);
    }
    return { players, intents, slow };
}

/**
 * After everyone has moved: a locked pair stays together. The blocker follows the defender (and drives him along the blocker's
 * push direction), so a block has a visible physical effect: the rusher is held up, and a run blocker walls the defender off.
 */
export function resolveLocks(players: ArcadePlayer[], state: DownState, mode: Mode): ArcadePlayer[] {
    const dir = direction(state.offense), out = players.slice();
    const idx = new Map(out.map((p, i) => [p.id, i] as const));
    const carrier = out[idx.get(state.possession.carrier) ?? 0]!;
    for (const d of players) {
        if (d.team === state.offense || !d.lock)
            continue;
        const bi = idx.get(d.lock.with), di = idx.get(d.id);
        if (bi === undefined || di === undefined)
            continue;
        const b = out[bi]!, def = out[di]!;
        // A pass block gives ground slowly. A run block walks the defender downfield and seals him away from the runner's lane,
        // which is what opens a hole.
        let pushX: number, pushY: number;
        if (mode === 'pocket') { pushX = dir * 0.55; pushY = 0; }
        else {
            const side = def.y === carrier.y ? 1 : Math.sign(def.y - carrier.y);
            pushX = dir * 0.5; pushY = side * 1.0;
        }
        const nd = clampField({ x: def.x + pushX / 60, y: def.y + pushY / 60 });
        const away = unit({ x: b.x - nd.x, y: b.y - nd.y });
        out[di] = { ...def, x: nd.x, y: nd.y };
        const cap = Math.min(1, maxSpeed(b) / Math.max(1e-9, Math.hypot(def.vx, def.vy)));
        // The blocker is placed beside the defender, who is already on the field; keep him on it too (a sideline drag would put him outside).
        const bp = clampField({ x: nd.x + (away.x || -dir) * 1.15, y: nd.y + away.y * 1.15 });
        out[bi] = { ...b, x: bp.x, y: bp.y, vx: def.vx * cap, vy: def.vy * cap };
    }
    return out;
}
