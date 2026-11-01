import { useMemo, useState } from "react";

import { TEAMS_BY_CODE } from "@/data/teams";
import type { BroadcastPlay, GameBroadcast, GameResult, ScoringPlay } from "@/domain";

import { narrateBroadcast, type Seg } from "../../../../src/engine/narration.js";

const teamName = (code: string): string => TEAMS_BY_CODE[code]?.name ?? code;
const qLabel = (q: number): string => (q >= 5 ? "OT" : `Q${q}`);
const segText = (segs: readonly Seg[]): string => segs.map((s) => (typeof s === "string" ? s : s.name)).join("");

const OUTCOME: Record<string, string> = {
  touchdown: "Touchdown",
  turnover: "Turnover",
  field_goal: "Field goal",
  missed_field_goal: "Missed field goal",
  punt: "Punt",
  punt_return_td: "Punt returned for a touchdown",
  stalled: "Turned over on downs",
};

function isNotable(p: BroadcastPlay): boolean {
  return p.touchdown || p.turnover || p.gained >= 25 || p.call === "sack" || (p.scores?.length ?? 0) > 0;
}

/** The quarters that have recorded plays, by each play's own quarter (a drive can cross a quarter break). */
export function quartersOf(drives: readonly { quarter: number; plays: readonly { quarter: number }[] }[]): number[] {
  const qs = new Set<number>();
  for (const d of drives) {
    if (d.plays.length === 0) qs.add(d.quarter);
    for (const p of d.plays) qs.add(p.quarter);
  }
  return [...qs].sort((a, b) => a - b);
}

/** The indices of a drive's plays that belong to `quarter` ("all" = every play). */
export function playIndicesIn(drive: { plays: readonly { quarter: number }[] }, quarter: number | "all"): number[] {
  const out: number[] = [];
  drive.plays.forEach((p, i) => {
    if (quarter === "all" || p.quarter === quarter) out.push(i);
  });
  return out;
}

/**
 * The whole recorded game as a page you can scroll, one quarter at a time.
 *
 * It renders what the game recorded and nothing else: a drive that is not in
 * the trace is not drawn, and a quarter with no recorded plays says so. The
 * Gamecast above it is the replay; this is the transcript.
 */
