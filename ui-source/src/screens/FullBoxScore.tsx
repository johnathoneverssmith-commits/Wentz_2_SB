import { useNavigate, useParams, useSearchParams } from "react-router-dom";

import { TeamBadge } from "@/components/bits";
import { Footer, Panel, Tabs, Ticker, useTabs } from "@/components/primitives";
import { GameDayMasthead } from "@/design/GameDayMasthead";
import { GdPage } from "@/design/GdPage";
import { TEAMS_BY_CODE } from "@/data/teams";
import { roundLabelFor, type PlayerGameLine, type PlayoffRound, type TeamGameTotals } from "@/domain";
import { findGame } from "@/state/gameHistory";
import { viewerTeamCode } from "@/state/selectors";
import { useStore } from "@/state/store";
import { teamInfoFor } from "@/state/teamInfo";
import { posLabel, seconds, weeksOut } from "@/util/format";

import { RecapPanel } from "./RecapPanel";

import "@/design/gameday.css";
import "@/design/gameday-blocks.css";
import "./game-days-gameday.css";

export function FullBoxScore() {
  const { gameId } = useParams();
  const nav = useNavigate();
  // A results screen passes its own URL in `back`, so the one way out of this
  // screen is the week the GM left — see SeasonResults.
  const back = useSearchParams()[0].get("back");
  const game = useStore((s) => findGame(s, gameId));
  const bracket = useStore((s) => s.bracket);
  const league = useStore();
  const mine = useStore((s) => viewerTeamCode(s));
  const { active, setActive } = useTabs("recap");

  if (!game || !game.totals) {
    return (
      <GdPage code={mine} className="gdy">
        <GameDayMasthead code={mine ?? ""} compact title="Box score" heading="Box score" sub={game ? "Not available for this game." : "Unknown game."} />
        <div className="emptystate">
          {game
            ? "No box score was recorded for this game — the final score is all that was kept. Games played from here on carry the full detail."
            : "That game isn't in this league's history — it may have been from a previous save."}
        </div>
        <Footer>
          <button type="button" className="btnlink" onClick={() => nav("/schedule")}>
            Full schedule
          </button>
          <button type="button" className="btnlink btn-primary" onClick={() => nav("/hub")}>
            Back to team hub
          </button>
        </Footer>
      </GdPage>
    );
  }

  const { home, away } = game.totals;
  const homeWin = game.homeScore > game.awayScore;
  const tie = game.homeScore === game.awayScore;
  // worst first, because that's the one the reader came for
  const injuries = [...(game.injuries ?? [])].sort(
    (a, b) => (b.projectedWeeks[1] ?? 0) - (a.projectedWeeks[1] ?? 0),
  );
  // each team's rating and record as of this game
  const info = teamInfoFor(league, league.games, game.phase, game.week);
  const homeMeta = TEAMS_BY_CODE[game.homeTeam]!;
  const awayMeta = TEAMS_BY_CODE[game.awayTeam]!;

  return (
    <GdPage code={mine ?? game.homeTeam} className="gdy gd-tabbed">
      <GameDayMasthead
        code={mine ?? game.homeTeam}
        compact
        title={`Final · ${
          game.phase === "PRE"
            ? `Preseason Wk ${game.week}`
            : game.phase === "REG"
              ? `Week ${game.week}`
              : roundLabelFor(bracket, game.phase as PlayoffRound)
        }`}
        heading="Box score"
        sub={game.weather ?? `${homeMeta.label} and ${awayMeta.label}`}
      />
      <div className="gdy-final gdy-final--box">
        <TeamSide meta={homeMeta} score={game.homeScore} won={homeWin} info={info(game.homeTeam)} />
        <div className="gdy-final-tag">
          {tie ? (
            "Tie"
          ) : (
            <>
              <span className="gdy-won">{(homeWin ? homeMeta : awayMeta).abbr} W</span>
              <span>{(homeWin ? awayMeta : homeMeta).abbr} L</span>
            </>
          )}
        </div>
        <TeamSide meta={awayMeta} score={game.awayScore} won={!homeWin && !tie} right info={info(game.awayTeam)} />
      </div>

      <Ticker
        stats={[
          { label: `Total yards`, value: `${homeMeta.abbr} ${home.totalYards} – ${away.totalYards} ${awayMeta.abbr}`, className: "sm" },
          { label: "Pass yards", value: `${home.passYards} – ${away.passYards}` },
          { label: "Rush yards", value: `${home.rushYards} – ${away.rushYards}` },
          { label: "Turnovers", value: `${home.turnovers} – ${away.turnovers}` },
        ]}
      />

      <div className="gd-hub">
      <Tabs
        tabs={[
          { id: "recap", label: "Recap" },
          { id: "team", label: "Team Stats" },
          { id: "scoring", label: "Scoring Summary" },
          { id: "home", label: TEAMS_BY_CODE[game.homeTeam]!.label },
          { id: "away", label: TEAMS_BY_CODE[game.awayTeam]!.label },
          // only when there were any: an empty tab is a worse answer than no tab
          ...(injuries.length > 0 ? [{ id: "injuries", label: "Injuries" }] : []),
        ]}
        active={active}
        onChange={setActive}
      />
      </div>

      <Panel id="recap" open={active === "recap"}>
        <RecapPanel game={game} />
      </Panel>

      <Panel id="team" open={active === "team"}>
        <table className="mtable gdy-teamstats">
          <thead>
            <tr>
              <th className="gdy-stat-h">Team stat</th>
              <th className="gdy-stat-c">{homeMeta.abbr}</th>
              <th className="gdy-stat-gap" />
              <th className="gdy-stat-c">{awayMeta.abbr}</th>
            </tr>
          </thead>
          <tbody>
            <TeamStatRow label="Total yards" h={home.totalYards} a={away.totalYards} />
            <TeamStatRow label="Passing yards" h={home.passYards} a={away.passYards} />
            <TeamStatRow label="Rushing yards" h={home.rushYards} a={away.rushYards} />
            <TeamStatRow label="Total plays" h={home.plays} a={away.plays} />
            <TeamStatRow label="Third down" h={`${home.thirdDownMade}/${home.thirdDownAtt}`} a={`${away.thirdDownMade}/${away.thirdDownAtt}`} />
            <TeamStatRow label="Time of possession" h={seconds(home.topSeconds)} a={seconds(away.topSeconds)} />
            <TeamStatRow label="Penalties" h={`${home.penalties}-${home.penaltyYards}`} a={`${away.penalties}-${away.penaltyYards}`} />
            <TeamStatRow label="Turnovers" h={home.turnovers} a={away.turnovers} />
            {/* what each defense did: the totals of its players' lines */}
            {game.playerLines && (
              <>
                <TeamStatRow label="Sacks" h={sumOf(game.playerLines.home, "sacks")} a={sumOf(game.playerLines.away, "sacks")} />
                <TeamStatRow label="Interceptions" h={sumOf(game.playerLines.home, "defInt")} a={sumOf(game.playerLines.away, "defInt")} />
                <TeamStatRow label="Forced fumbles" h={sumOf(game.playerLines.home, "ffum")} a={sumOf(game.playerLines.away, "ffum")} />
                <TeamStatRow label="Passes defended" h={sumOf(game.playerLines.home, "passDef")} a={sumOf(game.playerLines.away, "passDef")} />
              </>
            )}
          </tbody>
        </table>
      </Panel>

      <Panel id="scoring" open={active === "scoring"}>
        <p className="subhead">By quarter</p>
        <table className="stbl gdy-quarters">
          <thead>
            <tr>
              <th />
              {home.byQuarter.map((_, i) => (
                <th className="c" key={i}>
                  {i < 4 ? `Q${i + 1}` : `OT${i - 3}`}
                </th>
              ))}
              <th className="r">Final</th>
            </tr>
          </thead>
          <tbody>
            <QuarterRow name={TEAMS_BY_CODE[game.homeTeam]!.label} q={home.byQuarter} total={game.homeScore} />
            <QuarterRow name={TEAMS_BY_CODE[game.awayTeam]!.label} q={away.byQuarter} total={game.awayScore} />
          </tbody>
        </table>
        <p className="subhead">Scoring plays</p>
        {(game.scoringPlays ?? []).map((p, i) => (
          <div key={i} className="gdy-play">
            <span className="gdy-play-q">Q{p.quarter}</span>
            <span className="gdy-play-team">
              <TeamBadge code={p.team} size={22} />
            </span>
            <span className="gdy-play-text">{p.description}</span>
            <span className="gdy-play-score">
              {p.homeScore}–{p.awayScore}
            </span>
          </div>
        ))}
      </Panel>

      <Panel id="home" open={active === "home"}>
        {!game.playerLines && (
          <p className="gdy-note gdy-note--left">
            Player lines are kept for your own games; this one keeps its team totals and scoring.
          </p>
        )}
        <TeamLines lines={game.playerLines?.home ?? []} />
      </Panel>
      <Panel id="away" open={active === "away"}>
        <TeamLines lines={game.playerLines?.away ?? []} />
      </Panel>

      <Panel id="injuries" open={active === "injuries"}>
        <p className="sectionlabel">Left the game</p>
        {injuries.map((e, i) => (
          <div key={`${e.playerId}-${i}`} className="neg-row">
            <div>
              <span className="pname">
                {e.player} <span className="ppos">{posLabel(e.position)}</span>
              </span>
              <p className="gdy-sub">
                {TEAMS_BY_CODE[e.team]?.abbr ?? e.team} · Q{e.quarter} {e.clock} · {e.bodyPart}
              </p>
            </div>
            <div className="gdy-right">
              <span className="gdy-severity">{e.severity}</span>
              <p className="gdy-sub">
                {weeksOut(e.projectedWeeks)}
              </p>
            </div>
          </div>
        ))}
        <p className="gdy-note gdy-note--left">
          An injury keeps a player out of the roster sheet until he's back, so these are the
          weeks his team plays without him.
        </p>
      </Panel>

      <Footer>
        {back ? (
          <button type="button" className="btnlink btn-primary" onClick={() => nav(back)}>
            Return to Game Results
          </button>
        ) : (
          <>
            <button type="button" className="btnlink" onClick={() => nav("/schedule")}>
              Full schedule
            </button>
            <button type="button" className="btnlink btn-primary" onClick={() => nav("/hub")}>
              Back to team hub
            </button>
          </>
        )}
      </Footer>
    </GdPage>
  );
}

