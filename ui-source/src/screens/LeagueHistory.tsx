import { useNavigate } from "react-router-dom";

import { ScoreTrackerTable } from "@/components/ScoreTrackerTable";
import { Card, CardHeader, Footer, Ticker } from "@/components/primitives";
import { LeagueMemory } from "@/components/LeagueMemory";
import { TEAMS_BY_CODE } from "@/data/teams";
import { AWARD_LABEL, type SeasonAward } from "@/state/seasonAwards";
import { useStore } from "@/state/store";
import { buildScoreTracker } from "@/state/scoreTracker";
import { points } from "@/util/format";

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
    <Card maxWidth={860}>
      <CardHeader badge="FS" title="League History" subtitle="Cross-season score tracker" />
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
    </Card>
  );
}

/** Every season's award winners, most recent first. */
function AwardsHistory({ awards }: { awards: SeasonAward[] }) {
  if (awards.length === 0) return null;
  const seasons = [...new Set(awards.map((a) => a.season))].sort((a, b) => b - a);
  return (
    <div className="panel open" style={{ display: "grid", gap: 14 }}>
      <p className="sectionlabel" style={{ margin: 0 }}>
        Season awards
      </p>
      {seasons.map((season) => (
        <div key={season}>
          <p style={{ margin: "0 0 6px", fontWeight: 700, fontSize: 13 }}>{season}</p>
          <div style={{ display: "grid", gap: 4 }}>
            {awards
              .filter((a) => a.season === season)
              .map((a) => (
                <div key={a.award} style={{ fontSize: 12.5, display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ color: "var(--ink-faint)", minWidth: 210 }}>{AWARD_LABEL[a.award]}</span>
                  <strong>{a.name}</strong>
                  <span style={{ color: "var(--ink-dim)" }}>
                    {a.position} · {TEAMS_BY_CODE[a.team]?.abbr ?? a.team} · {a.line}
                  </span>
                </div>
              ))}
          </div>
        </div>
      ))}
    </div>
  );
}
