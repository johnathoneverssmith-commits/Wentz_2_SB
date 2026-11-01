import type { LeagueState } from "@/domain";

/**
 * Where the league's transactions are allowed to happen.
 *
 * A human GM acquires players and trades only inside a designated simultaneous
 * window — never on demand. These are the single source of truth for that, read
 * by the server (`online/src/decide.ts`), the local action layer
 * (`useLeagueActions`/store) and the screens that grey a control out.
 *
 *  - free agency: the five-round event (`freeAgencyEvent`) is running, in any
 *    of the three stages that host it. Offers are made on the GM's own turn.
 *  - trading: the Trade Deadline event (`tradeDeadline` stage). Its turns,
 *    counters and responses have their own rulings.
 *
 * Roster repair of a CPU team is the one signing that is not a round; it has
 * its own authorisation (`decideCpuRepairSigning`) and is not a window.
 */
const FREE_AGENCY_STAGES: ReadonlySet<string> = new Set([
  "freeAgency",
  "midseasonFreeAgency",
  "offseasonFreeAgency",
]);

export const FREE_AGENCY_WINDOW_MESSAGE =
  "Free agents can only be signed during the scheduled free-agency rounds. You can still browse the market.";
export const TRADE_WINDOW_MESSAGE =
  "Trades can only be proposed during the Trade Deadline window. You can still review trade history and values.";

export function freeAgencyWindowOpen(s: Pick<LeagueState, "stage" | "freeAgencyEvent">): boolean {
  return FREE_AGENCY_STAGES.has(s.stage) && !!s.freeAgencyEvent && !s.freeAgencyEvent.complete;
}

export function tradeWindowOpen(s: Pick<LeagueState, "stage">): boolean {
  return s.stage === "tradeDeadline";
}
