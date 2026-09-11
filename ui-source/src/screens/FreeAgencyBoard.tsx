import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { OvrPill, TeamBadge } from "@/components/bits";
import { ContractNegotiation } from "@/components/ContractNegotiation";
import { ExpandableRow } from "@/components/ExpandableRow";
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
  const freeAgents = useMemo(
    () =>
      Object.values(s.players)
        .filter((p) => p.free_agent && !p.retired && !windowSigned.has(p.id))
        .sort((a, b) => b.overall - a.overall),
    [s.players, windowSigned],
  );

  const capSpace =
    255 -
    (code
      ? teamRoster(s, code).reduce((n, p) => n + (p.contract?.cap_hit_by_year[0] ?? 0), 0)
      : 0);

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
        subtitle={
          isWindowStage
            ? `Live window · Day ${fa?.day ?? 1} of 5`
            : "Standing market · open through the season"
        }
      />
      <Ticker
        stats={[
          isWindowStage
            ? { label: "Time left today", value: seconds(remaining), className: remaining <= 60 ? "urgent" : undefined }
            : { label: "Mode", value: "Standing", className: "sm" },
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

      <Panel open={active === "unsigned"}>
        <div style={{ maxHeight: 440, overflowY: "auto" }}>
          {freeAgents.slice(0, 50).map((p) => {
            const mine = myOffer(p.id);
            const lead = leadOffer(p.id);
            const exp = playerPriorities(p).expectation;
            return (
              <ExpandableRow
                key={p.id}
                gridTemplate="1.7fr 0.45fr 0.5fr 1fr auto 16px"
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

      <Panel open={active === "needs"}>
        {code ? (
          <RosterNeeds roster={teamRoster(s, code)} />
        ) : (
          <div className="emptystate">Pick a team first.</div>
        )}
      </Panel>

      <Panel open={active === "signed"}>
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
          <div className="emptystate">The Signed log updates once per simulated week.</div>
        )}
      </Panel>

      <Footer>
        {(!inWindow || fa?.mode === "standing") && (
          <a className="btnlink" onClick={() => nav(returnLink.to)}>
            {returnLink.label}
          </a>
        )}
        {isWindowStage && inWindow && (
          <button className="btn-primary" onClick={() => advanceDay("players")}>
            Mark ready for next day
          </button>
        )}
        {!isWindowStage && (
          <a className="btnlink" onClick={() => nav("/roster")}>
            Roster &amp; Cap
          </a>
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
          onClose={() => setNegotiating(null)}
          onSubmit={(offer) => {
            const full: ContractOffer = { ...offer, teamCode: code };
            if (isWindowStage) placeOffer("players", negotiating.id, full);
            else signStanding(negotiating.id, full);
            setNegotiating(null);
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
