import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { OvrPill, TeamBadge } from "@/components/bits";
import { ContractNegotiation } from "@/components/ContractNegotiation";
import { ExpandableRow } from "@/components/ExpandableRow";
import { RowHeader, useListFilter } from "@/components/ListFilter";
import { FullScreenOverlay } from "@/components/FullScreenOverlay";
import { Card, CardHeader, Footer, Panel, Tabs, Ticker, useTabs } from "@/components/primitives";
import { ReadinessGate } from "@/components/ReadinessGate";
import { TEAMS_BY_CODE } from "@/data/teams";
import type { ContractOffer, Player } from "@/domain";
import { playerPriorities } from "@/sim/priorities";
import { RosterNeeds } from "@/components/RosterNeeds";
import { useStore } from "@/state/store";
import { teamRoster, viewerTeamCode } from "@/state/selectors";
import { millions, seconds } from "@/util/format";

export function FreeAgencyBoard() {
  const nav = useNavigate();
  const s = useStore();
  const { active, setActive } = useTabs("unsigned");
  const code = viewerTeamCode(s);

  const startBidding = useStore((st) => st.startBidding);
  const placeOffer = useStore((st) => st.placeOffer);
  const advanceDay = useStore((st) => st.advanceBiddingDay);
  const dismiss = useStore((st) => st.dismissInterstitial);
  const signStanding = useStore((st) => st.signStandingFreeAgent);

  const isWindowStage = s.stage === "offseasonFreeAgency";
  const [negotiating, setNegotiating] = useState<Player | null>(null);
  const [signError, setSignError] = useState<string | null>(null);

  useEffect(() => {
    if (isWindowStage && !s.freeAgency) startBidding("players");
  }, [isWindowStage, s.freeAgency, startBidding]);

  const fa = s.freeAgency;
  const inWindow = isWindowStage && fa?.mode === "main";

  const [remaining, setRemaining] = useState(fa?.secondsRemaining ?? 720);
  useEffect(() => setRemaining(fa?.secondsRemaining ?? 720), [fa?.day]);
  useEffect(() => {
    if (!inWindow || fa?.interstitialVisible) return;
    const t = setInterval(() => setRemaining((r) => Math.max(0, r - 1)), 1000);
    return () => clearInterval(t);
  }, [inWindow, fa?.interstitialVisible, fa?.day]);
  useEffect(() => {
    if (inWindow && remaining === 0 && !fa?.interstitialVisible) advanceDay("players");
  }, [inWindow, remaining, fa?.interstitialVisible, advanceDay]);

  const windowSigned = new Set(fa?.signed.map((x) => x.id) ?? []);
  const FA_GRID = "1.7fr 0.45fr 0.5fr 1fr auto 16px";
  const freeAgents = useMemo(
    () =>
      Object.values(s.players)
        .filter((p) => p.free_agent && !p.retired && !windowSigned.has(p.id))
        .sort((a, b) => b.overall - a.overall),
    [s.players, windowSigned],
  );

  // 560 players go on the market in a fantasy offseason. Sorting by overall
  // and showing the top 50 meant the punters, and every depth signing a
  // rebuilding team actually wants, were simply unreachable.
  const market = useListFilter(freeAgents);

  // the store's own figure (players + staff) — identical to what the signing
  // check enforces, so the number here is the number that decides a signing
  const capSpace = code ? Math.round((s.teams[code]!.cap.total - s.teams[code]!.cap.used) * 10) / 10 : 0;

  const bidsFor = (id: string): ContractOffer[] =>
    isWindowStage ? (fa?.bids[id] ?? []) : [];
  const myOffer = (id: string) => bidsFor(id).find((o) => o.teamCode === code);
  const leadOffer = (id: string) =>
    [...bidsFor(id)].sort(
      (a, b) => b.baseSalary * b.years + b.signingBonus - (a.baseSalary * a.years + a.signingBonus),
    )[0];

  const returnLink = s.returnTo
    ? { to: s.returnTo, label: "Return to retirements" }
    : { to: "/hub", label: "Return to team hub" };

  return (
    <Card maxWidth={860}>
      {isWindowStage && fa?.interstitialVisible && (
        <FullScreenOverlay
          kicker="Free agency"
          big={`Day ${fa.day}`}
          note="Click anywhere to see the board with today's signings."
          onDismiss={() => dismiss("players")}
        />
      )}

      <CardHeader
        badge={code ? TEAMS_BY_CODE[code]!.abbr : "FS"}
        title="Free Agency"
        // The window closing doesn't end the stage — bidding is over but the
        // market stays open, and the header used to keep saying "Live window ·
        // Day 5 of 5" while a signing was a straight purchase.
        subtitle={
          inWindow
            ? `Live window · Day ${fa?.day ?? 1} of 5`
            : isWindowStage
              ? "Window closed · open market until the season starts"
              : "Standing market · open through the season"
        }
      />
      <Ticker
        stats={[
          inWindow
            ? { label: "Time left today", value: seconds(remaining), className: remaining <= 60 ? "urgent" : undefined }
            : { label: "Mode", value: isWindowStage ? "Open market" : "Standing", className: "sm" },
          { label: "Cap space", value: millions(capSpace), className: capSpace >= 0 ? "good" : "bad" },
          { label: "Available", value: freeAgents.length },
          { label: isWindowStage ? "Signed" : "Your bids", value: isWindowStage ? (fa?.signed.length ?? 0) : bidsCount(fa, code) },
        ]}
      />

      <Tabs
        tabs={[
          { id: "unsigned", label: "Unsigned" },
          { id: "needs", label: "Roster Needs" },
          { id: "signed", label: "Signed" },
        ]}
        active={active}
        onChange={setActive}
      />

      <Panel id="unsigned" open={active === "unsigned"}>
        {freeAgents.length === 0 && (
          <div className="emptystate">Nobody is on the market right now.</div>
        )}
        {market.controls}
        {freeAgents.length > 0 && market.matched === 0 && (
          <div className="emptystate">
            Nobody on the market matches that. Clear the search or pick another position.
          </div>
        )}
        <div className="scroll-list">
          {market.matched > 0 && (
            <RowHeader
              gridTemplate={FA_GRID}
              labels={["Player", "Ovr", "Age", isWindowStage ? "Leading offer" : "Status", "", ""]}
            />
          )}
          {market.shown.map((p) => {
            const mine = myOffer(p.id);
            const lead = leadOffer(p.id);
            const exp = playerPriorities(p).expectation;
            return (
              <ExpandableRow
                key={p.id}
                gridTemplate={FA_GRID}
                columns={
                  <>
                    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                      <p className="pname">
                        {p.name} <span className="ppos">{p.position}</span>
                      </p>
                      <p style={{ margin: 0, fontSize: 11, color: "var(--ink-faint)" }}>
                        Age {p.age} · wants ~{millions(exp.baseSalary)}/yr
                      </p>
                    </div>
                    <OvrPill value={p.overall} />
                    <span className="pcell">{p.age}</span>
                    <span style={{ fontSize: 12.5, textAlign: "center", color: mine && lead?.teamCode === code ? "var(--good)" : "var(--ink-dim)" }}>
                      {isWindowStage
                        ? lead
                          ? `${TEAMS_BY_CODE[lead.teamCode]?.abbr ?? lead.teamCode} · ${millions(lead.baseSalary)}/yr`
                          : "No offers"
                        : "Open market"}
                    </span>
                    <button
                      className="btn-primary"
                      style={{ fontSize: 11.5, padding: "7px 8px" }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSignError(null);
                        setNegotiating(p);
                      }}
                    >
                      {mine ? "Revise" : "Negotiate"}
                    </button>
                  </>
                }
                detail={
                  <>
                    {isWindowStage &&
                      bidsFor(p.id)
                        .sort((a, b) => b.baseSalary * b.years - a.baseSalary * a.years)
                        .map((o, i) => (
                          <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: "1px solid var(--line)", fontSize: 12 }}>
                            <span style={{ color: o.teamCode === code ? "var(--good)" : "var(--ink-dim)", fontWeight: o.teamCode === code ? 600 : 400 }}>
                              {TEAMS_BY_CODE[o.teamCode]?.city ?? o.teamCode}
                              {o.teamCode === code ? " (you)" : ""}
                            </span>
                            <span className="oswald">
                              {millions(o.baseSalary)}/yr · {o.years}yr · {millions(o.guaranteed)} gtd
                            </span>
                          </div>
                        ))}
                    <p style={{ margin: "8px 0 0", fontSize: 11, color: "var(--ink-faint)" }}>
                      Priorities: {playerPriorities(p).ranked.join(" · ")}.
                    </p>
                  </>
                }
              />
            );
          })}
        </div>
        {isWindowStage && (
          <p style={{ margin: "16px 0 0", fontSize: 11, color: "var(--ink-faint)", textAlign: "center" }}>
            After Day 5 the unsigned market rolls into the standing free-agent market.
          </p>
        )}
      </Panel>

      <Panel id="needs" open={active === "needs"}>
        {code ? (
          <RosterNeeds roster={teamRoster(s, code)} />
        ) : (
          <div className="emptystate">Pick a team first.</div>
        )}
      </Panel>

      <Panel id="signed" open={active === "signed"}>
        {isWindowStage ? (
          (fa?.signed ?? []).length === 0 ? (
            <div className="emptystate">No signings yet.</div>
          ) : (
            [...(fa?.signed ?? [])].reverse().map((sg, i) => {
              const p = s.players[sg.id];
              return (
                <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "11px 6px", borderBottom: "1px solid var(--line)" }}>
                  <div>
                    <p className="pname" style={{ margin: 0 }}>
                      {p?.name ?? sg.id} <span style={{ fontSize: 12, color: "var(--ink-dim)" }}>· {p?.position}</span>
                    </p>
                    <span style={{ fontSize: 12, color: "var(--ink-dim)" }}>
                      <TeamBadge code={sg.toTeam} size={16} /> {TEAMS_BY_CODE[sg.toTeam]?.city ?? sg.toTeam} · Day {sg.at}
                    </span>
                  </div>
                  <span className="oswald" style={{ fontSize: 13 }}>
                    {sg.years}yr / {millions(sg.baseSalary * sg.years + sg.signingBonus)}
                  </span>
                </div>
              );
            })
          )
        ) : (
          <div className="emptystate">
            Standing-market signings go straight onto your roster — check Roster &amp; Cap to see them.
          </div>
        )}
      </Panel>

      <Footer>
        {(!inWindow || fa?.mode === "standing") && (
          <button type="button" className="btnlink" onClick={() => nav(returnLink.to)}>
            {returnLink.label}
          </button>
        )}
        {isWindowStage && inWindow && (
          <button className="btn-primary" onClick={() => advanceDay("players")}>
            Mark ready for next day
          </button>
        )}
        {!isWindowStage && (
          <button type="button" className="btnlink" onClick={() => nav("/roster")}>
            Roster &amp; Cap
          </button>
        )}
      </Footer>

      {isWindowStage && (
        <ReadinessGate
          title="Free agency readiness"
          disabled={inWindow}
          disabledHint={`Day ${fa?.day ?? 1} of 5 — the window is still open`}
          onAdvance={(r) => nav(r)}
        />
      )}

      {negotiating && code && (
        <ContractNegotiation
          title={`Offer — ${negotiating.name}`}
          subtitle={`${negotiating.position} · age ${negotiating.age} · ${negotiating.overall} OVR`}
          priorities={playerPriorities(negotiating)}
          prior={myOffer(negotiating.id)}
          error={signError}
          onClose={() => {
            setSignError(null);
            setNegotiating(null);
          }}
          onSubmit={(offer) => {
            const full: ContractOffer = { ...offer, teamCode: code };
            if (isWindowStage) {
              const result = placeOffer("players", negotiating.id, full);
              if (result.ok) {
                setSignError(null);
                setNegotiating(null);
              } else {
                setSignError(result.reason ?? "Unable to bid on this player.");
              }
            } else {
              const result = signStanding(negotiating.id, full);
              if (result.ok) {
                setSignError(null);
                setNegotiating(null);
              } else {
                setSignError(result.reason ?? "Unable to sign this player.");
              }
            }
          }}
        />
      )}
    </Card>
  );
}

function bidsCount(fa: LeagueFA, code: string | undefined): number {
  if (!fa || !code) return 0;
  return Object.values(fa.bids).filter((list) => list.some((o) => o.teamCode === code)).length;
}
type LeagueFA = ReturnType<typeof useStore.getState>["freeAgency"];
