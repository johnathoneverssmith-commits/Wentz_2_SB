import { teamFullName } from "@/data/teams";
import { useStore } from "@/state/store";
import { buildScoreTracker } from "@/state/scoreTracker";

/** The cross-season score tracker table (spec §5). Shared by League History and
 * the Season Complete screen's "Score Tracker" tab. */
export function ScoreTrackerTable() {
  const s = useStore();
  const tracker = buildScoreTracker(s);

  if (tracker.seasons.length === 0) {
    return <div className="emptystate">The tracker fills in once a season is complete.</div>;
  }

  return (
    <>
      <p className="subhead" style={{ marginTop: 0 }}>
        Cumulative standings
      </p>
      <table className="stbl" style={{ marginBottom: 20 }}>
        <thead>
          <tr>
            <th>GM</th>
            <th>Team</th>
            <th className="r">Points</th>
          </tr>
        </thead>
        <tbody>
          {[...tracker.cumulative.entries()]
            .sort((a, b) => b[1] - a[1])
            .map(([gid, total]) => {
              const g = s.gms.find((x) => x.id === gid)!;
              return (
                <tr key={gid} className={gid === s.viewerGmId ? "highlight" : ""}>
                  <td className="name">{g.id === s.viewerGmId ? "You" : g.name}</td>
                  <td>{g.teamCode ? teamFullName(g.teamCode) : "—"}</td>
                  <td className="r">{total}</td>
                </tr>
              );
            })}
        </tbody>
      </table>

      <p className="subhead">Season by season</p>
      {[...tracker.seasons].reverse().map(({ season, breakdowns }) => (
        <div key={season} style={{ marginBottom: 16 }}>
          <p style={{ margin: "0 0 6px", fontSize: 12, color: "var(--ink-dim)", fontWeight: 600 }}>{season}</p>
          <table className="stbl">
            <thead>
              <tr>
                <th>GM</th>
                <th className="c">A</th>
                <th className="c">B</th>
                <th className="c">C</th>
                <th className="c">D</th>
                <th className="r">Total</th>
              </tr>
            </thead>
            <tbody>
              {breakdowns.map((b) => {
                const g = s.gms.find((x) => x.id === b.gmId)!;
                return (
                  <tr key={b.gmId} className={b.gmId === s.viewerGmId ? "highlight" : ""}>
                    <td className="name">{g.id === s.viewerGmId ? "You" : g.name}</td>
                    <td className="c">{b.bucketA}</td>
                    <td className="c">{b.bucketB}</td>
                    <td className="c">{b.bucketC}</td>
                    <td className="c">{b.bucketD}</td>
                    <td className="r">{b.seasonTotal}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}
      <p style={{ margin: "6px 0 0", fontSize: 11, color: "var(--ink-faint)", textAlign: "center" }}>
        A: regular-season placement · B: playoff progression · C: rival elimination · D: season quality
      </p>
    </>
  );
}
