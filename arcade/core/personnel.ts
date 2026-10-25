/**
 * Who is on the field. Every team has a fixed roster of persistent players with stable ids (`home-QB`, `away-DE1`), a football
 * position and a jersey number. A play puts 11 of the offensive group and 11 of the defensive group on the field in a named formation.
 *
 * Attributes: the `Abilities` record is the interface Milestone 5C will fill from the franchise schema (src/schema/player.ts:
 * speed, acceleration, strength, agility, awareness are shared names; block, passRush, tackle, coverage, hands are the arcade's
 * aggregates of the position-specific ratings). Milestone 5B gives every player the average profile of his position.
 */
import type { Abilities, TeamId } from './simulation';

export type Pos = 'QB' | 'RB' | 'FB' | 'TE' | 'WR' | 'LT' | 'LG' | 'C' | 'RG' | 'RT' | 'DE' | 'DT' | 'OLB' | 'MLB' | 'CB' | 'FS' | 'SS';
/** The franchise engine's position for each arcade position (src/schema/player.ts POSITIONS). */
export const FRANCHISE_POSITION: Record<Pos, string> = { QB: 'QB', RB: 'RB', FB: 'RB', TE: 'TE', WR: 'WR', LT: 'OT', RT: 'OT', LG: 'OG', RG: 'OG', C: 'C', DE: 'EDGE', DT: 'DT', OLB: 'OLB', MLB: 'ILB', CB: 'CB', FS: 'S', SS: 'S' };

export type OffenseCode = 'QB' | 'RB' | 'FB' | 'TE1' | 'TE2' | 'WR1' | 'WR2' | 'WR3' | 'LT' | 'LG' | 'C' | 'RG' | 'RT';
export type DefenseCode = 'DE1' | 'DT1' | 'DT2' | 'DE2' | 'OLB1' | 'MLB' | 'OLB2' | 'CB1' | 'CB2' | 'CB3' | 'FS' | 'SS';
export type Code = OffenseCode | DefenseCode;
export const OFFENSE_CODES: readonly OffenseCode[] = ['QB', 'RB', 'FB', 'TE1', 'TE2', 'WR1', 'WR2', 'WR3', 'LT', 'LG', 'C', 'RG', 'RT'];
export const DEFENSE_CODES: readonly DefenseCode[] = ['DE1', 'DT1', 'DT2', 'DE2', 'OLB1', 'MLB', 'OLB2', 'CB1', 'CB2', 'CB3', 'FS', 'SS'];
export const isOffenseCode = (code: string): code is OffenseCode => (OFFENSE_CODES as readonly string[]).includes(code);
export const positionOfCode = (code: Code): Pos => code.startsWith('TE') ? 'TE' : code.startsWith('WR') ? 'WR' : code.startsWith('DE') ? 'DE' : code.startsWith('DT') ? 'DT' : code.startsWith('OLB') ? 'OLB' : code.startsWith('CB') ? 'CB' : code as Pos;
export const JERSEY: Record<Code, number> = {
    QB: 12, RB: 28, FB: 44, TE1: 87, TE2: 84, WR1: 81, WR2: 11, WR3: 15, LT: 72, LG: 66, C: 55, RG: 64, RT: 76,
    DE1: 91, DT1: 95, DT2: 93, DE2: 98, OLB1: 54, MLB: 52, OLB2: 58, CB1: 24, CB2: 31, CB3: 21, FS: 29, SS: 33,
};

