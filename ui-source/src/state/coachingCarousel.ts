import type { Coach, CoachRole, LeagueState } from "@/domain";

/**
 * The coaching carousel.
 *
 * Staffs were permanent: ten seasons, not one coaching change, and no coach
 * contract ever ran down — the head coach a CPU team started with was its
 * head coach forever, however badly it went. This turns the offseason over
 * the way the league does, for CPU teams only (a human's staff is the GM's
 * to change, on the Coaching Staff screen):
 *
 * - every CPU staff contract loses a year;
 * - a head coach whose team won four games or fewer is fired, and so is one
 *   whose deal ran out after a losing season;
 * - a coordinator whose unit ranked in the league's bottom six on a losing
 *   team is fired;
 * - an expiring coach on a winning team is extended, anyone else walks;
 * - every vacancy is filled with the best available coach at the role — a
 *   fired coach can land elsewhere, never back where he was fired.
 *
 * Deterministic: the same league makes the same moves on every machine.
 */

export interface CoachingChange {
  season: number;
  team: string;
  role: CoachRole;
  departed: string | null;
  hired: string | null;
  reason: "fired" | "contract";
}

const CAROUSEL_ROLES: CoachRole[] = ["HC", "OC", "DC"];

export function coachRating(c: Coach): number {
  if (c.role === "HC") return ((c.gameManagement ?? 70) + (c.discipline ?? 70)) / 2;
  if (c.role === "OC" || c.role === "DC") return c.playCallIq ?? 70;
  return c.overall ?? 70;
}

export function runCoachingCarousel(s: LeagueState): CoachingChange[] {
  const changes: CoachingChange[] = [];
  const teams = Object.keys(s.teams).filter((c) => s.teams[c]!.controlledBy.kind === "ai");
  const barred = new Map<string, string>(); // coach id -> team that let him go
  const vacancies: { team: string; role: CoachRole; departed: string | null; reason: CoachingChange["reason"] }[] = [];
  const bottom = Math.max(1, Math.round(Object.keys(s.teams).length * 0.19));
  const nTeams = Object.keys(s.teams).length;

  for (const team of teams) {
    const t = s.teams[team]!;
    const losing = t.wins < t.losses;
    for (const role of CAROUSEL_ROLES) {
      const c = Object.values(s.coaches).find((x) => x.team === team && x.role === role);
      if (!c) {
        vacancies.push({ team, role, departed: null, reason: "contract" });
        continue;
      }
      if (c.contract) c.contract.yearsRemaining -= 1;
      const expired = !c.contract || c.contract.yearsRemaining <= 0;
      const unitRank = role === "OC" ? t.ratings.offenseRank : role === "DC" ? t.ratings.defenseRank : 0;
      const fired =
        role === "HC"
          ? t.wins <= 4 || (expired && losing)
          : losing && unitRank > nTeams - bottom;
      if (fired || (expired && losing)) {
        c.team = null;
        barred.set(c.id, team);
        vacancies.push({ team, role, departed: c.name, reason: fired ? "fired" : "contract" });
      } else if (expired) {
        c.contract = { yearsRemaining: 2 + (t.wins >= 12 ? 1 : 0), annualValue: c.contract?.annualValue ?? 3 };
      }
    }
  }

  // best vacancies choose first: the better team, then the head coach
  vacancies.sort(
    (a, b) =>
      s.teams[b.team]!.wins - s.teams[a.team]!.wins ||
      CAROUSEL_ROLES.indexOf(a.role) - CAROUSEL_ROLES.indexOf(b.role) ||
      a.team.localeCompare(b.team),
  );
  for (const v of vacancies) {
    const pool = Object.values(s.coaches)
      .filter((c) => c.team === null && c.role === v.role && barred.get(c.id) !== v.team)
      .sort((a, b) => coachRating(b) - coachRating(a) || a.id.localeCompare(b.id));
    const pick = pool[0];
    if (pick) {
      pick.team = v.team;
      pick.contract = { yearsRemaining: 3, annualValue: pick.contract?.annualValue ?? 3 };
    }
    changes.push({
      season: s.season,
      team: v.team,
      role: v.role,
      departed: v.departed,
      hired: pick?.name ?? null,
      reason: v.reason,
    });
  }

  // keep the last three offseasons of news
  s.coachingChanges = [...(s.coachingChanges ?? []).filter((c) => c.season > s.season - 3), ...changes];
  return changes;
}
