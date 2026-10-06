/**
 * Team rosters, depth charts, per-play lineups (spec §14, §15).
 *
 * TS port of `analysis/engine/roster.py`. Depth-chart *order* uses `overall`
 * (allowed — it only ranks players into roles); play *outcomes* use the
 * individual skill attributes via the rating layer (`ratings.ts`).
 */

import type { Player } from "../schema/player.js";
import { loadPlayerPool } from "../data/players.js";
import { policyOrder } from "./rookies.js";

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

/** `Roster.defense` rest mask bits: which front starter sits out a snap. */
export const REST_DT1 = 1;
export const REST_DT2 = 2;
export const REST_EDGE1 = 4;
export const REST_EDGE2 = 8;

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

/**
 * An explicit depth chart: position -> player ids, starter first.
 *
 * Rating order is the right default and stays the default — the pool has no
 * depth-chart data and nothing in the validation paths supplies one. It
 * exists for the franchise layer, where a GM sets a lineup by hand and that
 * choice has to reach the simulator; without it the UI's depth-chart stage
 * was a screen whose output nothing read. A position the order omits, and any
 * player it doesn't mention, falls back to `overall` exactly as before.
 */
export type DepthOrder = Readonly<Record<string, readonly string[]>>;

export class Roster {
  readonly team: string;
  /** position -> players, in depth order (by `overall` unless one was given) */
  readonly depth: Map<string, Player[]>;
  private _off: Lineup | null = null;
  private readonly _def = new Map<number, Lineup>();

  constructor(team: string, players: Player[], order?: DepthOrder) {
    this.team = team;
    this.depth = new Map();
    for (const p of players) pushInto(this.depth, p.position, p);
    for (const [pos, list] of this.depth) {
      const named = order?.[pos];
      if (!named || named.length === 0) {
        list.sort((a, b) => (b.overall ?? 0) - (a.overall ?? 0));
        continue;
      }
      // named players in the order given, then everyone else by rating —
      // a player signed after the chart was set slots in behind it
      const rank = new Map(named.map((id, i) => [id, i]));
      list.sort((a, b) => {
        const ra = rank.get(a.id);
        const rb = rank.get(b.id);
        if (ra != null && rb != null) return ra - rb;
        if (ra != null) return -1;
        if (rb != null) return 1;
        return (b.overall ?? 0) - (a.overall ?? 0);
      });
    }
  }

  /**
   * nth-*available* player at `pos`, clamped to the last, or null if none.
   * `out` (ids injured/unavailable) is skipped before counting to `i`.
   */
  /** The `i`-th available player at a position — for trace attribution only; not a lineup slot. */
  depthAt(pos: string, i: number, out?: ReadonlySet<string>): Player | null {
    return this.nth(pos, i, out);
  }

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

  /**
   * `rest` is a bit mask of front starters taking a breather this snap
   * (`REST_DT1` …): each is replaced by the next lineman down the chart, if
   * the team has one. Zero is the plain starting front.
   */
  defense(nickel = false, out?: ReadonlySet<string>, rest = 0): Lineup {
    if (out && out.size) return this.buildDefense(nickel, out, rest);
    const key = (nickel ? 1 : 0) + rest * 2;
    let d = this._def.get(key);
    if (!d) {
      d = this.buildDefense(nickel, undefined, rest);
      this._def.set(key, d);
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

  private buildDefense(nickel: boolean, out?: ReadonlySet<string>, rest = 0): Lineup {
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
    // the rotation: a resting starter's snap goes to the third man at his
    // position — never to a starter twice, so a team without one plays on
    const sub = (pos: "DT" | "EDGE", slot: string) => {
      const third = this.available(pos, out)[2];
      if (third) d[slot] = third;
    };
    if (rest & REST_DT1) sub("DT", "DT1");
    else if (rest & REST_DT2) sub("DT", "DT2");
    if (rest & REST_EDGE1) sub("EDGE", "EDGE1");
    else if (rest & REST_EDGE2) sub("EDGE", "EDGE2");
    return d;
  }

  private available(pos: string, out?: ReadonlySet<string>): Player[] {
    const d = this.depth.get(pos) ?? [];
    return out && out.size ? d.filter((p) => !out.has(p.id)) : d;
  }
}

/**
 * A copy of the roster with the rookie policy applied to its depth chart
 * (`policyOrder`). The shared roster is not changed.
 */
export function withRookiePlaytime(r: Roster, dial: number): Roster {
  if (!dial) return r;
  const order: Record<string, string[]> = {};
  const all: Player[] = [];
  for (const [pos, list] of r.depth) {
    all.push(...list);
    order[pos] = policyOrder(list, dial).map((p) => p.id);
  }
  return new Roster(r.team, all, order);
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
