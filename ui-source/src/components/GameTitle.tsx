import { useEffect, useRef, useState } from "react";
import { teamMeta } from "@/data/teams";
import { gameTitle, possessive, BASE_TITLE } from "@/state/gameTitle";
import "@/visual/visual.css";

/**
 * "Road to the Super Bowl" until a team is chosen, then "The Browns' Road to
 * the Super Bowl". Choosing a team plays a short title swap (a rising
 * reveal and a team-colour sweep); reduced-motion and the app's motion
 * setting both turn it into an instant change.
 */
export function GameTitle({ team, eyebrow }: { team?: string; eyebrow?: string }) {
  const name = team ? teamMeta(team).name : undefined;
  const prev = useRef(team);
  const [swap, setSwap] = useState(false);
  useEffect(() => {
    if (prev.current === team) return;
    prev.current = team;
    setSwap(true);
    const t = setTimeout(() => setSwap(false), 1100);
    return () => clearTimeout(t);
  }, [team]);
  return (
    <div className={`title-wrap${swap ? " swap" : ""}`}>
      {eyebrow && <p className="eyebrow">{eyebrow}</p>}
      {/* the visible title is replaced when a team is chosen; this says so to a screen reader */}
      <p className="sr-only" role="status">{name ? `You are the ${name}. ${gameTitle(name)}.` : ""}</p>
      <h1 className="game-title" key={team ?? "none"} aria-label={gameTitle(name)}>
        {name ? (
          <>
            The <span className="t-team">{possessive(name)}</span> {BASE_TITLE}
          </>
        ) : (
          BASE_TITLE
        )}
      </h1>
    </div>
  );
}
