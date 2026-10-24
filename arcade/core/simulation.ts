/** Browser-free movement drill. World coordinates and speeds use yards and seconds. */
export type TeamId = "home" | "away";
export type PlayerId = `${TeamId}-${1 | 2 | 3 | 4 | 5}`;
export interface Vector {
    readonly x: number;
    readonly y: number;
}
export interface Abilities {
    readonly speed: number;
} // 0–99 rating; not a franchise engine rating model
export interface ArcadePlayer extends Vector {
    readonly id: PlayerId;
    readonly team: TeamId;
    readonly number: number;
    readonly human: boolean;
    readonly abilities: Abilities;
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
export function createMatch(): MatchSnapshot {
    const players: ArcadePlayer[] = [];
    for (const team of ["home", "away"] as const) {
        for (const number of [1, 2, 3, 4, 5] as const) {
            players.push({
                id: `${team}-${number}`, team, number, human: number === 1,
                x: team === "home" ? 38 - (number - 1) * 2 : 72 + (number - 1) * 2,
                y: number === 1 ? FIELD.width / 2 : 7 + (number - 2) * 12,
                abilities: { speed: number === 1 ? 60 : 45 },
            });
        }
    }
    return { tick: 0, players, possession: { team: "home", carrier: "home-1" } };
}
function direction(v: Vector): Vector {
    if (!Number.isFinite(v.x) || !Number.isFinite(v.y))
        throw new Error("Movement must be finite");
    const length = Math.max(1, Math.hypot(v.x, v.y));
    return { x: v.x / length, y: v.y / length };
}
/** AI reads the previous snapshot only, so array ordering never changes decisions. */
/** `slow` scales a player's speed this tick (a blocked defender), for humans and AI alike. */
export function step(state: MatchSnapshot, inputs: Inputs, targets?: ReadonlyMap<PlayerId, Vector>, slow?: ReadonlyMap<PlayerId, number>): MatchSnapshot {
    const human = { home: direction(inputs.home), away: direction(inputs.away) };
    const carrier = state.players.find(p => p.id === state.possession.carrier)!;
    const players = state.players.map(p => {
        let movement: Vector;
        if (p.human)
            movement = human[p.team];
        else {
            const target = targets?.get(p.id) ?? (p.team === state.possession.team
                ? { x: Math.min(FIELD.length - 15, carrier.x + 12), y: 7 + (p.number - 2) * 12 }
                : { x: carrier.x + 2, y: carrier.y + (p.number - 3.5) * 2 });
            const delta = { x: target.x - p.x, y: target.y - p.y };
            movement = Math.hypot(delta.x, delta.y) < 0.5 ? { x: 0, y: 0 } : direction(delta);
        }
        const distance = (4 + p.abilities.speed / 20) * STEP_SECONDS * (slow?.get(p.id) ?? 1);
        return {
            ...p,
            x: Math.max(FIELD.radius, Math.min(FIELD.length - FIELD.radius, p.x + movement.x * distance)),
            y: Math.max(FIELD.radius, Math.min(FIELD.width - FIELD.radius, p.y + movement.y * distance)),
        };
    });
    return { ...state, tick: state.tick + 1, players };
}
