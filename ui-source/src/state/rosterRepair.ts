/**
 * Emergency roster repair: the CPU front office fills a hole nobody else will.
 *
 * A team with too few players at a position cannot field a lineup — the game
 * would otherwise hand it a 0-rated placeholder for each missing starter
 * (`withPlaceholders`). At a handful of progression checkpoints the staff
 * signs real players into those holes, for every team, human or CPU.
 *
 * What this is NOT, deliberately:
 *
 *  - **Not a person's decision.** There is no entry point that takes a player
 *    id. The staff chooses, by a fixed rule, and tells the GM afterwards
 *    (`describeRepair`). A GM's only lever is how they managed the roster
 *    beforehand.
 *  - **Not free agency.** It signs only a position that is *below its
 *    minimum*, only up to the shortfall, only from the unsigned pool, and never
 *    while a free-agency window is running (`repairBlockedBy`) or for a player
 *    with a live offer in one. The price is half the player's market ask (never
 *    below the league minimum) on a one-year deal, so a good player is not a
 *    bargain and cutting a kicker to "buy" the best one is not a strategy.
 *  - **Not unlimited.** It respects the cap (a player the team cannot afford is
 *    skipped for the next best that it can) and the roster limit (it releases
 *    the cheapest surplus player to make the room, and says so).
 *
 * Deterministic: no randomness; candidates are ordered by score then id, and
 * teams by strength (weakest first, as waiver priority runs) then code.
 *
 * Integration for the transaction-phase rules (docs/ROSTER_REPAIR_AND_CONTRACTS.md):
 * the only exported entry points that change a roster are `repairRoster` and
 * `runRepairCheckpoint`. Call the latter from a stage transition; it decides
 * for itself whether `to` is a checkpoint and whether a market is open.
 */
import type { LeagueState, Player, Stage } from "@/domain";
import { POSITIONS } from "@/domain";

import { marketScale, minSalaryM } from "./capEconomy.ts";
import { expectedSalary } from "./freeAgencyValues.ts";
import { onInjuredReserve } from "./injuries";
import { strategyOf } from "./aiGms.ts";
import { strategyAgeBonus } from "./aiStrategy.ts";
import { applyRelease, checkRelease, positionalMinimums, rosterOf } from "./reconciliation.ts";
import { releasePenalty } from "./releaseCost.ts";
import { ROSTER_TEMPLATE } from "@/sim/roster-template";
import { rosterLimitFor, rosterCountOf, offerToContract } from "./rules.ts";
import { capUsedOf, recomputeTeamRatings } from "./seed.ts";
import { UNITS } from "./unitValue.ts";

/** Entering one of these stages is a checkpoint: rosters are about to be played. */
export const REPAIR_CHECKPOINTS: readonly Stage[] = ["preseason", "regularSeason", "midseasonDepthChart"];

/** Stages in which a market is the scheduled way to add players; repair stays out of them. */
const MARKET_STAGES: readonly Stage[] = ["freeAgency", "midseasonFreeAgency", "offseasonFreeAgency", "coachingHiring"];

/** The share of a player's market ask an emergency deal pays (never under the league minimum). */
export const EMERGENCY_ASK_SHARE = 0.5;
/** Records kept on the league, newest last. */
const KEEP_RECORDS = 80;

export interface RepairShortfall {
  position: string;
  have: number;
  need: number;
}

export interface RepairSigning {
  playerId: string;
  name: string;
  position: string;
  overall: number;
  /** $M, one year */
  salary: number;
}

export interface RepairRecord {
  /** `${season}|${stage}|${team}` — one per team per checkpoint, so a retry cannot double it */
  id: string;
  season: number;
  stage: Stage;
  team: string;
  /** whether a person runs the team; the repair is the same either way */
  human: boolean;
  signed: RepairSigning[];
  /** players the staff released to make roster room */
  released: { playerId: string; name: string; position: string; overall: number }[];
  /** holes the staff could not fill (nobody eligible, or no money) — the game plays a placeholder */
  unresolved: RepairShortfall[];
}

/** The positional holes on a roster right now (injured reserve and the practice squad don't fill one). */
export function rosterMinimumViolations(s: LeagueState, teamCode: string): RepairShortfall[] {
  const mins = positionalMinimums();
  const roster = rosterOf(s, teamCode).filter((p) => !onInjuredReserve(p, s.stage));
  const out: RepairShortfall[] = [];
  for (const pos of POSITIONS) {
    const need = mins[pos] ?? 0;
    if (need === 0) continue;
    const have = roster.filter((p) => p.position === pos).length;
    if (have < need) out.push({ position: pos, have, need });
  }
  return out;
}