/** Average ratings by position (0-99). Everything that varies between players in 5C lives here. */
const BASE: Record<Pos, Abilities> = {
    QB: { speed: 55, accel: 60, strength: 40, agility: 55, awareness: 70, block: 20, passRush: 5, tackle: 25, coverage: 15, hands: 55, throwing: 75 },
    RB: { speed: 70, accel: 75, strength: 55, agility: 75, awareness: 55, block: 40, passRush: 5, tackle: 30, coverage: 20, hands: 60, throwing: 10 },
    FB: { speed: 55, accel: 55, strength: 70, agility: 50, awareness: 55, block: 68, passRush: 5, tackle: 35, coverage: 20, hands: 50, throwing: 10 },
    TE: { speed: 58, accel: 58, strength: 62, agility: 52, awareness: 55, block: 62, passRush: 5, tackle: 30, coverage: 25, hands: 65, throwing: 10 },
    WR: { speed: 70, accel: 78, strength: 40, agility: 78, awareness: 55, block: 38, passRush: 5, tackle: 25, coverage: 30, hands: 78, throwing: 10 },
    LT: { speed: 40, accel: 45, strength: 80, agility: 40, awareness: 60, block: 78, passRush: 10, tackle: 30, coverage: 5, hands: 15, throwing: 5 },
    LG: { speed: 40, accel: 45, strength: 82, agility: 38, awareness: 60, block: 76, passRush: 10, tackle: 30, coverage: 5, hands: 15, throwing: 5 },
    C: { speed: 40, accel: 45, strength: 80, agility: 40, awareness: 68, block: 76, passRush: 10, tackle: 30, coverage: 5, hands: 15, throwing: 5 },
    RG: { speed: 40, accel: 45, strength: 82, agility: 38, awareness: 60, block: 76, passRush: 10, tackle: 30, coverage: 5, hands: 15, throwing: 5 },
    RT: { speed: 40, accel: 45, strength: 80, agility: 40, awareness: 60, block: 78, passRush: 10, tackle: 30, coverage: 5, hands: 15, throwing: 5 },
    DE: { speed: 52, accel: 62, strength: 70, agility: 55, awareness: 55, block: 30, passRush: 76, tackle: 66, coverage: 20, hands: 25, throwing: 5 },
    DT: { speed: 44, accel: 55, strength: 82, agility: 40, awareness: 55, block: 30, passRush: 66, tackle: 66, coverage: 10, hands: 20, throwing: 5 },
    OLB: { speed: 60, accel: 66, strength: 62, agility: 62, awareness: 60, block: 30, passRush: 55, tackle: 72, coverage: 52, hands: 35, throwing: 5 },
    MLB: { speed: 58, accel: 64, strength: 64, agility: 58, awareness: 68, block: 30, passRush: 45, tackle: 74, coverage: 50, hands: 35, throwing: 5 },
    CB: { speed: 74, accel: 78, strength: 40, agility: 78, awareness: 58, block: 20, passRush: 20, tackle: 60, coverage: 76, hands: 55, throwing: 5 },
    FS: { speed: 70, accel: 74, strength: 48, agility: 70, awareness: 66, block: 20, passRush: 15, tackle: 68, coverage: 70, hands: 55, throwing: 5 },
    SS: { speed: 68, accel: 72, strength: 55, agility: 66, awareness: 62, block: 25, passRush: 20, tackle: 72, coverage: 62, hands: 50, throwing: 5 },
};
export const baseAbilities = (pos: Pos): Abilities => BASE[pos];

