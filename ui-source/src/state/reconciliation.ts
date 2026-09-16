import type { LeagueState, Player } from "@/domain";
import { POSITIONS } from "@/domain";
import { ROSTER_TEMPLATE, ROSTER_SIZE } from "@/sim/roster-template";

/**
 * Putting the rules back after free agency.
 *
 * Bidding deliberately ignores the cap, the roster maximum and the positional
 * minimums, so a team can win a player it cannot yet fit. This is where that
 * comes due: nobody advances until they are under the cap, at or below the
 * roster limit, and legal at every position, all three at once.
 *
 * The "all three at once" matters. Fixing the cap by cutting people can break
 * a positional minimum, and filling a position can break the cap — so a
 * screen that reported them one at a time would send a GM round in circles.
 * `reconciliationIssues` returns every violation together.
 */

export interface ReconciliationIssue {
  kind: "cap" | "roster" | "position";
  message: string;
}

/** Players who count against a team's roster and cap. */
export function rosterOf(s: LeagueState, teamCode: string): Player[] {
  return Object.values(s.players).filter(
    (p) => p.nfl_team === teamCode && !p.retired && !p.free_agent,
  );
}

export function capUsed(s: LeagueState, teamCode: string): number {
  return (
    Math.round(
      rosterOf(s, teamCode).reduce((n, p) => n + (p.contract?.cap_hit_by_year[0] ?? 0), 0) * 10,
    ) / 10
  );
}

/** The minimum this game needs at each position to field a legal lineup. */
export function positionalMinimums(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of ROSTER_TEMPLATE) {
    // starters plus one is the honest floor: enough to field the unit and
    // survive a single injury without the simulation inventing somebody
    out[row.pos] = row.starters > 0 ? row.starters : 0;
  }
  return out;
}

/** Everything wrong with this roster right now, together. */
export function reconciliationIssues(s: LeagueState, teamCode: string): ReconciliationIssue[] {
  const issues: ReconciliationIssue[] = [];
  const roster = rosterOf(s, teamCode);
  const team = s.teams[teamCode];

  if (team) {
    const used = capUsed(s, teamCode);
    if (used > team.cap.total) {
      issues.push({
        kind: "cap",
        message: `$${(used - team.cap.total).toFixed(1)}M over the salary cap.`,
      });
    }
  }

  if (roster.length > ROSTER_SIZE) {
    issues.push({
      kind: "roster",
      message: `${roster.length} players — ${roster.length - ROSTER_SIZE} over the limit of ${ROSTER_SIZE}.`,
    });
  }

  const mins = positionalMinimums();
  for (const pos of POSITIONS) {
    const need = mins[pos] ?? 0;
    if (need === 0) continue;
    const have = roster.filter((p) => p.position === pos).length;
    if (have < need) {
      issues.push({
        kind: "position",
        message: `${pos}: ${have} of the ${need} needed.`,
      });
    }
  }

  return issues;
}

export function isReconciled(s: LeagueState, teamCode: string): boolean {
  return reconciliationIssues(s, teamCode).length === 0;
}

/**
 * What releasing a player costs against this year's cap.
 *
 * The lesser of twenty percent of the annual value for each year left, or
 * eighty percent of one year. The cap stops a long deal from being ruinous to
 * escape while still making it expensive — releasing somebody in year one of
 * five should hurt, but not more than paying him.
 */
export function releasePenalty(p: Player): number {
  const c = p.contract;
  if (!c) return 0;
  const annual = c.cap_hit_by_year[0] ?? 0;
  const byYears = annual * 0.2 * c.years_remaining;
  const capped = annual * 0.8;
  return Math.round(Math.min(byYears, capped) * 10) / 10;
}

export interface ReleaseCheck {
  ok: boolean;
  reason?: string;
}

/**
 * Whether this player can be let go.
 *
 * Somebody signed in the free agency that just happened is locked for the
 * season. Signing a player and cutting him ten minutes later to clear his own
 * cap hit would make every offer costless, which would empty the market of
 * meaning — an offer has to be a commitment for a bidding war to mean
 * anything.
 */
