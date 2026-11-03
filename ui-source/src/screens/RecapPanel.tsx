import { useMemo } from "react";

import { TEAMS_BY_CODE } from "@/data/teams";
import type { GameResult } from "@/domain";

import { buildRecap } from "../../../src/engine/recap.js";

const teamName = (code: string): string => TEAMS_BY_CODE[code]?.name ?? code;

/**
 * The postgame recap: what happened, who stood out, and the moments that
 * decided it. Written by `buildRecap` from the game's own record — the scores,
 * the recorded player lines and, where the game still has them, its plays —
 * so it says nothing the box score does not support.
 */
export function RecapPanel({ game }: { game: GameResult }): JSX.Element {
  const recap = useMemo(() => buildRecap(game, { teamName }), [game]);
  return (
    <div className="gdy-recap">
      <h2>{recap.headline}</h2>
      {recap.paragraphs.map((p, i) => (
        <p key={i}>{p}</p>
      ))}

      {recap.keyMoments.length > 0 && (
        <>
          <p className="sectionlabel">Key moments</p>
          {recap.keyMoments.map((m, i) => (
            <div key={i} className="neg-row">
              <div style={{ minWidth: 0 }}>
                <span className="pname">{m.text}</span>
                <p className="gdy-sub">{m.why}</p>
              </div>
              <span className="gdy-recap-when">
                {m.quarter >= 5 ? "OT" : `Q${m.quarter}`}
                {m.clock ? ` ${m.clock}` : ""}
              </span>
            </div>
          ))}
        </>
      )}

      {recap.standouts.length > 0 && (
        <>
          <p className="sectionlabel">Standouts</p>
          {recap.standouts.map((s, i) => (
            <div key={i} className="neg-row">
              <div style={{ minWidth: 0 }}>
                <span className="pname">
                  {s.name} <span className="ppos">{s.position}</span>
                </span>
                <p className="gdy-sub">{s.line}</p>
              </div>
              <span className="gdy-recap-when">{TEAMS_BY_CODE[s.team]?.abbr ?? s.team}</span>
            </div>
          ))}
        </>
      )}

      {recap.basis !== "broadcast" && (
        <p className="gdy-note gdy-note--left">
          {recap.basis === "scoring_summary"
            ? "Built from the scoring summary and the recorded player lines; the play-by-play of this game is not kept."
            : "Only the final score was kept for this game."}
        </p>
      )}
    </div>
  );
}
