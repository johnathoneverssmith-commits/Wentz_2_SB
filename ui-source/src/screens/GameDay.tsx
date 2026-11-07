import { useNavigate } from "react-router-dom";

import { AnimatedNumber } from "@/motion/AnimatedNumber";
import { pressable, TeamBadge } from "@/components/bits";
import { Footer } from "@/components/primitives";
import { TEAMS_BY_CODE } from "@/data/teams";
import { GameDayMasthead } from "@/design/GameDayMasthead";
import { GdPage } from "@/design/GdPage";
import { roundLabelFor, type PlayoffRound } from "@/domain";
import { isOnline } from "@/state/online";
import { useStore } from "@/state/store";
import { hasBoxScore, viewerTeamCode } from "@/state/selectors";
import { teamInfoFor } from "@/state/teamInfo";

import { Gamecast } from "./gamecast/Gamecast";
import { posLabel, weeksOut } from "@/util/format";

import "@/design/gameday.css";
import "@/design/gameday-blocks.css";
import "./game-days-gameday.css";

/**
 * Post-simulation Game Day screen. Deliberately a light canvas for now — the
 * detailed live/gameflow presentation will be designed against the real engine.
 * Its one job today: show that the week/round was played and let the viewer
 * continue (which is what actually advances the week / stage).
 */
