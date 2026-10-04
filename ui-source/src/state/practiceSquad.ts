/**
 * The practice squad: sixteen young players a team keeps without spending a
 * roster spot on them.
 *
 * Without one, every cut-down day sent a team's late-round rookies to the
 * open market, so a fourth-round pass rusher who needed two years was gone
 * the summer he arrived, and a team had no way to develop depth except by
 * playing it. A practice-squad player:
 *
 *  - doesn't count against the 53 and doesn't play in games
 *  - is on a one-year practice-squad deal ($0.2M, counted against the cap
 *    as in the NFL), so he reaches the market at the season's end unless he
 *    is promoted and signed
 *  - is eligible only early in his career (two accrued seasons or fewer)
 *    and only off a minimum-level deal, so the squad can't hide a big
 *    contract
 *
 * He is kept on the team as `nfl_team = "PS:<team>"`: every roster count,
 * game roster and cap line filters by `nfl_team === team`, and a practice
 * squad belongs outside all of them.
 */
import type { LeagueState, Player } from "@/domain";
import { ROSTER_SIZE } from "@/sim/roster-template";

import type { ContractMoveResult } from "./contracts";
import { onInjuredReserve } from "./injuries";

export const PRACTICE_SQUAD_SIZE = 16;
export const PRACTICE_SQUAD_SALARY_M = 0.2;
/** The most a player's current deal can pay and still go to the squad. */
const PS_MAX_CAP_HIT_M = 1.5;
const ACTIVE_MINIMUM_M = 1;

export const psCode = (team: string): string => `PS:${team}`;
export const isPracticeSquad = (p: Player): boolean => p.nfl_team.startsWith("PS:");
/** The team a practice-squad player belongs to. */
export const practiceSquadTeam = (p: Player): string | null => (isPracticeSquad(p) ? p.nfl_team.slice(3) : null);

export function practiceSquad(s: LeagueState, team: string): Player[] {
  const code = psCode(team);
  return Object.values(s.players)
    .filter((p) => p.nfl_team === code && !p.retired)
    .sort((a, b) => b.overall - a.overall);
}

/** Young enough, and cheap enough, to go to the squad. */
export function practiceSquadEligible(p: Player): boolean {
  if (p.retired || p.free_agent || isPracticeSquad(p)) return false;
  return p.years_pro <= 2 && (p.contract?.cap_hit_by_year[0] ?? 0) <= PS_MAX_CAP_HIT_M;
}

export function checkToPracticeSquad(s: LeagueState, p: Player): ContractMoveResult {
  if (!s.teams[p.nfl_team]) return { ok: false, reason: "He isn't on a roster." };
  if (p.years_pro > 2) return { ok: false, reason: "Only players with two seasons or fewer can go to the practice squad." };
  if ((p.contract?.cap_hit_by_year[0] ?? 0) > PS_MAX_CAP_HIT_M) {
    return { ok: false, reason: "His contract is too big for the practice squad." };
  }
  if (onInjuredReserve(p, s.stage)) return { ok: false, reason: "He's on injured reserve." };
  if (practiceSquad(s, p.nfl_team).length >= PRACTICE_SQUAD_SIZE) {
    return { ok: false, reason: `The practice squad is full (${PRACTICE_SQUAD_SIZE}).` };
  }
  return { ok: true };
}

export function toPracticeSquad(s: LeagueState, p: Player): ContractMoveResult {
  const check = checkToPracticeSquad(s, p);
  if (!check.ok) return check;
  const team = p.nfl_team;
  p.nfl_team = psCode(team);
  p.contract = {
    team_id: team,
    years_remaining: 1,
    total_value: PRACTICE_SQUAD_SALARY_M,
    guaranteed: 0,
    cap_hit_by_year: [PRACTICE_SQUAD_SALARY_M],
    signing_bonus: 0,
  };
  // the depth chart forgets him; he isn't playing
  for (const order of Object.values(s.depthChart[team] ?? {})) {
    const i = order.indexOf(p.id);
    if (i >= 0) order.splice(i, 1);
  }
  return { ok: true };
}

export function checkPromote(s: LeagueState, p: Player): ContractMoveResult {
  const team = practiceSquadTeam(p);
  if (!team || !s.teams[team]) return { ok: false, reason: "He isn't on a practice squad." };
  const active = Object.values(s.players).filter(
    (x) => x.nfl_team === team && !x.retired && !onInjuredReserve(x, s.stage),
  ).length;
  if (active >= ROSTER_SIZE) return { ok: false, reason: `The active roster is full (${ROSTER_SIZE}). Make room first.` };
  const t = s.teams[team]!;
  if (t.cap.used - PRACTICE_SQUAD_SALARY_M + ACTIVE_MINIMUM_M > t.cap.total) {
    return { ok: false, reason: "There's no cap room for an active-roster deal." };
  }
  return { ok: true };
}

/** Up to the 53, on a one-year minimum deal. */
export function promoteFromPracticeSquad(s: LeagueState, p: Player): ContractMoveResult {
  const check = checkPromote(s, p);
  if (!check.ok) return check;
  const team = practiceSquadTeam(p)!;
  p.nfl_team = team;
  p.contract = {
    team_id: team,
    years_remaining: 1,
    total_value: ACTIVE_MINIMUM_M,
    guaranteed: 0,
    cap_hit_by_year: [ACTIVE_MINIMUM_M],
    signing_bonus: 0,
  };
  return { ok: true };
}
