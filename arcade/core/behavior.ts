/**
 * What all 22 players do, every tick. A play gives each player an assignment (a route, a man to cover, a zone, a block); each tick
 * the engine reads the previous snapshot, picks a behavior for every player from the assignment and what the play has become (a
 * pocket pass, a scramble, a catch, a run), and returns where each one is heading. Nobody has a "finished" state: a receiver who
 * completes his route settles into open space or blocks; a lineman whose man is gone finds another; every defender pursues once
 * the ball is loose. Everything is a pure function of the snapshot, so the simulation stays deterministic.
 */
import { FIELD, maxSpeed, unit, type ArcadePlayer, type Behavior, type Intent, type PlayerId, type TeamId, type Vector } from './simulation';
import { codeOf, type Code } from './personnel';
import type { DownState, Play } from './down';

export const opposite = (team: TeamId): TeamId => team === 'home' ? 'away' : 'home';
export const direction = (team: TeamId) => team === 'home' ? 1 : -1;
export const CONTACT_RADIUS = FIELD.radius * 2;
export const CATCH_RADIUS = 1.6;
export const BREAKUP_RADIUS = 2.2;
/** A covering defender holds his coverage this many ticks into a throw before breaking on the ball. */
export const REACT_TICKS = 18;
/** Route depths in yards past the line of scrimmage for the two primary targets (WR1, WR2). */
export const ROUTE_DEPTH = { slants: { WR1: 10, WR2: 18 }, go: { WR1: 31, WR2: 34 } } as const;
export const PASS_LEAD = 1.2;
/** Man coverage sits this far ahead of the receiver (go routes: trailing, close). */
export const COVER_CUSHION = 7;
export const GO_CUSHION = 0;
export const GO_REACT_TICKS = 36;
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
/** The deep safety plays this deep, and breaks on deep balls (see Milestone 4). */
export const SAFETY_DEPTH = 22;
export const SAFETY_ZONE = 20;
export const SAFETY_REACT_TICKS = 24;
export const ZONE_BREAK_RANGE = 5.5;
export const POCKET_LATERAL = 9;

/** Where a covering defender stands: `cushion` yards deeper than his man; on a go route he runs with him, shaded to the outside so the two bodies do not collide. */
/** A defender reads his man a moment late (MAN_LAG seconds behind), so a sharp cut leaves a step of separation. */
export const MAN_LAG = 0.5;
/** On a vertical route the defender runs stride for stride with his man and loses almost nothing. */
export const GO_LAG = 0.1;
const manSpot = (mine: ArcadePlayer, dir: number, cushion: number, trailing: boolean): Vector => ({ x: mine.x - mine.vx * (trailing ? GO_LAG : MAN_LAG) + dir * cushion, y: mine.y - mine.vy * (trailing ? GO_LAG : MAN_LAG) + (trailing ? (mine.y < FIELD.width / 2 ? -1 : 1) * 1.3 : 0) });
/**
 * Where an AI defender goes to play a thrown ball: to the side of the landing point he is coming from, close enough to break the catch up
 * (inside the break-up circle) but, unless he is a deep safety with his eyes on the quarterback, not on the ball itself. Intercepting
 * is for a defender who is truly on the ball: a safety, or a human who has pressed Hands.
 */
