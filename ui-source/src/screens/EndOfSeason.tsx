import { useMemo } from "react";
import { useNavigate } from "react-router-dom";

import { pressable } from "@/components/bits";
import { ScoreTrackerTable } from "@/components/ScoreTrackerTable";
import { Card, CardHeader, Footer, Panel, Tabs, useTabs } from "@/components/primitives";
import { ReadinessGate } from "@/components/ReadinessGate";
import { TEAMS_BY_CODE, teamFullName } from "@/data/teams";
import { ROUND_LABEL, type PlayoffRound } from "@/domain";
import { useStore } from "@/state/store";

/** Big "END OF {year} SEASON" card. Any GM clicks past on their own. */
export function EndOfSeasonAnnounce() {
  const nav = useNavigate();
  const s = useStore();
  const setReady = useStore((st) => st.setReady);
  const autoReady = useStore((st) => st.autoReadyNonViewers);
  const tryAdvance = useStore((st) => st.tryAdvance);

  // This is the one stage screen with no ReadinessGate, and the gate is what
  // readies the other human GMs. Without that, "click anywhere" did nothing
  // at all in a multi-GM league: `tryAdvance` refuses until every human is
  // ready, and it routes back to this same screen when it refuses.
  const goOn = async () => {
    setReady(s.viewerGmId, true);
    autoReady();
    const { moved, route } = await tryAdvance();
    if (moved) nav(route);
  };

  return (
    <Card maxWidth={720}>
      <CardHeader badge="NFL" title={`End of ${s.season} Season`} />
      <div
        className="panel open"
        style={{ textAlign: "center", padding: "56px 26px", cursor: "pointer" }}
        {...pressable(() => void goOn())}
      >
        <p className="oswald" style={{ margin: 0, fontSize: 13, letterSpacing: "0.2em", color: "var(--ink-faint)" }}>
          THAT'S A WRAP ON
        </p>
        <p className="oswald" style={{ margin: "12px 0 0", fontSize: 46, fontWeight: 700, color: "var(--team)" }}>
          {s.season}
        </p>
        <p style={{ margin: "16px 0 0", fontSize: 12.5, color: "var(--ink-dim)" }}>
          Click anywhere to see how the season graded out.
        </p>
      </div>
      <Footer>
        <button className="btn-primary" onClick={goOn}>
          Continue
        </button>
      </Footer>
    </Card>
  );
}

/** The win / consolation recap, with a Score Tracker tab. */
export function SeasonComplete() {
  const nav = useNavigate();
  const s = useStore();
  const { active, setActive } = useTabs("season");

  const champ = s.bracket?.champion ?? s.bracket?.matchups.find((m) => m.round === "SB")?.winner ?? null;
  const humanChampGm = s.gms.find((g) => g.isHuman && g.teamCode === champ);

  // furthest-advanced human GM (used when no human won it all)
  const furthest = useMemo(() => {
    const rank = (r: string) => ({ SB: 4, CONF: 3, DIV: 2, WC: 1, none: 0 })[r as PlayoffRound | "none"] ?? 0;
    let best: { gmId: string; teamCode: string; round: string; rec: string } | null = null;
    for (const g of s.gms.filter((x) => x.isHuman && x.teamCode)) {
      let reached = "none";
      if (s.bracket) {
        for (const round of ["WC", "DIV", "CONF", "SB"] as PlayoffRound[]) {
          if (
            s.bracket.matchups.some(
              (m) => m.round === round && (m.highSeed?.code === g.teamCode || m.lowSeed?.code === g.teamCode),
            )
          ) {
            reached = round;
          }
        }
      }
      const t = s.teams[g.teamCode]!;
      if (!best || rank(reached) > rank(best.round)) {
        best = {
          gmId: g.id,
          teamCode: g.teamCode,
          round: reached,
          rec: `${t.wins}-${t.losses}${t.ties ? `-${t.ties}` : ""}`,
        };
      }
    }
    return best;
  }, [s.gms, s.bracket, s.teams]);

  const winnerGm = humanChampGm ?? (furthest ? s.gms.find((g) => g.id === furthest.gmId) : undefined);
  const winnerCode = humanChampGm?.teamCode ?? furthest?.teamCode;
  const gmPossessive = (g?: { id: string; name: string }) =>
    g ? (g.id === s.viewerGmId ? "Your" : `${g.name}'s`) : "";

  const roundText = humanChampGm
    ? "Won the Super Bowl"
    : furthest
      ? furthest.round === "none"
        ? "Finished"
        : `Advanced to the ${ROUND_LABEL[furthest.round as PlayoffRound]}`
      : "";
  const roundBoldPart = humanChampGm
    ? "Super Bowl"
    : furthest && furthest.round !== "none"
      ? ROUND_LABEL[furthest.round as PlayoffRound]
      : furthest?.rec ?? "";

  return (
    <Card maxWidth={760}>
      <CardHeader badge={winnerCode ? TEAMS_BY_CODE[winnerCode]!.abbr : "NFL"} title={`End of ${s.season} Season`} />
      <Tabs
        tabs={[
          { id: "season", label: "This Season" },
          { id: "tracker", label: "Score Tracker" },
        ]}
        active={active}
        onChange={setActive}
      />

      <Panel open={active === "season"}>
        <div style={{ textAlign: "center", padding: "24px 8px 8px" }}>
          <p style={{ margin: 0, fontSize: 11, color: "var(--ink-faint)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
            {humanChampGm
              ? "Super Bowl Champions"
              : furthest?.round === "none"
                ? // nobody advanced, so "furthest advanced" would be a boast
                  // about missing the playoffs
                  "Your season"
                : "Furthest advanced"}
          </p>
          <p className="oswald" style={{ margin: "10px 0 0", fontSize: 32, fontWeight: 700, color: humanChampGm ? "var(--team)" : "var(--ink)" }}>
            {winnerGm && winnerCode ? `${gmPossessive(winnerGm)} ${teamFullName(winnerCode)}` : winnerCode ? teamFullName(winnerCode) : "—"}
          </p>
          <p style={{ margin: "10px 0 0", fontSize: 13, color: "var(--ink-dim)" }}>
            {roundText.replace(roundBoldPart, "").trim()}{" "}
            <strong style={{ color: "var(--ink)" }}>{roundBoldPart}</strong>
            {humanChampGm ? "." : furthest?.round !== "none" ? " — the best of the league this year." : "."}
          </p>
          {champ && !humanChampGm && (
            <p style={{ margin: "14px 0 0", fontSize: 12, color: "var(--ink-faint)" }}>
              {teamFullName(champ)} took the title.
            </p>
          )}
          <p style={{ margin: "16px 0 0", fontSize: 12, color: "var(--ink-faint)" }}>
            The cross-season score tracker has been updated — see the tab above.
          </p>
        </div>
      </Panel>

      <Panel open={active === "tracker"}>
        <ScoreTrackerTable />
      </Panel>

      <Footer>
        <button type="button" className="btnlink" onClick={() => nav("/bracket")}>
          Final bracket
        </button>
        <button type="button" className="btnlink" onClick={() => nav("/history")}>
          Full league history
        </button>
      </Footer>

      <ReadinessGate title="End of season readiness" onAdvance={(r) => nav(r)} />
    </Card>
  );
}
