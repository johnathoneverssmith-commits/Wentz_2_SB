import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { TeamBadge } from "@/components/bits";
import { Footer, Ticker } from "@/components/primitives";
import { GameDayMasthead } from "@/design/GameDayMasthead";
import { GdPage } from "@/design/GdPage";
import "@/design/gameday.css";
import "@/design/gameday-blocks.css";
import "./office-gameday.css";
import { TEAMS_BY_CODE } from "@/data/teams";
import { record } from "@/domain";
import { isHumansOnly, seasonShape } from "@/state/leagueFormat";
import { useStore } from "@/state/store";
import { currentPhase, statsThroughWeek, viewerTeamCode } from "@/state/selectors";
import { onlineSession } from "@/state/online";
import { visibleGames } from "@/state/reveal";
import { describeTrace } from "@/state/gameHistory";

export function FullSchedule() {
  const nav = useNavigate();
  const s = useStore();
  const code = viewerTeamCode(s);
  const phase = currentPhase(s) ?? "REG";
  // Online the season runs ahead of every GM: results come from the games
  // this GM has watched (the rest are redacted, and used to show as
  // "0 – 0 Final"), and the current week is the next one they haven't seen.
  const seen = onlineSession() ? visibleGames(s, s.viewerGmId) : s.games;
  const weeks = seasonShape(s).regularSeasonWeeks;
  const currentWeek = Math.max(s.week || 1, Math.min(statsThroughWeek(seen) + 1, weeks));
  const single = isHumansOnly(s);
  const [viewWeek, setViewWeek] = useState(currentWeek);

  const weekGames = useMemo(
    () => s.schedule.filter((g) => g.phase === "REG" && g.week === viewWeek),
    [s.schedule, viewWeek],
  );
  const byeTeams = useMemo(() => {
    const playing = new Set(weekGames.flatMap((g) => [g.homeTeam, g.awayTeam]));
    // this league's teams: every NFL franchise, listed as on a bye, used to
    // take a humans-only league's schedule down (their records don't exist)
    return Object.keys(s.teams)
      .filter((c) => !playing.has(c))
      .sort();
  }, [weekGames, s.teams]);

  const resultFor = (home: string, away: string) =>
    seen.find((g) => g.phase === "REG" && g.week === viewWeek && g.homeTeam === home && g.awayTeam === away);

  const yourGame = code ? weekGames.find((g) => g.homeTeam === code || g.awayTeam === code) : undefined;
  const yourOpp = yourGame ? (yourGame.homeTeam === code ? yourGame.awayTeam : yourGame.homeTeam) : null;
  const yourResult = yourGame ? resultFor(yourGame.homeTeam, yourGame.awayTeam) : undefined;

  const matchup = yourOpp
    ? `${yourGame!.homeTeam === code ? "vs" : "@"} ${yourOpp}${
        yourResult
          ? (() => {
              // "(30-38)" beside a record read as another record; say how it went
              const home = yourGame!.homeTeam === code;
              const us = home ? yourResult.homeScore : yourResult.awayScore;
              const them = home ? yourResult.awayScore : yourResult.homeScore;
              return ` · ${us > them ? "W" : us < them ? "L" : "T"} ${us}-${them}`;
            })()
          : ""
      }`
    : "Bye";

  return (
    <GdPage code={code}>
      <GameDayMasthead
        code={code ?? ""}
        compact
        title={`${s.season} season, ${Object.keys(s.teams).length} teams`}
        heading="Full schedule"
        sub={`Week ${viewWeek} of ${weeks}. ${phase === "PRE" ? "The league is in preseason." : `The league is in week ${currentWeek}.`}`}
      />
      <Ticker
        stats={[
          { label: "Viewing", value: `Week ${viewWeek}` },
          { label: "Current week", value: phase === "PRE" ? "Preseason" : `Week ${currentWeek}` },
          // your score first, and @ when you're the visitor
          { label: "Your matchup", value: matchup, className: "accent sm" },
          { label: "Games", value: weekGames.length, className: "sm" },
        ]}
      />

      <div className="gd-toolbar">
        <label htmlFor="schedule-week">Week</label>
        <select id="schedule-week" value={viewWeek} onChange={(e) => setViewWeek(Number(e.target.value))}>
          {Array.from({ length: weeks }, (_, i) => i + 1).map((w) => (
            <option key={w} value={w}>
              Week {w}
            </option>
          ))}
        </select>
      </div>

      <div className="scroll-list gd-sched">
        {weekGames.map((g, i) => {
          const r = resultFor(g.homeTeam, g.awayTeam);
          const mine = g.homeTeam === code || g.awayTeam === code;
          const homeWin = r ? r.homeScore > r.awayScore : false;
          return (
            <div key={i} className={"gamerow gd-game" + (mine ? " gd-game--mine" : "")}>
              <div className="gd-game__team">
                <TeamBadge code={g.homeTeam} />
                <span>
                  <b>{TEAMS_BY_CODE[g.homeTeam]!.label}</b>
                  <small>{record(s.teams[g.homeTeam]!)}</small>
                </span>
              </div>
              <div className="gd-game__score">
                {r ? (
                  <>
                    <div>
                      <span className={homeWin ? "win" : undefined}>{r.homeScore}</span> –{" "}
                      <span className={!homeWin ? "win" : undefined}>{r.awayScore}</span>
                    </div>
                    <small>Final</small>
                  </>
                ) : (
                  <>
                    <div className="none">–</div>
                    <small>Scheduled</small>
                  </>
                )}
              </div>
              <div className="gd-game__team gd-game__team--away">
                <TeamBadge code={g.awayTeam} />
                <span>
                  <b>{TEAMS_BY_CODE[g.awayTeam]!.label}</b>
                  <small>{record(s.teams[g.awayTeam]!)}</small>
                </span>
              </div>
              {r && describeTrace(r) !== "none" && (
                <div className="gd-game__actions">
                  <button
                    type="button"
                    className="gd-btn gd-small"
                    aria-label={`Play-by-play, ${g.awayTeam} at ${g.homeTeam}`}
                    onClick={() => nav(`/watch/${r.id}?back=${encodeURIComponent("/schedule")}`)}
                  >
                    Play-by-play
                  </button>
                </div>
              )}
            </div>
          );
        })}
        {byeTeams.map((c) => (
          <div key={c} className={"gd-bye" + (c === code ? " gd-bye--mine" : "")}>
            <div className="gd-game__team">
              <TeamBadge code={c} />
              <span>
                <b>{TEAMS_BY_CODE[c]!.label}</b>
                <small>{record(s.teams[c]!)}</small>
              </span>
            </div>
            <span className="gd-bye__tag">Bye week</span>
          </div>
        ))}
      </div>

      <p className="gd-foot">
        Completed weeks show final scores; upcoming weeks show each team&rsquo;s current record.
        {single ? "" : " Every team gets one bye."}
      </p>

      <Footer>
        <button type="button" className="btnlink" onClick={() => nav("/hub")}>
          Return to team hub
        </button>
      </Footer>
    </GdPage>
  );
}
