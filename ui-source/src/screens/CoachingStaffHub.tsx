import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { ContractNegotiation } from "@/components/ContractNegotiation";
import { ExpandableRow, RatingBar } from "@/components/ExpandableRow";
import { RowHeader } from "@/components/ListFilter";
import { useLeagueActions } from "@/state/useLeagueActions";
import { FullScreenOverlay } from "@/components/FullScreenOverlay";
import { Card, CardHeader, Footer, Panel, Tabs, Ticker, useTabs } from "@/components/primitives";
import { ReadinessGate } from "@/components/ReadinessGate";
import { TEAMS_BY_CODE } from "@/data/teams";
import type { Coach, CoachRole, DefenseScheme, OffenseScheme } from "@/domain";
import { SCHEME_LABEL } from "@/domain";
import { HybridSimulationService } from "@/sim/HybridSimulationService";
import { coachPriorities } from "@/sim/priorities";
import { useStore } from "@/state/store";
import { teamRoster, viewerTeamCode } from "@/state/selectors";
import { millions, seconds } from "@/util/format";

const sim = new HybridSimulationService();
const ROLE_LABEL: Record<CoachRole, string> = {
  HC: "Head Coach",
  OC: "Offensive Coordinator",
  DC: "Defensive Coordinator",
};
const schemeLabel = (s: OffenseScheme | DefenseScheme | undefined): string =>
  s ? SCHEME_LABEL[s] : "—";

const COACH_GRID = "1.7fr 0.6fr 0.9fr auto 16px";

export function CoachingStaffHub() {
  const s = useStore();
  const code = viewerTeamCode(s);
  const isHiring = s.stage === "coachingHiring";

  return isHiring ? <HiringWindow key="hire" code={code} /> : <NormalHub key="normal" code={code} />;
}

/* ---- the 5-day coaching-hire free-agency window --------------------- */

