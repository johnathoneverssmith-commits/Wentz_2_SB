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

  /**
   * nth-*available* player at `pos`, clamped to the last, or null if none.
   * `out` (ids injured/unavailable) is skipped before counting to `i`.
   */
  private nth(pos: string, i: number, out?: ReadonlySet<string>): Player | null {
    let d = this.depth.get(pos) ?? [];
    if (out && out.size) {
      const avail = d.filter((p) => !out.has(p.id));
      if (avail.length) d = avail;
    }
    return d[i] ?? d[d.length - 1] ?? null;
  }

  /** `out` = ids to treat as unavailable (in-game injuries). Uncached when non-empty. */
  offense(out?: ReadonlySet<string>): Lineup {
    if (out && out.size) return this.buildOffense(out);
    if (!this._off) this._off = this.buildOffense();
    return this._off;
  }

  defense(nickel = false, out?: ReadonlySet<string>): Lineup {
    if (out && out.size) return this.buildDefense(nickel, out);
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

  punter(): Player | null {
    return this.nth("P", 0);
  }

  private buildOffense(out?: ReadonlySet<string>): Lineup {
    let ot = this.depth.get("OT") ?? [];
    let og = this.depth.get("OG") ?? [];
    if (out && out.size) {
      ot = ot.filter((p) => !out.has(p.id));
      og = og.filter((p) => !out.has(p.id));
    }
    return {
      QB1: this.nth("QB", 0, out),
      RB1: this.nth("RB", 0, out),
      WR1: this.nth("WR", 0, out),
      WR2: this.nth("WR", 1, out),
      WR3: this.nth("WR", 2, out),
      TE1: this.nth("TE", 0, out),
      LT: ot[0] ?? null,
      RT: ot[1] ?? ot[0] ?? null,
      LG: og[0] ?? null,
      RG: og[1] ?? og[0] ?? null,
      C: this.nth("C", 0, out),
    };
  }

  private buildDefense(nickel: boolean, out?: ReadonlySet<string>): Lineup {
    const d: Lineup = {
      EDGE1: this.nth("EDGE", 0, out),
      EDGE2: this.nth("EDGE", 1, out),
      DT1: this.nth("DT", 0, out),
      DT2: this.nth("DT", 1, out),
      ILB1: this.nth("ILB", 0, out),
      ILB2: this.nth("ILB", 1, out),
      CB1: this.nth("CB", 0, out),
      CB2: this.nth("CB", 1, out),
      S1: this.nth("S", 0, out),
      S2: this.nth("S", 1, out),
    };
    if (nickel) d.CB3 = this.nth("CB", 2, out);
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
