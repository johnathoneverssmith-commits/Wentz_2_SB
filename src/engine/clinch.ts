/**
 * Conservative clinch / elimination status (Phase A1).
 *
 * From the games played so far plus the full schedule, tag each team with what
 * it has mathematically locked up: a playoff berth, its division, a first-round
 * bye (#1 seed), or league-best record (home field) — or that it's been
 * eliminated from playoff contention.
 *
 * "Conservative" = the logic works only from final-win-total bounds (a team's
 * floor if it loses out, its ceiling if it wins out) plus the pigeonhole on the
 * 7 playoff spots, accounting for the fact that a weak division's winner still
 * takes a seat. It never claims a clinch (or an elimination) that the remaining
 * games or tiebreakers could still overturn, so it may trail the NFL's official
 * scenarios by up to a week but never contradicts them. Ties count as half a
 * win in both bounds.
 */

import { type Conference, NFL_TEAMS, conferenceOf, divisionOf } from "./nfl-structure.js";
import type { SchedulePair } from "./schedule.js";
import type { FinishedGame } from "./standings.js";

export type ClinchTag = "homefield" | "bye" | "division" | "berth" | "eliminated";

export interface ClinchResult {
  team: string;
  /** All tags that apply (a division winner also carries "berth"). */
  tags: ClinchTag[];
}

const SEASON_GAMES = 17;
const PLAYOFF_SPOTS = 7;

interface Bounds {
  floor: number; // final win-equiv if the team loses every remaining game
  ceil: number; // final win-equiv if it wins every remaining game
}

function computeBounds(played: FinishedGame[], schedule: SchedulePair[]): Map<string, Bounds> {
  const cur = new Map<string, { we: number; gp: number }>(
    NFL_TEAMS.map((t) => [t, { we: 0, gp: 0 }]),
  );
  for (const g of played) {
    const h = cur.get(g.home);
    const a = cur.get(g.away);
    if (!h || !a) continue;
    h.gp += 1;
    a.gp += 1;
    if (g.homeScore > g.awayScore) h.we += 1;
    else if (g.awayScore > g.homeScore) a.we += 1;
    else {
      h.we += 0.5;
      a.we += 0.5;
    }
  }
  const total = new Map<string, number>(NFL_TEAMS.map((t) => [t, 0]));
  for (const g of schedule) {
    total.set(g.home, (total.get(g.home) ?? 0) + 1);
    total.set(g.away, (total.get(g.away) ?? 0) + 1);
  }
  const out = new Map<string, Bounds>();
  for (const t of NFL_TEAMS) {
    const c = cur.get(t)!;
    const remaining = Math.max(0, (total.get(t) || SEASON_GAMES) - c.gp);
    out.set(t, { floor: c.we, ceil: c.we + remaining });
  }
  return out;
}

const rivalsOf = (t: string) => NFL_TEAMS.filter((u) => u !== t && divisionOf(u) === divisionOf(t));

/** Can `u` still win its division? (No rival is locked strictly ahead of u's ceiling.) */
function canWinDivision(u: string, b: Map<string, Bounds>): boolean {
  const uc = b.get(u)!.ceil;
  return rivalsOf(u).every((r) => b.get(r)!.floor <= uc);
}

export function clinchStatus(played: FinishedGame[], schedule: SchedulePair[]): ClinchResult[] {
  const b = computeBounds(played, schedule);
  const byConf: Record<Conference, string[]> = {
    AFC: NFL_TEAMS.filter((t) => conferenceOf(t) === "AFC"),
    NFC: NFL_TEAMS.filter((t) => conferenceOf(t) === "NFC"),
  };

  return NFL_TEAMS.map((team) => {
    const conf = byConf[conferenceOf(team)];
    const rivals = rivalsOf(team);
    const tags: ClinchTag[] = [];
    const floor = b.get(team)!.floor;
    const ceil = b.get(team)!.ceil;
    const others = conf.filter((u) => u !== team);

    // Division locked: every rival is mathematically behind, even if this team
    // loses out and the rival wins out.
    const divisionLocked = rivals.every((r) => b.get(r)!.ceil < floor);
    if (divisionLocked) {
      tags.push("division", "berth");
    } else {
      // Wild-card pigeonhole. Teams that can seed ahead of `team`:
      //   - every team that can still catch it on record (as a division winner
      //     or a wild card), plus
      //   - the winners of the other three divisions (each outseeds `team` when
      //     `team` ends up a wild card, whatever their record). +3 covers the
      //     weak-division winners; strong ones are already record-catchers, so
      //     this over-counts and never over-claims.
      const recordCatchers = others.filter((u) => b.get(u)!.ceil >= floor).length;
      const threats = recordCatchers + 3;
      if (threats <= PLAYOFF_SPOTS - 1) tags.push("berth");
    }

    // #1 seed / bye: division locked AND no other still-possible division winner
    // can match this team's record.
    if (
      divisionLocked &&
      !others.some((u) => canWinDivision(u, b) && b.get(u)!.ceil >= floor)
    ) {
      tags.push("bye");
    }
    // Home field: a bye plus nobody in the league can reach this record.
    if (tags.includes("bye") && NFL_TEAMS.every((u) => u === team || b.get(u)!.ceil < floor)) {
      tags.push("homefield");
    }

    // Eliminated: can win neither a wild card nor its division.
    //   ≥7 conference teams finish strictly ahead on record (≤4 are division
    //   winners → ≥3 non-winners ahead → no wild card) AND a rival is locked
    //   strictly ahead → can't win the division.
    const recordPassers = others.filter((u) => b.get(u)!.floor > ceil).length;
    const rivalLockedAhead = rivals.some((r) => b.get(r)!.floor > ceil);
    if (!tags.includes("berth") && recordPassers >= PLAYOFF_SPOTS && rivalLockedAhead) {
      tags.push("eliminated");
    }

    const order: ClinchTag[] = ["homefield", "bye", "division", "berth", "eliminated"];
    tags.sort((x, y) => order.indexOf(x) - order.indexOf(y));
    return { team, tags };
  });
}

/** The single strongest tag, or null. */
export function topClinchTag(r: ClinchResult): ClinchTag | null {
  for (const t of ["homefield", "bye", "division", "berth", "eliminated"] as const) {
    if (r.tags.includes(t)) return t;
  }
  return null;
}
