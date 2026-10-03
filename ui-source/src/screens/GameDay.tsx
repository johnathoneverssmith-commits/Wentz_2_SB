import { useNavigate } from "react-router-dom";

import { pressable, TeamBadge } from "@/components/bits";
import { Card, CardHeader, Footer } from "@/components/primitives";
import { TEAMS_BY_CODE } from "@/data/teams";
import { roundLabelFor, type PlayoffRound } from "@/domain";
import { isOnline } from "@/state/online";
import { useStore } from "@/state/store";
import { hasBoxScore, viewerTeamCode } from "@/state/selectors";

import { Gamecast } from "./gamecast/Gamecast";
import { posLabel, weeksOut } from "@/util/format";

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
  const online = isOnline();
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
    ? roundLabelFor(s.bracket, pgd.phase as PlayoffRound)
    : pgd.phase === "PRE"
      ? `Preseason Week ${pgd.week}`
      : `Week ${pgd.week}`;

  const slate = s.games.filter((g) => pgd.gameIds.includes(g.id));
  const viewerGame = slate.find((g) => g.homeTeam === code || g.awayTeam === code);
  const myInjuries = (viewerGame?.injuries ?? [])
    .filter((e) => e.team === code)
    .sort((a, b) => (b.projectedWeeks[1] ?? 0) - (a.projectedWeeks[1] ?? 0));

  // A playoff round leaves no games on file — the scores live on the bracket
  // — so a GM whose team had just played was told it "wasn't in action".
  const roundResults = isPlayoff
    ? (s.bracket?.matchups ?? [])
        .filter((m) => m.round === pgd.phase && m.highSeed && m.lowSeed && m.homeScore != null && m.awayScore != null)
        .sort((a, b) => Number(isMine(b)) - Number(isMine(a)))
    : [];
  function isMine(m: { highSeed: { code: string } | null; lowSeed: { code: string } | null }): boolean {
    return !!code && (m.highSeed?.code === code || m.lowSeed?.code === code);
  }
  const playedThisRound = roundResults.some(isMine);

  const hadBye =
    isPlayoff &&
    !!code &&
    (s.bracket?.matchups ?? []).some((m) => m.round === pgd.phase && !m.lowSeed && m.highSeed?.code === code);

  return (
    <Card maxWidth={760}>
      <CardHeader badge={code ? TEAMS_BY_CODE[code]?.abbr ?? "FS" : "FS"} title="Game Day" subtitle={`${label} · results are in`} />

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
                  {e.player} <span className="ppos">{posLabel(e.position)}</span>
                </span>
                <span style={{ fontSize: 12.5, color: "var(--bad)", fontWeight: 600 }}>
                  {e.bodyPart} · {weeksOut(e.projectedWeeks)}
                </span>
              </div>
            ))}
          </>
        )}

        {roundResults.length > 0 && (
          <>
            <p className="subhead" style={{ marginTop: 0 }}>
              This round
            </p>
            <div className="scroll-list short">
              {roundResults.map((m) => {
                const home = m.highSeed!;
                const away = m.lowSeed!;
                const mine = isMine(m);
                return (
                  <div
                    key={`${m.conference}-${home.code}-${away.code}`}
                    style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center", gap: 10, padding: "9px 6px", borderBottom: "1px solid var(--line)", borderRadius: "var(--r-sm)", background: mine ? "var(--panel-raised)" : undefined }}
                  >
                    <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <TeamBadge code={home.code} size={20} />
                      <span style={{ fontSize: 12.5, fontWeight: m.winner === home.code ? 600 : 400 }}>
                        {TEAMS_BY_CODE[home.code]?.label ?? home.code}
                      </span>
                    </span>
                    <span className="oswald" style={{ fontSize: 13 }}>
                      {m.homeScore}–{m.awayScore}
                    </span>
                    <span style={{ display: "flex", alignItems: "center", gap: 8, flexDirection: "row-reverse" }}>
                      <TeamBadge code={away.code} size={20} />
                      <span style={{ fontSize: 12.5, fontWeight: m.winner === away.code ? 600 : 400 }}>
                        {TEAMS_BY_CODE[away.code]?.label ?? away.code}
                      </span>
                    </span>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {!isPlayoff && (
          <>
            <p className="subhead" style={{ marginTop: viewerGame ? 18 : 0 }}>
              Around the league
            </p>
            <div className="scroll-list short">
              {/* your own game is the card above; it was listed here again */}
              {slate.filter((g) => g !== viewerGame).map((g) => {
                const homeWon = g.homeScore > g.awayScore;
                const awayWon = g.awayScore > g.homeScore;
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
                      <span style={{ fontSize: 12.5, fontWeight: homeWon ? 600 : 400 }}>{TEAMS_BY_CODE[g.homeTeam]!.label}</span>
                    </span>
                    <span className="oswald" style={{ fontSize: 13 }}>
                      {g.homeScore}–{g.awayScore}
                    </span>
                    <span style={{ display: "flex", alignItems: "center", gap: 8, flexDirection: "row-reverse" }}>
                      <TeamBadge code={g.awayTeam} size={20} />
                      <span style={{ fontSize: 12.5, fontWeight: awayWon ? 600 : 400 }}>{TEAMS_BY_CODE[g.awayTeam]!.label}</span>
                    </span>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {!viewerGame?.broadcast && !playedThisRound && (
          <p style={{ margin: "16px 0 0", fontSize: 11, color: "var(--ink-faint)", textAlign: "center" }}>
            {viewerGame
              ? online
                ? // online the broadcast isn't stored; it is rebuilt when asked for
                  "The play-by-play is a click away — Watch play-by-play below."
                : "There's no play-by-play for this game — just the final score."
              : isPlayoff
                ? hadBye
                  ? "Your team had the bye this round and advances automatically."
                  : // a team that never made the field read as one resting
                    (s.bracket?.matchups ?? []).some(isMine)
                    ? "Your team is out of the playoffs."
                    : "Your team missed the playoffs."
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
        {online && viewerGame && !viewerGame.broadcast && (
          <button type="button" className="btnlink" onClick={() => nav(`/watch/${viewerGame.id}`)}>
            Watch play-by-play
          </button>
        )}
        <button type="button" className="btnlink" onClick={() => nav("/hub")}>
          Team hub
        </button>
        <button
          className="btn-primary"
          onClick={async () => {
            // Online the week is already over — the server played it and moved
            // the clock before this screen ever appeared. Calling
            // `finishGameDay` here would step it a second time in this browser
            // only, and the copy would drift until the next frame corrected
            // it. There is nothing to decide on a results screen either, so
            // nobody waits: read it and leave whenever you like.
            if (online) {
              nav("/");
              return;
            }
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
        <p style={{ margin: 0, fontSize: 11, color: "var(--ink-faint)" }}>{TEAMS_BY_CODE[code]!.label}</p>
      </div>
    </div>
  );
}