/** Why repair must not run right now, or null. A scheduled market always goes first. */
export function repairBlockedBy(s: LeagueState): string | null {
  if (MARKET_STAGES.includes(s.stage)) return "A free-agency window is the scheduled way to add players.";
  if (s.freeAgencyEvent && !s.freeAgencyEvent.complete) return "A free-agency event is still running.";
  for (const field of ["freeAgency", "coachingFreeAgency"] as const) {
    const w = (s as unknown as Record<string, { mode?: string } | null | undefined>)[field];
    if (w && w.mode === "main") return "A bidding window is open.";
  }
  return null;
}

const r1 = (n: number): number => Math.round(n * 10) / 10;

/** What the staff pays for an emergency signing: half his ask, never under the minimum. */
export function emergencyPrice(s: LeagueState, p: Player): number {
  const min = minSalaryM(s);
  return Math.max(min, r1(expectedSalary(p, marketScale(s)) * EMERGENCY_ASK_SHARE));
}

/**
 * Who the staff would release to make roster room: never someone the lineup needs.
 *
 * Counts only ACTIVE players (injured reserve fills no position and holds no roster spot), so cutting
 * one cannot open a new hole. Prefers a position carrying more than its template count, then the lowest
 * rated, then the cheapest to leave. Never at the position being filled.
 */
export function repairCutCandidate(
  s: LeagueState,
  teamCode: string,
  fillingPosition: string,
  /** when given, the cut must leave `price` of room: cutting can cost more (dead money) than it frees */
  afford?: { room: number; price: number },
): Player | null {
  const mins = positionalMinimums();
  const active = rosterOf(s, teamCode).filter((p) => !onInjuredReserve(p, s.stage));
  const countAt = (pos: string): number => active.filter((p) => p.position === pos).length;
  const template = (pos: string): number => ROSTER_TEMPLATE.find((r) => r.pos === pos)?.count ?? 0;
  const cuttable = active.filter(
    (p) => p.position !== fillingPosition && !p.id.startsWith("emg_") && countAt(p.position) > (mins[p.position] ?? 0) &&
      checkRelease(s, teamCode, p.id).ok &&
      (!afford || afford.room + (p.contract?.cap_hit_by_year[0] ?? 0) - releasePenalty(p) >= afford.price - 1e-9),
  );
  cuttable.sort(
    (a, b) =>
      countAt(b.position) - template(b.position) - (countAt(a.position) - template(a.position)) ||
      a.overall - b.overall ||
      releasePenalty(a) - releasePenalty(b) ||
      (a.id < b.id ? -1 : 1),
  );
  return cuttable[0] ?? null;
}

/** Template positions by how much a hole there costs, so the biggest gets first call on the pool. */
function importance(position: string): number {
  for (const u of Object.values(UNITS)) if (position in u.slots) return u.weight / Object.values(u.slots).reduce((a, b) => a + b, 0);
  return 0.005;
}

/**
 * Fill one team's positional holes. Safe to call on a legal roster (does nothing and records nothing).
 * Refuses (returns null) while a market is open.
 */
