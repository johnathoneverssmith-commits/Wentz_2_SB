import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { TeamBadge } from "@/components/bits";
import { Card, CardHeader, Footer, Ticker } from "@/components/primitives";
import { TEAMS_BY_CODE, teamFullName } from "@/data/teams";
import { record } from "@/domain";
import { REGULAR_SEASON_WEEKS } from "@/state/stageMachine";
import { useStore } from "@/state/store";
import { currentPhase, viewerTeamCode } from "@/state/selectors";

export function FullSchedule() {
  const nav = useNavigate();
  const s = useStore();
  const code = viewerTeamCode(s);
  const phase = currentPhase(s) ?? "REG";
  const currentWeek = s.week || 1;
  const [viewWeek, setViewWeek] = useState(currentWeek);

  const weekGames = useMemo(
    () => s.schedule.filter((g) => g.phase === "REG" && g.week === viewWeek),
    [s.schedule, viewWeek],
  );
  const byeTeams = useMemo(() => {
    const playing = new Set(weekGames.flatMap((g) => [g.homeTeam, g.awayTeam]));
    return Object.keys(TEAMS_BY_CODE).filter((c) => !playing.has(c));
  }, [weekGames]);

  const resultFor = (home: string, away: string) =>
    s.games.find((g) => g.phase === "REG" && g.week === viewWeek && g.homeTeam === home && g.awayTeam === away);

  const yourGame = code ? weekGames.find((g) => g.homeTeam === code || g.awayTeam === code) : undefined;
  const yourOpp = yourGame ? (yourGame.homeTeam === code ? yourGame.awayTeam : yourGame.homeTeam) : null;
  const yourResult = yourGame ? resultFor(yourGame.homeTeam, yourGame.awayTeam) : undefined;

  return (
    <Card maxWidth={800}>
      <CardHeader
        badge="NFL"
        title="Full Schedule"
        subtitle={`${s.season} season · ${code ? teamFullName(code) : "the"} league`}
      />
      <Ticker
        stats={[
          { label: "Viewing", value: `Week ${viewWeek}` },
          { label: "Current week", value: phase === "PRE" ? `Preseason ${currentWeek}` : `Week ${currentWeek}` },
          {
            label: "Your matchup",
            value: yourOpp
              ? `${code} vs ${yourOpp}${yourResult ? ` (${yourResult.homeScore}-${yourResult.awayScore})` : ""}`
              : "Bye",
            className: "accent sm",
          },
          { label: "Games", value: weekGames.length, className: "sm" },
        ]}
      />

      <div style={{ display: "flex", justifyContent: "center", padding: "16px 26px", borderBottom: "1px solid var(--line)" }}>
        <select value={viewWeek} onChange={(e) => setViewWeek(Number(e.target.value))}>
          {Array.from({ length: REGULAR_SEASON_WEEKS }, (_, i) => i + 1).map((w) => (
            <option key={w} value={w}>
              Week {w}
            </option>
          ))}
        </select>
      </div>

      <div className="scroll-list" style={{ padding: "14px 20px 20px", display: "flex", flexDirection: "column", gap: 6 }}>
        {weekGames.map((g, i) => {
          const r = resultFor(g.homeTeam, g.awayTeam);
          const mine = g.homeTeam === code || g.awayTeam === code;
          const homeWin = r ? r.homeScore > r.awayScore : false;
          return (
            <div
              key={i}
              className="gamerow"
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 76px 1fr",
                alignItems: "center",
                padding: "13px 14px",
                borderRadius: "var(--r-md)",
                background: mine ? "color-mix(in srgb, var(--team) 7%, transparent)" : "var(--panel-sunken)",
                border: `1px solid ${mine ? "color-mix(in srgb, var(--team) 38%, transparent)" : "var(--line)"}`,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                <TeamBadge code={g.homeTeam} />
                <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                  <span style={{ fontSize: 12.5, fontWeight: 500 }}>{TEAMS_BY_CODE[g.homeTeam]!.city}</span>
                  <span style={{ fontSize: 11, color: "var(--ink-faint)" }}>{record(s.teams[g.homeTeam]!)}</span>
                </span>
              </div>
              <div style={{ textAlign: "center" }}>
                {r ? (
                  <>
                    <div className="oswald" style={{ fontSize: 15, fontWeight: 600, lineHeight: 1 }}>
                      <span style={{ color: homeWin ? "var(--good)" : undefined }}>{r.homeScore}</span> –{" "}
                      <span style={{ color: !homeWin ? "var(--good)" : undefined }}>{r.awayScore}</span>
                    </div>
                    <div style={{ marginTop: 4, fontSize: 10, color: "var(--ink-faint)" }}>Final</div>
                  </>
                ) : (
                  <>
                    <div style={{ fontSize: 12, color: "var(--ink-faint)", fontWeight: 500 }}>–</div>
                    <div style={{ marginTop: 4, fontSize: 10, color: "var(--ink-faint)" }}>Scheduled</div>
                  </>
                )}
              </div>
              <div style={{ display: "flex", flexDirection: "row-reverse", alignItems: "center", gap: 10, minWidth: 0, textAlign: "right" }}>
                <TeamBadge code={g.awayTeam} />
                <span style={{ display: "flex", flexDirection: "column", gap: 2, alignItems: "flex-end", minWidth: 0 }}>
                  <span style={{ fontSize: 12.5, fontWeight: 500 }}>{TEAMS_BY_CODE[g.awayTeam]!.city}</span>
                  <span style={{ fontSize: 11, color: "var(--ink-faint)" }}>{record(s.teams[g.awayTeam]!)}</span>
                </span>
              </div>
            </div>
          );
        })}
        {byeTeams.map((c) => (
          <div
            key={c}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "13px 14px",
              borderRadius: "var(--r-md)",
              background: c === code ? "color-mix(in srgb, var(--team) 7%, transparent)" : "var(--panel-sunken)",
              border: `1px dashed ${c === code ? "color-mix(in srgb, var(--team) 42%, transparent)" : "var(--line-strong)"}`,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <TeamBadge code={c} />
              <span style={{ fontSize: 12.5, fontWeight: 500 }}>{TEAMS_BY_CODE[c]!.city}</span>
              <span style={{ fontSize: 11, color: "var(--ink-faint)" }}>{record(s.teams[c]!)}</span>
            </div>
            <span style={{ fontSize: 11.5, color: "var(--ink-faint)", fontWeight: 600, letterSpacing: "0.03em", textTransform: "uppercase" }}>
              Bye week
            </span>
          </div>
        ))}
      </div>

      <p style={{ margin: 0, padding: "12px 26px", fontSize: 11, color: "var(--ink-faint)", textAlign: "center", borderTop: "1px solid var(--line)" }}>
        Completed weeks show final scores; upcoming weeks show each team's current record. Every team gets one bye.
      </p>

      <Footer>
        <button type="button" className="btnlink" onClick={() => nav("/hub")}>
          Return to team hub
        </button>
      </Footer>
    </Card>
  );
}
