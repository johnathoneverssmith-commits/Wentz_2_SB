import { pruneComparison } from "@/components/decisions/decision-view";
import { DecisionFrame, DecisionHeading, DecisionComparison, CompareToggle, DecisionSortControl, toggleComparison, FocusedOfferPanel } from "@/components/decisions/DecisionWorkspace";
import { publicDecisionRow, sortDecisionRows, type DecisionSort } from "@/components/decisions/decision-view";
import { RosterFinance } from "@/components/roster/RosterFinance";
import { useEffect, useMemo, useRef, useState } from "react";
import { StaggerList } from "@/motion/Stagger";
import { careerArc } from "@/state/careerArc";
import { useNavigate } from "react-router-dom";

import { OvrPill, TeamBadge } from "@/components/bits";
import { FitTag } from "@/components/FitTag";
import { fitFor } from "@/state/unitReport";
import { standingAsk } from "@/state/rules";
import { InlineNegotiation } from "@/components/ContractNegotiation";
import { ExpandableRow } from "@/components/ExpandableRow";
import { RowHeader, useListFilter } from "@/components/ListFilter";
import { FullScreenOverlay } from "@/components/FullScreenOverlay";
import { Card, Footer, Panel, Tabs, Ticker, useTabs } from "@/components/primitives";
import { ReadinessGate } from "@/components/ReadinessGate";
import { TEAMS_BY_CODE } from "@/data/teams";
import type { ContractOffer, Player } from "@/domain";
import { playerPriorities } from "@/sim/priorities";
import { RosterNeeds } from "@/components/RosterNeeds";
import { useStore } from "@/state/store";
import { useLeagueActions } from "@/state/useLeagueActions";
import { teamRoster, viewerTeamCode } from "@/state/selectors";
import { millions, posLabel, seconds } from "@/util/format";

