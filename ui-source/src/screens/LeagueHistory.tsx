import { useNavigate } from "react-router-dom";

import { ScoreTrackerTable } from "@/components/ScoreTrackerTable";
import { Card, CardHeader, Footer, Ticker } from "@/components/primitives";
import { useStore } from "@/state/store";
import { buildScoreTracker } from "@/state/scoreTracker";
import { points } from "@/util/format";

export function LeagueHistory() {
  const nav = useNavigate();
  const s = useStore();
  const humans = s.gms.filter((g) => g.isHuman);
  const tracker = buildScoreTracker(s);
  const leaderName = tracker.leader ? s.gms.find((g) => g.id === tracker.leader!.gmId)?.name ?? "—" : "—";

  return (
    <Card maxWidth={860}>
      <CardHeader badge="FS" title="League History" subtitle="Cross-season score tracker" />
      <Ticker
        stats={[
          { label: "Seasons played", value: tracker.seasons.length },
          { label: "Human GMs", value: humans.length },
          {
            label: "Current leader",
            value: tracker.leader?.gmId === s.viewerGmId ? "You" : leaderName,
            className: "accent sm",
          },
          { label: "Leader points", value: points(tracker.leader?.total ?? 0) },
        ]}
      />
      <div className="panel open">
        <ScoreTrackerTable />
      </div>
      <Footer>
        <button type="button" className="btnlink" onClick={() => nav("/")}>
          Back
        </button>
      </Footer>
    </Card>
  );
}
