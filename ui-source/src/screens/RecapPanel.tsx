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
    <div>
      <h2 style={{ margin: "0 0 10px", fontSize: 18, lineHeight: 1.25 }}>{recap.headline}</h2>
      {recap.paragraphs.map((p, i) => (
        <p key={i} style={{ margin: "0 0 10px", fontSize: 13.5, lineHeight: 1.55, color: "var(--ink-dim)" }}>
          {p}
        </p>
      ))}

      {recap.keyMoments.length > 0 && (
        <>
          <p className="sectionlabel">Key moments</p>
          {recap.keyMoments.map((m, i) => (
            <div key={i} className="neg-row">
              <div style={{ minWidth: 0 }}>
                <span className="pname">{m.text}</span>
                <p style={{ margin: "2px 0 0", fontSize: 11.5, color: "var(--ink-dim)" }}>{m.why}</p>
              </div>
              <span style={{ fontSize: 11.5, color: "var(--ink-faint)", whiteSpace: "nowrap" }}>
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
                <p style={{ margin: "2px 0 0", fontSize: 11.5, color: "var(--ink-dim)" }}>{s.line}</p>
              </div>
              <span style={{ fontSize: 11.5, color: "var(--ink-faint)" }}>{TEAMS_BY_CODE[s.team]?.abbr ?? s.team}</span>
            </div>
          ))}
        </>
      )}

      {recap.basis !== "broadcast" && (
        <p style={{ margin: "12px 0 0", fontSize: 11, color: "var(--ink-faint)", lineHeight: 1.5 }}>
          {recap.basis === "scoring_summary"
            ? "Built from the scoring summary and the recorded player lines; the play-by-play of this game is not kept."
            : "Only the final score was kept for this game."}
        </p>
      )}
    </div>
  );
}