export type OffenseFormation = 'singleback' | 'shotgun' | 'iformation';
export type DefenseFormation = 'fourThree' | 'nickel';
export interface Slot { readonly code: Code; readonly depth: number; readonly lane: number }
/** The line is slightly bowed (centre forward, tackles back) and well spread, so no two sprites sit on top of each other. */
const oline = (): Slot[] => [
    { code: 'C', depth: 1.0, lane: 0 }, { code: 'LG', depth: 1.6, lane: -3.7 }, { code: 'RG', depth: 1.6, lane: 3.7 },
    { code: 'LT', depth: 2.2, lane: -7.4 }, { code: 'RT', depth: 2.2, lane: 7.4 },
];
/** `depth` is yards behind the line of scrimmage for the offense (positive = back), `lane` yards left (-) or right (+) of the ball. */
export const OFFENSE_FORMATIONS: Record<OffenseFormation, readonly Slot[]> = {
    singleback: [...oline(), { code: 'QB', depth: 3.6, lane: 0 }, { code: 'RB', depth: 8.8, lane: 0 }, { code: 'TE1', depth: 2.0, lane: 11.2 }, { code: 'TE2', depth: 2.0, lane: -11.2 }, { code: 'WR1', depth: 1.2, lane: -22 }, { code: 'WR2', depth: 1.2, lane: 22 }],
    shotgun: [...oline(), { code: 'QB', depth: 6.5, lane: 0 }, { code: 'RB', depth: 6.5, lane: 4.4 }, { code: 'TE1', depth: 2.0, lane: 11.2 }, { code: 'WR1', depth: 1.2, lane: -22 }, { code: 'WR2', depth: 1.2, lane: 22 }, { code: 'WR3', depth: 3.2, lane: -13.5 }],
    iformation: [...oline(), { code: 'QB', depth: 3.6, lane: 0 }, { code: 'FB', depth: 6.4, lane: 0 }, { code: 'RB', depth: 9.4, lane: 0 }, { code: 'TE1', depth: 2.0, lane: 11.2 }, { code: 'WR1', depth: 1.2, lane: -22 }, { code: 'WR2', depth: 1.2, lane: 22 }],
};
/** `depth` is yards beyond the line of scrimmage. */
export const DEFENSE_FORMATIONS: Record<DefenseFormation, readonly Slot[]> = {
    fourThree: [
        { code: 'DE1', depth: 3.8, lane: -9.6 }, { code: 'DT1', depth: 3.0, lane: -3.3 }, { code: 'DT2', depth: 3.0, lane: 3.3 }, { code: 'DE2', depth: 3.8, lane: 9.6 },
        { code: 'OLB1', depth: 6.8, lane: -12 }, { code: 'MLB', depth: 7.2, lane: 0 }, { code: 'OLB2', depth: 6.8, lane: 12 },
        { code: 'CB1', depth: 8.5, lane: -22 }, { code: 'CB2', depth: 8.5, lane: 22 }, { code: 'FS', depth: 15, lane: -6 }, { code: 'SS', depth: 11.5, lane: 7 },
    ],
    nickel: [
        { code: 'DE1', depth: 3.8, lane: -9.6 }, { code: 'DT1', depth: 3.0, lane: -3.3 }, { code: 'DT2', depth: 3.0, lane: 3.3 }, { code: 'DE2', depth: 3.8, lane: 9.6 },
        { code: 'OLB1', depth: 6.8, lane: -7.5 }, { code: 'OLB2', depth: 6.8, lane: 7.5 },
        { code: 'CB1', depth: 8.5, lane: -22 }, { code: 'CB2', depth: 8.5, lane: 22 }, { code: 'CB3', depth: 7.5, lane: -13.5 }, { code: 'FS', depth: 15, lane: -6 }, { code: 'SS', depth: 12, lane: 7 },
    ],
};
export const OFFENSE_FORMATION_NAMES: Record<OffenseFormation, string> = { singleback: 'Singleback', shotgun: 'Shotgun', iformation: 'I-formation' };
export const DEFENSE_FORMATION_NAMES: Record<DefenseFormation, string> = { fourThree: '4-3', nickel: 'Nickel' };
/** The formations a play starts from. Deterministic: the same play number and call always line up the same way. */
export function chooseFormations(play: 'rush' | 'slants' | 'go' | 'fieldgoal', playNumber: number): { readonly offense: OffenseFormation; readonly defense: DefenseFormation } {
    if (play === 'rush' || play === 'fieldgoal')
        return { offense: playNumber % 2 === 0 ? 'iformation' : 'singleback', defense: 'fourThree' };
    return playNumber % 2 === 0 ? { offense: 'shotgun', defense: 'nickel' } : { offense: 'singleback', defense: 'fourThree' };
}
export const playerId = (team: TeamId, code: Code) => `${team}-${code}` as const;
export const codeOf = (id: string): Code => id.slice(id.indexOf('-') + 1) as Code;