export function repairRoster(s: LeagueState, teamCode: string): RepairRecord | null {
  if (repairBlockedBy(s)) return null;
  const team = s.teams[teamCode];
  if (!team) return null;
  const shortfalls = rosterMinimumViolations(s, teamCode);
  if (shortfalls.length === 0) return null;

  const human = s.gms.some((g) => g.isHuman && g.teamCode === teamCode);
  const strategy = strategyOf(s, teamCode);
  const live = new Set<string>(Object.keys(s.freeAgencyEvent?.offers ?? {}));
  const signed: RepairSigning[] = [];
  const released: RepairRecord["released"] = [];
  const unresolved: RepairShortfall[] = [];

  const ordered = [...shortfalls].sort((a, b) => importance(b.position) - importance(a.position) || a.position.localeCompare(b.position));
  for (const hole of ordered) {
    let have = hole.have;
    while (have < hole.need) {
      // the canonical books: active contracts, the practice squad and dead money
      const room = team.cap.total - capUsedOf(s, teamCode);
      const candidates = Object.values(s.players)
        .filter(
          (p) =>
            p.free_agent &&
            !p.retired &&
            p.nfl_team === "FA" &&
            p.position === hole.position &&
            !live.has(p.id) &&
            p.injury_status?.status !== "out" &&
            emergencyPrice(s, p) <= room + 1e-9,
        )
        .map((p) => ({ p, score: p.overall + 0.1 * strategyAgeBonus(strategy, p.age) }))
        .sort((a, b) => b.score - a.score || (a.p.id < b.p.id ? -1 : 1));
      const pick = candidates[0]?.p;
      if (!pick) break;

      // roster limit: a full roster gives up its cheapest surplus man to make the room
      if (rosterCountOf(s, teamCode) >= rosterLimitFor(s.stage)) {
        const victim = repairCutCandidate(s, teamCode, hole.position, { room, price: emergencyPrice(s, pick) });
        if (!victim) break;
        released.push({ playerId: victim.id, name: victim.name, position: victim.position, overall: victim.overall });
        applyRelease(s, teamCode, victim.id);
        continue; // re-read the room: the cut's dead money counts
      }

      const salary = emergencyPrice(s, pick);
      pick.free_agent = false;
      pick.nfl_team = teamCode;
      // the same builder every other signing uses, one year at the emergency price
      pick.contract = offerToContract({ teamCode, baseSalary: salary, years: 1, signingBonus: 0, guaranteed: 0 }, minSalaryM(s));
      if (s.standingFreeAgents) s.standingFreeAgents = s.standingFreeAgents.filter((id) => id !== pick.id);
      signed.push({ playerId: pick.id, name: pick.name, position: pick.position, overall: pick.overall, salary });
      have++;
    }
    if (have < hole.need) unresolved.push({ position: hole.position, have, need: hole.need });
  }

  if (signed.length === 0 && released.length === 0 && unresolved.length === 0) return null;
  const record: RepairRecord = { id: `${s.season}|${s.stage}|${teamCode}`, season: s.season, stage: s.stage, team: teamCode, human, signed, released, unresolved };
  const log = (s.rosterRepairs ??= []);
  const at = log.findIndex((x) => x.id === record.id);
  if (at >= 0) log[at] = record;
  else log.push(record);
  if (log.length > KEEP_RECORDS) log.splice(0, log.length - KEEP_RECORDS);
  return record;
}

/** Every team, weakest first (waiver order), human or CPU alike. Returns the records made. */
export function repairAllRosters(s: LeagueState): RepairRecord[] {
  if (repairBlockedBy(s)) return [];
  const order = Object.keys(s.teams).sort(
    (a, b) => (s.teams[a]!.ratings.overall - s.teams[b]!.ratings.overall) || (a < b ? -1 : 1),
  );
  const out: RepairRecord[] = [];
  for (const code of order) {
    const r = repairRoster(s, code);
    if (r) out.push(r);
  }
  if (out.length > 0) recomputeTeamRatings(s);
  return out;
}

/**
 * The hook for a stage transition. `entering` is the stage being entered; callers that run
 * before `s.stage` is assigned (the single-player store's `applyStageEntry`) pass it, and the
 * repair reads the league as if that stage had begun. A no-op unless it is a checkpoint stage
 * with no market open.
 */
export function runRepairCheckpoint(s: LeagueState, entering: Stage = s.stage): RepairRecord[] {
  if (!REPAIR_CHECKPOINTS.includes(entering)) return [];
  const prior = s.stage;
  s.stage = entering;
  try {
    return repairAllRosters(s);
  } finally {
    s.stage = prior;
  }
}

const posName = (p: string): string => p;

/** The sentence a GM reads afterwards. */
export function describeRepair(r: RepairRecord): string {
  const parts: string[] = [];
  if (r.signed.length) {
    parts.push(
      `signed ${r.signed
        .map((x) => `${x.name} (${posName(x.position)} ${x.overall}, $${x.salary.toFixed(1)}M for one year)`)
        .join(", ")}`,
    );
  }
  if (r.released.length) parts.push(`released ${r.released.map((x) => `${x.name} (${x.position} ${x.overall})`).join(", ")} to make room`);
  const head = parts.length ? `Your staff ${parts.join(" and ")} so the roster could field a lineup.` : "";
  const gaps = r.unresolved.length
    ? ` Still short: ${r.unresolved.map((x) => `${x.position} ${x.have}/${x.need}`).join(", ")} — no one eligible was affordable, so a placeholder plays.`
    : "";
  return (head + gaps).trim();
}

/** The latest repair records for one team, newest first. */
export function repairsFor(s: Pick<LeagueState, "rosterRepairs">, teamCode: string, season?: number): RepairRecord[] {
  return (s.rosterRepairs ?? []).filter((r) => r.team === teamCode && (season === undefined || r.season === season)).reverse();
}
