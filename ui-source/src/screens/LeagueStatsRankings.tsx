import { useMemo, useState } from "react";
import { leagueBadge } from "@/state/leagueFormat";
import { useNavigate } from "react-router-dom";

import { Card, CardHeader, Footer, Panel, Tabs, Ticker, useTabs } from "@/components/primitives";

import { TEAMS_BY_CODE } from "@/data/teams";
import { teamStatRows, type TeamStatRow } from "@/state/leagueStats";
import { useStore } from "@/state/store";
import {
  anyBoxScores,
  playedGames,
  regularSeasonUnderway,
  statsThroughWeek,
  viewerTeamCode,
} from "@/state/selectors";
import { onlineSession } from "@/state/online";
import { visibleGames } from "@/state/reveal";
import { ordinal } from "@/util/format";

type SortKey = keyof Pick<
  TeamStatRow,
  "offTotal" | "offPass" | "offRush" | "defTotal" | "defPass" | "defRush" | "ppg" | "fgPct" | "puntRet" | "kickRet" | "netPunt"
>;

export function LeagueStatsRankings() {
  const nav = useNavigate();
  const s = useStore();
  const { active, setActive } = useTabs("offense");
  const code = viewerTeamCode(s);
  const rows = useMemo(() => teamStatRows(s), [s]);
  const played = playedGames(s, "REG").length;
  // the league's people, so a GM can find their rivals in the tables
  const gmOf = (c: string) => s.gms.find((g) => g.isHuman && g.teamCode === c)?.name;

  const [offBy, setOffBy] = useState<SortKey>("offTotal");
  const [defBy, setDefBy] = useState<SortKey>("defTotal");
  const [stBy, setStBy] = useState<SortKey>("fgPct");

  if (played === 0 || !anyBoxScores(s)) {
    return (
      <Card maxWidth={800}>
        <CardHeader badge={leagueBadge(s)} title="League Stats & Rankings" subtitle={`${s.season} season`} />
        <div className="panel open">
          <div className="emptystate">
            {played === 0
              ? "Rankings populate once you’ve seen the first regular-season week."
              : "These rankings are built from per-game team stats, and none of this season's games recorded any. Weeks played from here on will fill them in."}
          </div>
        </div>
        <Footer>
          {/* same as player stats: last season is in the history */}
          <button type="button" className="btnlink" onClick={() => nav("/history")}>
            Past seasons in League History
          </button>
          <button type="button" className="btnlink" onClick={() => nav("/hub")}>
            Return to team hub
          </button>
        </Footer>
      </Card>
    );
  }

  const sorted = (key: SortKey, higherBetter: boolean) =>
    [...rows].sort((a, b) => (higherBetter ? b[key] - a[key] : a[key] - b[key]));
  const myOffRank = sorted("offTotal", true).findIndex((r) => r.code === code) + 1;
  const myDefRank = sorted("defTotal", false).findIndex((r) => r.code === code) + 1;
  const myPpg = rows.find((r) => r.code === code)?.ppg ?? 0;
  const scoringLeader = sorted("ppg", true)[0];

  const teamCount = Object.keys(s.teams).length;
  const rankOf = (r: number) => (teamCount < 32 ? `${ordinal(r)} of ${teamCount}` : ordinal(r));
  return (
    <Card maxWidth={800}>
      <CardHeader
        badge={leagueBadge(s)}
        title="League Stats & Rankings"
        subtitle={
          // what this GM has watched, not `s.week` (reveals don't move it)
          regularSeasonUnderway(s.stage)
            ? `Through Week ${statsThroughWeek(onlineSession() ? visibleGames(s, s.viewerGmId) : s.games)} · ${s.season} season`
            : `${s.season} season · final`
        }
      />
      <Ticker
        stats={[
          // "4th" in a four-team league is last; say so there
          { label: "Your offense rank", value: rankOf(myOffRank), className: "accent" },
          { label: "Your defense rank", value: rankOf(myDefRank), className: "accent" },
          { label: "Points per game", value: myPpg.toFixed(1) },
          { label: "Scoring leader", value: scoringLeader ? TEAMS_BY_CODE[scoringLeader.code]!.label : "—", className: "sm" },
        ]}
      />
      <Tabs
        tabs={[
          { id: "offense", label: "Offense" },
          { id: "defense", label: "Defense" },
          { id: "scoring", label: "Scoring" },
          { id: "special", label: "Special Teams" },
        ]}
        active={active}
        onChange={setActive}
      />

      <Panel id="offense" open={active === "offense"}>
        <RankedBy
          value={offBy}
          onChange={setOffBy}
          options={[
            ["offTotal", "Total yards/gm"],
            ["offPass", "Passing yards/gm"],
            ["offRush", "Rushing yards/gm"],
          ]}
        />
        <RankTable
          rows={sorted(offBy, true)}
          me={code}
          gmOf={gmOf}
          cols={[
            ["Total", (r) => r.offTotal.toFixed(0)],
            ["Pass", (r) => r.offPass.toFixed(0)],
            ["Rush", (r) => r.offRush.toFixed(0)],
            ["PPG", (r) => r.ppg.toFixed(1)],
          ]}
        />
      </Panel>

      <Panel id="defense" open={active === "defense"}>
        <RankedBy
          value={defBy}
          onChange={setDefBy}
          options={[
            ["defTotal", "Total yds allowed/gm"],
            ["defPass", "Pass yds allowed/gm"],
            ["defRush", "Rush yds allowed/gm"],
          ]}
        />
        <RankTable
          rows={sorted(defBy, false)}
          me={code}
          gmOf={gmOf}
          cols={[
            ["Total", (r) => r.defTotal.toFixed(0)],
            ["Pass", (r) => r.defPass.toFixed(0)],
            ["Rush", (r) => r.defRush.toFixed(0)],
            ["PA/gm", (r) => r.paPg.toFixed(1)],
          ]}
        />
      </Panel>

      <Panel id="scoring" open={active === "scoring"}>
        <RankTable
          rows={sorted("ppg", true)}
          me={code}
          gmOf={gmOf}
          cols={[
            ["PPG", (r) => r.ppg.toFixed(1)],
            ["PA/gm", (r) => r.paPg.toFixed(1)],
            ["Diff", (r) => (r.diff >= 0 ? "+" : "") + r.diff.toFixed(1)],
          ]}
        />
      </Panel>

      <Panel id="special" open={active === "special"}>
        <RankedBy
          value={stBy}
          onChange={setStBy}
          options={[
            ["fgPct", "Field goal %"],
            ["puntRet", "Punt return avg"],
            ["kickRet", "Kick return avg"],
            ["netPunt", "Net punt avg"],
          ]}
        />
        <RankTable
          rows={sorted(stBy, true)}
          me={code}
          gmOf={gmOf}
          cols={[
            ["FG%", (r) => r.fgPct.toFixed(1) + "%"],
            ["Punt ret", (r) => r.puntRet.toFixed(1)],
            ["Kick ret", (r) => r.kickRet.toFixed(1)],
            ["Net punt", (r) => r.netPunt.toFixed(1)],
          ]}
        />
      </Panel>

      <Footer>
        <button type="button" className="btnlink" onClick={() => nav("/hub")}>
          Return to team hub
        </button>
      </Footer>
    </Card>
  );
}

