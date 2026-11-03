import { useMemo } from "react";
import { useNavigate } from "react-router-dom";

import { Footer } from "@/components/primitives";
import { GameDayMasthead } from "@/design/GameDayMasthead";
import { GdPage } from "@/design/GdPage";
import { TEAMS_BY_CODE } from "@/data/teams";
import { roundLabelFor, type GameResult } from "@/domain";
import { describeTrace } from "@/state/gameHistory";
import { onlineSession } from "@/state/online";
import { visibleGames } from "@/state/reveal";
import { viewerTeamCode } from "@/state/selectors";
import { useStore } from "@/state/store";

import "@/design/gameday.css";
import "@/design/gameday-blocks.css";
import "./game-days-gameday.css";

type Row = GameResult & { season: number };

const order = (g: { phase: string; week: number }): number =>
  g.phase === "PRE" ? g.week : g.phase === "REG" ? 100 + g.week : 200 + ["WC", "DIV", "CONF", "SB"].indexOf(g.phase);

/**
 * Every game your team has played — this season and the seasons kept in the
 * archive — newest first, each with its box score and play-by-play. Online it
 * lists only the games this GM has watched.
 */
export function GameHistory(): JSX.Element {
  const nav = useNavigate();
  const s = useStore();
  const code = viewerTeamCode(s);

  const rows = useMemo<Row[]>(() => {
    const current = (onlineSession() ? visibleGames(s, s.viewerGmId) : s.games).map((g) => ({ ...g, season: s.season }));
    const all: Row[] = [...current, ...(s.gameArchive ?? [])];
    return all
      .filter((g) => g.played && !!code && (g.homeTeam === code || g.awayTeam === code))
      .sort((a, b) => b.season - a.season || order(b) - order(a));
  }, [s, code]);

  const phaseLabel = (g: Row): string =>
    g.phase === "PRE" ? `Preseason week ${g.week}` : g.phase === "REG" ? `Week ${g.week}` : roundLabelFor(s.bracket, g.phase);

  return (
    <GdPage code={code} className="gdy">
      <GameDayMasthead
        code={code ?? ""}
        compact
        title={`${rows.length} ${rows.length === 1 ? "game" : "games"} played`}
        heading="Game history"
        sub="Your games, newest first, each with its box score and play-by-play."
      />
      <div className="gdy-section gdy-history">
        {rows.length === 0 && <div className="emptystate">No games played yet. Results appear here after your first game.</div>}
        {rows.map((g) => {
          const home = g.homeTeam === code;
          const us = home ? g.homeScore : g.awayScore;
          const them = home ? g.awayScore : g.homeScore;
          const opp = home ? g.awayTeam : g.homeTeam;
          const trace = describeTrace(g);
          const result = us > them ? "W" : us < them ? "L" : "T";
          return (
            <div key={g.id} className="neg-row gdy-hrow" data-testid="history-row">
              <span className={"gdy-hres" + (result === "W" ? " gdy-won" : result === "L" ? " gdy-lost" : "")}>{result}</span>
              <span className="gdy-hmain">
                <span className="pname">
                  {result} {us}–{them} {home ? "vs" : "@"} {TEAMS_BY_CODE[opp]?.label ?? opp}
                </span>
                <span className="gdy-sub">
                  {g.season} · {phaseLabel(g)}
                </span>
              </span>
              <span className="gdy-hactions">
                {g.totals && (
                  <button type="button" className="btnlink" onClick={() => nav(`/box/${g.id}?back=/games`)}>
                    Box score
                  </button>
                )}
                <button type="button" className="btnlink btn-primary" onClick={() => nav(`/watch/${g.id}?back=/games`)}>
                  {trace === "full" ? "Play-by-play" : trace === "summary" ? "Scoring summary" : "Details"}
                </button>
              </span>
            </div>
          );
        })}
      </div>
      <Footer>
        <button type="button" className="btnlink" onClick={() => nav("/hub")}>
          Back to team hub
        </button>
      </Footer>
    </GdPage>
  );
}
