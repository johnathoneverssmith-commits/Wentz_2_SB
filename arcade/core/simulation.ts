/** Browser-free movement for 22 players. World coordinates and speeds use yards and seconds. */
import type { Pos } from './personnel';

export type TeamId = "home" | "away";
export type PlayerId = `${TeamId}-${string}`;
export interface Vector {
    readonly x: number;
    readonly y: number;
}
/** 0-99 ratings. Milestone 5B gives every player his position's average; 5C fills them from the franchise schema. */
export interface Abilities {
    readonly speed: number;
    readonly accel: number;
    readonly strength: number;
    readonly agility: number;
    readonly awareness: number;
    readonly block: number;
    readonly passRush: number;
    readonly tackle: number;
    readonly coverage: number;
    readonly hands: number;
    readonly throwing: number;
}
export type Behavior = 'stance' | 'route' | 'settle' | 'passBlock' | 'runBlock' | 'downfieldBlock' | 'carry' | 'dropback' | 'rush' | 'runFit' | 'man' | 'zone' | 'pursue' | 'contain' | 'stumble';
/** What a player has been told to do on this play (all serializable, so a saved play resumes exactly). */
export interface Assignment {
    /** Route waypoints in world coordinates, and how many have been reached. */
    readonly points?: readonly Vector[];
    readonly index?: number;
    /** The opponent to cover or block. */
    readonly target?: PlayerId;
    /** A zone landmark or gap to hold. */
    readonly spot?: Vector;
}
export interface Lock {
    readonly with: PlayerId;
    readonly since: number;
}
export interface ArcadePlayer extends Vector {
    readonly id: PlayerId;
    readonly team: TeamId;
    /** Jersey number. */
    readonly number: number;
    readonly position: Pos;
    readonly human: boolean;
    readonly abilities: Abilities;
    readonly vx: number;
    readonly vy: number;
    readonly behavior: Behavior;
    readonly assign: Assignment | null;
    /** Blocked by (or blocking) this player since this tick. */
    readonly lock: Lock | null;
    /** Ticks left of a stumble after a missed tackle: slowed, and unable to tackle. */
    readonly stun: number;
    /** Ticks during which a defender who has just shed a block cannot be engaged again. */
    readonly free: number;
}
export interface Inputs {
    readonly home: Vector;
    readonly away: Vector;
}
export interface MatchSnapshot {
    readonly tick: number;
    readonly players: readonly ArcadePlayer[];
    readonly possession: {
        readonly team: TeamId;
        readonly carrier: PlayerId;
    };
}
export const STEP_SECONDS = 1 / 60;
export const FIELD = { length: 120, width: 53.3333333333, endZone: 10, radius: 0.9 } as const;
/** Time for a player to reach full speed from rest. */
export const ACCEL_SECONDS = 0.22;
/** Closer than this, two players push each other apart. */
export const BODY = FIELD.radius * 2 * 0.92;
export const maxSpeed = (p: ArcadePlayer): number => 4 + p.abilities.speed / 20;
/** How fast a player's speed can rise, in yards per second per second (the same ramp `advance` applies each tick). */
export const accelerationOf = (p: ArcadePlayer): number => maxSpeed(p) / ACCEL_SECONDS * (0.6 + p.abilities.accel / 150);
/**
 * How far a player runs in `seconds` heading in one direction at full effort, from the speed he has now: he accelerates at his own rate
 * to his top speed and then holds it. This is the ground `advance` covers for a runner who is not blocked, so a pass led by it arrives
 * where the receiver is.
 */
export function distanceCovered(p: ArcadePlayer, seconds: number): number {
    const top = maxSpeed(p), now = Math.min(top, Math.hypot(p.vx, p.vy)), a = accelerationOf(p), toTop = (top - now) / a;
    if (seconds <= toTop) return now * seconds + a * seconds * seconds / 2;
    return now * toTop + a * toTop * toTop / 2 + top * (seconds - toTop);
}

