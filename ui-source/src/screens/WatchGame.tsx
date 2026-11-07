import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";

import { Footer } from "@/components/primitives";
import { GdPage } from "@/design/GdPage";
import { GameDayMasthead } from "@/design/GameDayMasthead";
import "@/design/gameday.css";
import "@/design/gameday-blocks.css";
import { roundLabelFor, type GameBroadcast, type PlayoffRound } from "@/domain";
import { fetchBroadcast, onlineSession } from "@/state/online";
import { useStore } from "@/state/store";
import { viewerTeamCode } from "@/state/selectors";

import { findGame, archivedSeasonOf, describeTrace } from "@/state/gameHistory";
import { Gamecast } from "./gamecast/Gamecast";
import { PlayByPlayLog, ScoringSummary } from "./gamecast/PlayByPlayLog";
import "./gamecast/gamecast-gameday.css";

/**
 * Watch a game that has already been played.
 *
 * Online, the play-by-play is not in the league document — the block saved
 * scores and injuries and threw the trace away, because a broadcast is ~44KB
 * and the document travels whole on every request. So this screen asks for
 * one game's worth and the server rebuilds it from the same seed and the same
 * two lineups. The wait is a second and it happens at most a few times a
 * season; the alternative was six megabytes on every pull for everyone.
 *
 * Offline, the broadcast is already attached to the game and there is nothing
 * to fetch, so the same screen just renders it.
 */
export function WatchGame() {
  const { gameId } = useParams();
  const nav = useNavigate();
  const [params] = useSearchParams();
  // Where the GM came from. A results screen hands it its own URL, week and
  // all, so "Return to Game Results" lands on the tab they left rather than
  // on the default one.
  const back = params.get("back");
  const game = useStore((s) => findGame(s, gameId));
  const archivedSeason = useStore((s) => (gameId ? archivedSeasonOf(s, gameId) : null));
  const bracket = useStore((s) => s.bracket);
  const viewerCode = useStore((s) => viewerTeamCode(s));

  const [fetched, setFetched] = useState<GameBroadcast | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showLog, setShowLog] = useState(false);

  const saved = game?.broadcast ?? null;
  const online = onlineSession() !== null;

  useEffect(() => {
    if (!gameId || saved || !online || archivedSeason !== null) return;
    let live = true;
    setLoading(true);
    setError(null);
    fetchBroadcast(gameId)
      .then((b) => {
        if (live) setFetched(b);
      })
      .catch((e: unknown) => {
        if (live) setError(e instanceof Error ? e.message : "Couldn't load the play-by-play.");
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [gameId, saved, online, archivedSeason]);

  const broadcast = saved ?? fetched;

  // Coming from a results screen, that is the only way out the spec allows:
  // the detail views are a side trip, not a fork in the road.
  const footer = back ? (
    <Footer>
      <button type="button" className="btnlink btn-primary" onClick={() => nav(back)}>
        Return to Game Results
      </button>
    </Footer>
  ) : (
    <Footer>
      {game && (
        <button type="button" className="btnlink" onClick={() => nav(`/box/${game.id}`)}>
          Full box score
        </button>
      )}
      <button type="button" className="btnlink btn-primary" onClick={() => nav("/hub")}>
        Back to team hub
      </button>
    </Footer>
  );

  if (!game || !game.played) {
    return (
      <GdPage code={viewerCode} className="wg">
        <GameDayMasthead code={viewerCode ?? ""} compact title="Play-by-Play" sub="Nothing to watch" />
        <section className="wg-panel">
          <div className="emptystate">
            {!game
              ? "That game isn't in this league."
              : online
                ? // online a game can be played and still hidden until you watch that far
                  "You haven't watched that far yet — reveal it from the team hub first."
                : "That game hasn't been played yet."}
          </div>
        </section>
        {footer}
      </GdPage>
    );
  }

  const when =
    game.phase === "PRE"
      ? `Preseason Week ${game.week}`
      : game.phase === "REG"
        ? `Week ${game.week}`
        : roundLabelFor(bracket, game.phase as PlayoffRound);

  return (
    <GdPage code={game.homeTeam} className="wg">
      <GameDayMasthead
        code={game.homeTeam}
        compact
        title="Play-by-Play"
        sub={`${game.awayTeam} at ${game.homeTeam} · ${when}`}
      />
      <section className="wg-panel">
        {loading && (
          <div className="emptystate wg-loading" role="status">
            Rebuilding the broadcast…
          </div>
        )}
        {error && (
          <div className="notice bad" role="status">
            {error}
          </div>
        )}
        {archivedSeason !== null && <p className="wg-season">{archivedSeason} season</p>}
        {broadcast && (
          <>
            <Gamecast game={{ ...game, broadcast }} />
            <button type="button" className="btnlink wg-toggle" aria-expanded={showLog} onClick={() => setShowLog((v) => !v)}>
              {showLog ? "Hide full transcript" : "Show full transcript (shows the result)"}
            </button>
            {showLog && <PlayByPlayLog broadcast={broadcast} />}
          </>
        )}
        {!loading && !error && !broadcast && describeTrace(game) === "summary" && <ScoringSummary game={game} />}
        {!loading && !error && !broadcast && describeTrace(game) === "none" && (
          <div className="emptystate">
            No play-by-play or scoring summary was kept for this game — the final score is all there is.
            {archivedSeason !== null ? " Plays from seasons before the last one are not kept, to keep saves small." : ""}
          </div>
        )}
      </section>
      {footer}
    </GdPage>
  );
}
