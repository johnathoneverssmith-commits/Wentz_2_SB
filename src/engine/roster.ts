/**
 * Team rosters, depth charts, per-play lineups (spec §14, §15).
 *
 * TS port of `analysis/engine/roster.py`. Depth-chart *order* uses `overall`
 * (allowed — it only ranks players into roles); play *outcomes* use the
 * individual skill attributes via the rating layer (`ratings.ts`).
 */

import type { Player } from "../schema/player.js";
import { loadPlayerPool } from "../data/players.js";

export const OFF_SLOTS = [
  "QB1", "RB1", "WR1", "WR2", "WR3", "TE1", "LT", "LG", "C", "RG", "RT",
] as const;
export const DEF_SLOTS_BASE = [
  "EDGE1", "EDGE2", "DT1", "DT2", "ILB1", "ILB2", "CB1", "CB2", "S1", "S2",
] as const;
export const DEF_SLOTS_NICKEL = [
  "EDGE1", "EDGE2", "DT1", "DT2", "ILB1", "CB1", "CB2", "CB3", "S1", "S2",
] as const;

export type Lineup = Record<string, Player | null>;

function pushInto<K, V>(m: Map<K, V[]>, k: K, v: V): void {
  const list = m.get(k);
  if (list) list.push(v);
  else m.set(k, [v]);
}

let _pool: Map<string, Player[]> | null = null;

/** Pool grouped by `nfl_team`; free agents ("FA" / blank) dropped. Memoised. */
export function loadPool(): Map<string, Player[]> {
  if (_pool) return _pool;
  const byTeam = new Map<string, Player[]>();
  for (const p of loadPlayerPool()) {
    const t = p.nfl_team;
    if (!t || t === "FA") continue;
    pushInto(byTeam, t, p);
  }
  _pool = byTeam;
  return byTeam;
}

export class Roster {
  readonly team: string;
  /** position -> players, sorted by `overall` descending */
  readonly depth: Map<string, Player[]>;
  private _off: Lineup | null = null;
  private readonly _def = new Map<boolean, Lineup>();

  constructor(team: string, players: Player[]) {
    this.team = team;
    this.depth = new Map();
    for (const p of players) pushInto(this.depth, p.position, p);
    for (const list of this.depth.values()) {
      list.sort((a, b) => (b.overall ?? 0) - (a.overall ?? 0));
    }
  }

  /** nth-deepest at `pos`, clamped to the last player, or null if none. */
  private nth(pos: string, i: number): Player | null {
    const d = this.depth.get(pos) ?? [];
    return d[i] ?? d[d.length - 1] ?? null;
  }

  offense(): Lineup {
    if (!this._off) this._off = this.buildOffense();
    return this._off;
  }

  defense(nickel = false): Lineup {
    let d = this._def.get(nickel);
    if (!d) {
      d = this.buildDefense(nickel);
      this._def.set(nickel, d);
    }
    return d;
  }

  kicker(): Player | null {
    return this.nth("K", 0);
  }

  private buildOffense(): Lineup {
    const ot = this.depth.get("OT") ?? [];
    const og = this.depth.get("OG") ?? [];
    return {
      QB1: this.nth("QB", 0),
      RB1: this.nth("RB", 0),
      WR1: this.nth("WR", 0),
      WR2: this.nth("WR", 1),
      WR3: this.nth("WR", 2),
      TE1: this.nth("TE", 0),
      LT: ot[0] ?? null,
      RT: ot[1] ?? ot[0] ?? null,
      LG: og[0] ?? null,
      RG: og[1] ?? og[0] ?? null,
      C: this.nth("C", 0),
    };
  }

  private buildDefense(nickel: boolean): Lineup {
    const d: Lineup = {
      EDGE1: this.nth("EDGE", 0),
      EDGE2: this.nth("EDGE", 1),
      DT1: this.nth("DT", 0),
      DT2: this.nth("DT", 1),
      ILB1: this.nth("ILB", 0),
      ILB2: this.nth("ILB", 1),
      CB1: this.nth("CB", 0),
      CB2: this.nth("CB", 1),
      S1: this.nth("S", 0),
      S2: this.nth("S", 1),
    };
    if (nickel) d.CB3 = this.nth("CB", 2);
    return d;
  }
}

const _rosters = new Map<string, Roster>();

export function roster(team: string): Roster {
  let r = _rosters.get(team);
  if (!r) {
    const players = loadPool().get(team);
    if (!players) throw new Error(`roster: no players for team ${team}`);
    r = new Roster(team, players);
    _rosters.set(team, r);
  }
  return r;
}

export function teamList(): string[] {
  return [...loadPool().keys()].sort();
}