const contestPoint = (d: ArcadePlayer, to: Vector, covering: boolean): Vector => {
    const away = unit({ x: d.x - to.x, y: d.y - to.y });
    const standoff = covering || d.position === 'FS' || d.position === 'SS' ? 1.35 : 1.9;
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
    if (state.play === 'rush' || carrier.position !== 'QB' || state.possession.team !== state.offense)
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
    const set = (p: ArcadePlayer, behavior: Behavior, assign: ArcadePlayer['assign'] = null) => next.set(p.id, { behavior, assign, lock: null, stun: 0, free: 0, vx: 0, vy: 0 });
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
    for (const d of defense) {
        // A blocked defender is slowed whoever steers him: the slowdown applies to a human-controlled defender too.
        const partner = lockedPartner(d);
        if (partner) slow.set(d.id, BLOCK_SLOW);
        if (d.human) continue;
        const toQB = qb;
        if (mode === 'run') {
            // everyone pursues the ball; the secondary keeps outside leverage a beat, then closes
            const delay = state.play === 'rush' && tickIn < READ_TICKS && d.position !== 'DE' && d.position !== 'DT';
            if (delay) setIntent(d, 'runFit', { x: line + dir * 3, y: d.y + (carrier.y - d.y) * 0.3 }, 0.9);
            else setIntent(d, 'pursue', intercept(d, carrier), 1);
            continue;
        }
        if (mode === 'pocket') {
            if (d.behavior === 'rush' || d.position === 'DE' || d.position === 'DT') { setIntent(d, 'rush', { x: toQB.x, y: toQB.y }, 1); continue; }
            if (d.behavior === 'man' || d.position === 'CB') {
                const mine = d.assign?.target ? players.find(p => p.id === d.assign!.target) : undefined;
                const cushion = state.play === 'go' ? GO_CUSHION : COVER_CUSHION;
                if (mine) setIntent(d, 'man', manSpot(mine, dir, cushion, state.play === 'go'), 1);
                else setIntent(d, 'zone', d.assign?.spot ?? d, 0.8);
                continue;
            }
            // zone defenders drop to their landmark and play the receiver who enters it
            const spot = d.assign?.spot ?? d;
            const intruder = nearest(spot, offense.filter(p => (p.position === 'WR' || p.position === 'TE' || p.position === 'RB') && dist(p, spot) < 6 && (p.x - line) * dir > 2));
            // A zone is not a statue: the defender shades toward the quarterback's side and works within his area.
            const sway = { x: spot.x + Math.sin(tickIn / 30 + d.y) * 0.9, y: spot.y + (toQB.y - CENTER) * 0.25 + Math.cos(tickIn / 37 + d.x) * 0.7 };
            if (d.position === 'FS' || d.position === 'SS') setIntent(d, 'zone', intruder ? { x: intruder.x + dir * 4, y: intruder.y } : sway, 0.85);
            else setIntent(d, 'zone', intruder ? { x: intruder.x + dir * 2.5, y: intruder.y } : sway, 0.85);
            continue;
        }
        // the ball is in the air
        const f = flight!, elapsed = f.elapsed * 60, to = f.to, targetPlayer = players.find(q => q.id === f.target)!;
        const react = state.play === 'go' ? GO_REACT_TICKS : REACT_TICKS;
        const deepBall = Math.abs(to.x - line) >= SAFETY_ZONE;
        if (d.position === 'FS' || d.position === 'SS') {
            if (deepBall && elapsed >= SAFETY_REACT_TICKS - 1e-9 || !deepBall && elapsed >= react - 1e-9 && dist(d, to) < 13) setIntent(d, 'pursue', contestPoint(d, to, d.assign?.target === f.target), 1);
            else setIntent(d, 'zone', d.assign?.spot ?? d, 0.9);
            continue;
        }
        const isTargetCover = d.assign?.target === f.target;
        if (isTargetCover && elapsed >= react - 1e-9) { setIntent(d, 'pursue', contestPoint(d, to, d.assign?.target === f.target), 1); continue; }
        if (d.position === 'CB' && elapsed >= react - 1e-9 && dist(d, to) < ZONE_BREAK_RANGE) { setIntent(d, 'pursue', contestPoint(d, to, d.assign?.target === f.target), 1); continue; }
        if ((d.position === 'OLB' || d.position === 'MLB') && elapsed >= REACT_TICKS - 1e-9 && dist(d, to) < ZONE_BREAK_RANGE) { setIntent(d, 'pursue', contestPoint(d, to, d.assign?.target === f.target), 1); continue; }
        if (d.position === 'DE' || d.position === 'DT') { setIntent(d, 'rush', { x: to.x, y: to.y }, 0.8); continue; }
        if (d.behavior === 'man' && d.assign?.target) {
            const mine = players.find(p => p.id === d.assign!.target);
            if (mine) { setIntent(d, 'man', manSpot(mine, dir, state.play === 'go' ? GO_CUSHION : COVER_CUSHION, state.play === 'go'), 1); continue; }
        }
        setIntent(d, 'zone', d.assign?.spot ?? d, 0.85);
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
