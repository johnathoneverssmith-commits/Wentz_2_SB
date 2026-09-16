import { useEffect, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { TeamBadge, pressable } from "@/components/bits";
import { Card, CardHeader, Footer, Panel, Tabs } from "@/components/primitives";
import { TEAMS_BY_CODE } from "@/data/teams";
import type { GameResult } from "@/domain";
import { onlineSession } from "@/state/online";
import { visibleGames } from "@/state/reveal";
import { hasBoxScore, viewerTeamCode } from "@/state/selectors";
import { STAGE_HOME } from "@/state/stageMachine";
import { useStore } from "@/state/store";

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

  // default to the newest week, which is what the reveal was for
  const active = weeks.includes(Number(week)) ? Number(week) : last;

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

  // Only what this GM has actually revealed. `s.games` holds the whole
  // precomputed block, so reading it directly here would put a week they
  // have not watched on screen under a tab they can click.
  const seen = onlineSession() ? visibleGames(s, s.viewerGmId) : s.games;
  const slateOf = (w: number) => seen.filter((g) => g.phase === phaseKey && g.week === w);

  const label = (w: number) => (phaseKey === "PRE" ? `Preseason Week ${w}` : `Week ${w}`);
  const single = weeks.length === 1;

  const goHub = () => nav(STAGE_HOME[useStore.getState().stage]);

  return (
    <Card maxWidth={860}>
      <CardHeader
        badge="FS"
        title="Game Results"
        subtitle={single ? `${label(first)} · results are in` : `${label(first)} through ${label(last)}`}
      />

      {!single && (
        <Tabs
          label="Revealed weeks"
          tabs={weeks.map((w) => ({ id: String(w), label: label(w) }))}
          active={String(active)}
          onChange={(id) => nav(`/results/${phaseKey}/${first}/${last}/${id}`, { replace: true })}
        />
      )}

      <div className="panel open" ref={scroller} style={{ maxHeight: "62vh", overflowY: "auto" }}>
        {weeks.map((w) => (
          <Panel key={w} id={String(w)} open={w === active}>
            <WeekResults
              slate={slateOf(w)}
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

      <Footer>
        <button type="button" className="btn-primary" onClick={goHub}>
          Continue
        </button>
      </Footer>
    </Card>
  );
}

function WeekResults({
  slate,
  code,
  label,
  showDetail,
  onBox,
  onWatch,
}: {
  slate: GameResult[];
  code: string | null;
  label: string;
  showDetail: boolean;
  onBox: (gameId: string) => void;
  onWatch: (gameId: string) => void;
}) {
  const mine = slate.find((g) => g.homeTeam === code || g.awayTeam === code);
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
          style={{
            display: "grid",
            gridTemplateColumns: "1fr auto 1fr",
            alignItems: "center",
            gap: 16,
            padding: "22px 18px",
            background: "var(--panel-sunken)",
            border: "1px solid var(--line)",
            borderRadius: "var(--r-md)",
            marginBottom: 16,
          }}
        >
          <Side code={mine.homeTeam} score={mine.homeScore} won={mine.homeScore > mine.awayScore} />
          <div style={{ textAlign: "center", color: "var(--ink-faint)", fontSize: 11 }}>FINAL</div>
          <Side code={mine.awayTeam} score={mine.awayScore} won={mine.awayScore > mine.homeScore} right />
        </div>
      ) : (
        <p style={{ margin: "0 0 16px", fontSize: 12, color: "var(--ink-faint)", textAlign: "center" }}>
          Bye week — your team wasn&rsquo;t on this slate.
        </p>
      )}

      {showDetail && mine && (
        <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
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
          <p className="subhead" style={{ marginTop: 0 }}>
            Your injury report
          </p>
          {myInjuries.map((e, i) => (
            <div key={`${e.playerId}-${i}`} className="neg-row">
              <span className="pname">
                {e.player} <span className="ppos">{e.position}</span>
              </span>
              <span style={{ fontSize: 12.5, color: "var(--bad)", fontWeight: 600 }}>
                {e.bodyPart} · {e.projectedWeeks[0]}–{e.projectedWeeks[1]} wks
              </span>
            </div>
          ))}
        </>
      )}

      <p className="subhead">Around the league</p>
      <div className="scroll-list short">
        {slate.map((g) => {
          const homeWon = g.homeScore > g.awayScore;
          const openable = hasBoxScore(g);
          return (
            <div
              key={g.id}
              {...(openable ? pressable(() => onBox(g.id)) : {})}
              title={openable ? "Open the box score" : "No box score for this game"}
              style={{
                display: "grid",
                gridTemplateColumns: "1fr auto 1fr",
                alignItems: "center",
                gap: 10,
                padding: "9px 6px",
                borderBottom: "1px solid var(--line)",
                cursor: openable ? "pointer" : "default",
                borderRadius: "var(--r-sm)",
              }}
            >
              <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <TeamBadge code={g.homeTeam} size={20} />
                <span style={{ fontSize: 12.5, fontWeight: homeWon ? 600 : 400 }}>
                  {TEAMS_BY_CODE[g.homeTeam]!.label}
                </span>
              </span>
              <span className="oswald" style={{ fontSize: 13 }}>
                {g.homeScore}–{g.awayScore}
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: 8, flexDirection: "row-reverse" }}>
                <TeamBadge code={g.awayTeam} size={20} />
                <span style={{ fontSize: 12.5, fontWeight: !homeWon ? 600 : 400 }}>
                  {TEAMS_BY_CODE[g.awayTeam]!.label}
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
}: {
  code: string;
  score: number;
  won: boolean;
  right?: boolean;
}) {
  return (
    <div style={{ display: "flex", flexDirection: right ? "row-reverse" : "row", alignItems: "center", gap: 10 }}>
      <TeamBadge code={code} size={34} />
      <div style={{ textAlign: right ? "right" : "left" }}>
        <span
          className="oswald"
          style={{ display: "block", fontSize: 26, fontWeight: 700, color: won ? "var(--good)" : "var(--ink)" }}
        >
          {score}
        </span>
        <span style={{ fontSize: 11.5, color: "var(--ink-dim)" }}>{TEAMS_BY_CODE[code]!.label}</span>
      </div>
    </div>
  );
}
