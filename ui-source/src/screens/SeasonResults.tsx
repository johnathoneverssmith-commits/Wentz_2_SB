import { useEffect, useRef } from "react";
import { AnimatedNumber } from "@/motion/AnimatedNumber";
import { ExpiringContracts } from "@/components/ExpiringContracts";
import { useNavigate, useParams } from "react-router-dom";

import { TeamBadge, pressable } from "@/components/bits";
import { Footer, Panel, Tabs } from "@/components/primitives";
import { GameDayMasthead } from "@/design/GameDayMasthead";
import { GdPage } from "@/design/GdPage";
import { TEAMS_BY_CODE } from "@/data/teams";
import type { GameResult } from "@/domain";
import { onlineSession } from "@/state/online";
import { visibleGames } from "@/state/reveal";
import { currentBlock } from "@/state/revealBlocks";
import { hasBoxScore, viewerTeamCode } from "@/state/selectors";
import { teamInfoFor } from "@/state/teamInfo";
import { useStore } from "@/state/store";
import { posLabel, weeksOut } from "@/util/format";

import "@/design/gameday.css";
import "@/design/gameday-blocks.css";
import "./game-days-gameday.css";


/**
 * What a reveal opens: every week it just uncovered, on one screen.
 *
 * Revealing one week and revealing the rest of the preseason are the same
 * action with different arguments, so they get the same screen rather than
 * two that drift apart. One week renders as a single panel with Continue
 * underneath; several render as tabs, opening on the last one — the newest
 * result is the one a GM came here for, and the earlier tabs are there to be
 * gone back to rather than scrolled past.
 *
 * The selected tab lives in the URL. That is what makes "Return to Game
 * Results" from a box score land on the week the GM left rather than on the
 * default, without a screen having to remember anything about another screen.
 */
export function SeasonResults() {
  const { phase, from, to, week } = useParams();
  const nav = useNavigate();
  const s = useStore();
  const code = viewerTeamCode(s) ?? null;

  const phaseKey = phase === "PRE" ? "PRE" : "REG";
  const first = Math.max(1, Number(from) || 1);
  const last = Math.max(first, Number(to) || first);
  const weeks: number[] = [];
  for (let w = first; w <= last; w++) weeks.push(w);

  // Only what this GM has actually revealed. `s.games` holds the whole
  // precomputed block, so reading it directly here would put a week they
  // have not watched on screen under a tab they can click.
  const seen = onlineSession() ? visibleGames(s, s.viewerGmId) : s.games;
  const slateOf = (w: number) => seen.filter((g) => g.phase === phaseKey && g.week === w);

  // Which week this opens on is a property of the block — see `resultsOpenOn`.
  // Opening on the first week used to land a GM on their own bye: an empty
  // "your team wasn't on this slate" before the result they came for.
  const playedIn = (w: number) => !!code && slateOf(w).some((g) => g.homeTeam === code || g.awayTeam === code);
  const openOn =
    currentBlock(s)?.resultsOpenOn === "first" ? (weeks.find(playedIn) ?? first) : last;
  const active = weeks.includes(Number(week)) ? Number(week) : openOn;

  // Each team's rating and record as of that week — from the games this GM
  // has revealed, never one they haven't.
  const infoFor = (w: number) => teamInfoFor(s, seen, phaseKey, w);

  // Restoring the scroll position the GM left from, so a trip into a box
  // score and back does not dump them at the top of a long screen.
  const scroller = useRef<HTMLDivElement>(null);
  const key = `results:${phaseKey}:${active}`;
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const saved = Number(sessionStorage.getItem(key) ?? 0);
    if (saved) el.scrollTop = saved;
    const onScroll = () => sessionStorage.setItem(key, String(el.scrollTop));
    el.addEventListener("scroll", onScroll);
    return () => el.removeEventListener("scroll", onScroll);
  }, [key]);


  const label = (w: number) => (phaseKey === "PRE" ? `Preseason Week ${w}` : `Week ${w}`);
  const single = weeks.length === 1;

  const goHub = () => nav("/");

  return (
    <GdPage code={code} className={single ? "gdy" : "gdy gd-tabbed"}>
      <GameDayMasthead
        code={code ?? ""}
        compact
        title={single ? `${label(first)} · results are in` : `${label(first)} through ${label(last)}`}
        heading="Game results"
        sub="What the week uncovered."
      />

      {!single && (
        <div className="gd-hub">
          <Tabs
            label="Revealed weeks"
            tabs={weeks.map((w) => ({ id: String(w), label: label(w) }))}
            active={String(active)}
            onChange={(id) => nav(`/results/${phaseKey}/${first}/${last}/${id}`, { replace: true })}
          />
        </div>
      )}

      <div className={"panel open gdy-results" + (single ? " gdy-section" : "")} ref={scroller} style={{ maxHeight: "62vh", overflowY: "auto" }}>
        {weeks.map((w) => (
          <Panel key={w} id={String(w)} open={w === active}>
            <WeekResults
              slate={slateOf(w)}
              info={infoFor(w)}
              code={code}
              label={label(w)}
              /* The spec keeps these off the one-week screen: it has a single
                 game on it and a Continue button, and two more ways out of a
                 screen with one thing on it is clutter, not navigation. */
              showDetail={!single}
              onBox={(id) => nav(`/box/${id}?back=${encodeURIComponent(`/results/${phaseKey}/${first}/${last}/${w}`)}`)}
              onWatch={(id) => nav(`/watch/${id}?back=${encodeURIComponent(`/results/${phaseKey}/${first}/${last}/${w}`)}`)}
            />
          </Panel>
        ))}
      </div>

      {viewerTeamCode(s) && <ExpiringContracts teamCode={viewerTeamCode(s)!} />}
      <Footer>
        <button type="button" className="btn-primary" onClick={goHub}>
          Continue
        </button>
      </Footer>
    </GdPage>
  );
}