export function GameDay() {
  const nav = useNavigate();
  const s = useStore();
  const finishGameDay = useStore((st) => st.finishGameDay);
  const online = isOnline();
  const pgd = s.pendingGameDay;
  const code = viewerTeamCode(s);

  if (!pgd) {
    return (
      <GdPage code={code} className="gdy">
        <GameDayMasthead code={code ?? ""} compact title="Game day" heading="Game day" sub="Nothing to show." />
        <div className="emptystate">No simulated results are pending. Head back to the hub.</div>
        <Footer>
          <button type="button" className="btnlink btn-primary" onClick={() => nav("/hub")}>
            Back to team hub
          </button>
        </Footer>
      </GdPage>
    );
  }

  const isPlayoff = ["WC", "DIV", "CONF", "SB"].includes(pgd.phase);
  const label = isPlayoff
    ? roundLabelFor(s.bracket, pgd.phase as PlayoffRound)
    : pgd.phase === "PRE"
      ? `Preseason Week ${pgd.week}`
      : `Week ${pgd.week}`;

  const slate = s.games.filter((g) => pgd.gameIds.includes(g.id));
  // each team's rating and record as of this slate, under its name
  const info = teamInfoFor(s, s.games, pgd.phase, pgd.week);
  const infoLine = (team: string) => <small className="gdy-info">{info(team)}</small>;
  const viewerGame = slate.find((g) => g.homeTeam === code || g.awayTeam === code);
  const myInjuries = (viewerGame?.injuries ?? [])
    .filter((e) => e.team === code)
    .sort((a, b) => (b.projectedWeeks[1] ?? 0) - (a.projectedWeeks[1] ?? 0));

  // A playoff round leaves no games on file — the scores live on the bracket
  // — so a GM whose team had just played was told it "wasn't in action".
  const roundResults = isPlayoff
    ? (s.bracket?.matchups ?? [])
        .filter((m) => m.round === pgd.phase && m.highSeed && m.lowSeed && m.homeScore != null && m.awayScore != null)
        .sort((a, b) => Number(isMine(b)) - Number(isMine(a)))
    : [];
  function isMine(m: { highSeed: { code: string } | null; lowSeed: { code: string } | null }): boolean {
    return !!code && (m.highSeed?.code === code || m.lowSeed?.code === code);
  }
  const playedThisRound = roundResults.some(isMine);

  const hadBye =
    isPlayoff &&
    !!code &&
    (s.bracket?.matchups ?? []).some((m) => m.round === pgd.phase && !m.lowSeed && m.highSeed?.code === code);

  return (
    <GdPage code={code} className="gdy">
      <GameDayMasthead code={code ?? ""} compact title={`${label} · results are in`} heading="Game day" sub="Final scores, and what it cost you." />

      <div className="gdy-board">
        {viewerGame?.broadcast && (
          <div className="gdy-cast">
            <Gamecast game={viewerGame} {...(hasBoxScore(viewerGame) ? { onBoxScore: () => nav(`/box/${viewerGame.id}`) } : {})} />
          </div>
        )}

        {viewerGame && !viewerGame.broadcast && (
          <div
            // your own score opens the box score, as every other game's does
            {...(hasBoxScore(viewerGame) ? pressable(() => nav(`/box/${viewerGame.id}`)) : {})}
            title={hasBoxScore(viewerGame) ? "Open the box score" : undefined}
            className={"gdy-final" + (hasBoxScore(viewerGame) ? " gdy-final--open" : "")}
          >
            <ScoreSide code={viewerGame.homeTeam} score={viewerGame.homeScore} won={viewerGame.homeScore > viewerGame.awayScore} />
            <div className="gdy-final-tag">Final</div>
            <ScoreSide code={viewerGame.awayTeam} score={viewerGame.awayScore} won={viewerGame.awayScore > viewerGame.homeScore} right />
          </div>
        )}

        {/* The one thing a GM needs off a game day besides the score: who they
            lost. It's in the box score too, but nobody opens a box score to
            find out their left tackle is gone for six weeks. */}
        {myInjuries.length > 0 && (
          <section className="gdy-section">
            <p className="subhead">Your injury report</p>
            {myInjuries.map((e, i) => (
              <div key={`${e.playerId}-${i}`} className="neg-row">
                <span className="pname">
                  {e.player} <span className="ppos">{posLabel(e.position)}</span>
                </span>
                <span className="gdy-injury">
                  {e.bodyPart} · {weeksOut(e.projectedWeeks)}
                </span>
              </div>
            ))}
          </section>
        )}

        {roundResults.length > 0 && (
          <section className="gdy-section">
            <p className="subhead">This round</p>
            <div className="scroll-list short">
              {roundResults.map((m) => {
                const home = m.highSeed!;
                const away = m.lowSeed!;
                const mine = isMine(m);
                return (
                  <div key={`${m.conference}-${home.code}-${away.code}`} className={"gdy-row" + (mine ? " gdy-row--mine" : "")}>
                    <span className={"gdy-side" + (m.winner === home.code ? " gdy-won" : "")}>
                      <TeamBadge code={home.code} size={20} />
                      <span>
                        {TEAMS_BY_CODE[home.code]?.label ?? home.code}
                        {infoLine(home.code)}
                      </span>
                    </span>
                    <span className="gdy-score">
                      {m.homeScore}–{m.awayScore}
                    </span>
                    <span className={"gdy-side gdy-side--away" + (m.winner === away.code ? " gdy-won" : "")}>
                      <TeamBadge code={away.code} size={20} />
                      <span>
                        {TEAMS_BY_CODE[away.code]?.label ?? away.code}
                        {infoLine(away.code)}
                      </span>
                    </span>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {!isPlayoff && (
          <section className="gdy-section">
            <p className="subhead">Around the league</p>
            <div className="scroll-list short">
              {/* your own game is the card above; it was listed here again */}
              {slate.filter((g) => g !== viewerGame).map((g) => {
                const homeWon = g.homeScore > g.awayScore;
                const awayWon = g.awayScore > g.homeScore;
                const openable = hasBoxScore(g);
                return (
                  <div
                    key={g.id}
                    {...(openable ? pressable(() => nav(`/box/${g.id}`)) : {})}
                    title={openable ? "Open the box score" : "No box score for this game"}
                    className={"gdy-row" + (openable ? " gdy-row--open" : "")}
                  >
                    <span className={"gdy-side" + (homeWon ? " gdy-won" : "")}>
                      <TeamBadge code={g.homeTeam} size={20} />
                      <span>
                        {TEAMS_BY_CODE[g.homeTeam]!.label}
                        {infoLine(g.homeTeam)}
                      </span>
                    </span>
                    <span className="gdy-score">
                      {g.homeScore}–{g.awayScore}
                    </span>
                    <span className={"gdy-side gdy-side--away" + (awayWon ? " gdy-won" : "")}>
                      <TeamBadge code={g.awayTeam} size={20} />
                      <span>
                        {TEAMS_BY_CODE[g.awayTeam]!.label}
                        {infoLine(g.awayTeam)}
                      </span>
                    </span>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {!viewerGame?.broadcast && !playedThisRound && (
          <p className="gdy-note">
            {viewerGame
              ? online
                ? // online the broadcast isn't stored; it is rebuilt when asked for
                  "The play-by-play is a click away — Watch play-by-play below."
                : "There's no play-by-play for this game — just the final score."
              : isPlayoff
                ? hadBye
                  ? "Your team had the bye this round and advances automatically."
                  : // a team that never made the field read as one resting
                    (s.bracket?.matchups ?? []).some(isMine)
                    ? "Your team is out of the playoffs."
                    : "Your team missed the playoffs."
                : "Bye week — your team wasn't on this week's slate."}
          </p>
        )}
      </div>

      <Footer>
        {hasBoxScore(viewerGame) && (
          <button type="button" className="btnlink" onClick={() => nav(`/box/${viewerGame!.id}`)}>
            Full box score
          </button>
        )}
        {online && viewerGame && !viewerGame.broadcast && (
          <button type="button" className="btnlink" onClick={() => nav(`/watch/${viewerGame.id}`)}>
            Watch play-by-play
          </button>
        )}
        <button type="button" className="btnlink" onClick={() => nav("/hub")}>
          Team hub
        </button>
        <button
          className="btn-primary"
          onClick={async () => {
            // Online the week is already over — the server played it and moved
            // the clock before this screen ever appeared. Calling
            // `finishGameDay` here would step it a second time in this browser
            // only, and the copy would drift until the next frame corrected
            // it. There is nothing to decide on a results screen either, so
            // nobody waits: read it and leave whenever you like.
            if (online) {
              nav("/");
              return;
            }
            const { route } = await finishGameDay();
            nav(route);
          }}
        >
          Continue
        </button>
      </Footer>
    </GdPage>
  );
}

function ScoreSide({
  code,
  score,
  won,
  right = false,
}: {
  code: string;
  score: number;
  won: boolean;
  right?: boolean;
}) {
  return (
    <div className={"gdy-score-side" + (right ? " gdy-score-side--away" : "") + (won ? " gdy-won" : "")}>
      <TeamBadge code={code} size={44} />
      <div>
        <p className="gdy-big">
          {/* the result is being revealed: it counts up from nothing */}
          <AnimatedNumber value={score} from={0} duration={1.1} />
        </p>
        <p className="gdy-team">{TEAMS_BY_CODE[code]!.label}</p>
      </div>
    </div>
  );
}