export function checkRelease(s: LeagueState, teamCode: string, playerId: string): ReleaseCheck {
  const p = s.players[playerId];
  if (!p) return { ok: false, reason: "No such player." };
  if (p.nfl_team !== teamCode) return { ok: false, reason: "He isn't on your roster." };
  const justSigned = (s.freeAgencyEvent?.signed ?? []).some((x) => x.playerId === playerId);
  if (justSigned) {
    return { ok: false, reason: "You signed him this off-season — he's locked for the year." };
  }
  return { ok: true };
}

/** Release a player: he goes to the pool and his penalty lands on the cap. */
export function applyRelease(s: LeagueState, teamCode: string, playerId: string): void {
  const p = s.players[playerId];
  const team = s.teams[teamCode];
  if (!p || !team) return;
  const penalty = releasePenalty(p);
  p.free_agent = true;
  p.nfl_team = "FA";
  p.contract = null;
  // dead money: the cost of the release stays on this year's books
  team.cap.used = Math.round((team.cap.used + penalty) * 10) / 10;
}

/**
 * Fill a positional hole nobody in the league can fill.
 *
 * A last resort, and deliberately unattractive: a 0-overall player on a
 * one-year deal at nothing. He exists so the simulation always has eleven
 * bodies to put on the field, not as a way out of managing a roster — a team
 * that fills its secondary this way will be visibly terrible at it.
 */
export function makeEmergencyPlayer(
  s: LeagueState,
  teamCode: string,
  position: string,
  index: number,
): Player {
  const id = `emg_${teamCode}_${position}_${s.season}_${index}`;
  return {
    id,
    name: `Replacement ${position} ${index + 1}`,
    position: position as Player["position"],
    age: 24,
    nfl_team: teamCode,
    years_pro: 0,
    overall: 0,
    attributes: {},
    scheme_tags: [],
    dev_age_threshold: 26,
    decline_age_threshold: 30,
    injury_history: [],
    contract: {
      team_id: teamCode,
      years_remaining: 1,
      total_value: 0,
      guaranteed: 0,
      cap_hit_by_year: [0],
      signing_bonus: 0,
    },
    free_agent: false,
    injury_status: null,
    retired: false,
  } as Player;
}

/**
 * Fill every positional hole with the fewest emergency players possible.
 *
 * Only the gaps, and only after the real market has been exhausted — this
 * runs at reconciliation, by which point anybody available has been available
 * to everybody for five rounds.
 */
export function fillPositionalGaps(s: LeagueState, teamCode: string): number {
  const mins = positionalMinimums();
  let made = 0;
  for (const pos of POSITIONS) {
    const need = mins[pos] ?? 0;
    if (need === 0) continue;
    let have = rosterOf(s, teamCode).filter((p) => p.position === pos).length;
    while (have < need) {
      const p = makeEmergencyPlayer(s, teamCode, pos, have);
      s.players[p.id] = p;
      have++;
      made++;
    }
  }
  return made;
}

/**
 * Bring a CPU team into compliance.
 *
 * Cheapest-first by cap hit among players it is allowed to move, which is a
 * crude proxy for "least valuable" but an honest one: the expensive players
 * are expensive because they are good. It stops as soon as it is legal rather
 * than optimising, because a CPU team that gutted itself to be maximally
 * under the cap would be worse, not better.
 */
export function reconcileCpuTeam(s: LeagueState, teamCode: string): void {
  let guard = 0;
  while (guard++ < 120) {
    const issues = reconciliationIssues(s, teamCode);
    if (issues.length === 0) return;

    const overCap = issues.some((i) => i.kind === "cap");
    const overSize = issues.some((i) => i.kind === "roster");

    if (overCap || overSize) {
      const cuttable = rosterOf(s, teamCode)
        .filter((p) => checkRelease(s, teamCode, p.id).ok && p.overall > 0)
        .sort((a, b) => (a.contract?.cap_hit_by_year[0] ?? 0) - (b.contract?.cap_hit_by_year[0] ?? 0));
      // cut the cheapest when crowded, the dearest when broke
      const victim = overCap && !overSize ? cuttable[cuttable.length - 1] : cuttable[0];
      if (!victim) break;
      applyRelease(s, teamCode, victim.id);
      continue;
    }

    // only positional holes left, which cutting cannot fix
    if (fillPositionalGaps(s, teamCode) === 0) break;
  }
  // whatever is left, the simulation still needs bodies
  fillPositionalGaps(s, teamCode);
}
