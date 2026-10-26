import type { PlayerId, TeamId } from '../../core/simulation';
import { codeOf, type Code } from '../../core/personnel';

/**
 * Display identity for the persistent players. The key is the player id (`home-QB`, `away-DE1`): a future franchise roster replaces
 * this table (name, skin) without touching the renderer, because everything looks players up by id. Names are invented.
 */
export interface Identity { readonly id: PlayerId; readonly name: string; readonly skin: number }
const NAMES: Record<TeamId, Record<Code, string>> = {
    home: {
        QB: 'Keller', RB: 'Ortiz', FB: 'Brandt', TE1: 'Nakamura', TE2: 'Okafor', WR1: 'Vance', WR2: 'Delgado', WR3: 'Hartley', LT: 'Mbeki', LG: 'Sorensen', C: 'Whitfield', RG: 'Ajayi', RT: 'Kowalski',
        DE1: 'Strand', DT1: 'Moreau', DT2: 'Tuiasosopo', DE2: 'Beaumont', OLB1: 'Castellano', MLB: 'Fitzgerald', OLB2: 'Oduya', CB1: 'Lennox', CB2: 'Barrow', CB3: 'Ibarra', FS: 'Quillen', SS: 'Dumont',
    },
    away: {
        QB: 'Rourke', RB: 'Vasquez', FB: 'Gallagher', TE1: 'Abara', TE2: 'Pruitt', WR1: 'Sato', WR2: 'Okonkwo', WR3: 'Lindqvist', LT: 'Haddad', LG: 'Petrov', C: 'Nolan', RG: 'Kimura', RT: 'Brannigan',
        DE1: 'Voss', DT1: 'Mancini', DT2: 'Fonoti', DE2: 'Archer', OLB1: 'Santoro', MLB: 'Eze', OLB2: 'Calloway', CB1: 'Rivers', CB2: 'Tanaka', CB3: 'Maddox', FS: 'Lund', SS: 'Ferreira',
    },
};
const SKIN_CYCLE = [0, 2, 1, 0, 1, 2, 0, 1, 2, 0, 2, 1, 0];
export const identityOf = (id: PlayerId): Identity => {
    const team = id.split('-')[0] as TeamId, code = codeOf(id);
    const index = Object.keys(NAMES[team]).indexOf(code);
    return { id, name: NAMES[team][code] ?? 'Player', skin: SKIN_CYCLE[(index + (team === 'home' ? 0 : 5)) % SKIN_CYCLE.length] ?? 0 };
};
/** The position label on a name plate: the roster position (QB, WR, LT, MLB ...). */
export const positionOf = (position: string): string => position;
