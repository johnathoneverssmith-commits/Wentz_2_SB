/**
 * Injuries, from the game that caused them to the roster that carries them.
 *
 * The engine has simulated injuries all along (`injuries: true` on every game
 * the adapter runs) but only the viewer's game carried them back, buried in
 * its broadcast. Nothing ever wrote one onto a player, so the hub's Injuries
 * tab read "No injuries reported" for an entire dynasty, `injury_history`
 * never grew, and `injuryAgeReduction` — the part of the retirement model that
 * exists to shorten a battered career — had nothing to work with.
 */
import type { GameResult, InjuryEvent, LeagueState, Player } from "@/domain";

/** Weeks a severity costs, when the event doesn't project a range itself. */
const FALLBACK_WEEKS: Record<string, [number, number]> = {
  minor: [1, 1],
  moderate: [2, 4],
  significant: [4, 8],
  severe: [8, 14],
  season: [17, 17],
};

/** The engine's severities, mapped to the vocabulary `injury_history` uses. */
function historySeverity(severity: string): string {
  return severity === "severe" || severity === "season" ? "significant" : severity;
}

function weeksFor(ev: InjuryEvent): [number, number] {
  const projected = ev.projectedWeeks;
  if (Array.isArray(projected) && Number.isFinite(projected[0]) && Number.isFinite(projected[1])) {
    return [projected[0], projected[1]];
  }
  return FALLBACK_WEEKS[ev.severity] ?? [1, 2];
}

/** The status word the hub colours by, from how long he's out. */
function statusFor(weeks: number): Player["injury_status"] extends null ? never : "questionable" | "doubtful" | "out" {
  if (weeks <= 1) return "questionable";
  if (weeks <= 2) return "doubtful";
  return "out";
}

/**
 * Writes a week's injuries onto the players who suffered them.
 *
 * A player already hurt keeps whichever injury is worse — a knock in week 3
 * shouldn't shorten a broken leg from week 2.
 */
export function applyInjuries(state: LeagueState, results: GameResult[], season: number): void {
  for (const game of results) {
    for (const ev of game.injuries ?? []) {
      const p = state.players[ev.playerId];
      if (!p || p.retired) continue;
      const [lo, hi] = weeksFor(ev);
      const out = Math.max(1, Math.round((lo + hi) / 2));
      const already = p.injury_status?.weeks_out_est?.[1] ?? 0;
      if (out < already) continue;
      p.injury_status = {
        status: statusFor(out),
        weeks_out_est: [lo, hi],
        description: ev.bodyPart || ev.suspectedType || "undisclosed",
      };
      p.injury_history = [
        ...(p.injury_history ?? []),
        {
          season,
          type: ev.suspectedType || ev.bodyPart || "undisclosed",
          severity: historySeverity(ev.severity),
          weeks_out: out,
        },
      ];
    }
  }
}

/**
 * A week goes by. Everyone hurt gets a week closer, and whoever has run out
 * of weeks is back.
 */
export function healOneWeek(state: LeagueState): void {
  for (const p of Object.values(state.players)) {
    const inj = p.injury_status;
    if (!inj) continue;
    const [lo, hi] = inj.weeks_out_est ?? [0, 0];
    const nextHi = hi - 1;
    if (nextHi <= 0) {
      p.injury_status = null;
      continue;
    }
    p.injury_status = {
      ...inj,
      status: statusFor(nextHi),
      // still out means still at least a week out — a range starting at 0
      // reads as "might play", which is what `questionable` already says
      weeks_out_est: [Math.max(1, Math.min(lo - 1, nextHi)), nextHi],
    };
  }
}

/** Everyone starts a new season healthy; an offseason is longer than any injury. */
export function clearInjuries(state: LeagueState): void {
  for (const p of Object.values(state.players)) p.injury_status = null;
}

/**
 * The roster to hand the simulator: the healthy players, except that a
 * position stripped bare sends its injured man out anyway. The engine builds
 * its depth chart from whatever it is given, and a team with no quarterback
 * on the sheet is a crash, not a hardship.
 */
export function availableRoster(roster: Player[]): Player[] {
  const healthy = roster.filter((p) => !p.injury_status || p.injury_status.status !== "out");
  const covered = new Set(healthy.map((p) => p.position));
  const playingHurt = roster.filter((p) => !covered.has(p.position));
  if (playingHurt.length === 0) return healthy;
  // the least-hurt man at each uncovered position suits up
  const bySpot = new Map<string, Player>();
  for (const p of playingHurt) {
    const cur = bySpot.get(p.position);
    const weeks = (x: Player) => x.injury_status?.weeks_out_est?.[1] ?? 0;
    if (!cur || weeks(p) < weeks(cur)) bySpot.set(p.position, p);
  }
  return [...healthy, ...bySpot.values()];
}