function HiringWindow({ code }: { code: string | undefined }) {
  const nav = useNavigate();
  const s = useStore();
  const startBidding = useStore((st) => st.startBidding);
  const actions = useLeagueActions();
  const advanceDay = useStore((st) => st.advanceBiddingDay);
  const dismiss = useStore((st) => st.dismissInterstitial);
  const [roleFilter, setRoleFilter] = useState<"ALL" | CoachRole>("ALL");
  const [negotiating, setNegotiating] = useState<Coach | null>(null);

  useEffect(() => {
    // see FreeAgencyBoard: online this market belongs to the server
    if (actions.online) return;
    if (!s.coachingHire) startBidding("coaches");
  }, [s.coachingHire, startBidding, actions.online]);

  const fa = s.coachingHire;
  const [remaining, setRemaining] = useState(fa?.secondsRemaining ?? 720);
  useEffect(() => setRemaining(fa?.secondsRemaining ?? 720), [fa?.day]);
  useEffect(() => {
    if (!fa || fa.mode !== "main" || fa.interstitialVisible) return;
    const t = setInterval(() => setRemaining((r) => Math.max(0, r - 1)), 1000);
    return () => clearInterval(t);
  }, [fa?.day, fa?.interstitialVisible, fa?.mode]);
  useEffect(() => {
    // see FreeAgencyBoard: online the server turns the day
    if (actions.online) return;
    if (fa && fa.mode === "main" && remaining === 0 && !fa.interstitialVisible) advanceDay("coaches");
  }, [remaining, fa?.interstitialVisible, fa?.mode, advanceDay]);

  const staff = useStaff(code);
  const filledCount = [staff.HC, staff.OC, staff.DC].filter(Boolean).length;
  const signedIds = new Set(fa?.signed.map((x) => x.id) ?? []);
  const open = useMemo(
    () => Object.values(s.coaches).filter((c) => c.team === null && !signedIds.has(c.id)),
    [s.coaches, signedIds],
  );

  if (!code || !fa) {
    return (
      <Card>
        <CardHeader badge="FS" title="Coaching Staff" subtitle="Loading the hiring window…" />
        <div className="panel open">
          <div className="emptystate">Opening the coaching market…</div>
        </div>
      </Card>
    );
  }

  const missing = (["HC", "OC", "DC"] as CoachRole[]).filter((r) => !staff[r]);

  return (
    <Card maxWidth={840}>
      {fa.interstitialVisible && (
        <FullScreenOverlay
          kicker="Coaching hiring window"
          big={`Day ${fa.day}`}
          note="Click anywhere to see the board with the day's hires."
          onDismiss={() => dismiss("coaches")}
        />
      )}

      <CardHeader
        badge={TEAMS_BY_CODE[code]!.abbr}
        title="Coaching Staff"
        subtitle={`Hiring window · Day ${fa.day} of 5 — every team starts with no coaches`}
      />
      <Ticker
        stats={[
          { label: "Time left today", value: seconds(remaining), className: remaining <= 60 ? "urgent" : undefined },
          { label: "Your staff", value: `${filledCount} / 3` },
          { label: "Hires so far", value: fa.signed.length },
          { label: "Still open", value: open.length },
        ]}
      />

      <div className="panel open">
        {missing.length > 0 ? (
          <div className="team-callout" style={{ marginBottom: 14 }} role="status">
            Still need a {missing.map((r) => ROLE_LABEL[r]).join(", ")}. Make offers below — hires resolve at the end
            of each day, and the window closes after Day 5. Any role you haven't filled by then gets assigned from
            whoever's left, so bid for the staff you actually want.
          </div>
        ) : (
          <div
            className="team-callout"
            style={{ marginBottom: 14, color: "var(--good)", background: "rgba(111,200,150,0.08)", borderColor: "rgba(111,200,150,0.35)" }}
            role="status"
          >
            Full staff signed — you can keep browsing, or mark ready to move on.
          </div>
        )}
        <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 14 }}>
          <label style={{ fontSize: 11.5, color: "var(--ink-faint)" }}>Role</label>
          <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value as "ALL" | CoachRole)}>
            <option value="ALL">All roles</option>
            <option value="HC">Head Coach</option>
            <option value="OC">Offensive Coordinator</option>
            <option value="DC">Defensive Coordinator</option>
          </select>
        </div>
        <div className="scroll-list">
          <RowHeader
            gridTemplate={COACH_GRID}
            labels={["Coach", "Tendency", "Leading offer", "", ""]}
          />
          {open.filter((c) => roleFilter === "ALL" || c.role === roleFilter).length === 0 && (
            <div className="emptystate">Every {roleFilter === "ALL" ? "coach" : ROLE_LABEL[roleFilter]} on the market has been hired.</div>
          )}
          {open
            .filter((c) => roleFilter === "ALL" || c.role === roleFilter)
            .slice(0, 120)
            .map((c) => {
              const myOffer = fa.bids[c.id]?.find((o) => o.teamCode === code);
              const lead = [...(fa.bids[c.id] ?? [])].sort(
                (a, b) => b.baseSalary * b.years + b.signingBonus - (a.baseSalary * a.years + a.signingBonus),
              )[0];
              return (
                <ExpandableRow
                  key={c.id}
                  gridTemplate={COACH_GRID}
                  columns={
                    <>
                      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                        <p className="pname">
                          {c.name} <span className="ppos">{c.role}</span>
                        </p>
                        <p style={{ margin: 0, fontSize: 11, color: "var(--ink-faint)" }}>
                          {c.role === "HC" ? `Disc ${c.discipline} · GM ${c.gameManagement}` : `${schemeLabel(c.scheme)} · IQ ${c.playCallIq}`}
                        </p>
                      </div>
                      <span className="pcell">{c.role === "HC" ? `${c.aggressiveness} AGG` : `${c.role === "OC" ? c.tendencyPassRate : c.tendencyBlitzRate}%`}</span>
                      <span style={{ fontSize: 12.5, textAlign: "center", color: myOffer && lead?.teamCode === code ? "var(--good)" : "var(--ink-dim)" }}>
                        {lead ? `${TEAMS_BY_CODE[lead.teamCode]?.abbr ?? lead.teamCode} · ${millions(lead.baseSalary)}/yr` : "No offers"}
                      </span>
                      <button
                        className="btn-primary"
                        style={{ fontSize: 11.5, padding: "7px 8px" }}
                        onClick={(e) => {
                          e.stopPropagation();
                          setNegotiating(c);
                        }}
                      >
                        {myOffer ? "Revise" : "Negotiate"}
                      </button>
                    </>
                  }
                  detail={
                    c.role === "HC" ? (
                      <>
                        <RatingBar label="Discipline" value={c.discipline ?? 0} />
                        <RatingBar label="Game management" value={c.gameManagement ?? 0} />
                        <RatingBar label="Aggressiveness" value={c.aggressiveness ?? 0} />
                      </>
                    ) : (
                      <>
                        <span className="prio-chip" style={{ marginBottom: 12, display: "inline-block" }}>{schemeLabel(c.scheme)}</span>
                        <RatingBar label={c.role === "OC" ? "Play-calling IQ" : "Coverage IQ"} value={c.playCallIq ?? 0} />
                        <RatingBar
                          label={c.role === "OC" ? "Pass tendency" : "Blitz rate"}
                          value={(c.role === "OC" ? c.tendencyPassRate : c.tendencyBlitzRate) ?? 0}
                          suffix="%"
                        />
                      </>
                    )
                  }
                />
              );
            })}
        </div>
      </div>

      <Footer>
        <span style={{ flex: 1, fontSize: 11, color: "var(--ink-faint)", alignSelf: "center" }}>
          {missing.length ? `Still need: ${missing.map((r) => ROLE_LABEL[r]).join(", ")}.` : "Full staff signed."}
        </span>
        {fa.mode === "main" ? (
          <button
            className="btn-primary"
            onClick={() => {
              // online, readying up is what turns the day — the server owns it
              if (actions.online) void actions.readyUp(true);
              else advanceDay("coaches");
            }}
          >
            Mark ready for next day
          </button>
        ) : (
          <button type="button" className="btnlink btn-primary" onClick={() => nav("/hub")}>
            View team hub
          </button>
        )}
      </Footer>

      <ReadinessGate
        title="Coaching window readiness"
        disabled={fa.mode === "main"}
        disabledHint={`Day ${fa.day} of 5 — the hiring window is still open`}
        onAdvance={(r) => nav(r)}
      />

      {negotiating && code && (
        <ContractNegotiation
          title={`Offer — ${negotiating.name}`}
          subtitle={`${ROLE_LABEL[negotiating.role]}${negotiating.scheme ? ` · ${schemeLabel(negotiating.scheme)}` : ""}`}
          priorities={coachPriorities(negotiating)}
          prior={fa.bids[negotiating.id]?.find((o) => o.teamCode === code)}
          onClose={() => setNegotiating(null)}
          onSubmit={(offer) => {
            void actions.placeBid("coaches", negotiating.id, { ...offer, teamCode: code });
            setNegotiating(null);
          }}
        />
      )}
    </Card>
  );
}

