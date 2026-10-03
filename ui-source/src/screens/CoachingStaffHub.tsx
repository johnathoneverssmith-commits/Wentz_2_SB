import { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { RatingBar } from "@/components/ExpandableRow";
import { useLeagueActions } from "@/state/useLeagueActions";
import { Card, CardHeader, Footer, Panel, Tabs, Ticker, useTabs } from "@/components/primitives";
import { TEAMS_BY_CODE } from "@/data/teams";
import type { Coach, CoachRole, DefenseScheme, OffenseScheme } from "@/domain";
import { COACH_POSITION_GROUPS, COACH_ROLES, COACH_ROLE_LABEL, DEVELOPMENT_ROLES, SCHEME_LABEL } from "@/domain";
import { HybridSimulationService } from "@/sim/HybridSimulationService";
import { useStore } from "@/state/store";
import { teamRoster, viewerTeamCode } from "@/state/selectors";
import { millions, posLabel } from "@/util/format";

const sim = new HybridSimulationService();
// the twelve-role table now lives in the domain, with the position groups
const ROLE_LABEL = COACH_ROLE_LABEL;
const schemeLabel = (s: OffenseScheme | DefenseScheme | undefined): string =>
  s ? SCHEME_LABEL[s] : "—";
/** The number a role is judged on: game management for a head coach, play-calling for a coordinator. */
const headline = (c: Coach): number => (c.role === "HC" ? (c.gameManagement ?? 0) : (c.playCallIq ?? 0));

/**
 * Your staff, and the coaches you could hire instead.
 *
 * This used to open into a five-day sealed-bid hiring window that ran once a
 * year at a fixed point in the calendar, with a twelve-minute clock per day.
 * Teams started with nobody and bid against each other to fill three jobs.
 * That window is gone: every team begins with the staff it actually has, and
 * changing a coach is something you do when you want to, from here.
 */
export function CoachingStaffHub() {
  const s = useStore();
  return <NormalHub code={viewerTeamCode(s)} />;
}

function useStaff(code: string | undefined) {
  const coaches = useStore((s) => s.coaches);
  return useMemo(() => {
    const byRole = Object.fromEntries(COACH_ROLES.map((r) => [r, undefined])) as Record<
      CoachRole,
      Coach | undefined
    >;
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
  const actions = useLeagueActions();
  // the server's own rule (`refuseDuringBlock`): a block's games are played
  const hiringClosed = actions.online && (s.stage === "preseason" || s.stage === "regularSeason");
  const [hiring, setHiring] = useState(false);
  const hiringRef = useRef(false);
  const [hireError, setHireError] = useState<string | null>(null);
  const openCoaches = useMemo(
    () =>
      Object.values(s.coaches)
        .filter((c) => c.team === null)
        // by role, then each role's own headline rating: head coaches used to
        // be ranked by the coordinators' play-calling number
        .sort(
          (a, b) =>
            COACH_ROLES.indexOf(a.role) - COACH_ROLES.indexOf(b.role) || headline(b) - headline(a),
        ),
    [s.coaches],
  );
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
          { label: "Staff", value: `${COACH_ROLES.filter((r) => staff[r]).length} / ${COACH_ROLES.length}` },
        ]}
      />
      <Tabs
        tabs={[
          { id: "current", label: "Current Staff" },
          { id: "fit", label: "Scheme Fit" },
          { id: "market", label: `Available (${openCoaches.length})` },
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
                  <RatingBar label="Play-calling IQ" /* the same number the rest of the game calls play-calling; "Coverage IQ" read as a second rating */ value={c.playCallIq ?? 0} />
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
        {/* The nine development coaches a GM drafts alongside the big three
            used to appear nowhere after the coaching draft — the staff read
            "3 / 3" with nine hires missing from it. */}
        <p className="subhead" style={{ margin: "4px 0 10px" }}>
          Development staff
        </p>
        <table className="stbl">
          <thead>
            <tr>
              <th>Role</th>
              <th>Coach</th>
              <th>Works with</th>
              <th className="c">OVR</th>
              <th className="r">Contract</th>
            </tr>
          </thead>
          <tbody>
            {DEVELOPMENT_ROLES.map((role) => {
              const c = staff[role];
              return (
                <tr key={role}>
                  <td>{COACH_ROLE_LABEL[role]}</td>
                  <td>{c?.name ?? "Vacant"}</td>
                  <td style={{ color: "var(--ink-dim)" }}>
                    {role === "MED" ? "Injury recovery" : (COACH_POSITION_GROUPS[role] ?? []).join(", ")}
                  </td>
                  <td className="c">{c?.overall ?? "—"}</td>
                  <td className="r" style={{ color: "var(--ink-dim)" }}>
                    {c?.contract ? `${c.contract.yearsRemaining}y · ${millions(c.contract.annualValue)}` : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
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
                <td className="c">{posLabel(p.position)}</td>
                <td className="c" style={{ fontWeight: 600, color: fit >= 75 ? "var(--good)" : fit >= 60 ? "var(--notice)" : "var(--bad)" }}>
                  {fit}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
      <Panel id="market" open={active === "market"}>
        {hiringClosed && (
          <div className="notice" role="status" style={{ marginBottom: 12 }}>
            Hiring is closed while this stretch of the season plays out — its games are already
            decided with today&rsquo;s staff. It opens again at the next break.
          </div>
        )}
        <p style={{ margin: "0 0 14px", fontSize: 11.5, color: "var(--ink-faint)", lineHeight: 1.6 }}>
          Coaches without a job. Hiring one replaces whoever holds that role on your staff, and
          sends him back to this list.{" "}
          {/* it said "do it whenever" directly under "hiring is closed" */}
          {actions.online
            ? "Any break between stretches of games will do — there's no deadline."
            : "There is no window and no deadline — do it whenever."}
        </p>
        {hireError && (
          <div className="notice bad" role="status">
            {hireError}
          </div>
        )}
        {openCoaches.length === 0 ? (
          <div className="emptystate">Every coach in the league is under contract.</div>
        ) : (
          openCoaches.map((c) => (
            <div key={c.id} className="lobby-row">
              <div>
                <p className="pname">
                  {c.name}
                  <span className="ppos">{c.role}</span>
                </p>
                <p className="lobby-sub">
                  {ROLE_LABEL[c.role]}
                  {c.scheme ? ` · ${schemeLabel(c.scheme)}` : ""}
                  {c.role === "HC"
                    ? ` · game mgmt ${c.gameManagement ?? "—"}, discipline ${c.discipline ?? "—"}`
                    : ` · play-calling ${c.playCallIq ?? "—"}`}
                </p>
                {/* against the man he'd replace */}
                {(() => {
                  const now = staff[c.role];
                  if (!now) return <p className="lobby-sub">Fills your vacant {ROLE_LABEL[c.role].toLowerCase()} job.</p>;
                  const d = headline(c) - headline(now);
                  return (
                    <p className="lobby-sub" style={{ color: d > 0 ? "var(--good)" : d < 0 ? "var(--bad)" : undefined }}>
                      Replaces {now.name} ({d > 0 ? "+" : ""}
                      {d} on {c.role === "HC" ? "game management" : "play-calling"})
                    </p>
                  );
                })()}
              </div>
              <div className="lobby-actions">
                <button
                  type="button"
                  className="btn-primary"
                  // closed buttons used to ask "let him go?" and then be refused
                  disabled={hiring || hiringClosed}
                  title={hiringClosed ? "Hiring opens again at the next break." : undefined}
                  onClick={() => {
                    if (hiringRef.current) return;
                    // it fires whoever holds the job, on the spot
                    const now = staff[c.role];
                    if (now && !confirm(`Hire ${c.name} as ${ROLE_LABEL[c.role].toLowerCase()}? ${now.name} is let go.`)) return;
                    hiringRef.current = true;
                    setHiring(true);
                    setHireError(null);
                    void actions
                      .hireCoach(c.id)
                      .then((res) => {
                        if (!res.ok) setHireError(res.reason ?? "That hire didn't go through.");
                      })
                      .finally(() => {
                        hiringRef.current = false;
                        setHiring(false);
                      });
                  }}
                >
                  Hire as {c.role}
                </button>
              </div>
            </div>
          ))
        )}
      </Panel>
      <Footer>
        <button type="button" className="btnlink btn-primary" onClick={() => nav("/hub")}>
          Return to team hub
        </button>
      </Footer>
    </Card>
  );
}
