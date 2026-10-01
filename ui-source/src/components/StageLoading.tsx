import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

/**
 * "One moment" for a screen whose stage data hasn't arrived — with a way out
 * if it never does.
 *
 * A turn-based screen waits for its event (the market, the coaching board) to
 * exist. Reached when the league is somewhere else — a reload that came back
 * signed out to a solo save, an old link — it said "One moment." forever.
 */
export function StageLoading() {
  const nav = useNavigate();
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), 4_000);
    return () => clearTimeout(t);
  }, []);
  return (
    <div className="emptystate">
      {slow ? (
        <>
          This isn&rsquo;t coming — the league is probably at a different stage.{" "}
          <button type="button" className="btnlink" onClick={() => nav("/")}>
            Go to where the league is
          </button>
        </>
      ) : (
        "One moment."
      )}
    </div>
  );
}
