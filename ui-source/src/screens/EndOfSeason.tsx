import { useEffect, useMemo, useState } from "react";

import { type Moment, ScoreMoment } from "@/motion/ScoreMoment";
import { SeasonAwardsList } from "@/components/LeagueMemory";
import { useNavigate } from "react-router-dom";

import { pressable } from "@/components/bits";
import { OffseasonRounds } from "@/components/OffseasonRounds";
import { ScoreTrackerTable } from "@/components/ScoreTrackerTable";
import { Footer, Panel } from "@/components/primitives";
import { ReadinessGate } from "@/components/ReadinessGate";
import { TEAMS_BY_CODE, teamFullName } from "@/data/teams";
import { GameDayMasthead } from "@/design/GameDayMasthead";
import { GdPage } from "@/design/GdPage";
import "@/design/gameday.css";
import "@/design/gameday-blocks.css";
import "./season-end-gameday.css";
import { roundLabelFor, winPct, type PlayoffRound } from "@/domain";
import { visibleBracket } from "@/state/reveal";
import { viewerTeamCode } from "@/state/selectors";
import { useStore } from "@/state/store";
import { isOnline } from "@/state/online";
import { useLeagueActions } from "@/state/useLeagueActions";

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
  const actions = useLeagueActions();
  const goOn = async () => {
    // online the league has already moved past the announcement (it is a
    // splash there, not a stage) — the local store's gate would do nothing.
    // Seeing the awards is this GM's own step, so every GM gets them.
    if (isOnline()) {
      await actions.stepForward("awardsSeen");
      nav("/season-complete");
      return;
    }
    await actions.stepForward("awardsSeen");
    setReady(s.viewerGmId, true);
    autoReady();
    const { moved, route } = await tryAdvance();
    if (moved) nav(route);
  };

  // the champion's colours, once this GM has watched the title game; their own
  // team's until then
  const mine = viewerTeamCode(s);
  const champ = s.bracket ? visibleBracket(s.bracket, s, s.viewerGmId).champion : null;
  const awards = (s.awards ?? []).filter((a) => a.season === s.season);

  return (
    <GdPage code={champ ?? mine}>
      <GameDayMasthead
        code={champ ?? mine ?? ""}
        title="End of season"
        heading={s.season}
        sub={champ ? `That's a wrap on ${s.season}. ${teamFullName(champ)} took the title.` : `That's a wrap on ${s.season}.`}
      />
      <div className="se-stage" {...pressable(() => void goOn())}>
        {awards.length > 0 && (
          <div className="se-stage__awards">
            {/* no stopPropagation: the awards fill most of the card, and "click
                anywhere" did nothing on them — there is nothing in them to click */}
            <p className="se-stage__label">Season awards</p>
            <SeasonAwardsList awards={awards} />
          </div>
        )}
        <p className="se-stage__hint">Tap or click anywhere to see how the season graded out.</p>
      </div>
      <Footer>
        <button className="btn-primary" onClick={goOn}>
          Continue
        </button>
      </Footer>
    </GdPage>
  );
}

