import type { LeagueState, Player } from "@/domain";
import { onInjuredReserve } from "./injuries";
import { releaseToMarket } from "./seed";
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

/**
 * The roster's contracts this year — what reconciliation holds to the cap.
 *
 * Dead money (`cap.dead`) is left out on purpose. It is on the books and it
 * shrinks the room to add anyone (`cap.used` carries it), but it can't make a
 * roster illegal: counting it here meant each cut freed only part of its hit,
 * and a CPU team $46M over after a fantasy draft cut itself to 42 players.
 */
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
  const everyone = rosterOf(s, teamCode);
  // the cap counts everyone; the roster limit and the minimums don't count IR
  const roster = everyone.filter((p) => !onInjuredReserve(p, s.stage));
  const team = s.teams[teamCode];

  if (team) {
    const used = Math.round(everyone.reduce((n, p) => n + (p.contract?.cap_hit_by_year[0] ?? 0), 0) * 10) / 10;
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
  // Free Agency + Contracts optimization pass (contracts.release_penalty).
  const byYears = annual * 0.22 * c.years_remaining;
  const capped = annual * 0.75;
  const base = Math.min(byYears, capped);
  // exploit audit (contracts §3, "restructure then release"): a restructure
  // converts base salary into bonus money prorated across the *later* years
  // (`prorated_per_year`) — this formula otherwise only looks at this year's
  // (now-shrunk) hit, so restructuring a contract down and releasing him
  // right after made the deferred money vanish instead of ever coming due.
  // `extendContract` already carries this money forward through an
  // extension; releasing has to accelerate the same remaining amount onto
  // the cap now, the way a real signing bonus's unamortized proration does.
  const acceleratedProration = (c.prorated_per_year ?? 0) * c.years_remaining;
  return Math.round(Math.max(base, acceleratedProration) * 10) / 10;
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
    // mid-season free agency runs through here too, where "this off-season" was wrong
    const when = s.stage.startsWith("midseason") ? "in this free agency" : "this off-season";
    return { ok: false, reason: `You signed him ${when} — he's locked for the year.` };
  }
  return { ok: true };
}

