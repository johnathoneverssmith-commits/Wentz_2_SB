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
const NEXT_ROUND: Partial<Record<PlayoffRound, PlayoffRound>> = { WC: "DIV", DIV: "CONF", CONF: "SB" };

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
  // a GM already knocked out: which round it was, rather than "isn't playing"
  const lost = code
    ? seen.find(
        (g) =>
          g.played &&
          g.phase !== "REG" &&
          g.phase !== "PRE" &&
          g.phase !== r &&
          (g.homeTeam === code ? g.homeScore < g.awayScore : g.awayTeam === code && g.awayScore < g.homeScore),
      )
    : undefined;
  const outIn = lost ? (lost.phase as PlayoffRound) : null;
  const missedPlayoffs =
    !!code &&
    !!s.bracket &&
    !s.bracket.matchups.some((m) => m.highSeed?.code === code || m.lowSeed?.code === code) &&
    !(s.bracket.field ?? []).includes(code) &&
    !s.bracket.seeds.AFC.includes(code) &&
    !s.bracket.seeds.NFC.includes(code);
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
            {/* a GM still in it read the score and had to work out what it
                meant for them */}
            {r !== "SB" &&
              code &&
              slate
                .filter((g) => g.played && (g.homeTeam === code || g.awayTeam === code) && g.homeScore !== g.awayScore)
                .slice(0, 1)
                .map((g) => {
                  const won = (g.homeTeam === code) === g.homeScore > g.awayScore;
                  return (
                    <div key={`you-${g.id}`} className="notice" role="status">
                      {won
                        ? `${TEAMS_BY_CODE[code]?.label ?? code} move on — next stop, the ${roundLabelFor(s.bracket, NEXT_ROUND[r] ?? "SB")}.`
                        : `${TEAMS_BY_CODE[code]?.label ?? code}'s season ends here.`}
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
              // the top seed sat the round out: "isn't playing in this round"
              // read like an elimination
              noGame={
                code && byes.includes(code)
                  ? `${TEAMS_BY_CODE[code]?.label ?? code} had the bye — next stop, the ${roundLabelFor(s.bracket, NEXT_ROUND[r] ?? "SB")}.`
                  : outIn
                    ? `${TEAMS_BY_CODE[code!]?.label ?? code}'s season ended in the ${roundLabelFor(s.bracket, outIn)}.`
                    : // "isn't playing in this round" read as if they might be next
                      code && missedPlayoffs
                      ? `${TEAMS_BY_CODE[code]?.label ?? code} missed the playoffs this year.`
                      : undefined
              }
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