export function PlayByPlayLog({ broadcast }: { broadcast: GameBroadcast }): JSX.Element {
  const quarters = useMemo(() => quartersOf(broadcast.drives), [broadcast]);
  const [quarter, setQuarter] = useState<number | "all">(quarters[0] ?? 1);
  const [only, setOnly] = useState<"all" | "notable">("all");
  const narration = useMemo(
    () => narrateBroadcast(broadcast.drives, { home: broadcast.home, away: broadcast.away }),
    [broadcast],
  );

  return (
    <section aria-label="Play-by-play log" data-testid="pbp-log">
      <p className="sectionlabel">Play-by-play log</p>
      <div role="tablist" aria-label="Quarter" style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "6px 0 10px" }}>
        {quarters.map((q) => (
          <button
            key={q}
            type="button"
            role="tab"
            aria-selected={quarter === q}
            className={`btnlink ${quarter === q ? "btn-primary" : ""}`}
            onClick={() => setQuarter(q)}
          >
            {qLabel(q)}
          </button>
        ))}
        <button type="button" role="tab" aria-selected={quarter === "all"} className={`btnlink ${quarter === "all" ? "btn-primary" : ""}`} onClick={() => setQuarter("all")}>
          Full game
        </button>
        <label style={{ marginLeft: "auto", fontSize: 12, color: "var(--ink-dim)", display: "flex", gap: 6, alignItems: "center" }}>
          <input type="checkbox" checked={only === "notable"} onChange={(e) => setOnly(e.target.checked ? "notable" : "all")} />
          Scoring, turnovers &amp; big plays only
        </label>
      </div>
      {broadcast.drives.map((d, di) => {
        const inQuarter = new Set(playIndicesIn(d, quarter));
        // a drive with no plays belongs to the quarter it started in
        if (d.plays.length === 0 ? quarter !== "all" && d.quarter !== quarter : inQuarter.size === 0) return null;
        const plays = d.plays
          .map((p, pi) => ({ p, pi }))
          .filter(({ p, pi }) => inQuarter.has(pi) && (only === "all" || isNotable(p)));
        if (only === "notable" && plays.length === 0) return null;
        const last = d.plays[d.plays.length - 1];
        return (
          <div key={di} className="neg-row" style={{ display: "block" }} data-testid="pbp-drive">
            <p style={{ margin: "0 0 4px", fontSize: 12.5, fontWeight: 600 }}>
              {qLabel(quarter === "all" ? d.quarter : quarter)} · {teamName(d.team)} · {d.plays.length} {d.plays.length === 1 ? "play" : "plays"}
              {quarter !== "all" && inQuarter.size < d.plays.length ? ` (${inQuarter.size} this quarter)` : ""} ·{" "}
              {OUTCOME[d.ended] ?? d.ended}
              {d.points > 0 ? ` (+${d.points})` : ""}
              {d.pointsAgainst > 0 ? ` (${teamName(d.side === "home" ? broadcast.away : broadcast.home)} +${d.pointsAgainst})` : ""}
              {last?.scoreAfter ? (
                <span style={{ color: "var(--ink-faint)", fontWeight: 400 }}>
                  {" "}
                  · {teamName(broadcast.away)} {last.scoreAfter[1]}, {teamName(broadcast.home)} {last.scoreAfter[0]}
                </span>
              ) : null}
            </p>
            <ol style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, lineHeight: 1.5, color: "var(--ink-dim)" }}>
              {plays.map(({ p, pi }) => (
                <li key={pi} style={{ fontWeight: isNotable(p) ? 600 : 400, color: isNotable(p) ? "var(--ink)" : undefined }}>
                  <span style={{ color: "var(--ink-faint)" }}>{p.clock} </span>
                  {(narration[di]?.[pi]?.before ?? []).map((b, bi) => (
                    <em key={bi}>{segText(b)} </em>
                  ))}
                  {segText(narration[di]?.[pi]?.play ?? []) || p.desc}
                </li>
              ))}
            </ol>
          </div>
        );
      })}
      {quarter !== "all" && !quarters.includes(quarter) && (
        <div className="emptystate">No plays were recorded for this quarter.</div>
      )}
    </section>
  );
}

/**
 * What is left when a game kept no play-by-play: its scoring plays and nothing
 * more. Labelled as a summary so it is never mistaken for the full record.
 */
export function ScoringSummary({ game }: { game: GameResult }): JSX.Element {
  const plays: ScoringPlay[] = game.scoringPlays ?? [];
  return (
    <section aria-label="Scoring summary" data-testid="pbp-summary">
      <div className="notice" role="status" style={{ marginBottom: 10 }}>
        The play-by-play for this game wasn't recorded, so this is the scoring summary — every scoring play the game kept,
        and nothing else.
      </div>
      {plays.length === 0 ? (
        <div className="emptystate">
          No scoring plays were recorded either. Final: {teamName(game.awayTeam)} {game.awayScore}, {teamName(game.homeTeam)}{" "}
          {game.homeScore}.
        </div>
      ) : (
        plays.map((p, i) => (
          <div key={i} className="neg-row">
            <span>
              <span className="pname">{p.description}</span>
              <span style={{ display: "block", fontSize: 11.5, color: "var(--ink-dim)" }}>{teamName(p.team)}</span>
            </span>
            <span style={{ fontSize: 11.5, color: "var(--ink-faint)", whiteSpace: "nowrap" }}>
              {qLabel(p.quarter)} · {game.awayTeam} {p.awayScore}–{p.homeScore} {game.homeTeam}
            </span>
          </div>
        ))
      )}
    </section>
  );
}