/* ---- the normal in-season coaching hub ----------------------------- */

function useStaff(code: string | undefined) {
  const coaches = useStore((s) => s.coaches);
  return useMemo(() => {
    const byRole: Record<CoachRole, Coach | undefined> = { HC: undefined, OC: undefined, DC: undefined };
    for (const c of Object.values(coaches)) if (c.team === code) byRole[c.role] = c;
    return byRole;
  }, [coaches, code]);
}

function NormalHub({ code }: { code: string | undefined }) {
  const nav = useNavigate();
  const s = useStore();
  const { active, setActive } = useTabs("current");
  const staff = useStaff(code);
  const roster = code ? teamRoster(s, code) : [];
  const oc = staff.OC ?? null;
  const dc = staff.DC ?? null;
  const fitRows = roster.slice(0, 12).map((p) => ({ p, fit: sim.computeSchemeFit(p, oc, dc) }));
  const avgFit = fitRows.length ? Math.round(fitRows.reduce((n, r) => n + r.fit, 0) / fitRows.length) : 0;

  if (!code) {
    return (
      <Card>
        <CardHeader badge="FS" title="Coaching Staff" subtitle="No team selected" />
        <div className="panel open">
          <div className="emptystate">Pick a team first.</div>
        </div>
      </Card>
    );
  }

  return (
    <Card maxWidth={820}>
      <CardHeader
        badge={TEAMS_BY_CODE[code]!.abbr}
        title="Coaching Staff"
        subtitle={`${TEAMS_BY_CODE[code]!.label} · Front office`}
      />
      <Ticker
        stats={[
          { label: "Offensive scheme", value: schemeLabel(oc?.scheme), className: "sm" },
          { label: "Defensive scheme", value: schemeLabel(dc?.scheme), className: "sm" },
          { label: "Avg scheme fit", value: `${avgFit}%`, className: avgFit >= 70 ? "good" : undefined },
          { label: "Staff", value: `${[staff.HC, staff.OC, staff.DC].filter(Boolean).length} / 3` },
        ]}
      />
      <Tabs
        tabs={[
          { id: "current", label: "Current Staff" },
          { id: "fit", label: "Scheme Fit" },
        ]}
        active={active}
        onChange={setActive}
      />
      <Panel id="current" open={active === "current"}>
        {(["HC", "OC", "DC"] as CoachRole[]).map((role) => {
          const c = staff[role];
          return (
            <div key={role} style={{ background: "var(--panel-sunken)", border: "1px solid var(--line)", borderRadius: "var(--r-md)", padding: 18, marginBottom: 16 }}>
              <div style={{ marginBottom: 14 }}>
                <p style={{ margin: 0, fontSize: 10.5, color: "var(--ink-faint)", textTransform: "uppercase", letterSpacing: "0.03em", fontWeight: 600 }}>
                  {ROLE_LABEL[role]}
                </p>
                <p style={{ margin: "2px 0 0", fontSize: 15, fontWeight: 600 }}>{c?.name ?? "Vacant"}</p>
                <p style={{ margin: "2px 0 0", fontSize: 11.5, color: "var(--ink-dim)" }}>
                  {c?.contract ? `${c.contract.yearsRemaining} yrs · ${millions(c.contract.annualValue)}/yr` : "Open position"}
                </p>
              </div>
              {c && role === "HC" && (
                <>
                  <RatingBar label="Discipline" value={c.discipline ?? 0} />
                  <RatingBar label="Game management" value={c.gameManagement ?? 0} />
                  <RatingBar label="Aggressiveness" value={c.aggressiveness ?? 0} />
                </>
              )}
              {c && role !== "HC" && (
                <>
                  <span className="prio-chip" style={{ display: "inline-block", marginBottom: 12 }}>{schemeLabel(c.scheme)}</span>
                  <RatingBar label={role === "OC" ? "Play-calling IQ" : "Coverage IQ"} value={c.playCallIq ?? 0} />
                  <RatingBar
                    label={role === "OC" ? "Pass tendency" : "Blitz rate"}
                    value={(role === "OC" ? c.tendencyPassRate : c.tendencyBlitzRate) ?? 0}
                    suffix="%"
                  />
                </>
              )}
            </div>
          );
        })}
      </Panel>
      <Panel id="fit" open={active === "fit"}>
        <p style={{ margin: "0 0 14px", fontSize: 11.5, color: "var(--ink-faint)" }}>
          Against current schemes: {oc ? schemeLabel(oc.scheme) : "no OC"} (offense), {dc ? schemeLabel(dc.scheme) : "no DC"} (defense)
        </p>
        <table className="stbl">
          <thead>
            <tr>
              <th>Player</th>
              <th className="c">Pos</th>
              <th className="c">Fit</th>
            </tr>
          </thead>
          <tbody>
            {fitRows.map(({ p, fit }) => (
              <tr key={p.id}>
                <td className="name">{p.name}</td>
                <td className="c">{p.position}</td>
                <td className="c" style={{ fontWeight: 600, color: fit >= 75 ? "var(--good)" : fit >= 60 ? "var(--notice)" : "var(--bad)" }}>
                  {fit}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
      <Footer>
        <button type="button" className="btnlink btn-primary" onClick={() => nav("/hub")}>
          Return to team hub
        </button>
      </Footer>
    </Card>
  );
}
