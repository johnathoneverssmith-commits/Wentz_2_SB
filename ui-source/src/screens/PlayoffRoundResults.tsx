import { useNavigate, useParams } from "react-router-dom";

import { Card, CardHeader, Footer } from "@/components/primitives";
import { TEAMS_BY_CODE } from "@/data/teams";
import { roundLabelFor, type PlayoffRound } from "@/domain";
import { onlineSession } from "@/state/online";
import { revealedRounds, visibleGames } from "@/state/reveal";
import { leagueBadge } from "@/state/leagueFormat";
import { viewerTeamCode } from "@/state/selectors";
import { useStore } from "@/state/store";

import { WeekResults } from "./SeasonResults";

/**
 * One revealed playoff round.
 *
 * A round rather than a block: the postseason is revealed one round at a
 * time and there is no watch-it-all, because four rounds decide who is left
 * and taking them in a batch is watching the season end in a paragraph.
 *
 * Every game here carries its own detail controls, including the ones the
 * viewer is not in. In the regular season a GM follows their own team; in
 * January everybody watches everything, and a GM whose season ended in week
 * twelve is still in the league and still reading.
 */
export function PlayoffRoundResults() {
  const { round } = useParams();
  const nav = useNavigate();
  const s = useStore();
  const code = viewerTeamCode(s) ?? null;

  const r = (round ?? "WC") as PlayoffRound;
  const online = onlineSession() !== null;
  const seen = online ? visibleGames(s, s.viewerGmId) : s.games;
  const slate = seen.filter((g) => g.phase === r);

  // the one seed sits the wild card out, which is a result worth stating
  const byes = (s.bracket?.matchups ?? [])
    .filter((m) => m.round === r && (!m.highSeed || !m.lowSeed))
    .map((m) => m.highSeed?.code ?? m.lowSeed?.code)
    .filter((x): x is string => !!x);

  const revealed = online ? revealedRounds(s, s.viewerGmId).includes(r) : true;
  const back = `/results/round/${r}`;

  return (
    <Card maxWidth={860}>
      <CardHeader
        badge={leagueBadge(s)}
        title={roundLabelFor(s.bracket, r)}
        subtitle={`${s.season} postseason · ${revealed ? "results are in" : "not watched yet"}`}
      />
      <div className="panel open">
        {!revealed ? (
          <div className="emptystate">You haven&rsquo;t watched this round yet.</div>
        ) : (
          <>
            {/* the season's last result, and the page gave it the same line as
                any other game */}
            {r === "SB" &&
              slate
                .filter((g) => g.played && g.homeScore !== g.awayScore)
                .slice(0, 1)
                .map((g) => {
                  const winner = g.homeScore > g.awayScore ? g.homeTeam : g.awayTeam;
                  return (
                    <div key={g.id} className="notice" role="status">
                      <strong>{TEAMS_BY_CODE[winner]?.label ?? winner} are the {s.season} champions</strong>
                      {winner === code ? " — that's you." : "."}
                    </div>
                  );
                })}
            {byes.length > 0 && (
              <div className="notice" role="status">
                {byes.map((c) => TEAMS_BY_CODE[c]?.label ?? c).join(" and ")} —{" "}
                <strong>Bye, auto-advance.</strong>
              </div>
            )}
            <WeekResults
              slate={slate}
              code={code}
              label={roundLabelFor(s.bracket, r)}
              showDetail
              detailOnEvery
              onBox={(id) => nav(`/box/${id}?back=${encodeURIComponent(back)}`)}
              onWatch={(id) => nav(`/watch/${id}?back=${encodeURIComponent(back)}`)}
            />
          </>
        )}
      </div>

      <Footer>
        <button type="button" className="btn-primary" onClick={() => nav("/bracket")}>
          Continue
        </button>
      </Footer>
    </Card>
  );
}
