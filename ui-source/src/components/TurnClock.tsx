import { useEffect, useState } from "react";

import { onOnlineChange, phaseMsLeft } from "@/state/online";
import { TEAMS_BY_CODE } from "@/data/teams";
import { timeLeft } from "@/util/format";

/** The stages that run one team at a time, each turn on its own clock. */
export const TURN_STAGES: ReadonlySet<string> = new Set([
  "fantasyDraft",
  "offseasonDraft",
  "coachingDraft",
  "freeAgency",
  "midseasonFreeAgency",
  "tradeDeadline",
]);

/**
 * How long the team on the clock has before its staff acts for it.
 *
 * The lobby showed this; inside the league nothing did, so a GM on the
 * clock in the draft room had no idea the pick would be made for them in
 * ten minutes.
 */
export function TurnClock({ stage, yourTurn, team }: { stage: string; yourTurn: boolean; team?: string | null }) {
  const [, bump] = useState(0);
  const ms = phaseMsLeft();
  const finalMinutes = ms != null && ms < 120_000;
  useEffect(() => {
    const off = onOnlineChange(() => bump((n) => n + 1));
    // a minute is the display's resolution, except at the very end
    const tick = setInterval(() => bump((n) => n + 1), finalMinutes ? 5_000 : 30_000);
    return () => {
      off();
      clearInterval(tick);
    };
  }, [finalMinutes]);

  if (!TURN_STAGES.has(stage) || ms == null) return null;
  const urgent = yourTurn && ms < 5 * 60_000;
  return (
    <div className={`turnclock${urgent ? " urgent" : ""}`} role="timer">
      {yourTurn ? "Your clock" : team ? `${TEAMS_BY_CODE[team]?.abbr ?? team} on the clock` : "On the clock"}: {timeLeft(ms)}
      {yourTurn && <span className="hint">then your staff acts for you</span>}
    </div>
  );
}