export function unit(v: Vector): Vector {
    if (!Number.isFinite(v.x) || !Number.isFinite(v.y))
        throw new Error("Movement must be finite");
    const length = Math.hypot(v.x, v.y);
    return length < 1e-9 ? { x: 0, y: 0 } : { x: v.x / length, y: v.y / length };
}
/** What a player is trying to do this tick: head for `to` at `speed` times his top speed, or follow a human's direction. */
export interface Intent {
    readonly to: Vector | null;
    readonly speed: number;
}
/**
 * One movement tick for everyone. Intents are computed from the previous snapshot only, so array order never changes decisions.
 * Velocity ramps toward the intended velocity (acceleration), locked blockers/defenders drag each other, and overlapping bodies are
 * pushed apart in a fixed pairwise order, so 22 players do not stack on each other.
 */
export function advance(players: readonly ArcadePlayer[], human: Inputs, intents: ReadonlyMap<PlayerId, Intent>, slow: ReadonlyMap<PlayerId, number>, carrier?: PlayerId): ArcadePlayer[] {
    const dir = { home: unit(human.home), away: unit(human.away) };
    const moved = players.map(p => {
        let wish: Vector, factor = 1;
        if (p.human) {
            wish = dir[p.team];
        }
        else {
            const intent = intents.get(p.id);
            if (!intent || !intent.to) {
                wish = { x: 0, y: 0 };
            }
            else {
                const dx = intent.to.x - p.x, dy = intent.to.y - p.y, d = Math.hypot(dx, dy);
                // Ease into the destination instead of vibrating around it.
                factor = intent.speed * Math.min(1, d / 0.8);
                wish = d < 0.05 ? { x: 0, y: 0 } : { x: dx / d, y: dy / d };
            }
        }
        const top = maxSpeed(p) * factor * (slow.get(p.id) ?? 1) * (p.stun > 0 ? 0.35 : 1);
        const want = { x: wish.x * top, y: wish.y * top };
        const dv = maxSpeed(p) / ACCEL_SECONDS * STEP_SECONDS * (0.6 + p.abilities.accel / 150);
        const ax = want.x - p.vx, ay = want.y - p.vy, am = Math.hypot(ax, ay);
        const k = am > dv ? dv / am : 1;
        const vx = p.vx + ax * k, vy = p.vy + ay * k;
        return {
            ...p, vx, vy, stun: Math.max(0, p.stun - 1), free: Math.max(0, p.free - 1),
            x: p.x + vx * STEP_SECONDS, y: p.y + vy * STEP_SECONDS,
        };
    });
    separate(moved, carrier);
    for (let i = 0; i < moved.length; i++) {
        const p = moved[i]!;
        moved[i] = { ...p, x: Math.max(FIELD.radius, Math.min(FIELD.length - FIELD.radius, p.x)), y: Math.max(FIELD.radius, Math.min(FIELD.width - FIELD.radius, p.y)) };
    }
    return moved;
}
/**
 * Soft collision: overlapping players move apart equally; players locked in a block are allowed to stay in contact. Every pair is
 * judged against the same starting positions and the pushes are summed, so the result does not depend on the order of the array.
 */
function separate(list: ArcadePlayer[], carrier?: PlayerId): void {
    const dx = new Array<number>(list.length).fill(0), dy = new Array<number>(list.length).fill(0);
    for (let i = 0; i < list.length; i++)
        for (let j = i + 1; j < list.length; j++) {
            const a = list[i]!, b = list[j]!;
            const ex = b.x - a.x, ey = b.y - a.y, d2 = ex * ex + ey * ey;
            if (d2 >= BODY * BODY || a.lock?.with === b.id)
                continue;
            const d = Math.sqrt(d2);
            // Exactly overlapping players separate along a direction fixed by their ids, not by array position.
            const flip = a.id < b.id ? 1 : -1;
            const nx = d > 1e-6 ? ex / d : flip, ny = d > 1e-6 ? ey / d : 0;
            // The ball carrier is never shoved aside by his own teammates: they make way for him.
            const wa = carrier === a.id && a.team === b.team ? 0 : carrier === b.id && a.team === b.team ? 2 : 1;
            const push = (BODY - d) / 2;
            dx[i]! -= nx * push * wa; dy[i]! -= ny * push * wa;
            dx[j]! += nx * push * (2 - wa); dy[j]! += ny * push * (2 - wa);
        }
    for (let i = 0; i < list.length; i++)
        if (dx[i] !== 0 || dy[i] !== 0)
            list[i] = { ...list[i]!, x: list[i]!.x + dx[i]!, y: list[i]!.y + dy[i]! };
}
