import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";

import { Card, CardHeader, Footer } from "@/components/primitives";
import type { GameBroadcast } from "@/domain";
import { fetchBroadcast, onlineSession } from "@/state/online";
import { useStore } from "@/state/store";

import { Gamecast } from "./gamecast/Gamecast";

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
  const game = useStore((s) => s.games.find((g) => g.id === gameId));

  const [fetched, setFetched] = useState<GameBroadcast | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const saved = game?.broadcast ?? null;
  const online = onlineSession() !== null;

  useEffect(() => {
    if (!gameId || saved || !online) return;
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
  }, [gameId, saved, online]);

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
      <Card maxWidth={860}>
        <CardHeader badge="TV" title="Play-by-Play" subtitle="Nothing to watch" />
        <div className="panel open">
          <div className="emptystate">
            {game ? "That game hasn't been played yet." : "That game isn't in this league."}
          </div>
        </div>
        {footer}
      </Card>
    );
  }

  return (
    <Card maxWidth={860}>
      <CardHeader
        badge="TV"
        title="Play-by-Play"
        subtitle={`${game.awayTeam} at ${game.homeTeam} · ${game.phase === "PRE" ? "Preseason " : ""}Week ${game.week}`}
      />
      <div className="panel open">
        {loading && <div className="emptystate">Rebuilding the broadcast…</div>}
        {error && (
          <div className="notice bad" role="status">
            {error}
          </div>
        )}
        {broadcast && <Gamecast game={{ ...game, broadcast }} />}
        {!loading && !error && !broadcast && (
          <div className="emptystate">
            No play-by-play was kept for this game — the final score is all there is.
          </div>
        )}
      </div>
      {footer}
    </Card>
  );
}