/** Release a player: he goes to the pool and his penalty lands on the cap. */
export function applyRelease(s: LeagueState, teamCode: string, playerId: string): void {
  const p = s.players[playerId];
  const team = s.teams[teamCode];
  if (!p || !team) return;
  const penalty = releasePenalty(p);
  // onto the open market (a cut used to vanish from it)
  releaseToMarket(s, p);
  // dead money: the cost of the release stays on this year's books
  team.cap.dead = Math.round(((team.cap.dead ?? 0) + penalty) * 10) / 10;
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

/** A street free agent's deal: one year at the league minimum. */
const MIN_SALARY_M = 1;

/**
 * Fill every positional hole — from the real market first.
 *
 * This used to go straight to `makeEmergencyPlayer`, on the assumption that
 * by reconciliation "anybody available has been available to everybody".
 * But a CPU team that never bid on a kicker (the Master AI, correctly,
 * values one at almost nothing) or that had just cut its only one was left
 * with a 0-rated "Replacement K" while sixteen real kickers rated 72-78 sat
 * unsigned — and a 0-rated kicker misses everything. So a hole is filled by
 * the best free agent at the position on a one-year minimum deal, the way a
 * real team signs a street free agent, and only a hole nobody real can fill
 * (or that the cap cannot absorb even at the minimum) gets a placeholder.
 */
export function fillPositionalGaps(s: LeagueState, teamCode: string): number {
  const mins = positionalMinimums();
  const team = s.teams[teamCode];
  let made = 0;
  // A placeholder from an earlier reconciliation — or from a save made before
  // the market was tried first — gives way to a real player the moment one
  // can be signed, so a league that was already kicking with a 0-rated
  // "Replacement K" heals itself here rather than carrying him all year.
  for (const ph of rosterOf(s, teamCode).filter((p) => p.id.startsWith("emg_"))) {
    delete s.players[ph.id];
  }
  // one read of the roster, not one per position: this runs for every CPU
  // team on the way out of each market and the deadline, and sixteen scans of
  // the whole league per team were ~0.5s of every one of those transitions
  const counts = new Map<string, number>();
  for (const p of rosterOf(s, teamCode)) {
    if (onInjuredReserve(p, s.stage)) continue; // IR doesn't fill a position
    counts.set(p.position, (counts.get(p.position) ?? 0) + 1);
  }
  for (const pos of POSITIONS) {
    const need = mins[pos] ?? 0;
    if (need === 0) continue;
    let have = counts.get(pos) ?? 0;
    while (have < need) {
      const room = team ? team.cap.total - capUsed(s, teamCode) : 0;
      const street =
        room >= MIN_SALARY_M
          ? Object.values(s.players)
              .filter((p) => p.free_agent && !p.retired && p.position === pos && p.nfl_team === "FA")
              .sort((a, b) => b.overall - a.overall)[0]
          : undefined;
      if (street) {
        street.free_agent = false;
        street.nfl_team = teamCode;
        street.contract = {
          team_id: teamCode,
          years_remaining: 1,
          total_value: MIN_SALARY_M,
          guaranteed: 0,
          cap_hit_by_year: [MIN_SALARY_M],
          signing_bonus: 0,
        };
        if (s.standingFreeAgents) s.standingFreeAgents = s.standingFreeAgents.filter((id) => id !== street.id);
      } else {
        const p = makeEmergencyPlayer(s, teamCode, pos, have);
        s.players[p.id] = p;
      }
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
/**
 * Every cut the staff would make to get this team legal, worked out on a
 * copy — the league itself is untouched. Online the button used to cut one,
 * download the whole league, and look again, a minute of waiting on a slow
 * host; this plans the lot so they can go out in one go.
 */
export function planStaffTrim(s: LeagueState, teamCode: string): Player[] {
  const team = s.teams[teamCode];
  if (!team) return [];
  // copy-on-write: only what a release touches is cloned
  const sim: LeagueState = {
    ...s,
    players: { ...s.players },
    teams: { ...s.teams, [teamCode]: { ...team, cap: { ...team.cap } } },
    standingFreeAgents: [...(s.standingFreeAgents ?? [])],
  };
  const cuts: Player[] = [];
  for (let i = 0; i < 25; i++) {
    const issues = reconciliationIssues(sim, teamCode);
    const overCap = issues.some((x) => x.kind === "cap");
    const overSize = issues.some((x) => x.kind === "roster");
    if (!overCap && !overSize) break;
    const cut = nextReconcileCut(sim, teamCode, overCap, overSize);
    if (!cut) break;
    cuts.push(s.players[cut.id]!);
    sim.players[cut.id] = { ...cut };
    applyRelease(sim, teamCode, cut.id);
  }
  return cuts;
}

/**
 * Who a team over the limit should let go next: surplus bodies first, then
 * the lowest rating when crowded; the dearest non-starter when broke. The
 * CPU teams trim with it, and so does a GM's "Let my staff trim" button.
 */
export function nextReconcileCut(
  s: LeagueState,
  teamCode: string,
  overCap: boolean,
  overSize: boolean,
): Player | null {
  // never the last man a positional minimum depends on: the cheapest
  // player on a roster is usually the kicker or the punter, and cutting
  // the only one just opened a hole this same loop then had to fill
  const mins = positionalMinimums();
  const roster = rosterOf(s, teamCode);
  const countAt = (pos: string) => roster.filter((x) => x.position === pos).length;
  const cuttable = roster
    .filter((p) => checkRelease(s, teamCode, p.id).ok && p.overall > 0)
    .filter((p) => countAt(p.position) > (mins[p.position] ?? 0));
  // Where each player stands at his position, best first: a starter is
  // inside the template's starter count, a surplus body is past its
  // full count (a second kicker, a seventh corner).
  const rankAt = new Map<string, number>();
  for (const pos of new Set(roster.map((p) => p.position))) {
    roster
      .filter((p) => p.position === pos)
      .sort((a, b) => b.overall - a.overall)
      .forEach((p, i) => rankAt.set(p.id, i));
  }
  const slot = (pos: string) => ROSTER_TEMPLATE.find((r) => r.pos === pos);
  const surplus = (p: Player) => (rankAt.get(p.id) ?? 0) >= (slot(p.position)?.count ?? 0);
  const starter = (p: Player) => (rankAt.get(p.id) ?? 0) < (slot(p.position)?.starters ?? 0);
  const capHit = (p: Player) => p.contract?.cap_hit_by_year[0] ?? 0;
  // what he's worth keeping: his rating, plus half of any room a young
  // player still has to grow — the trim used to cut rookies signed that
  // same week for a 29-year-old one point better
  const keepValue = (p: Player) =>
    p.overall + (p.age <= 25 ? Math.max(0, (p.potential ?? p.overall) - p.overall) * 0.5 : 0);
  // Crowded: the least useful body — surplus positions first (a team
  // that upgraded its kicker used to keep both and cut its cheapest
  // linebacker), then the lowest rating. Broke: the dearest player who
  // isn't starting — it used to be the dearest player, full stop, which
  // is how a CPU team over the cap cut its quarterback.
  const victim = overCap && !overSize
    ? ([...cuttable].filter((p) => !starter(p)).sort((a, b) => capHit(b) - capHit(a))[0] ??
      [...cuttable].sort((a, b) => capHit(b) - capHit(a))[0])
    : [...cuttable].sort(
        (a, b) =>
          Number(surplus(b)) - Number(surplus(a)) || keepValue(a) - keepValue(b) || capHit(a) - capHit(b),
      )[0];
  return victim ?? null;
}

export function reconcileCpuTeam(s: LeagueState, teamCode: string): void {
  let guard = 0;
  while (guard++ < 120) {
    const issues = reconciliationIssues(s, teamCode);
    if (issues.length === 0) return;

    const overCap = issues.some((i) => i.kind === "cap");
    const overSize = issues.some((i) => i.kind === "roster");

    if (overCap || overSize) {
      const victim = nextReconcileCut(s, teamCode, overCap, overSize);
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
