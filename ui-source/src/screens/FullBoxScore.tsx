import { useNavigate, useParams } from "react-router-dom";

import { TeamBadge } from "@/components/bits";
import { Card, CardHeader, Footer, Panel, Tabs, Ticker, useTabs } from "@/components/primitives";
import { TEAMS_BY_CODE } from "@/data/teams";
import type { PlayerGameLine, TeamGameTotals } from "@/domain";
import { useStore } from "@/state/store";
import { seconds } from "@/util/format";

export function FullBoxScore() {
  const { gameId } = useParams();
  const nav = useNavigate();
  const game = useStore((s) => s.games.find((g) => g.id === gameId));
  const { active, setActive } = useTabs("team");

  if (!game || !game.totals) {
    return (
      <Card maxWidth={860}>
        <CardHeader badge="NFL" title="Box Score" subtitle={game ? "Not available for this game" : "Unknown game"} />
        <div className="panel open">
          <div className="emptystate">
            {game
              ? "No box score was recorded for this game — the final score is all that was kept. Games played from here on carry the full detail."
              : "That game isn't in this league's history — it may have been from a previous save."}
          </div>
        </div>
        <Footer>
          <button type="button" className="btnlink" onClick={() => nav("/schedule")}>
            Full schedule
          </button>
          <button type="button" className="btnlink btn-primary" onClick={() => nav("/hub")}>
            Back to team hub
          </button>
        </Footer>
      </Card>
    );
  }

  const { home, away } = game.totals;
  const homeWin = game.homeScore > game.awayScore;
  // worst first, because that's the one the reader came for
  const injuries = [...(game.injuries ?? [])].sort(
    (a, b) => (b.projectedWeeks[1] ?? 0) - (a.projectedWeeks[1] ?? 0),
  );
  const homeMeta = TEAMS_BY_CODE[game.homeTeam]!;
  const awayMeta = TEAMS_BY_CODE[game.awayTeam]!;

  return (
    <Card maxWidth={860} twoTeam>
      <div className="header two-team">
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <TeamSide meta={homeMeta} score={game.homeScore} won={homeWin} />
          <span style={{ fontSize: 13, color: "rgba(255,255,255,0.4)" }}>–</span>
          <TeamSide meta={awayMeta} score={game.awayScore} won={!homeWin} right />
        </div>
        <div className="right">
          <p>
            Final ·{" "}
            {game.phase === "PRE" ? `Preseason Wk ${game.week}` : game.phase === "REG" ? `Week ${game.week}` : game.phase}
          </p>
          <p style={{ fontSize: 16, fontWeight: 700 }}>
            <span style={{ color: "var(--good)" }}>{(homeWin ? homeMeta : awayMeta).abbr} W</span>{" "}
            <span style={{ color: "var(--ink-faint)", marginLeft: 6 }}>
              {(homeWin ? awayMeta : homeMeta).abbr} L
            </span>
          </p>
        </div>
      </div>

      <Ticker
        stats={[
          { label: `Total yards`, value: `${homeMeta.abbr} ${home.totalYards} – ${away.totalYards} ${awayMeta.abbr}`, className: "sm" },
          { label: "Pass yards", value: `${home.passYards} – ${away.passYards}` },
          { label: "Rush yards", value: `${home.rushYards} – ${away.rushYards}` },
          { label: "Turnovers", value: `${home.turnovers} – ${away.turnovers}` },
        ]}
      />

      <Tabs
        tabs={[
          { id: "team", label: "Team Stats" },
          { id: "scoring", label: "Scoring Summary" },
          { id: "home", label: TEAMS_BY_CODE[game.homeTeam]!.city },
          { id: "away", label: TEAMS_BY_CODE[game.awayTeam]!.city },
          // only when there were any: an empty tab is a worse answer than no tab
          ...(injuries.length > 0 ? [{ id: "injuries", label: "Injuries" }] : []),
        ]}
        active={active}
        onChange={setActive}
      />

      <Panel id="team" open={active === "team"}>
        <table className="mtable">
          <thead>
            <tr>
              <th style={{ textAlign: "left", fontSize: 11, color: "var(--ink-faint)", fontWeight: 500, padding: "4px" }}>Team stat</th>
              <th style={{ textAlign: "center", fontSize: 12, color: "var(--ink)", fontWeight: 600 }}>{homeMeta.abbr}</th>
              <th style={{ width: 16 }} />
              <th style={{ textAlign: "center", fontSize: 12, color: "var(--ink)", fontWeight: 600 }}>{awayMeta.abbr}</th>
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
          </tbody>
        </table>
      </Panel>

      <Panel id="scoring" open={active === "scoring"}>
        <p className="subhead">By quarter</p>
        <table className="stbl" style={{ marginBottom: 18 }}>
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
            <QuarterRow name={TEAMS_BY_CODE[game.homeTeam]!.city} q={home.byQuarter} total={game.homeScore} />
            <QuarterRow name={TEAMS_BY_CODE[game.awayTeam]!.city} q={away.byQuarter} total={game.awayScore} />
          </tbody>
        </table>
        <p className="subhead">Scoring plays</p>
        {(game.scoringPlays ?? []).map((p, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderBottom: "1px solid var(--line)" }}>
            <span style={{ width: 26, fontSize: 11, color: "var(--ink-faint)" }}>Q{p.quarter}</span>
            <span style={{ width: 40 }}>
              <TeamBadge code={p.team} size={22} />
            </span>
            <span style={{ flex: 1, fontSize: 12.5, color: "var(--ink-dim)" }}>{p.description}</span>
            <span className="oswald" style={{ fontSize: 12.5, fontWeight: 600 }}>
              {p.homeScore}–{p.awayScore}
            </span>
          </div>
        ))}
      </Panel>

      <Panel id="home" open={active === "home"}>
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
                {e.player} <span className="ppos">{e.position}</span>
              </span>
              <p style={{ margin: "2px 0 0", fontSize: 11.5, color: "var(--ink-dim)" }}>
                {TEAMS_BY_CODE[e.team]?.abbr ?? e.team} · Q{e.quarter} {e.clock} · {e.bodyPart}
              </p>
            </div>
            <div style={{ textAlign: "right" }}>
              <span style={{ fontSize: 12.5, fontWeight: 600, textTransform: "capitalize" }}>
                {e.severity}
              </span>
              <p style={{ margin: "2px 0 0", fontSize: 11.5, color: "var(--ink-faint)" }}>
                {e.projectedWeeks[0]}–{e.projectedWeeks[1]} wks
              </p>
            </div>
          </div>
        ))}
        <p style={{ margin: "12px 0 0", fontSize: 11.5, color: "var(--ink-faint)", lineHeight: 1.6 }}>
          An injury keeps a player out of the roster sheet until he's back, so these are the
          weeks his team plays without him.
        </p>
      </Panel>

      <Footer>
        <button type="button" className="btnlink" onClick={() => nav("/schedule")}>
          Full schedule
        </button>
        <button type="button" className="btnlink btn-primary" onClick={() => nav("/hub")}>
          Back to team hub
        </button>
      </Footer>
    </Card>
  );
}

