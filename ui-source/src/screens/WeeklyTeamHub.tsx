import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { TeamBadge } from "@/components/bits";
import { Card, CardHeader, Footer, Panel, Tabs, Ticker, useTabs } from "@/components/primitives";
import { LeagueRoster } from "@/components/LeagueRoster";
import { ReadinessGate } from "@/components/ReadinessGate";
import { TEAMS_BY_CODE, teamFullName } from "@/data/teams";
import { record, winPct } from "@/domain";
import { PRESEASON_WEEKS, REGULAR_SEASON_WEEKS, STAGE_HOME, STAGE_LABEL } from "@/state/stageMachine";
import { hasMoreToReveal, revealedWeek, visibleGames } from "@/state/reveal";
import { preseasonRoasts } from "@/state/roasts";
import { rankBy, staffCards } from "@/state/staffRatings";
import { useLeagueActions } from "@/state/useLeagueActions";
import { onlineSession } from "@/state/online";
import { useStore } from "@/state/store";
import {
  currentPhase,
  divisionRivals,
  hasBoxScore,
  humanHeadToHead,
  injuredOn,
  leagueInjuries,
  opponentOf,
  playoffOdds,
  recoveryText,
  viewerTeamCode,
  watchNotes,
  weekGame,
} from "@/state/selectors";
import { winProbability } from "@/sim/win-probability";
import { millions, ordinal } from "@/util/format";

// Was `0.5 + 0.02 * gap + a 4% home edge`, which was a guess in both terms.
// `win-probability.ts` is the same question answered by 47,616 engine games,
// and the home edge is back because the engine has one now (OQ-10).
const favWinProb = (
  a: { overall: number },
  b: { overall: number },
  atHome: boolean,
): number => winProbability(a.overall, b.overall, atHome ? "home" : "away");