function TeamSide({
  meta,
  score,
  won,
  right = false,
  info,
}: {
  meta: import("@/domain").TeamMeta;
  score: number;
  won: boolean;
  right?: boolean;
  info?: string;
}) {
  return (
    <div className={"gdy-score-side" + (right ? " gdy-score-side--away" : "") + (won ? " gdy-won" : "")}>
      <TeamBadge code={meta.code} size={36} />
      <div>
        <span className="gdy-big">{score}</span>
        <span className="gdy-team">{meta.label}</span>
        {info && <span className="gdy-info">{info}</span>}
      </div>
    </div>
  );
}

function TeamStatRow({ label, h, a }: { label: string; h: number | string; a: number | string }) {
  return (
    <tr>
      <td>{label}</td>
      <td className="val">{h}</td>
      <td className="gdy-stat-gap" />
      <td className="val">{a}</td>
    </tr>
  );
}

function QuarterRow({ name, q, total }: { name: string; q: number[]; total: number }) {
  return (
    <tr>
      <td className="name">{name}</td>
      {q.map((v, i) => (
        <td className="c" key={i}>
          {v}
        </td>
      ))}
      <td className="r">{total}</td>
    </tr>
  );
}

const sumOf = (lines: PlayerGameLine[], key: "sacks" | "defInt" | "ffum" | "passDef"): number =>
  lines.reduce((n, l) => n + (l[key] ?? 0), 0);