/**
 * One slate: the viewer's game, their injuries, and the scoreboard.
 *
 * Exported because a playoff round is the same screen with a different set
 * of games in it — the only thing the postseason changes is that every game
 * gets detail controls, since with two games in a round a GM watches the
 * whole league rather than only themselves.
 */
export function WeekResults({
  slate,
  code,
  label,
  showDetail,
  detailOnEvery = false,
  onBox,
  onWatch,
  noGame,
  info,
}: {
  /** What to say when the viewer has no game here, if there's more to say. */
  noGame?: string;
  /** A team's rating and record as of this slate, shown under its name. */
  info?: (team: string) => string;
  slate: GameResult[];
  code: string | null;
  label: string;
  showDetail: boolean;
  /** Playoffs only: detail controls on every game, not just the viewer's. */
  detailOnEvery?: boolean;
  onBox: (gameId: string) => void;
  onWatch: (gameId: string) => void;
}) {
  const mine = slate.find((g) => g.homeTeam === code || g.awayTeam === code);
  // the other GMs' games are the ones a league of friends asks about first;
  // in a 32-team slate they sat wherever the schedule put them, unmarked
  const gms = useStore((st) => st.gms);
  const gmName = (team: string) => gms.find((g) => g.isHuman && g.teamCode === team && team !== code)?.name;
  // a game with a GM's team in it is the one worth finding in a long slate
  const humanIn = (g: GameResult) => gms.some((x) => x.isHuman && (x.teamCode === g.homeTeam || x.teamCode === g.awayTeam));
  const others = slate
    .filter((g) => g !== mine)
    .map((g, i) => ({ g, i, gm: !!(gmName(g.homeTeam) || gmName(g.awayTeam)) }))
    .sort((a, b) => Number(b.gm) - Number(a.gm) || a.i - b.i)
    .map((x) => x.g);
  const myInjuries = (mine?.injuries ?? [])
    .filter((e) => e.team === code)
    .sort((a, b) => (b.projectedWeeks[1] ?? 0) - (a.projectedWeeks[1] ?? 0));

  if (slate.length === 0) {
    return <div className="emptystate">Nothing revealed for {label} yet.</div>;
  }

  return (
    <>
      {mine ? (
        <div
          // your own score opens the box score, as every other game's does
          {...(hasBoxScore(mine) ? pressable(() => onBox(mine.id)) : {})}
          title={hasBoxScore(mine) ? "Open the box score" : undefined}
          className={"gdy-final gdy-final--inline" + (hasBoxScore(mine) ? " gdy-final--open" : "")}
        >
          <Side code={mine.homeTeam} score={mine.homeScore} won={mine.homeScore > mine.awayScore} info={info?.(mine.homeTeam)} />
          <div className="gdy-final-tag">Final</div>
          <Side code={mine.awayTeam} score={mine.awayScore} won={mine.awayScore > mine.homeScore} right info={info?.(mine.awayTeam)} />
        </div>
      ) : (
        <p className="gdy-note gdy-note--gap">
          {/* a playoff round without you is a bye, an elimination or a
              missed postseason — never a "bye week" */}
          {noGame ?? (detailOnEvery
            ? "Your team isn’t playing in this round."
            : "Bye week — your team wasn’t on this slate.")}
        </p>
      )}

      {showDetail && mine && (
        <div className="gdy-actions">
          {hasBoxScore(mine) && (
            <button type="button" className="btnlink" onClick={() => onBox(mine.id)}>
              View Full Box Score
            </button>
          )}
          <button type="button" className="btnlink" onClick={() => onWatch(mine.id)}>
            View Play-by-Play
          </button>
        </div>
      )}

      {myInjuries.length > 0 && (
        <>
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
        </>
      )}

      {/* your own game is the card above; it was listed here a second time */}
      {others.length > 0 && <p className="subhead">Around the league</p>}
      <div className="scroll-list short">
        {others.map((g) => {
          const homeWon = g.homeScore > g.awayScore;
          const awayWon = g.awayScore > g.homeScore;
          const openable = hasBoxScore(g);
          return (
            <div
              key={g.id}
              {...(openable ? pressable(() => onBox(g.id)) : {})}
              title={openable ? "Open the box score" : "No box score for this game"}
              className={"gdy-row" + (openable ? " gdy-row--open" : "") + (humanIn(g) ? " gdy-row--human" : "")}
            >
              <span className={"gdy-side" + (homeWon ? " gdy-won" : "")}>
                <TeamBadge code={g.homeTeam} size={20} />
                <span>
                  {TEAMS_BY_CODE[g.homeTeam]!.label}
                  {gmName(g.homeTeam) && <> <span className="ppos">{gmName(g.homeTeam)}</span></>}
                  {info && <small className="gdy-info">{info(g.homeTeam)}</small>}
                </span>
              </span>
              {/* the playoff link lives in the score's cell: as a fourth item
                  in a three-column row it pushed the away team onto a line
                  of its own */}
              <span className="gdy-scorecell">
                <span className="gdy-score">
                  {g.homeScore}–{g.awayScore}
                </span>
                {detailOnEvery && (
                  <button
                    type="button"
                    className="btnlink sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      onWatch(g.id);
                    }}
                  >
                    Play-by-Play
                  </button>
                )}
              </span>
              <span className={"gdy-side gdy-side--away" + (awayWon ? " gdy-won" : "")}>
                <TeamBadge code={g.awayTeam} size={20} />
                <span>
                  {TEAMS_BY_CODE[g.awayTeam]!.label}
                  {gmName(g.awayTeam) && <> <span className="ppos">{gmName(g.awayTeam)}</span></>}
                  {info && <small className="gdy-info">{info(g.awayTeam)}</small>}
                </span>
              </span>
            </div>
          );
        })}
      </div>
    </>
  );
}

function Side({
  code,
  score,
  won,
  right = false,
  info,
}: {
  code: string;
  score: number;
  won: boolean;
  right?: boolean;
  info?: string | undefined;
}) {
  return (
    <div className={"gdy-score-side" + (right ? " gdy-score-side--away" : "") + (won ? " gdy-won" : "")}>
      <TeamBadge code={code} size={34} />
      <div>
        <span className="gdy-big">
          <AnimatedNumber value={score} from={0} duration={1.1} />
        </span>
        <span className="gdy-team">{TEAMS_BY_CODE[code]!.label}</span>
        {info && <span className="gdy-info">{info}</span>}
      </div>
    </div>
  );
}
