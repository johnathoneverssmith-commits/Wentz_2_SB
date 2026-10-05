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
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        margin: "0 22px 4px",
        padding: "8px 12px",
        border: "1px solid var(--line)",
        borderRadius: "var(--r-md)",
        background: "var(--panel-sunken)",
        fontSize: 12.5,
      }}
    >
      <span style={{ color: "var(--ink-faint)" }}>Game plan</span>
      <strong style={{ color: custom ? "var(--team)" : "var(--ink-dim)" }}>{custom ? "Custom" : "Standard"}</strong>
      <span style={{ flex: 1, color: "var(--ink-faint)", fontSize: 11.5 }}>
        Pass rate, fourth down, blitz, personnel and backs, for the games you play next.
      </span>
      <button type="button" onClick={() => nav("/game-plan")}>
        Adjust
      </button>
    </div>
  );
}
