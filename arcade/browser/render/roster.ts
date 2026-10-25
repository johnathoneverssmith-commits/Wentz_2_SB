import type { PlayerId, TeamId } from '../../core/simulation';

/**
 * Display identity for the five on-field players. The key is the persistent game player id (`home-3`): a future franchise roster
 * replaces this table (name, skin) without touching the renderer, because everything below looks players up by id.
 * Names are invented. Positions describe the role a player has on the current play, not a stored attribute.
 */
export interface Identity { readonly id: PlayerId; readonly name: string; readonly skin: number }
const NAMES: Record<TeamId, readonly string[]> = {
    home: ['Keller', 'Ortiz', 'Brandt', 'Nakamura', 'Okafor'],
    away: ['Rourke', 'Vasquez', 'Lindqvist', 'Abara', 'Pruitt'],
};
const SKINS: Record<TeamId, readonly number[]> = { home: [0, 2, 1, 0, 2], away: [1, 0, 2, 1, 0] };
export const identityOf = (id: PlayerId): Identity => {
    const [team, n] = id.split('-') as [TeamId, string], i = Number(n) - 1;
    return { id, name: NAMES[team][i] ?? 'Player', skin: SKINS[team][i] ?? 0 };
};
const OFFENSE = ['QB', 'RB', 'WR', 'WR', 'TE'], DEFENSE = ['DE', 'LB', 'CB', 'CB', 'S'];
export const positionOf = (number: number, onOffense: boolean): string => (onOffense ? OFFENSE : DEFENSE)[number - 1] ?? '';