function TeamLines({ lines }: { lines: PlayerGameLine[] }) {
  // leaders first, as a box score reads: they came in roster order, which put
  // a 71-yard receiver under a 12-yard one
  const by = (key: (l: PlayerGameLine) => number | undefined) => (a: PlayerGameLine, b: PlayerGameLine) =>
    (key(b) ?? 0) - (key(a) ?? 0);
  const pass = lines.filter((l) => (l.passAtt ?? 0) > 0).sort(by((l) => l.passAtt));
  const rush = lines.filter((l) => (l.rushAtt ?? 0) > 0).sort(by((l) => l.rushYds));
  const rec = lines.filter((l) => (l.rec ?? 0) > 0).sort(by((l) => l.recYds));
  const def = lines
    .filter((l) => (l.tackles ?? 0) + (l.sacks ?? 0) + (l.defInt ?? 0) + (l.passDef ?? 0) + (l.ffum ?? 0) > 0)
    .sort(by((l) => (l.tackles ?? 0) + 2 * (l.sacks ?? 0) + 3 * (l.defInt ?? 0) + 2 * (l.ffum ?? 0) + (l.passDef ?? 0)));
  const kick = lines.filter((l) => (l.fga ?? 0) > 0 || (l.xpa ?? 0) > 0);
  return (
    <>
      <StatGroup title="Passing" rows={pass} cols={[["C/ATT", (l) => `${l.passCmp}/${l.passAtt}`], ["Yds", (l) => l.passYds], ["TD", (l) => l.passTd], ["INT", (l) => l.passInt]]} />
      <StatGroup title="Rushing" rows={rush} cols={[["Att", (l) => l.rushAtt], ["Yds", (l) => l.rushYds], ["TD", (l) => l.rushTd]]} />
      <StatGroup title="Receiving" rows={rec} cols={[["Rec", (l) => l.rec], ["Yds", (l) => l.recYds], ["TD", (l) => l.recTd]]} />
      <StatGroup title="Defense" rows={def} cols={[["Tkl", (l) => l.tackles ?? 0], ["Sack", (l) => l.sacks ?? 0], ["INT", (l) => l.defInt ?? 0], ["FF", (l) => l.ffum ?? 0], ["PD", (l) => l.passDef ?? 0]]} />
      <StatGroup title="Kicking" rows={kick} cols={[["FG", (l) => `${l.fgm ?? 0}/${l.fga ?? 0}`], ["XP", (l) => `${l.xpm ?? 0}/${l.xpa ?? 0}`]]} />
    </>
  );
}

function StatGroup({
  title,
  rows,
  cols,
}: {
  title: string;
  rows: PlayerGameLine[];
  cols: Array<[string, (l: PlayerGameLine) => number | string | undefined]>;
}) {
  if (rows.length === 0) return null;
  return (
    <>
      <p className="subhead">{title}</p>
      <table className="stbl">
        <thead>
          <tr>
            <th>Player</th>
            {cols.map(([h]) => (
              <th className="r" key={h}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((l) => (
            <tr key={l.playerId + title}>
              <td className="name">
                {l.name} <span className="pos">{posLabel(l.position)}</span>
              </td>
              {cols.map(([h, fn]) => (
                <td className="r" key={h}>
                  {fn(l) ?? 0}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

export type { TeamGameTotals };