function RankedBy({
  value,
  onChange,
  options,
}: {
  value: SortKey;
  onChange: (k: SortKey) => void;
  options: Array<[SortKey, string]>;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 14 }}>
      <label style={{ fontSize: 11.5, color: "var(--ink-faint)" }}>Ranked by</label>
      <select value={value} onChange={(e) => onChange(e.target.value as SortKey)}>
        {options.map(([k, label]) => (
          <option key={k} value={k}>
            {label}
          </option>
        ))}
      </select>
    </div>
  );
}

function RankTable({
  rows,
  me,
  gmOf,
  cols,
}: {
  rows: TeamStatRow[];
  me: string | undefined;
  gmOf: (code: string) => string | undefined;
  cols: Array<[string, (r: TeamStatRow) => string]>;
}) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table className="stbl">
        <thead>
          <tr>
            <th style={{ width: 24 }} />
            <th>Team</th>
            {cols.map(([h]) => (
              <th className="c" key={h}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.code} className={r.code === me ? "highlight" : ""}>
              <td style={{ color: "var(--ink-faint)" }}>{i + 1}</td>
              <td className="name">
                {TEAMS_BY_CODE[r.code]!.label}
                {r.code !== me && gmOf(r.code) && (
                  // a real space as well as the margin: read aloud it was "Pittsburghnewgm"
                  <span style={{ marginLeft: 3, fontSize: 10.5, color: "var(--ink-faint)" }}> {gmOf(r.code)}</span>
                )}
              </td>
              {cols.map(([h, fn]) => (
                <td className="c" key={h}>
                  {fn(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