export function FreeAgencyBoard() {
  const nav = useNavigate();
  const s = useStore();
  const { active, setActive } = useTabs("unsigned");
  const code = viewerTeamCode(s);
  // one interface over "spend locally" and "ask the server"; identical
  // shapes, and the only difference a screen sees is that online a refusal
  // arrives after a round trip against the league as it is *now*
  const actions = useLeagueActions();
  // online, a block of weeks is already played (the server's `refuseDuringBlock`)
  const signingsClosed = actions.online && (s.stage === "preseason" || s.stage === "regularSeason");

  const advanceDay = useStore((st) => st.advanceBiddingDay);
  const dismiss = useStore((st) => st.dismissInterstitial);

  // while the turn-based market runs, it is the free-agency screen: this
  // standing board would only offer signings the market has closed
  const marketRunning =
    (s.stage === "freeAgency" || s.stage === "midseasonFreeAgency") &&
    !!s.freeAgencyEvent &&
    !s.freeAgencyEvent.complete;
  useEffect(() => {
    if (marketRunning) nav("/free-agency-board", { replace: true });
  }, [marketRunning, nav]);

  const isWindowStage = s.stage === "offseasonFreeAgency";
  const [displaySort,setDisplaySort] = useState<DecisionSort>("board");
  const [compared,setCompared] = useState<string[]>([]);
  const [boardLimit,setBoardLimit] = useState(120);
  const [negotiating, setNegotiating] = useState<Player | null>(null);
  const [signError, setSignError] = useState<string | null>(null);
  // the guard itself: state lags a render, so two quick clicks both passed it
  const submittingRef = useRef(false);

  // The five-day sealed-bid window is gone. `offseasonFreeAgency` is no longer
  // a stage the league passes through, so `isWindowStage` is false and this
  // screen is the standing market — open all year, signings resolve at once,
  // no clock. `inWindow` survives only so a league that was mid-window when
  // this shipped still renders its last day correctly.
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
    // online the day is the server's to turn: every client runs its own
    // countdown, and the first to hit zero would resolve a day the others
    // were still bidding in. There it turns when every GM is ready, or when
    // the phase clock runs out.
    if (actions.online) return;
    if (inWindow && remaining === 0 && !fa?.interstitialVisible) advanceDay("players");
  }, [inWindow, remaining, fa?.interstitialVisible, advanceDay, actions.online]);

  // what each free agent would add to your starting units
  const fit = useMemo(() => (code ? fitFor({ players: s.players }, code) : null), [s.players, code]);

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
  const sorted = useMemo(()=>sortDecisionRows(freeAgents.map(p=>({...p,rating:p.overall})),displaySort),[freeAgents,displaySort]);
  const market = useListFilter(sorted,boardLimit);
  const publicRows = freeAgents.map(p=>publicDecisionRow(p,`${careerArc(p).label} · asks ${millions(isWindowStage ? playerPriorities(p).expectation.baseSalary : standingAsk(s,p))}/yr`));
  useEffect(()=>setCompared(ids=>pruneComparison(ids,freeAgents)),[freeAgents]);

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

  useEffect(()=>{if(signingsClosed||!freeAgents.some(p=>p.id===negotiating?.id))setNegotiating(null);},[signingsClosed,freeAgents,negotiating?.id]);

  const negotiationFor = (p:Player) => (
                    <InlineNegotiation
                      priorities={
                        isWindowStage
                          ? playerPriorities(p)
                          : // in season his price falls week by week (`standingAsk`) —
                            // and the bonus and guarantee fall with it: kept at
                            // his opening price, a $3.9M-a-year ask "expected"
                            // $19.1M guaranteed, more than the whole deal paid
                            (() => {
                              const opening = playerPriorities(p);
                              const ask = standingAsk(s, p);
                              const scale = opening.expectation.baseSalary > 0 ? ask / opening.expectation.baseSalary : 1;
                              const r1 = (n: number) => Math.round(n * 10) / 10;
                              return {
                                ...opening,
                                expectation: {
                                  ...opening.expectation,
                                  baseSalary: ask,
                                  signingBonus: r1(opening.expectation.signingBonus * scale),
                                  guaranteed: r1(opening.expectation.guaranteed * scale),
                                },
                              };
                            })()
                      }
                      prior={myOffer(p.id)}
                      error={signError}
                      onClose={() => {
                        setSignError(null);
                        setNegotiating(null);
                      }}
                      onSubmit={(offer) => {
                        // one in flight: a double click signed him and then
                        // reported that he'd "just signed" with your own team
                        if (submittingRef.current) return;
                        submittingRef.current = true;
                        const full: ContractOffer = { ...offer, teamCode: code! };
                        const run = isWindowStage
                          ? actions.placeBid("players", p.id, full)
                          : actions.signFreeAgent(p.id, full);
                        void run
                          .finally(() => {
                            submittingRef.current = false;
                          })
                          .then((result) => {
                          if (result.ok) {
                            setSignError(null);
                            setNegotiating(null);
                          } else {
                            setSignError(
                              result.reason ??
                                (isWindowStage ? "Unable to bid on this player." : "Unable to sign this player."),
                            );
                          }
                        });
                      }}
                    />
  );

  return (
    <DecisionFrame kind="market" code={code} focused={!!negotiating}><Card maxWidth={1440}>
      {isWindowStage && fa?.interstitialVisible && (
        <FullScreenOverlay
          kicker="Free agency"
          big={`Day ${fa.day}`}
          note="Tap or click anywhere to see the board with today's signings."
          onDismiss={() => dismiss("players")}
        />
      )}

      <DecisionHeading code={code} title="Free Agency" subtitle={inWindow ? `Live window · Day ${fa?.day ?? 1} of 5` : isWindowStage ? "Window closed · open market until the season starts" : "Standing market · open through the season"}/>
      {/* online the block's weeks are already played: the server refuses a
          signing that would read as help for them */}
      {signingsClosed && (
        <div className="notice" role="status">
          Signings are closed while this stretch of the season plays out — its games are already
          decided. The market opens again at the next break.
        </div>
      )}
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

      <div className="decision-layout"><div className="decision-main">
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
        <div className="decision-toolbar">{market.controls}<DecisionSortControl value={displaySort} onChange={setDisplaySort}/></div>
        {freeAgents.length > 0 && market.matched === 0 && (
          <div className="emptystate">
            Nobody on the market matches that. Clear the search or pick another position.
          </div>
        )}
        <StaggerList className="scroll-list fa-list">
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
                open={negotiating?.id === p.id ? true : undefined}
                onOpenChange={(o) => {
                  if (!o) {
                    setSignError(null);
                    setNegotiating(null);
                  }
                }}
                columns={
                  <>
                    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                      <p className="pname">
                        {p.name} <span className="ppos">{posLabel(p.position)}</span>
                        {fit && <FitTag fit={fit(p.position, p.overall)} />}
                      </p>
                      <p style={{ margin: 0, fontSize: 11, color: "var(--ink-faint)" }}>
                        Age {p.age}{" "}
                        <span style={{ color: careerArc(p).color }} title={careerArc(p).hint}>
                          ({careerArc(p).label})
                        </span>{" "}
                        · wants ~{millions(isWindowStage ? exp.baseSalary : standingAsk(s, p))}/yr
                      </p>
                    </div>
                    <span><OvrPill value={p.overall}/><CompareToggle row={publicRows.find(row=>row.id===p.id)!} selected={compared} onToggle={id=>setCompared(ids=>toggleComparison(ids,id))}/></span>
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
                      // every row offered a negotiation the server would refuse
                      disabled={signingsClosed}
                      title={signingsClosed ? "Signings open again at the next break." : undefined}
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
                  negotiating?.id === p.id && code ? (
                    <p className="decision-muted">Offer controls are open in the player workspace.</p>
                  ) : (
                    <>
                      {isWindowStage &&
                        bidsFor(p.id)
                          .sort((a, b) => b.baseSalary * b.years - a.baseSalary * a.years)
                          .map((o, i) => (
                            <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: "1px solid var(--line)", fontSize: 12 }}>
                              <span style={{ color: o.teamCode === code ? "var(--good)" : "var(--ink-dim)", fontWeight: o.teamCode === code ? 600 : 400 }}>
                                {TEAMS_BY_CODE[o.teamCode]?.label ?? o.teamCode}
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
                  )
                }
              />
            );
          })}
        </StaggerList>
        {market.matched>boardLimit&&<button type="button" onClick={()=>setBoardLimit(n=>n+120)}>Show more players</button>}
        {isWindowStage && (
          <p style={{ margin: "16px 0 0", fontSize: 11, color: "var(--ink-faint)", textAlign: "center" }}>
            Free agents can be signed at any time; there is no window and no deadline.
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
                      {p?.name ?? sg.id} <span style={{ fontSize: 12, color: "var(--ink-dim)" }}>· {posLabel(p?.position)}</span>
                    </p>
                    <span style={{ fontSize: 12, color: "var(--ink-dim)" }}>
                      <TeamBadge code={sg.toTeam} size={16} /> {TEAMS_BY_CODE[sg.toTeam]?.label ?? sg.toTeam} · Day {sg.at}
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

      </div><aside className="decision-sidebar" aria-label="Standing market player workspace">
        {negotiating&&code&&freeAgents.some(p=>p.id===negotiating.id) ? <FocusedOfferPanel key={negotiating.id} title={negotiating.name}><p>{negotiating.position} · {negotiating.overall} OVR · Age {negotiating.age}</p>{negotiationFor(freeAgents.find(p=>p.id===negotiating.id)!)}</FocusedOfferPanel> : <section className="decision-context"><h2>Build your roster</h2><p>{inWindow ? "Bids settle as this free-agency window advances. Review the leading offer before committing." : "Negotiate salary, years and guarantees. Standing-market signings are immediate; cap and roster limits still apply."}</p></section>}
        <DecisionComparison rows={publicRows} ids={compared} onClear={()=>setCompared([])}/>
        {code&&s.teams[code]&&<RosterFinance total={s.teams[code]!.cap.total} used={s.teams[code]!.cap.used} room={capSpace} dead={s.teams[code]!.cap.dead}/>}
      </aside></div>
    </Card></DecisionFrame>
  );
}

function bidsCount(fa: LeagueFA, code: string | undefined): number {
  if (!fa || !code) return 0;
  return Object.values(fa.bids).filter((list) => list.some((o) => o.teamCode === code)).length;
}
type LeagueFA = ReturnType<typeof useStore.getState>["freeAgency"];
