import { useNavigate } from "react-router-dom";

import { isDefaultPlan } from "@/state/gamePlan";
import { viewerTeamCode } from "@/state/selectors";
import { useStore } from "@/state/store";

/**
 * A line above the week's tabs: what this team's game plan is, and a way to
 * change it before the games are played. The plan applies to every game
 * simulated from then on, so the place to remind a GM of it is the screen
 * they press "play" from.
 */
export function GamePlanStrip() {
  const nav = useNavigate();
  const code = useStore((s) => viewerTeamCode(s));
  const plan = useStore((s) => (code ? s.gamePlans?.[code] : undefined));
  const custom = !!plan && !isDefaultPlan(plan);
  return (
    <div className="plan-strip">
      <span className="plan-strip__k">Game plan</span>
      <strong className={custom ? "plan-strip__v plan-strip__v--custom" : "plan-strip__v"}>{custom ? "Custom" : "Standard"}</strong>
      <span className="plan-strip__note">Pass rate, fourth down, blitz, personnel and backs, for the games you play next.</span>
      <button type="button" onClick={() => nav("/game-plan")}>
        Adjust
      </button>
    </div>
  );
}