function TeamSide({
  meta,
  score,
  won,
  right = false,
}: {
  meta: import("@/domain").TeamMeta;
  score: number;
  won: boolean;
  right?: boolean;
}) {
  return (
    <div style={{ display: "flex", flexDirection: right ? "row-reverse" : "row", alignItems: "center", gap: 10 }}>
      <TeamBadge code={meta.code} size={36} />
      <div style={{ textAlign: right ? "right" : "left" }}>
        <span className="oswald" style={{ display: "block", fontSize: 26, fontWeight: 700, color: won ? "var(--good)" : "#fff" }}>
          {score}
        </span>
        <span style={{ fontSize: 10.5, color: "rgba(255,255,255,0.6)" }}>{meta.city}</span>
      </div>
    </div>
  );
}

function TeamStatRow({ label, h, a }: { label: string; h: number | string; a: number | string }) {
  return (
    <tr>
      <td>{label}</td>
      <td className="val">{h}</td>
      <td style={{ width: 16 }} />
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

function TeamLines({ lines }: { lines: PlayerGameLine[] }) {
  const pass = lines.filter((l) => (l.passAtt ?? 0) > 0);
  const rush = lines.filter((l) => (l.rushAtt ?? 0) > 0);
  const rec = lines.filter((l) => (l.rec ?? 0) > 0);
  const def = lines.filter((l) => (l.tackles ?? 0) > 0 || (l.sacks ?? 0) > 0 || (l.defInt ?? 0) > 0);
  const kick = lines.filter((l) => (l.fga ?? 0) > 0 || (l.xpa ?? 0) > 0);
  return (
    <>
      <StatGroup title="Passing" rows={pass} cols={[["C/ATT", (l) => `${l.passCmp}/${l.passAtt}`], ["Yds", (l) => l.passYds], ["TD", (l) => l.passTd], ["INT", (l) => l.passInt]]} />
      <StatGroup title="Rushing" rows={rush} cols={[["Att", (l) => l.rushAtt], ["Yds", (l) => l.rushYds], ["TD", (l) => l.rushTd]]} />
      <StatGroup title="Receiving" rows={rec} cols={[["Rec", (l) => l.rec], ["Yds", (l) => l.recYds], ["TD", (l) => l.recTd]]} />
      <StatGroup title="Defense" rows={def} cols={[["Tkl", (l) => l.tackles], ["Sack", (l) => l.sacks], ["INT", (l) => l.defInt], ["PD", (l) => l.passDef]]} />
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
                {l.name} <span className="pos">{l.position}</span>
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
