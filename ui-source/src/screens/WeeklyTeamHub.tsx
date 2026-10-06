import { LeagueWire } from "@/components/LeagueWire";
import { seasonShape } from "@/state/leagueFormat";
import { recordWatch } from "@/state/seasonAwards";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { Card, CardHeader, Footer, Panel, Tabs, Ticker, useTabs } from "@/components/primitives";
import { ExpiringContracts } from "@/components/ExpiringContracts";
import { GamePlanStrip } from "@/components/GamePlanStrip";
import { MatchupBoard, type SubMetric } from "@/components/MatchupBoard";
import { WaitingStakes } from "@/components/WaitingStakes";
import { productionRanks } from "@/state/productionRanks";
import { BETTER, type StatKey, teamProduction } from "@/state/teamProduction";
import { LeagueRoster } from "@/components/LeagueRoster";
import { ReadinessGate } from "@/components/ReadinessGate";
import { TEAMS_BY_CODE, teamFullName } from "@/data/teams";
import { record, winPct } from "@/domain";
import { STAGE_LABEL } from "@/state/stageMachine";
import { hasMoreToReveal, revealedWeek, viewerWeek, visibleGames } from "@/state/reveal";
import { currentBlock } from "@/state/revealBlocks";
import { rankBy, staffCards } from "@/state/staffRatings";
import { useLeagueActions } from "@/state/useLeagueActions";
import { onlineSession } from "@/state/online";
import { isHumansOnly, playoffFieldSize } from "@/state/leagueFormat";
import { useStore } from "@/state/store";
import { sideRatings } from "@/state/unitReport";
import { talentScaleOf } from "@/state/talentImpact";
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
import { count, millions, ordinal, posLabel } from "@/util/format";

// Was `0.5 + 0.02 * gap + a 4% home edge`, which was a guess in both terms.
// `win-probability.ts` is the same question answered by 47,616 engine games,
// and the home edge is back because the engine has one now (OQ-10).
const favWinProb = (
  a: { overall: number },
  b: { overall: number },
  atHome: boolean,
  talentScale: number,
): number => winProbability(a.overall, b.overall, atHome ? "home" : "away", talentScale);