export function WeeklyTeamHub() {
  const nav = useNavigate();
  const { active, setActive } = useTabs("overview");
  const s = useStore();
  const simulateGameDay = useStore((st) => st.simulateGameDay);

  const code = viewerTeamCode(s);
  if (!code) {
    // Online this is not a setup problem and League Setup cannot fix it —
    // teams are claimed in the lobby, and being here without one means the
    // claim did not reach this client. Say that instead of sending someone
    // to a single-player screen that will not help.
    const online = onlineSession() !== null;
    return (
      <Card>
        <CardHeader badge="FS" title="Weekly Team Hub" subtitle="No team selected" />
        <div className="panel open">
          {online ? (
            <>
              <LeagueRoster />
              <div className="notice bad" role="status">
                <strong>This league hasn't told us which team is yours.</strong> Open it again
                from Online Leagues — if it still lands here, your claim didn't save and the team
                is free to take again.
              </div>
            </>
          ) : (
            <div className="emptystate">Pick a team in League Setup to see your team hub.</div>
          )}
        </div>
      </Card>
    );
  }

  const meta = TEAMS_BY_CODE[code]!;
  const team = s.teams[code]!;
  const phase = currentPhase(s);
  // online the block is precomputed and these weeks are revealed, not played
  const online = onlineSession() !== null;
  const roasts = s.stage === "preseason" ? preseasonRoasts(s) : [];
  const staffCardsAll = staffCards(s);
  const staffOvr = staffCardsAll.find((c) => c.teamCode === code)?.overall ?? 0;
  const staffRank = rankBy(staffCardsAll, "overall").get(code) ?? 0;
  const isPreseason = s.stage === "preseason";
  const g = weekGame(s, code);
  const oppCode = opponentOf(g, code);
  const opp = oppCode ? s.teams[oppCode] : undefined;
  const iHost = g?.homeTeam === code;

  const divCodes = divisionRivals(code).sort((a, b) => winPct(s.teams[b]!) - winPct(s.teams[a]!));
  const confCodes = Object.values(TEAMS_BY_CODE)
    .filter((t) => t.conference === meta.conference)
    .map((t) => t.code)
    .sort((a, b) => winPct(s.teams[b]!) - winPct(s.teams[a]!));

  const h2h = humanHeadToHead(s);
  const gmRows = s.gms
    .filter((gm) => gm.isHuman && gm.teamCode)
    .map((gm) => ({ gm, t: s.teams[gm.teamCode]! }))
    .sort((a, b) => winPct(b.t) - winPct(a.t));

  const notes = watchNotes(s);
  const winProb = opp ? favWinProb(team.ratings, opp.ratings, iHost) : 50;

  return (
    <Card maxWidth={760}>
      <CardHeader
        badge={meta.abbr}
        title={meta.label}
        subtitle={
          isPreseason
            ? `Preseason · starting lineup ${team.ratings.overall} OVR`
            : `${record(team)} · ${ordinal(team.divisionRank)} in ${meta.conference} ${meta.division}`
        }
        right={
          <>
            <p>{!phase ? "Offseason" : isPreseason ? `Preseason Wk ${s.week}` : `Week ${s.week}`}</p>
            <p>
              {oppCode
                ? `${iHost ? "vs" : "@"} ${TEAMS_BY_CODE[oppCode]!.label} (${record(s.teams[oppCode]!)})`
                : phase
                  ? "Bye week"
                  : STAGE_LABEL[s.stage]}
            </p>
          </>
        }
      />

      <Ticker
        stats={[
          // Out of season there is no opponent and this tile read "—" for
          // months. Cap space is the number a GM is actually working against
          // in an offseason, so the tile says something either way.
          oppCode
            ? { label: "Win probability", value: `${winProb}%` }
            : {
                label: "Cap space",
                value: millions(Math.round((team.cap.total - team.cap.used) * 10) / 10),
                className: team.cap.used <= team.cap.total ? "good" : "bad",
              },
          {
            label: "Team overall",
            value: (
              <>
                {team.ratings.overall}
                {opp && (
                  <span style={{ fontSize: 12, color: "var(--ink-faint)", fontWeight: 400 }}>
                    {" "}
                    vs {opp.ratings.overall}
                  </span>
                )}
              </>
            ),
          },
          { label: "League rank", value: ordinal(team.ratings.overallRank) },
          { label: isPreseason ? "Preseason" : "Record", value: record(team), className: "sm" },
        ]}
      />

      <Tabs
        tabs={[
          { id: "overview", label: "Overview" },
          { id: "matchup", label: "Matchup" },
          { id: "division", label: "Division Standings" },
          { id: "league", label: "League Standings" },
          { id: "gms", label: "GM Standings" },
          { id: "injuries", label: "Injuries" },
        ]}
        active={active}
        onChange={setActive}
      />

      <Panel id="overview" open={active === "overview"}>
        {/* inert in a single-player dynasty; the component decides */}
        <LeagueRoster />
        {/*
          Change 6: in the preseason this is one roast per human GM instead of
          scouting notes. The notes were true and nobody read them; a league
          of four friends wants to know what the league thinks of them, and it
          is the only thing on this screen that is about the other GMs rather
          than about football.
        */}
        <p className="subhead" style={{ marginTop: 0 }}>
          {s.stage === "preseason" ? "Around the league" : "Around the league — things to watch"}
        </p>
        {s.stage === "preseason"
          ? roasts.map((r) => (
              <div className="watchnote" key={r.teamCode}>
                <div className="who">
                  {r.gmName} · {TEAMS_BY_CODE[r.teamCode]!.label}
                </div>
                <p className="txt">{r.line}</p>
              </div>
            ))
          : notes.map((n) => (
              <div className="watchnote" key={n.gmId}>
                <div className="who">
                  {n.gmName} · {TEAMS_BY_CODE[n.teamCode]!.label}
                </div>
                <p className="txt">
                  <strong style={{ color: "var(--ink)" }}>{n.player}</strong> {n.note}.
                </p>
              </div>
            ))}

        <p className="subhead">Unit ranks</p>
        <div className="split-4" style={{ gap: 10 }}>
          <UnitCard label="Offense" rank={team.ratings.offenseRank} rating={team.ratings.offense} />
          <UnitCard label="Defense" rank={team.ratings.defenseRank} rating={team.ratings.defense} />
          <UnitCard label="Special teams" rank={team.ratings.specialTeamsRank} rating={team.ratings.specialTeams} />
          {/* Change 6: a staff is a unit like any other, and after drafting
              twelve of them a GM should be able to see where that landed. */}
          <UnitCard label="Coaching" rank={staffRank} rating={staffOvr} />
        </div>
      </Panel>

      <Panel id="matchup" open={active === "matchup"}>
        {oppCode && opp ? (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center", gap: 12, marginBottom: 16 }}>
              <div style={{ textAlign: "center" }}>
                <TeamBadge code={code} size={40} />
                <p style={{ margin: "6px 0 0", fontSize: 13, fontWeight: 600 }}>{meta.label}</p>
                <p style={{ margin: 0, fontSize: 11, color: "var(--ink-faint)" }}>{record(team)}{iHost ? " · home" : " · away"}</p>
              </div>
              <div style={{ textAlign: "center", fontSize: 12, color: "var(--ink-faint)" }}>
                <div>Sun 1:00</div>
                <div className="oswald" style={{ fontSize: 15, marginTop: 4 }}>
                  {winProb}% – {100 - winProb}%
                </div>
              </div>
              <div style={{ textAlign: "center" }}>
                <TeamBadge code={oppCode} size={40} />
                <p style={{ margin: "6px 0 0", fontSize: 13, fontWeight: 600 }}>{TEAMS_BY_CODE[oppCode]!.label}</p>
                <p style={{ margin: 0, fontSize: 11, color: "var(--ink-faint)" }}>{record(opp)}{iHost ? " · away" : " · home"}</p>
              </div>
            </div>
            <table className="stbl">
              <thead>
                <tr>
                  <th>Metric</th>
                  <th className="c">{meta.abbr}</th>
                  <th className="c">{TEAMS_BY_CODE[oppCode]!.abbr}</th>
                </tr>
              </thead>
              <tbody>
                <MatchRow label="Team overall" a={team.ratings.overall} b={opp.ratings.overall} higherBetter />
                <MatchRow label="Offense rank" a={team.ratings.offenseRank} b={opp.ratings.offenseRank} higherBetter={false} rank />
                <MatchRow label="Defense rank" a={team.ratings.defenseRank} b={opp.ratings.defenseRank} higherBetter={false} rank />
                <MatchRow label="Special teams rank" a={team.ratings.specialTeamsRank} b={opp.ratings.specialTeamsRank} higherBetter={false} rank />
                <MatchRow label="Win probability" a={winProb} b={100 - winProb} higherBetter suffix="%" />
              </tbody>
            </table>
            <p style={{ margin: "10px 0 0", fontSize: 11, color: "var(--ink-faint)" }}>
              Green marks the team favored in that row.
            </p>
          </>
        ) : (
          <div className="emptystate">{phase ? "Bye week — no matchup." : "No game this week — the league is in the offseason."}</div>
        )}
      </Panel>

      <Panel id="division" open={active === "division"}>
        <p className="subhead" style={{ marginTop: 0 }}>
          {meta.conference} {meta.division}
        </p>
        <StandingsTable s={s} codes={divCodes} me={code} />
      </Panel>

      <Panel id="league" open={active === "league"}>
        <p className="subhead" style={{ marginTop: 0 }}>
          {meta.conference} — playoff seeding
        </p>
        <StandingsTable s={s} codes={confCodes} me={code} seedTop7 />
        <p style={{ margin: "10px 0 0", fontSize: 11, color: "var(--ink-faint)" }}>
          The top 7 seeds make the playoffs; seed 1 gets a first-round bye.
        </p>
      </Panel>

      <Panel id="gms" open={active === "gms"}>
        <p className="subhead" style={{ marginTop: 0 }}>
          Human GM standings
        </p>
        <div style={{ overflowX: "auto" }}>
          <table className="stbl">
            <thead>
              <tr>
                <th>GM</th>
                <th>Team</th>
                <th className="c">OVR</th>
                <th className="c">Record</th>
                <th className="c">Playoff odds</th>
                {gmRows.map((r) => (
                  <th className="c" key={r.gm.id}>
                    vs {TEAMS_BY_CODE[r.gm.teamCode]!.abbr}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {gmRows.map((r) => (
                <tr key={r.gm.id} className={r.gm.teamCode === code ? "highlight" : ""}>
                  <td className="name">{r.gm.id === s.viewerGmId ? "You" : r.gm.name}</td>
                  <td>{TEAMS_BY_CODE[r.gm.teamCode]!.label}</td>
                  <td className="c">{r.t.ratings.overall}</td>
                  <td className="c">{record(r.t)}</td>
                  <td className="c">{playoffOdds(s, r.gm.teamCode)}%</td>
                  {gmRows.map((o) => {
                    if (o.gm.id === r.gm.id) return <td className="c" key={o.gm.id}>—</td>;
                    const hh = h2h[r.gm.teamCode]?.[o.gm.teamCode];
                    return (
                      <td className="c" key={o.gm.id}>
                        {hh && hh.w + hh.l > 0 ? `${hh.w}-${hh.l}` : "–"}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel id="injuries" open={active === "injuries"}>
        <p className="subhead" style={{ marginTop: 0 }}>
          Your team
        </p>
        <InjuryTable players={injuredOn(s, code)} />
        {oppCode && (
          <>
            <p className="subhead">{TEAMS_BY_CODE[oppCode]!.label}</p>
            <InjuryTable players={injuredOn(s, oppCode)} />
          </>
        )}
        <p className="subhead">League watch — top injuries</p>
        <InjuryTable players={leagueInjuries(s)} showTeam />
      </Panel>

      <Footer>
        {/*
          Change 6: roster, coaching and free agency come off the in-season
          hub. Weeks 1-9 are precomputed, so a roster move now could not
          affect a game that has already been played — offering the controls
          would promise something the schedule cannot deliver. They return in
          the offseason, where they mean something.
        */}
        <button type="button" className="btnlink" onClick={() => nav("/schedule")}>
          Full Schedule
        </button>
        <button type="button" className="btnlink" onClick={() => nav("/player-stats")}>
          Player Statistics
        </button>
        <button type="button" className="btnlink" onClick={() => nav("/league-stats")}>
          League Statistics
        </button>
        {(() => {
          // locked until this GM has revealed a game of their own — there is
          // no box score to open for a week they have not watched
          const last = lastRevealedResult(s, code);
          return last && phase && hasBoxScore(last) ? (
            <>
              <button type="button" className="btnlink" onClick={() => nav(`/box/${last.id}`)}>
                Latest Box Score
              </button>
              <button
                type="button"
                className="btnlink btn-primary"
                onClick={() => nav(`/watch/${last.id}`)}
              >
                Watch Play-by-Play
              </button>
            </>
          ) : null;
        })()}
        {!phase && (
          <button type="button" className="btnlink btn-primary" onClick={() => nav(STAGE_HOME[s.stage])}>
            Go to {STAGE_LABEL[s.stage]}
          </button>
        )}
      </Footer>

      {phase && s.pendingGameDay && (
        // results for this week already exist — never offer to sim it again
        <div className="readiness">
          <div className="readiness-top">
            <p>This week's results are in</p>
            <span>Continue from Game Day to move to the next week</span>
          </div>
          <button type="button" className="btn-primary" style={{ width: "100%" }} onClick={() => nav("/game-day")}>
            View Game Day results
          </button>
        </div>
      )}
      {/*
        Change 6: in a precomputed block there is nothing to be ready *for* —
        the games are already played and saved. These reveal them to this GM
        alone, at whatever pace they like, and cannot change a result or
        anybody else's screen. The readiness gate belongs to stages where the
        league genuinely has to move together, and this is not one.
      */}
      {phase && !s.pendingGameDay && online && (
        <RevealControls />
      )}
      {phase && !s.pendingGameDay && !online && (
        <ReadinessGate
          title="Game day readiness"
          label="Ready for Game Day"
          action={simulateGameDay}
          onAdvance={(route) => nav(route)}
        />
      )}
    </Card>
  );
}

/**
 * Simulate Game / Simulate Season, which are reveals despite the word.
 *
 * The label keeps "Simulate" because that is what a GM expects the button to
 * be called and because from their side it is indistinguishable — they press
 * it, football happens. What it actually does is move their own marker
 * through results that already exist.
 */
function RevealControls() {
  const s = useStore();
  const actions = useLeagueActions();
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);

  const phase: "PRE" | "REG" = s.stage === "preseason" ? "PRE" : "REG";
  const lastWeek = phase === "PRE" ? PRESEASON_WEEKS : REGULAR_SEASON_WEEKS;
  const seen = revealedWeek(s, s.viewerGmId, phase);
  const more = hasMoreToReveal(s, s.viewerGmId, phase, lastWeek);

  const reveal = (through: number): void => {
    setBusy(true);
    // the weeks this press uncovers, which is what the results screen shows:
    // one tab for a single week, one per week for "simulate the rest"
    const from = seen + 1;
    void actions
      .revealThrough(through)
      .then((res) => {
        if (res.ok) nav(`/results/${phase}/${from}/${through}`);
      })
      .finally(() => setBusy(false));
  };

  if (!more) {
    return (
      <div className="readiness">
        <div className="readiness-top">
          <p>{phase === "PRE" ? "Preseason complete" : "Regular season complete"}</p>
          <span>You&rsquo;ve watched all {lastWeek} weeks</span>
        </div>
        <button
          className="btn-primary"
          style={{ width: "100%" }}
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void actions.readyUp(true).finally(() => setBusy(false));
          }}
        >
          {phase === "PRE" ? "Advance to the Regular Season" : "Advance to the Playoffs"}
        </button>
      </div>
    );
  }

  return (
    <div className="readiness">
      <div className="readiness-top">
        <p>{phase === "PRE" ? "Preseason" : "Regular season"}</p>
        <span aria-live="polite">
          Watched {seen} of {lastWeek} weeks
        </span>
      </div>
      <p className="readiness-held">
        These are already played — you&rsquo;re watching at your own pace, and nobody else&rsquo;s
        screen moves when you do.
      </p>
      <div style={{ display: "flex", gap: 8 }}>
        <button
          className="btn-primary"
          style={{ flex: 1 }}
          disabled={busy}
          onClick={() => reveal(seen + 1)}
        >
          {busy ? "…" : `Simulate week ${seen + 1}`}
        </button>
        <button
          className="btnlink"
          style={{ flex: 1 }}
          disabled={busy}
          onClick={() => reveal(lastWeek)}
        >
          {phase === "PRE" ? "Simulate the preseason" : "Simulate to the end"}
        </button>
      </div>
    </div>
  );
}

/**
 * The most recent game this GM has actually watched.
 *
 * Deliberately not "the most recent game played" — online the block runs
 * ahead of every viewer, and opening a box score for a week they have not
 * revealed would hand them the result they were about to watch.
 */
function lastRevealedResult(s: ReturnType<typeof useStore.getState>, code: string) {
  const seen = onlineSession() ? visibleGames(s, s.viewerGmId) : s.games;
  return [...seen]
    .filter((x) => x.played && (x.homeTeam === code || x.awayTeam === code))
    .sort((a, b) => b.week - a.week)[0];
}

function UnitCard({ label, rank, rating }: { label: string; rank: number; rating: number }) {
  const pct = Math.max(6, Math.round(((33 - rank) / 32) * 100));
  return (
    <div style={{ background: "var(--panel-sunken)", border: "1px solid var(--line)", borderRadius: "var(--r-md)", padding: "13px 14px" }}>
      <p style={{ margin: 0, fontSize: 11, color: "var(--ink-faint)" }}>{label}</p>
      <p className="oswald" style={{ margin: "4px 0 8px", fontSize: 18, fontWeight: 600 }}>
        {ordinal(rank)}{" "}
        <span style={{ fontSize: 12, color: "var(--ink-dim)", fontWeight: 400 }}>· {rating} OVR</span>
      </p>
      <div style={{ height: 6, background: "var(--panel-raised)", borderRadius: 3, overflow: "hidden" }}>
        <div style={{ height: "100%", background: "var(--team)", borderRadius: 3, width: `${pct}%` }} />
      </div>
    </div>
  );
}

function MatchRow({
  label,
  a,
  b,
  higherBetter,
  rank = false,
  suffix = "",
}: {
  label: string;
  a: number;
  b: number;
  higherBetter: boolean;
  rank?: boolean;
  suffix?: string;
}) {
  const aFav = higherBetter ? a > b : a < b;
  const bFav = higherBetter ? b > a : b < a;
  const fmt = (n: number) => (rank ? ordinal(n) : `${n}${suffix}`);
  return (
    <tr>
      <td>{label}</td>
      <td className={`c ${aFav ? "fav" : "und"}`}>{fmt(a)}</td>
      <td className={`c ${bFav ? "fav" : "und"}`}>{fmt(b)}</td>
    </tr>
  );
}

function StandingsTable({
  s,
  codes,
  me,
  seedTop7 = false,
}: {
  s: ReturnType<typeof useStore.getState>;
  codes: string[];
  me: string;
  seedTop7?: boolean;
}) {
  return (
    <div style={{ background: "var(--panel-sunken)", border: "1px solid var(--line)", borderRadius: "var(--r-md)", padding: "6px 14px" }}>
      <table className="stbl">
        <thead>
          <tr>
            {seedTop7 && <th style={{ width: 26 }}>Sd</th>}
            <th>Team</th>
            <th className="c">W</th>
            <th className="c">L</th>
            <th className="c">T</th>
            <th className="r">PD</th>
          </tr>
        </thead>
        <tbody>
          {codes.map((c, i) => {
            const t = s.teams[c]!;
            const pd = t.pointsFor - t.pointsAgainst;
            const inField = seedTop7 && i < 7;
            return (
              <tr key={c} className={c === me ? "highlight" : ""}>
                {seedTop7 && (
                  <td className="c" style={{ color: inField ? "var(--good)" : "var(--ink-faint)", fontWeight: inField ? 700 : 400 }}>
                    {inField ? i + 1 : "–"}
                  </td>
                )}
                <td>{teamFullName(c)}</td>
                <td className="c">{t.wins}</td>
                <td className="c">{t.losses}</td>
                <td className="c">{t.ties}</td>
                <td className="r">{pd > 0 ? "+" : ""}{pd}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function InjuryTable({
  players,
  showTeam = false,
}: {
  players: import("@/domain").Player[];
  showTeam?: boolean;
}) {
  if (players.length === 0) {
    return <div style={{ padding: "10px 0", fontSize: 12, color: "var(--ink-faint)" }}>No injuries reported.</div>;
  }
  const color = (st: string) => (st === "out" ? "var(--bad)" : st === "doubtful" ? "var(--notice)" : "var(--ink-dim)");
  return (
    <div style={{ background: "var(--panel-sunken)", border: "1px solid var(--line)", borderRadius: "var(--r-md)", padding: "4px 14px", marginBottom: 12 }}>
      <table className="stbl">
        <thead>
          <tr>
            <th>Player</th>
            {showTeam && <th className="c">Team</th>}
            <th className="c">OVR</th>
            <th className="c">Status</th>
            <th className="r">Recovery</th>
          </tr>
        </thead>
        <tbody>
          {players.map((p) => (
            <tr key={p.id}>
              <td className="name">
                {p.name} <span className="pos">{p.position}</span>
              </td>
              {showTeam && <td className="c">{p.nfl_team}</td>}
              <td className="c" style={{ color: "var(--ink)", fontWeight: 600 }}>
                {p.overall}
              </td>
              <td className="c" style={{ color: color(p.injury_status!.status), fontWeight: 600, textTransform: "capitalize" }}>
                {p.injury_status!.status}
              </td>
              <td className="r">{recoveryText(p)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
