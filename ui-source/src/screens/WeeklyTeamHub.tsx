import { useNavigate } from "react-router-dom";

import { TeamBadge } from "@/components/bits";
import { Card, CardHeader, Footer, Panel, Tabs, Ticker, useTabs } from "@/components/primitives";
import { ReadinessGate } from "@/components/ReadinessGate";
import { TEAMS_BY_CODE, teamFullName } from "@/data/teams";
import { record, winPct } from "@/domain";
import { STAGE_HOME, STAGE_LABEL } from "@/state/stageMachine";
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
import { ordinal } from "@/util/format";

function favWinProb(a: { overall: number }, b: { overall: number }, homeEdge = 4): number {
  return Math.round(Math.min(0.9, Math.max(0.1, 0.5 + (a.overall - b.overall) * 0.02 + homeEdge / 100)) * 100);
}

export function WeeklyTeamHub() {
  const nav = useNavigate();
  const { active, setActive } = useTabs("overview");
  const s = useStore();
  const simulateGameDay = useStore((st) => st.simulateGameDay);

  const code = viewerTeamCode(s);
  if (!code) {
    return (
      <Card>
        <CardHeader badge="FS" title="Weekly Team Hub" subtitle="No team selected" />
        <div className="panel open">
          <div className="emptystate">Pick a team in League Setup to see your team hub.</div>
        </div>
      </Card>
    );
  }

  const meta = TEAMS_BY_CODE[code]!;
  const team = s.teams[code]!;
  const phase = currentPhase(s);
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
  const winProb = opp ? favWinProb(team.ratings, opp.ratings, iHost ? 4 : -4) : 50;

  return (
    <Card maxWidth={760}>
      <CardHeader
        badge={meta.abbr}
        title={meta.city}
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
                ? `${iHost ? "vs" : "@"} ${TEAMS_BY_CODE[oppCode]!.city} (${record(s.teams[oppCode]!)})`
                : phase
                  ? "Bye week"
                  : STAGE_LABEL[s.stage]}
            </p>
          </>
        }
      />

      <Ticker
        stats={[
          { label: "Win probability", value: oppCode ? `${winProb}%` : "—" },
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
        <p className="subhead" style={{ marginTop: 0 }}>
          Around the league — things to watch
        </p>
        {notes.map((n) => (
          <div className="watchnote" key={n.gmId}>
            <div className="who">
              {n.gmName} · {TEAMS_BY_CODE[n.teamCode]!.city}
            </div>
            <p className="txt">
              <strong style={{ color: "var(--ink)" }}>{n.player}</strong> {n.note}.
            </p>
          </div>
        ))}

        <p className="subhead">Unit ranks</p>
        <div className="split-3" style={{ gap: 10 }}>
          <UnitCard label="Offense" rank={team.ratings.offenseRank} rating={team.ratings.offense} />
          <UnitCard label="Defense" rank={team.ratings.defenseRank} rating={team.ratings.defense} />
          <UnitCard label="Special teams" rank={team.ratings.specialTeamsRank} rating={team.ratings.specialTeams} />
        </div>
      </Panel>

      <Panel id="matchup" open={active === "matchup"}>
        {oppCode && opp ? (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center", gap: 12, marginBottom: 16 }}>
              <div style={{ textAlign: "center" }}>
                <TeamBadge code={code} size={40} />
                <p style={{ margin: "6px 0 0", fontSize: 13, fontWeight: 600 }}>{meta.city}</p>
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
                <p style={{ margin: "6px 0 0", fontSize: 13, fontWeight: 600 }}>{TEAMS_BY_CODE[oppCode]!.city}</p>
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
                  <td>{TEAMS_BY_CODE[r.gm.teamCode]!.city}</td>
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
            <p className="subhead">{TEAMS_BY_CODE[oppCode]!.city}</p>
            <InjuryTable players={injuredOn(s, oppCode)} />
          </>
        )}
        <p className="subhead">League watch — top injuries</p>
        <InjuryTable players={leagueInjuries(s)} showTeam />
      </Panel>

      <Footer>
        <button type="button" className="btnlink" onClick={() => nav("/roster")}>
          Roster &amp; Cap
        </button>
        <button type="button" className="btnlink" onClick={() => nav("/coaching")}>
          Coaching Staff
        </button>
        <button type="button" className="btnlink" onClick={() => nav("/free-agency")}>
          Free Agency
        </button>
        {(() => {
          const last = lastResult(s, code);
          return last && phase && hasBoxScore(last) ? (
            <button type="button" className="btnlink btn-primary" onClick={() => nav(`/box/${last.id}`)}>
              Latest box score
            </button>
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
      {phase && !s.pendingGameDay && (
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

function lastResult(s: ReturnType<typeof useStore.getState>, code: string) {
  return [...s.games]
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