/** The win / consolation recap, with a Score Tracker tab. */
export function SeasonComplete() {
  const nav = useNavigate();
  const s = useStore();

  const champ = s.bracket?.champion ?? s.bracket?.matchups.find((m) => m.round === "SB")?.winner ?? null;
  const humanChampGm = s.gms.find((g) => g.isHuman && g.teamCode === champ);

  // the title is an occasion for whoever won it: their colours, once, on arrival
  const [crown, setCrown] = useState<Moment | null>(null);
  useEffect(() => {
    if (!champ) return;
    setCrown({
      key: `champ-${s.season}`,
      color: TEAMS_BY_CODE[champ]?.color ?? "#444",
      label: "Champions",
      sub: teamFullName(champ),
      from: "left",
    });
  }, [champ, s.season]);

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

  // nobody made it: this is about your season, not whoever is listed first
  const viewerGm = s.gms.find((g) => g.id === s.viewerGmId && g.teamCode);
  const noneAdvanced = !humanChampGm && furthest?.round === "none";
  const winnerGm =
    humanChampGm ??
    (noneAdvanced && viewerGm ? viewerGm : furthest ? s.gms.find((g) => g.id === furthest.gmId) : undefined);
  const winnerCode = humanChampGm?.teamCode ?? (noneAdvanced && viewerGm ? viewerGm.teamCode : furthest?.teamCode);
  const winnerTeam = winnerCode ? s.teams[winnerCode] : undefined;
  // "Super Bowl" in the NFL, "Final" in a humans-only league's bracket
  const title = roundLabelFor(s.bracket, "SB");
  const gmPossessive = (g?: { id: string; name: string }) =>
    g ? (g.id === s.viewerGmId ? "Your" : `${g.name}'s`) : "";

  const roundText = humanChampGm
    ? `Won the ${title}`
    : furthest
      ? noneAdvanced
        ? "Finished"
        : // "advanced to the Wild Card" for a team that lost its first game
          `Reached the ${roundLabelFor(s.bracket, furthest.round as PlayoffRound)}`
      : "";
  const roundBoldPart = humanChampGm
    ? title
    : furthest && !noneAdvanced
      ? roundLabelFor(s.bracket, furthest.round as PlayoffRound)
      : winnerTeam
        ? `${winnerTeam.wins}-${winnerTeam.losses}${winnerTeam.ties ? `-${winnerTeam.ties}` : ""}`
        : "";

  // the page wears the champion's colours; the viewer's own team when there is none
  const pageCode = champ ?? viewerGm?.teamCode ?? winnerCode ?? "";

  return (
    <GdPage code={pageCode} className="se se-complete">
      <ScoreMoment moment={crown} onDone={() => setCrown(null)} />
      <GameDayMasthead
        code={pageCode}
        compact
        title={`End of ${s.season} season`}
        heading="Season complete"
        sub="The season's result, and what it did to the score tracker."
      />
      {/* the season's result and the running score tracker are one story: the
          season on top, what it did to the standings underneath */}
      <Panel id="season" open>
        <div className="se-result">
          <p className="se-result__kicker">
            {humanChampGm
              ? // "Final Champions" in a humans-only league
                s.bracket?.format === "single"
                ? "League Champions"
                : `${title} Champions`
              : furthest?.round === "none"
                ? // nobody advanced, so "furthest advanced" would be a boast
                  // about missing the playoffs
                  "Your season"
                : "Furthest advanced"}
          </p>
          <p className="se-result__name">
            {winnerGm && winnerCode ? `${gmPossessive(winnerGm)} ${teamFullName(winnerCode)}` : winnerCode ? teamFullName(winnerCode) : "—"}
          </p>
          <p className="se-result__line">
            {roundText.replace(roundBoldPart, "").trim()} <strong>{roundBoldPart}</strong>
            {humanChampGm ? "." : furthest?.round !== "none" ? " — as far as any GM in the league got this year." : "."}
          </p>
          {champ && !humanChampGm && <p className="se-result__champ">{teamFullName(champ)} took the title.</p>}
        </div>
        {/* the headline is one GM; in a league of several, how the others
            finished is the first thing anyone asks */}
        {s.gms.filter((g) => g.isHuman && g.teamCode).length > 1 && (
          <div className="se-card">
            <table className="stbl">
              <thead>
                <tr>
                  <th>GM</th>
                  <th>Team</th>
                  <th className="c">Record</th>
                  <th>Postseason</th>
                </tr>
              </thead>
              <tbody>
                {s.gms
                  .filter((g) => g.isHuman && g.teamCode)
                  // the order GMs joined in put the champion anywhere; this is
                  // the season's table, so it reads as one — furthest first
                  .map((g) => {
                    const games = s.bracket?.matchups.filter(
                      (m) => m.highSeed?.code === g.teamCode || m.lowSeed?.code === g.teamCode,
                    ) ?? [];
                    const depth = champ === g.teamCode ? 99 : games.length;
                    return { g, depth, pct: winPct(s.teams[g.teamCode]!) };
                  })
                  .sort((a, b) => b.depth - a.depth || b.pct - a.pct)
                  .map(({ g }) => {
                    const t = s.teams[g.teamCode]!;
                    const games = s.bracket?.matchups.filter(
                      (m) => m.highSeed?.code === g.teamCode || m.lowSeed?.code === g.teamCode,
                    ) ?? [];
                    const last = games.at(-1);
                    const result =
                      champ === g.teamCode
                        ? `Won the ${title}`
                        : !last
                          ? "Missed the playoffs"
                          : `Lost in the ${roundLabelFor(s.bracket, last.round as PlayoffRound)}`;
                    return (
                      <tr key={g.id}>
                        <td>{g.id === s.viewerGmId ? "You" : g.name}</td>
                        <td>{TEAMS_BY_CODE[g.teamCode]?.label ?? g.teamCode}</td>
                        <td className="c">{`${t.wins}-${t.losses}${t.ties ? `-${t.ties}` : ""}`}</td>
                        <td>{result}</td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        )}
        <div className="se-card">
          <p className="subhead">Cross-season score</p>
          <ScoreTrackerTable />
        </div>
        <OffseasonRounds />
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
    </GdPage>
  );
}
