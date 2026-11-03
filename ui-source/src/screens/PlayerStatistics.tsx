import { useMemo } from "react";
import { useNavigate } from "react-router-dom";

import { Footer, Panel, Tabs, Ticker, useTabs } from "@/components/primitives";
import { GameDayMasthead } from "@/design/GameDayMasthead";
import { GdPage } from "@/design/GdPage";
import "@/design/gameday.css";
import "@/design/gameday-blocks.css";
import "./office-gameday.css";
import { leaders, mvpTracker } from "@/state/leagueStats";
import { useStore } from "@/state/store";
import { anyBoxScores, playedGames, regularSeasonUnderway, statsThroughWeek, viewerTeamCode } from "@/state/selectors";
import { onlineSession } from "@/state/online";
import { visibleGames } from "@/state/reveal";
import { commas, posLabel } from "@/util/format";

const CATS = ["passing", "rushing", "receiving", "defense", "kicking", "returns"] as const;

/**
 * "through Week ${s.week || played}" printed "through Week 272" all offseason:
 * `s.week` is 0 once the season is over, and the fallback was the *game*
 * count. A finished season is described as finished.
 */
function asOf(week: number, season: number): string {
  return week > 0 ? `through week ${week}` : `${season} final`;
}

export function PlayerStatistics() {
  const nav = useNavigate();
  const s = useStore();
  const { active, setActive } = useTabs("passing");
  const code = viewerTeamCode(s);
  const played = playedGames(s, "REG").length;
  const mvp = useMemo(() => mvpTracker(s), [s]);
  const rows = useMemo(() => leaders(s, active as (typeof CATS)[number]), [s, active]);

  if (played === 0 || !anyBoxScores(s)) {
    return (
      <GdPage code={code}>
        <GameDayMasthead
          code={code ?? ""}
          compact
          title={`${s.season} season`}
          heading="Player statistics"
          sub="League leaders in every category."
        />
        <div className="emptystate">
          {played === 0
            ? "Leaderboards populate once you’ve seen the first regular-season week."
            : "Leaderboards are built from per-game player lines, and none of this season's games recorded any. Weeks played from here on will fill them in."}
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
      </GdPage>
    );
  }

  const awarded = (award: string): string | undefined =>
    (s.awards ?? []).find((a) => a.season === s.season && a.award === award)?.name;

  return (
    <GdPage code={code} className="gd-tabbed">
      <GameDayMasthead
        code={code ?? ""}
        compact
        title={`League leaders, ${asOf(
          regularSeasonUnderway(s.stage)
            ? statsThroughWeek(onlineSession() ? visibleGames(s, s.viewerGmId) : s.games)
            : 0,
          s.season,
        )}`}
        heading="Player statistics"
        sub="League leaders in every category."
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
      <div className="gd-hub">
        <Tabs
          tabs={CATS.map((c) => ({ id: c, label: c[0]!.toUpperCase() + c.slice(1) }))}
          active={active}
          onChange={setActive}
        />
      </div>
      {CATS.map((c) => (
        <Panel key={c} open={active === c}>
          <div className="gd-tablewrap">
            <table className="stbl">
              <thead>
                <tr>
                  <th style={{ width: 40 }} />
                  <th>Player</th>
                  <th className="c">Team</th>
                  <th className="r">{c === "defense" ? "Impact" : c === "kicking" ? "FGM" : "Yds"}</th>
                  <th>Line</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.playerId}>
                    <td className="rank">{i + 1}</td>
                    <td className="name">
                      {r.name} <span className="pos">{posLabel(r.position)}</span>
                    </td>
                    <td className="c">{r.team}</td>
                    <td className="r">
                      {c === "passing" || c === "rushing" || c === "receiving" || c === "returns"
                        ? commas(r.value)
                        : r.value}
                    </td>
                    <td className="sub">{r.line}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      ))}
      <p className="gd-foot">
        Individual lines are credited from each game&rsquo;s play-by-play. The simulation models team
        outcomes, so who gets the carry or the target is an accounting of the game that was played
        rather than a per-player usage forecast.
      </p>

      <Footer>
        <button type="button" className="btnlink" onClick={() => nav("/hub")}>
          Return to team hub
        </button>
      </Footer>
    </GdPage>
  );
}
