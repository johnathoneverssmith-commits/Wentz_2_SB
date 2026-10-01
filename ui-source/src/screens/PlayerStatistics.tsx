import { useMemo } from "react";
import { leagueBadge } from "@/state/leagueFormat";
import { useNavigate } from "react-router-dom";

import { Card, CardHeader, Footer, Panel, Tabs, Ticker, useTabs } from "@/components/primitives";
import { leaders, mvpTracker } from "@/state/leagueStats";
import { useStore } from "@/state/store";
import { anyBoxScores, playedGames, regularSeasonUnderway, statsThroughWeek } from "@/state/selectors";
import { onlineSession } from "@/state/online";
import { visibleGames } from "@/state/reveal";
import { commas } from "@/util/format";

const CATS = ["passing", "rushing", "receiving", "defense", "kicking", "returns"] as const;

/**
 * "through Week ${s.week || played}" printed "through Week 272" all offseason:
 * `s.week` is 0 once the season is over, and the fallback was the *game*
 * count. A finished season is described as finished.
 */
function asOf(week: number, season: number): string {
  return week > 0 ? `through Week ${week}` : `${season} final`;
}

export function PlayerStatistics() {
  const nav = useNavigate();
  const s = useStore();
  const { active, setActive } = useTabs("passing");
  const played = playedGames(s, "REG").length;
  const mvp = useMemo(() => mvpTracker(s), [s]);
  const rows = useMemo(() => leaders(s, active as (typeof CATS)[number]), [s, active]);

  if (played === 0 || !anyBoxScores(s)) {
    return (
      <Card maxWidth={800}>
        <CardHeader badge={leagueBadge(s)} title="Player Statistics" subtitle={`${s.season} season`} />
        <div className="panel open">
          <div className="emptystate">
            {played === 0
              ? "Leaderboards populate once you’ve seen the first regular-season week."
              : "Leaderboards are built from per-game player lines, and none of this season's games recorded any. Weeks played from here on will fill them in."}
          </div>
        </div>
        <Footer>
          {/* between seasons this page is empty; last year's records,
              leaders and awards live in the history */}
          {played === 0 && (
            <button type="button" className="btnlink" onClick={() => nav("/history")}>
              Past seasons in League History
            </button>
          )}
          <button type="button" className="btnlink" onClick={() => nav("/hub")}>
            Return to team hub
          </button>
        </Footer>
      </Card>
    );
  }

  const awarded = (award: string): string | undefined =>
    (s.awards ?? []).find((a) => a.season === s.season && a.award === award)?.name;

  return (
    <Card maxWidth={800}>
      <CardHeader
        badge={leagueBadge(s)}
        title="Player Statistics"
        subtitle={`League leaders · ${asOf(
          regularSeasonUnderway(s.stage)
            ? statsThroughWeek(onlineSession() ? visibleGames(s, s.viewerGmId) : s.games)
            : 0,
          s.season,
        )}`}
      />
      <Ticker
        stats={
          // once the awards are out there's no race to report
          awarded("MVP")
            ? [
                { label: `${s.season} MVP`, value: awarded("MVP")!, className: "sm accent" },
                { label: "Offensive POY", value: awarded("OPOY") ?? "—", className: "sm" },
                { label: "Defensive POY", value: awarded("DPOY") ?? "—", className: "sm" },
                { label: "Games played", value: played },
              ]
            : [
                { label: "MVP front-runner", value: mvp[0]?.name ?? "—", className: "sm accent" },
                { label: "2nd", value: mvp[1]?.name ?? "—", className: "sm" },
                { label: "3rd", value: mvp[2]?.name ?? "—", className: "sm" },
                { label: "Games played", value: played },
              ]
        }
      />
      <Tabs
        tabs={CATS.map((c) => ({ id: c, label: c[0]!.toUpperCase() + c.slice(1) }))}
        active={active}
        onChange={setActive}
      />
      {CATS.map((c) => (
        <Panel key={c} open={active === c}>
          <table className="stbl">
            <thead>
              <tr>
                <th style={{ width: 22 }} />
                <th>Player</th>
                <th className="c">Team</th>
                <th className="r">{c === "defense" ? "Impact" : c === "kicking" ? "FGM" : "Yds"}</th>
                <th>Line</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.playerId}>
                  <td style={{ color: "var(--ink-faint)" }}>{i + 1}</td>
                  <td className="name">
                    {r.name} <span className="pos">{r.position}</span>
                  </td>
                  <td className="c">{r.team}</td>
                  <td className="r">
                    {c === "passing" || c === "rushing" || c === "receiving" || c === "returns"
                      ? commas(r.value)
                      : r.value}
                  </td>
                  <td style={{ fontSize: 11.5 }}>{r.line}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      ))}
      <p
        style={{
          margin: 0,
          padding: "0 26px 16px",
          fontSize: 11,
          color: "var(--ink-faint)",
          textAlign: "center",
          lineHeight: 1.5,
        }}
      >
        Individual lines are credited from each game's play-by-play. The simulation models team
        outcomes, so who gets the carry or the target is an accounting of the game that was played
        rather than a per-player usage forecast.
      </p>

      <Footer>
        <button type="button" className="btnlink" onClick={() => nav("/hub")}>
          Return to team hub
        </button>
      </Footer>
    </Card>
  );
}
