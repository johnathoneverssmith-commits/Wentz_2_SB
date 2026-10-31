import { useMemo } from "react";

import type { GameResult } from "@/domain";
import { buildFanPosts, latestFanGame, priorGamesOf, type FanPost } from "@/state/fanReactions";
import { seasonShape } from "@/state/leagueFormat";
import { onlineSession } from "@/state/online";
import { viewerTeamCode } from "@/state/selectors";
import { useStore } from "@/state/store";

/**
 * Presentational list of fan posts. Style it through the `.fan-reactions*`
 * classes and the `--team` / `--team-on` custom properties (team identity);
 * each post carries `data-tone` so tone can be themed without touching logic.
 */
export function FanPosts({ posts, title = "What the Fans Are Saying", subtitle }: { posts: FanPost[]; title?: string; subtitle?: string }): JSX.Element {
  return (
    <section className="fan-reactions ui-surface" aria-labelledby="fan-reactions-title" data-testid="fan-reactions">
      <div className="ui-section-heading">
        <div>
          <h2 id="fan-reactions-title">{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
      </div>
      {posts.length === 0 ? (
        <p className="fan-reactions__empty" data-testid="fan-reactions-empty">
          The fans are waiting on a game. Once you've watched one, they'll have something to say.
        </p>
      ) : (
        <ul className="fan-reactions__list" style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 10 }}>
          {posts.map((p) => (
            <li key={p.id} className="fan-reactions__post" data-tone={p.tone} data-basis={p.basis} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
              <span
                aria-hidden="true"
                className="fan-reactions__avatar"
                style={{ flex: "none", width: 34, height: 34, borderRadius: "50%", display: "grid", placeItems: "center", background: "var(--team, #444)", color: "var(--team-on, #fff)", fontWeight: 700, fontSize: 14 }}
              >
                {p.handle.replace("@", "").charAt(0)}
              </span>
              <div style={{ minWidth: 0 }}>
                <p style={{ margin: 0, fontSize: 12.5 }}>
                  <strong>{p.handle}</strong> <span style={{ color: "var(--ink-faint)" }}>· {p.bio}</span>
                </p>
                <p className="fan-reactions__text" style={{ margin: "2px 0 0", fontSize: 13.5, lineHeight: 1.45 }}>{p.text}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="fan-reactions__note" style={{ margin: "10px 0 0", fontSize: 11, color: "var(--ink-faint)" }}>
        Invented fans, real results: every number comes from the game's record.
      </p>
    </section>
  );
}

/** The Command Center section: fans reacting to this GM's most recently revealed game. */
export function FanReactions(): JSX.Element | null {
  const s = useStore();
  const code = viewerTeamCode(s);
  const online = onlineSession() !== null;
  const game: GameResult | undefined = useMemo(() => (code ? latestFanGame(s, code, online) : undefined), [s, code, online]);
  const posts = useMemo(() => {
    if (!game || !code) return [];
    const team = s.teams[code];
    const prior = priorGamesOf(s, code, game, online);
    const record = team ? { wins: team.wins, losses: team.losses, ties: team.ties } : undefined;
    return buildFanPosts(game, code, { prior, record, gamesLeft: game.phase === "REG" ? Math.max(0, seasonShape(s).regularSeasonWeeks - game.week) : undefined });
    // keyed on the game, not the whole store: the same game keeps the same posts
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game?.id, code]);
  if (!code) return null;
  return <FanPosts posts={posts} {...(game ? { subtitle: `After ${game.awayTeam} at ${game.homeTeam}, ${game.awayScore}–${game.homeScore}` } : {})} />;
}