export function WeeklyTeamHub() {
  const nav = useNavigate();
  // a game week opens on the matchup; the offseason, and a bye, on the overview
  const { active, setActive } = useTabs(
    useStore.getState().stage === "preseason" || useStore.getState().stage === "regularSeason" ? "matchup" : "overview",
  );
  const s = useStore();
  const simulateGameDay = useStore((st) => st.simulateGameDay);

  const code = viewerTeamCode(s);
  // before any early return: hooks run in the same order every render
  const sides = useMemo(
    () => sideRatings({ players: s.players, teams: s.teams, depthChart: s.depthChart }),
    [s.players, s.teams, s.depthChart],
  );
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
  // a game week (preseason or regular season) carries the weekly "what's at
  // stake" update, where the league used to roast the GMs
  const weekly = s.stage === "preseason" || s.stage === "regularSeason";
  const staffCardsAll = staffCards(s);
  const staffOvr = staffCardsAll.find((c) => c.teamCode === code)?.overall ?? 0;
  const staffRank = rankBy(staffCardsAll, "overall").get(code) ?? 0;
  const isPreseason = s.stage === "preseason";
  // Reveals do not move `state.week`, so the header follows this GM's own
  // watching instead: the next game is the first one they haven't seen, and
  // a block watched to the end has no game left to preview. It used to read
  // "Preseason Wk 1 @ Philadelphia, 63%" after all three preseason games had
  // been watched.
  const hubBlock = currentBlock(s);
  const watched = hubBlock ? revealedWeek(s, s.viewerGmId, hubBlock.phase) : 0;
  const blockDone = !!hubBlock && watched >= hubBlock.lastWeek;
  const headerWeek = viewerWeek(s) ?? s.week;
  const g = blockDone ? undefined : weekGame(s, code, headerWeek);
  const oppCode = opponentOf(g, code);
  const opp = oppCode ? s.teams[oppCode] : undefined;
  const iHost = g?.homeTeam === code;

  // A humans-only league is one table: no divisions, no conferences, and
  // only the teams in the league. Reading the NFL's division or conference
  // lists here would look up franchises that do not exist in it.
  const single = isHumansOnly(s);
  const leagueSize = Object.keys(s.teams).length;
  const byTable = (a: string, b: string): number =>
    winPct(s.teams[b]!) - winPct(s.teams[a]!) ||
    s.teams[b]!.pointsFor - s.teams[b]!.pointsAgainst - (s.teams[a]!.pointsFor - s.teams[a]!.pointsAgainst);
  const divCodes = single ? [] : divisionRivals(code).filter((c) => s.teams[c]).sort(byTable);
  const confCodes = single
    ? Object.keys(s.teams).sort(byTable)
    : Object.values(TEAMS_BY_CODE)
        .filter((t) => t.conference === meta.conference && s.teams[t.code])
        .map((t) => t.code)
        .sort(byTable);
  const fieldSize = single ? playoffFieldSize(leagueSize) : 7;

  const h2h = humanHeadToHead(s);
  const gmRows = s.gms
    .filter((gm) => gm.isHuman && gm.teamCode)
    .map((gm) => ({ gm, t: s.teams[gm.teamCode]! }))
    // at 0-0 every GM tied and the table fell back to the order they joined
    // in, weakest roster first as often as not; odds break the tie
    .sort(
      (a, b) =>
        winPct(b.t) - winPct(a.t) ||
        playoffOdds(s, b.gm.teamCode) - playoffOdds(s, a.gm.teamCode) ||
        b.t.ratings.overall - a.t.ratings.overall,
    );

  const preseasonRecord = (() => {
    const mine = (online ? visibleGames(s, s.viewerGmId) : s.games).filter(
      (x) => x.phase === "PRE" && x.played && (x.homeTeam === code || x.awayTeam === code),
    );
    let w = 0;
    let l = 0;
    let t = 0;
    for (const x of mine) {
      const us = x.homeTeam === code ? x.homeScore : x.awayScore;
      const them = x.homeTeam === code ? x.awayScore : x.homeScore;
      if (us > them) w++;
      else if (us < them) l++;
      else t++;
    }
    return t ? `${w}-${l}-${t}` : `${w}-${l}`;
  })();

  const notes = watchNotes(s);
  // no game this week (a bye, the offseason): the matchup tab isn't offered
  const tab = active === "matchup" && !oppCode ? "overview" : active;
  // ranks of what's been done on the field this season (null before the first game)
  // from what this GM has watched: online, `state.games` runs ahead of them
  const seenGames = online ? visibleGames(s, s.viewerGmId) : s.games;
  const produced = productionRanks(s, seenGames);
  const prod = teamProduction(seenGames, Object.keys(s.teams));
  const winProb = opp ? favWinProb(team.ratings, opp.ratings, iHost, talentScaleOf(s.config)) : 50;

  return (
    <Card maxWidth={760}>
      <CardHeader
        badge={meta.abbr}
        title={meta.label}
        subtitle={
          isPreseason
            ? `Preseason · starting lineup ${team.ratings.overall} OVR`
            : // before a game is played the place is only the tiebreak order
              team.wins + team.losses + team.ties === 0
              ? single
                ? `${record(team)} · ${leagueSize}-team league` // no divisions to name
                : `${record(team)} · ${meta.conference} ${meta.division}`
              : single
                ? `${record(team)} · ${ordinal(team.leagueRank)} of ${leagueSize}`
                : `${record(team)} · ${ordinal(team.divisionRank)} in ${meta.conference} ${meta.division}`
        }
        right={
          <>
            <p>
              {!phase
                ? // the deadline and the midseason market are not the offseason
                  s.stage.startsWith("midseason") || s.stage.startsWith("tradeDeadline")
                  ? "Mid-season"
                  : "Offseason"
                : blockDone
                  ? isPreseason
                    ? "Preseason complete"
                    : `Through Week ${watched}`
                  : isPreseason
                    ? `Preseason Wk ${headerWeek}`
                    : `Week ${headerWeek}`}
            </p>
            <p>
              {oppCode
                ? `${iHost ? "vs" : "@"} ${TEAMS_BY_CODE[oppCode]!.label}${isPreseason ? "" : ` (${record(s.teams[oppCode]!)})`}`
                : blockDone
                  ? "Ready when you are"
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
            ? { label: "Win probability (default strategy)", value: `${winProb}%` }
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
          // roster strength, not the standings — "League rank" beside the
          // record read like a place in the table
          // "4th" in a four-team league is last; say so
          { label: "Roster rank", value: single ? `${ordinal(team.ratings.overallRank)} of ${leagueSize}` : ordinal(team.ratings.overallRank) },
          {
            label: isPreseason ? "Preseason" : "Record",
            // preseason games never count in the standings, so the team's
            // record read 0-0 all preseason; this is what the GM has watched
            value: isPreseason ? preseasonRecord : record(team),
            className: "sm",
          },
        ]}
      />

      {/* on a phone the week's controls sit under every tab, the wire and the
          unit ranks — a long scroll to the one button the hub is for */}
      {phase && (
        <button
          type="button"
          className="btnlink jump-next"
          onClick={() => document.getElementById("hub-next")?.scrollIntoView({ behavior: "smooth", block: "center" })}
        >
          Jump to what&rsquo;s next ↓
        </button>
      )}
      {weekly && <GamePlanStrip />}
      <Tabs
        tabs={[
          // the game is what this screen is for in a season; the league's
          // overview is the last stop
          ...(oppCode ? [{ id: "matchup", label: "Matchup" }] : []),
          ...(single ? [] : [{ id: "division", label: "Division Standings" }]),
          { id: "league", label: "League Standings" },
          // a solo dynasty has one human GM: a standings table of one
          ...(gmRows.length > 1 ? [{ id: "gms", label: "GM Standings" }] : []),
          { id: "injuries", label: "Injuries" },
          { id: "overview", label: "Overview" },
        ]}
        active={tab}
        onChange={setActive}
      />

      <Panel id="overview" open={tab === "overview"}>
        {code && <ExpiringContracts teamCode={code} />}
        {/* inert in a single-player dynasty; the component decides */}
        <LeagueRoster />
        {/* the rail's wire is hidden on a phone; this is where it goes instead */}
        <div className="wire-inline">
          <LeagueWire />
        </div>
        {weekly ? (
          <WaitingStakes />
        ) : (
          <>
            <p className="subhead" style={{ marginTop: 0 }}>
              Around the league — things to watch
            </p>
            {notes.map((n) => (
              <div className="watchnote" key={n.gmId}>
                <div className="who">
                  {n.gmName} · {TEAMS_BY_CODE[n.teamCode]!.label}
                </div>
                <p className="txt">
                  <strong style={{ color: "var(--ink)" }}>{n.player}</strong> {n.note}.
                </p>
              </div>
            ))}
            {recordWatch(s, s.config.leagueFormat === "humansOnly" ? seasonShape(s).regularSeasonWeeks : 17).map((r) => (
              <div className="watchnote" key={`rw-${r.playerId}-${r.text}`}>
                <div className="who">Record watch · {TEAMS_BY_CODE[r.team]?.label ?? r.team}</div>
                <p className="txt">
                  <strong style={{ color: "var(--ink)" }}>{s.players[r.playerId]?.name}</strong> {r.text}.
                </p>
              </div>
            ))}
          </>
        )}

        <p className="subhead">Unit ranks</p>
        <div className="split-4" style={{ gap: 10 }}>
          {/* engine-weighted, the same reading as Roster & Cap's Unit grades */}
          <UnitCard of={leagueSize} label="Offense" rank={sides[code]?.offenseRank ?? team.ratings.offenseRank} rating={sides[code]?.offense ?? team.ratings.offense} />
          <UnitCard of={leagueSize} label="Defense" rank={sides[code]?.defenseRank ?? team.ratings.defenseRank} rating={sides[code]?.defense ?? team.ratings.defense} />
          <UnitCard of={leagueSize} label="Special teams" rank={team.ratings.specialTeamsRank} rating={team.ratings.specialTeams} />
          {/* Change 6: a staff is a unit like any other, and after drafting
              twelve of them a GM should be able to see where that landed. */}
          <UnitCard of={leagueSize} label="Coaching" rank={staffRank} rating={staffOvr} />
        </div>
      </Panel>

      <Panel id="matchup" open={tab === "matchup"}>
        {oppCode && opp ? (
          <MatchupBoard
            when={isPreseason ? `Preseason Wk ${headerWeek}` : `Week ${headerWeek}`}
            me={{ code, record: record(team), site: iHost ? "home" : "away" }}
            them={{ code: oppCode, record: record(opp), site: iHost ? "away" : "home" }}
            winProb={winProb}
            metrics={[
              { label: "Team overall", a: team.ratings.overall, b: opp.ratings.overall },
              // the same engine-weighted ranks as Unit ranks on the overview —
              // the stored ones disagreed with it by a place or two
              // what each team has actually produced this season, from the box
              // scores — roster ratings only until a game has been played
              {
                label: produced ? "Offense rank (points scored)" : "Offense rank",
                subs: subsOf(prod, code, oppCode, [
                  ["points", "Points per game", f1, "average per game"],
                  ["rushYds", "Rushing yards per game", f1, "average per game"],
                  ["passYds", "Passing yards per game", f1, "average per game"],
                  ["compPct", "Completion %", pct, "completions per attempt"],
                  ["separation", "Avg. separation", yd, "Yards of separation on targets. A modelled estimate of the receivers' route running and hands against the coverage; the game doesn't measure it."],
                  ["pressure", "Pressure % allowed", pct, "Sacks plus quarterback hits per dropback: the offensive line's grade. Lower is better."],
                  ["possession", "Avg. time of possession", clock, "average per game"],
                ]),
                rank: true,
                a: produced?.get(code)?.offense ?? sides[code]?.offenseRank ?? team.ratings.offenseRank,
                b: produced?.get(oppCode)?.offense ?? sides[oppCode]?.offenseRank ?? opp.ratings.offenseRank,
              },
              {
                label: produced ? "Defense rank (points allowed)" : "Defense rank",
                subs: subsOf(prod, code, oppCode, [
                  ["pointsAllowed", "Points allowed per game", f1, "average per game"],
                  ["passYdsAllowed", "Passing yards allowed per game", f1, "average per game"],
                  ["rushYdsAllowed", "Rushing yards allowed per game", f1, "average per game"],
                  ["interceptions", "Interceptions", int, "season total"],
                  ["recoveries", "Fumble recoveries", int, "season total"],
                ]),
                rank: true,
                a: produced?.get(code)?.defense ?? sides[code]?.defenseRank ?? team.ratings.defenseRank,
                b: produced?.get(oppCode)?.defense ?? sides[oppCode]?.defenseRank ?? opp.ratings.defenseRank,
              },
              {
                label: produced?.get(code)?.specialTeams != null ? "Special teams rank (kicking points)" : "Special teams rank",
                subs: subsOf(prod, code, oppCode, [
                  ["kickPoints", "Kicking points", f1, "field goals and extra points, per game"],
                  ["krTd", "Kick return TDs", int, "season total"],
                  ["prTd", "Punt return TDs", int, "season total"],
                  ["startOwn", "Own avg. start", spot, "Where this team's drives begin, in yards from its own goal line. Higher is better."],
                  ["startOpp", "Opponents' avg. start", spot, "Where opponents' drives begin against this team. Lower is better."],
                ]),
                rank: true,
                a: produced?.get(code)?.specialTeams ?? team.ratings.specialTeamsRank,
                b: produced?.get(oppCode)?.specialTeams ?? opp.ratings.specialTeamsRank,
              },
            ]}
          />
        ) : (
          <div className="emptystate">{phase ? "Bye week — no matchup." : "No game this week — the league is in the offseason."}</div>
        )}
        {/* the week's stakes sit below the numbers and above the advance button */}
        {weekly && (
          <div style={{ marginTop: 24 }}>
            <WaitingStakes />
          </div>
        )}
      </Panel>

      <Panel id="division" open={tab === "division"}>
        <p className="subhead" style={{ marginTop: 0 }}>
          {meta.conference} {meta.division}
        </p>
        <StandingsTable s={s} codes={divCodes} me={code} />
      </Panel>

      <Panel id="league" open={tab === "league"}>
        <p className="subhead" style={{ marginTop: 0 }}>
          {single ? "League — playoff seeding" : `${meta.conference} — playoff seeding`}
        </p>
        <StandingsTable s={s} codes={confCodes} me={code} seedTop={fieldSize} />
        <p style={{ margin: "10px 0 0", fontSize: 11, color: "var(--ink-faint)" }}>
          {single
            ? `The top ${fieldSize} make the playoffs, best seed against worst; the final is at a neutral site.`
            : "The top 7 seeds make the playoffs; seed 1 gets a first-round bye."}
        </p>
      </Panel>

      <Panel id="gms" open={tab === "gms"}>
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
                      // "–" beside the "—" on the diagonal read as the same blank
                      <td className="c" key={o.gm.id} title={hh && hh.w + hh.l > 0 ? undefined : "Haven't played each other yet"}>
                        {hh && hh.w + hh.l > 0 ? `${hh.w}-${hh.l}` : "0-0"}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel id="injuries" open={tab === "injuries"}>
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
        {/* the Hooded Figure's bargains sideline players without an injury
            status, so a 97 out for the season appeared on no report at all */}
        {(() => {
          const week = viewerWeek(s) ?? s.week;
          const out = (s.hoodedFigure?.unavailable ?? [])
            .filter((u) => u.untilWeek === null || week <= u.untilWeek)
            .map((u) => ({ u, p: s.players[u.playerId] }))
            .filter((x) => x.p && !x.p.retired);
          if (out.length === 0) return null;
          return (
            <>
              <p className="subhead">Unavailable — league developments</p>
              <ul style={{ margin: "0 0 12px", paddingLeft: 18, fontSize: 12.5 }}>
                {out.map(({ u, p }) => (
                  <li key={u.playerId}>
                    {p!.name} <span className="pos">{posLabel(p!.position)}</span> · {p!.nfl_team ?? "FA"} ·{" "}
                    {u.untilWeek === null ? "rest of season" : `through week ${u.untilWeek}`}
                  </li>
                ))}
              </ul>
            </>
          );
        })()}
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
          <button type="button" className="btnlink btn-primary" onClick={() => nav("/")}>
            Go to {STAGE_LABEL[s.stage]}
          </button>
        )}
      </Footer>

      <span id="hub-next" />
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
  // the advance that starts the next block simulates it — a while, on the server
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!busy) {
      setSlow(false);
      return;
    }
    const t = setTimeout(() => setSlow(true), 8_000);
    return () => clearTimeout(t);
  }, [busy]);
  // a refused or dropped reveal used to leave the button looking like it did nothing
  const [error, setError] = useState<string | null>(null);

  const block = currentBlock(s);
  if (!block) return null;
  const { phase, firstWeek, lastWeek } = block;
  const seen = Math.max(revealedWeek(s, s.viewerGmId, phase), firstWeek - 1);
  // a bye is on the published schedule, so saying so gives nothing away —
  // and "Simulate week 10" for a week you don't play read like a mistake
  const me = viewerTeamCode(s);
  const byeNext =
    !!me && !s.games.some((g) => g.phase === phase && g.week === seen + 1 && (g.homeTeam === me || g.awayTeam === me));
  const more = hasMoreToReveal(s, s.viewerGmId, phase, lastWeek);

  const reveal = (through: number): void => {
    setBusy(true);
    setError(null);
    // the weeks this press uncovers, which is what the results screen shows:
    // one tab for a single week, one per week for "simulate the rest"
    const from = seen + 1;
    void actions
      .revealThrough(through)
      .then((res) => {
        if (res.ok) nav(`/results/${phase}/${from}/${through}`);
        else setError(res.reason ?? "Couldn't reveal that. Try again.");
      })
      .finally(() => setBusy(false));
  };

  // every other GM already committed: say so, since this press is the one
  // the whole league is waiting for
  const others = s.gms.filter((g) => g.isHuman && g.id !== s.viewerGmId);
  const othersWaiting = others.length > 0 && others.every((g) => s.readiness[g.id]);

  if (!more) {
    return (
      <div className="readiness">
        <div className="readiness-top">
          <p>{phase === "PRE" ? "Preseason complete" : `Watched through Week ${lastWeek}`}</p>
          <span>{othersWaiting ? "Everyone else has checked in — the league is waiting on you" : "Ready whenever you are"}</span>
        </div>
        <button
          className="btn-primary"
          style={{ width: "100%" }}
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setError(null);
            const before = useStore.getState().stage;
            void actions
              .readyUp(true)
              .then((res) => {
                if (!res.ok) {
                  setError(res.reason ?? "Couldn't reach the league. Try again.");
                  return;
                }
                // the last GM to commit moves the league: take them there
                // rather than leaving them on a hub for a finished stage
                const next = useStore.getState().stage;
                if (next !== before) nav("/");
              })
              .finally(() => setBusy(false));
          }}
        >
          {busy ? "Simulating…" : block.advanceLabel}
        </button>
        {slow && (
          <p role="status" style={{ margin: "8px 0 0", fontSize: 11.5, color: "var(--ink-faint)" }}>
            Still working — simulating a block of games can take a minute or two on the league server.
          </p>
        )}
        {error && (
          <p className="form-error" role="status" style={{ margin: "8px 0 0" }}>
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="readiness">
      <div className="readiness-top">
        <p>{phase === "PRE" ? "Preseason" : "Regular season"}</p>
        <span aria-live="polite">
          {seen > 0 ? `Watched through Week ${seen} of ${lastWeek}` : `Nothing watched yet · ${count(lastWeek, "week")} in this block`}
        </span>
      </div>
      <p className="readiness-held">
        Watch at your own pace — catching up here won&rsquo;t rush anyone else in the league.
      </p>
      <div style={{ display: "flex", gap: 8 }}>
        <button
          className="btn-primary"
          style={{ flex: 1 }}
          disabled={busy}
          onClick={() => reveal(seen + 1)}
        >
          {busy ? "…" : `Simulate week ${seen + 1}${byeNext ? " (your bye)" : ""}`}
        </button>
        {/* with one week left the two buttons did the same thing */}
        {seen + 1 < lastWeek && (
          <button
            className="btnlink"
            style={{ flex: 1 }}
            disabled={busy}
            onClick={() => reveal(lastWeek)}
          >
            {block.phase === "PRE" && seen >= firstWeek ? "Simulate the rest of the preseason" : block.watchAllLabel}
          </button>
        )}
      </div>
      {error && (
        <p className="form-error" role="status" style={{ margin: "8px 0 0" }}>
          {error}
        </p>
      )}
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
  // latest by phase, then week: sorting on the week alone put preseason week
  // 3 ahead of regular-season week 2
  const order = (g: { phase: string; week: number }) =>
    g.phase === "PRE" ? g.week : g.phase === "REG" ? 100 + g.week : 200 + ["WC", "DIV", "CONF", "SB"].indexOf(g.phase);
  return [...seen]
    .filter((x) => x.played && (x.homeTeam === code || x.awayTeam === code))
    .sort((a, b) => order(b) - order(a))[0];
}

function UnitCard({ label, rank, rating, of }: { label: string; rank: number; rating: number; of: number }) {
  // scaled to this league: a humans-only league has a handful of teams, and
  // last of four read as a nearly full bar out of 32
  const pct = Math.max(6, Math.round(((of + 1 - rank) / Math.max(1, of)) * 100));
  return (
    <div style={{ background: "var(--panel-sunken)", border: "1px solid var(--line)", borderRadius: "var(--r-md)", padding: "13px 14px" }}>
      <p style={{ margin: 0, fontSize: 11, color: "var(--ink-faint)" }}>{label}</p>
      <p className="oswald" style={{ margin: "4px 0 8px", fontSize: 18, fontWeight: 600 }}>
        {ordinal(rank)}
        {of < 32 ? ` of ${of}` : ""}{" "}
        <span style={{ fontSize: 12, color: "var(--ink-dim)", fontWeight: 400 }}>· {rating} OVR</span>
      </p>
      <div style={{ height: 6, background: "var(--panel-raised)", borderRadius: 3, overflow: "hidden" }}>
        <div style={{ height: "100%", background: "var(--team)", borderRadius: 3, width: `${pct}%` }} />
      </div>
    </div>
  );
}

function StandingsTable({
  s,
  codes,
  me,
  seedTop = 0,
}: {
  s: ReturnType<typeof useStore.getState>;
  codes: string[];
  me: string;
  /** how many make the playoffs from this table; 0 = no seed column */
  seedTop?: number;
}) {
  return (
    <div style={{ background: "var(--panel-sunken)", border: "1px solid var(--line)", borderRadius: "var(--r-md)", padding: "6px 14px" }}>
      <table className="stbl">
        <thead>
          <tr>
            {seedTop > 0 && <th style={{ width: 26 }}>Sd</th>}
            <th>Team</th>
            <th className="c">W</th>
            <th className="c">L</th>
            <th className="c">T</th>
            <th className="r">PF</th>
            <th className="r">PA</th>
            <th className="r">PD</th>
          </tr>
        </thead>
        <tbody>
          {codes.map((c, i) => {
            const t = s.teams[c]!;
            const pd = t.pointsFor - t.pointsAgainst;
            const inField = seedTop > 0 && i < seedTop;
            return (
              <tr key={c} className={c === me ? "highlight" : ""}>
                {seedTop > 0 && (
                  <td className="c" style={{ color: inField ? "var(--good)" : "var(--ink-faint)", fontWeight: inField ? 700 : 400 }}>
                    {inField ? i + 1 : "–"}
                  </td>
                )}
                <td>{teamFullName(c)}</td>
                <td className="c">{t.wins}</td>
                <td className="c">{t.losses}</td>
                <td className="c">{t.ties}</td>
                <td className="r">{t.pointsFor}</td>
                <td className="r">{t.pointsAgainst}</td>
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
            <th>Injury</th>
            <th className="c">Status</th>
            <th className="r">Recovery</th>
          </tr>
        </thead>
        <tbody>
          {players.map((p) => (
            <tr key={p.id}>
              <td className="name">
                {p.name} <span className="pos">{posLabel(p.position)}</span>
              </td>
              {showTeam && <td className="c">{p.nfl_team}</td>}
              <td className="c" style={{ color: "var(--ink)", fontWeight: 600 }}>
                {p.overall}
              </td>
              <td style={{ textTransform: "capitalize" }}>{p.injury_status!.description || "Undisclosed"}</td>
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

// ---- the figures behind each unit rank on the matchup tab ---------------------

const f1 = (n: number): string => n.toFixed(1);
const pct = (n: number): string => `${n.toFixed(1)}%`;
const yd = (n: number): string => `${n.toFixed(1)} yd`;
const int = (n: number): string => String(Math.round(n));
const spot = (n: number): string => `own ${n.toFixed(1)}`;
const clock = (secs: number): string => `${Math.floor(secs / 60)}:${String(Math.round(secs % 60)).padStart(2, "0")}`;

/** One unit's sub-rows for the two teams in the matchup, from the season's box scores. */
function subsOf(
  prod: ReturnType<typeof teamProduction>,
  me: string,
  them: string,
  rows: [StatKey, string, (n: number) => string, string][],
): SubMetric[] {
  return rows.map(([key, label, fmt, hint]) => ({
    label,
    a: prod?.get(me)?.[key]?.value ?? null,
    b: prod?.get(them)?.[key]?.value ?? null,
    aRank: prod?.get(me)?.[key]?.rank ?? null,
    bRank: prod?.get(them)?.[key]?.rank ?? null,
    better: BETTER[key],
    fmt,
    hint,
  }));
}
