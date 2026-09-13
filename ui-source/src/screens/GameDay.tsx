import { useNavigate } from "react-router-dom";

import { pressable, TeamBadge } from "@/components/bits";
import { Card, CardHeader, Footer } from "@/components/primitives";
import { TEAMS_BY_CODE } from "@/data/teams";
import { ROUND_LABEL, type PlayoffRound } from "@/domain";
import { useStore } from "@/state/store";
import { hasBoxScore, viewerTeamCode } from "@/state/selectors";

import { Gamecast } from "./gamecast/Gamecast";

/**
 * Post-simulation Game Day screen. Deliberately a light canvas for now — the
 * detailed live/gameflow presentation will be designed against the real engine.
 * Its one job today: show that the week/round was played and let the viewer
 * continue (which is what actually advances the week / stage).
 */
export function GameDay() {
  const nav = useNavigate();
  const s = useStore();
  const finishGameDay = useStore((st) => st.finishGameDay);
  const pgd = s.pendingGameDay;
  const code = viewerTeamCode(s);

  if (!pgd) {
    return (
      <Card>
        <CardHeader badge="FS" title="Game Day" subtitle="Nothing to show" />
        <div className="panel open">
          <div className="emptystate">No simulated results are pending. Head back to the hub.</div>
        </div>
        <Footer>
          <button type="button" className="btnlink btn-primary" onClick={() => nav("/hub")}>
            Back to team hub
          </button>
        </Footer>
      </Card>
    );
  }

  const isPlayoff = ["WC", "DIV", "CONF", "SB"].includes(pgd.phase);
  const label = isPlayoff
    ? ROUND_LABEL[pgd.phase as PlayoffRound]
    : pgd.phase === "PRE"
      ? `Preseason Week ${pgd.week}`
      : `Week ${pgd.week}`;

  const slate = s.games.filter((g) => pgd.gameIds.includes(g.id));
  const viewerGame = slate.find((g) => g.homeTeam === code || g.awayTeam === code);
  const myInjuries = (viewerGame?.injuries ?? [])
    .filter((e) => e.team === code)
    .sort((a, b) => (b.projectedWeeks[1] ?? 0) - (a.projectedWeeks[1] ?? 0));

  const roundMatchups = isPlayoff
    ? (s.bracket?.matchups ?? []).filter((m) => m.round === pgd.phase && m.winner)
    : [];
  const hadBye =
    isPlayoff &&
    !!code &&
    (s.bracket?.matchups ?? []).some((m) => m.round === pgd.phase && !m.lowSeed && m.highSeed?.code === code);

  return (
    <Card maxWidth={760}>
      <CardHeader badge="FS" title="Game Day" subtitle={`${label} · results are in`} />

      <div className="panel open">
        {viewerGame?.broadcast && (
          <div style={{ marginBottom: 16 }}>
            <Gamecast game={viewerGame} />
          </div>
        )}

        {viewerGame && !viewerGame.broadcast && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr auto 1fr",
              alignItems: "center",
              gap: 16,
              padding: "22px 18px",
              background: "var(--panel-sunken)",
              border: "1px solid var(--line)",
              borderRadius: "var(--r-md)",
              marginBottom: 16,
            }}
          >
            <ScoreSide code={viewerGame.homeTeam} score={viewerGame.homeScore} won={viewerGame.homeScore > viewerGame.awayScore} />
            <div style={{ textAlign: "center", color: "var(--ink-faint)", fontSize: 11 }}>FINAL</div>
            <ScoreSide code={viewerGame.awayTeam} score={viewerGame.awayScore} won={viewerGame.awayScore > viewerGame.homeScore} right />
          </div>
        )}

        {isPlayoff && (
          <table className="stbl">
            <thead>
              <tr>
                <th>{label} results</th>
                <th className="r">Score</th>
              </tr>
            </thead>
            <tbody>
              {roundMatchups.map((m, i) => (
                <tr key={i}>
                  <td className="name">
                    {m.highSeed ? TEAMS_BY_CODE[m.highSeed.code]!.city : "—"} vs{" "}
                    {m.lowSeed ? TEAMS_BY_CODE[m.lowSeed.code]!.city : "(bye)"}
                  </td>
                  <td className="r">
                    {m.homeScore != null ? `${m.homeScore}–${m.awayScore}` : m.lowSeed ? "—" : "advances"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* The one thing a GM needs off a game day besides the score: who they
            lost. It's in the box score too, but nobody opens a box score to
            find out their left tackle is gone for six weeks. */}
        {myInjuries.length > 0 && (
          <>
            <p className="subhead" style={{ marginTop: viewerGame ? 18 : 0 }}>
              Your injury report
            </p>
            {myInjuries.map((e, i) => (
              <div key={`${e.playerId}-${i}`} className="neg-row">
                <span className="pname">
                  {e.player} <span className="ppos">{e.position}</span>
                </span>
                <span style={{ fontSize: 12.5, color: "var(--bad)", fontWeight: 600 }}>
                  {e.bodyPart} · {e.projectedWeeks[0]}–{e.projectedWeeks[1]} wks
                </span>
              </div>
            ))}
          </>
        )}

        {!isPlayoff && (
          <>
            <p className="subhead" style={{ marginTop: viewerGame ? 18 : 0 }}>
              Around the league
            </p>
            <div style={{ maxHeight: 320, overflowY: "auto" }}>
              {slate.map((g) => {
                const homeWon = g.homeScore > g.awayScore;
                const openable = hasBoxScore(g);
                return (
                  <div
                    key={g.id}
                    {...(openable ? pressable(() => nav(`/box/${g.id}`)) : {})}
                    title={openable ? "Open the box score" : "No box score for this game"}
                    style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center", gap: 10, padding: "9px 6px", borderBottom: "1px solid var(--line)", cursor: openable ? "pointer" : "default", borderRadius: "var(--r-sm)" }}
                  >
                    <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <TeamBadge code={g.homeTeam} size={20} />
                      <span style={{ fontSize: 12.5, fontWeight: homeWon ? 600 : 400 }}>{TEAMS_BY_CODE[g.homeTeam]!.city}</span>
                    </span>
                    <span className="oswald" style={{ fontSize: 13 }}>
                      {g.homeScore}–{g.awayScore}
                    </span>
                    <span style={{ display: "flex", alignItems: "center", gap: 8, flexDirection: "row-reverse" }}>
                      <TeamBadge code={g.awayTeam} size={20} />
                      <span style={{ fontSize: 12.5, fontWeight: !homeWon ? 600 : 400 }}>{TEAMS_BY_CODE[g.awayTeam]!.city}</span>
                    </span>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {!viewerGame?.broadcast && (
          <p style={{ margin: "16px 0 0", fontSize: 11, color: "var(--ink-faint)", textAlign: "center" }}>
            {viewerGame
              ? "The full play-by-play gamecast needs the engine adapter running (npm run server) — showing the final score only."
              : isPlayoff
                ? hadBye
                  ? "Your team had the bye this round and advances automatically."
                  : "Your team wasn't in action this round."
                : "Bye week — your team wasn't on this week's slate."}
          </p>
        )}
      </div>

      <Footer>
        {hasBoxScore(viewerGame) && (
          <button type="button" className="btnlink" onClick={() => nav(`/box/${viewerGame!.id}`)}>
            Full box score
          </button>
        )}
        <button type="button" className="btnlink" onClick={() => nav("/hub")}>
          Team hub
        </button>
        <button
          className="btn-primary"
          onClick={async () => {
            const { route } = await finishGameDay();
            nav(route);
          }}
        >
          Continue
        </button>
      </Footer>
    </Card>
  );
}

function ScoreSide({
  code,
  score,
  won,
  right = false,
}: {
  code: string;
  score: number;
  won: boolean;
  right?: boolean;
}) {
  return (
    <div style={{ textAlign: "center", display: "flex", flexDirection: right ? "row-reverse" : "row", alignItems: "center", gap: 12, justifyContent: "center" }}>
      <TeamBadge code={code} size={44} />
      <div>
        <p className="oswald" style={{ margin: 0, fontSize: 30, fontWeight: 700, color: won ? "var(--good)" : "var(--ink)" }}>
          {score}
        </p>
        <p style={{ margin: 0, fontSize: 11, color: "var(--ink-faint)" }}>{TEAMS_BY_CODE[code]!.city}</p>
      </div>
    </div>
  );
}
