import { useNavigate } from "react-router-dom";

import { ScoreTrackerTable } from "@/components/ScoreTrackerTable";
import { Footer, Ticker } from "@/components/primitives";
import { GameDayMasthead } from "@/design/GameDayMasthead";
import { GdPage } from "@/design/GdPage";
import "@/design/gameday.css";
import "@/design/gameday-blocks.css";
import "./office-gameday.css";
import { LeagueMemory } from "@/components/LeagueMemory";
import { TEAMS_BY_CODE } from "@/data/teams";
import { AWARD_LABEL, type SeasonAward } from "@/state/seasonAwards";
import { useStore } from "@/state/store";
import { buildScoreTracker } from "@/state/scoreTracker";
import { viewerTeamCode } from "@/state/selectors";
import { points, posLabel } from "@/util/format";

export function LeagueHistory() {
  const nav = useNavigate();
  const s = useStore();
  const humans = s.gms.filter((g) => g.isHuman);
  const tracker = buildScoreTracker(s);
  // level on points: naming whoever sorted first made a tie read as a lead
  const leaders = tracker.leader
    ? [...tracker.cumulative.entries()].filter(([, total]) => total === tracker.leader!.total).map(([id]) => id)
    : [];
  const nameOf = (id: string) => (id === s.viewerGmId ? "You" : (s.gms.find((g) => g.id === id)?.name ?? "—"));
  const leaderName =
    leaders.length === 0 ? "—" : leaders.length === 1 ? nameOf(leaders[0]!) : `Tied: ${leaders.map(nameOf).join(", ")}`;

  return (
    <GdPage code={viewerTeamCode(s)} className="gd-hist">
      <GameDayMasthead
        code={viewerTeamCode(s) ?? ""}
        compact
        title="Every season so far"
        heading="League history"
        sub="The cross-season score tracker, past champions, records and awards."
      />
      <Ticker
        stats={[
          { label: "Seasons played", value: tracker.seasons.length },
          { label: "Human GMs", value: humans.length },
          {
            label: "Current leader",
            value: leaderName,
            className: "accent sm",
          },
          { label: "Leader points", value: points(tracker.leader?.total ?? 0) },
        ]}
      />
      <div className="panel open">
        <ScoreTrackerTable />
      </div>
      <LeagueMemory s={s} teamCode={s.gms.find((g) => g.id === s.viewerGmId)?.teamCode ?? null} />
      <AwardsHistory awards={s.awards ?? []} />
      <Footer>
        <button type="button" className="btnlink" onClick={() => nav("/")}>
          Back
        </button>
      </Footer>
    </GdPage>
  );
}

/** Every season's award winners, most recent first. */
function AwardsHistory({ awards }: { awards: SeasonAward[] }) {
  if (awards.length === 0) return null;
  const seasons = [...new Set(awards.map((a) => a.season))].sort((a, b) => b - a);
  return (
    <div className="panel open gd-awards">
      <p className="sectionlabel">Season awards</p>
      {seasons.map((season) => (
        <div key={season}>
          <p className="gd-awards__year">{season}</p>
          <div className="gd-awards__list">
            {awards
              .filter((a) => a.season === season)
              .map((a) => (
                <div key={a.award} className="gd-awards__row">
                  <span>{AWARD_LABEL[a.award]}</span>
                  <strong>{a.name}</strong>
                  <small>
                    {posLabel(a.position)} · {TEAMS_BY_CODE[a.team]?.abbr ?? a.team} · {a.line}
                  </small>
                </div>
              ))}
          </div>
        </div>
      ))}
    </div>
  );
}
