import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { OvrPill } from "@/components/bits";
import { ContractNegotiation } from "@/components/ContractNegotiation";
import { ExpandableRow } from "@/components/ExpandableRow";
import { Card, CardHeader, Footer, Panel, Tabs, Ticker, useTabs } from "@/components/primitives";
import { ReadinessGate } from "@/components/ReadinessGate";
import { TEAMS_BY_CODE } from "@/data/teams";
import {
  POSITION_GROUPS,
  POSITION_TO_GROUP,
  type Player,
  type Position,
  type PositionGroup,
} from "@/domain";
import { useStore } from "@/state/store";
import { HybridSimulationService } from "@/sim/HybridSimulationService";
import { playerPriorities } from "@/sim/priorities";
import { extensionAsk, previewRestructure } from "@/state/contracts";
import { depthAt } from "@/state/seed";
import { teamRoster, viewerTeamCode } from "@/state/selectors";
import { millions } from "@/util/format";

const sim = new HybridSimulationService();

const GROUP_LABEL: Record<PositionGroup, string> = {
  QB: "Quarterback", RB: "Running back", WR: "Wide receiver", TE: "Tight end",
  OL: "Offensive line", DL: "Defensive line", EDGE: "Edge rusher", LB: "Linebacker",
  CB: "Cornerback", S: "Safety", K: "Kicker", P: "Punter",
};

export function RosterCapManagement() {
  const nav = useNavigate();
  const s = useStore();
  const { active, setActive } = useTabs("roster");
  const [group, setGroup] = useState<PositionGroup>("QB");
  const [confirming, setConfirming] = useState<string | null>(null);
  const [extending, setExtending] = useState<Player | null>(null);
  const [extendError, setExtendError] = useState<string | null>(null);
  const [moveNote, setMoveNote] = useState<{ id: string; ok: boolean; text: string } | null>(null);
  const code = viewerTeamCode(s);
  const isDepthChartStage = s.stage === "offseasonDepthChart";
  const back = s.returnTo
    ? { to: s.returnTo, label: "Return to retirements" }
    : { to: isDepthChartStage ? "/" : "/hub", label: isDepthChartStage ? "Back to stage" : "Return to team hub" };

  const roster = useMemo(() => (code ? teamRoster(s, code) : []), [s, code]);
  const team = code ? s.teams[code] : undefined;
  const staff = Object.values(s.coaches).filter((c) => c.team === code);
  const oc = staff.find((c) => c.role === "OC") ?? null;
  const dc = staff.find((c) => c.role === "DC") ?? null;

  if (!code || !team) {
    return (
      <Card>
        <CardHeader badge="FS" title="Roster & Cap" subtitle="No team selected" />
        <div className="panel open">
          <div className="emptystate">Pick a team in League Setup first.</div>
        </div>
      </Card>
    );
  }

  // the store's own cap figures (players + coaching staff) — the same numbers
  // the signing checks use, so this screen never disagrees with them
  const capUsed = team.cap.used;
  const capTotalM = team.cap.total;
  const capSpace = Math.round((capTotalM - capUsed) * 10) / 10;
  const staffCap = Object.values(s.coaches)
    .filter((c) => c.team === code)
    .reduce((n, c) => n + (c.contract?.annualValue ?? 0), 0);

  // Depth is per position, not per group: "OL" covers three of them, and a
  // left tackle isn't competing with a centre for a spot.
  const positionsInGroup = (Object.keys(POSITION_TO_GROUP) as Position[]).filter(
    (pos) => POSITION_TO_GROUP[pos] === group,
  );
  const ordered = positionsInGroup.flatMap((pos) => depthAt(s, code, pos));

  /** Move a player one place up or down the chart at his own position. */
  const nudge = (p: Player, by: -1 | 1): void => {
    const line = depthAt(s, code, p.position).map((x) => x.id);
    const i = line.indexOf(p.id);
    const j = i + by;
    if (i < 0 || j < 0 || j >= line.length) return;
    [line[i], line[j]] = [line[j]!, line[i]!];
    s.setDepthOrder(code, p.position, line);
  };
  const lineAt = (pos: Position) => ordered.filter((x) => x.position === pos);

  const needs = POSITION_GROUPS.map((g) => {
    const players = roster.filter((p) => POSITION_TO_GROUP[p.position] === g);
    const top = players[0]?.overall ?? 0;
    const depth = players.length;
    if (depth === 0) return { g, reason: "No players on the roster" };
    if (top < 72) return { g, reason: `Weak starter (${top} OVR), no upgrade in house` };
    if (depth < 2 && g !== "K" && g !== "P") return { g, reason: "Starter only, no depth" };
    return null;
  }).filter(Boolean) as Array<{ g: PositionGroup; reason: string }>;

  const capByUnit = {
    offense: roster.filter((p) => ["QB", "RB", "WR", "TE", "OT", "OG", "C"].includes(p.position)).reduce((n, p) => n + (p.contract?.cap_hit_by_year[0] ?? 0), 0),
    defense: roster.filter((p) => ["EDGE", "DT", "ILB", "OLB", "CB", "S"].includes(p.position)).reduce((n, p) => n + (p.contract?.cap_hit_by_year[0] ?? 0), 0),
    special: roster.filter((p) => ["K", "P"].includes(p.position)).reduce((n, p) => n + (p.contract?.cap_hit_by_year[0] ?? 0), 0),
  };

  return (
    <Card maxWidth={820}>
      <CardHeader
        badge={TEAMS_BY_CODE[code]!.abbr}
        title="Roster & Cap"
        subtitle={`${TEAMS_BY_CODE[code]!.city} · ${isDepthChartStage ? "Re-order the depth chart" : "Roster management"}`}
        action={
          <button className="btn-ghost" onClick={() => nav("/trade")}>
            Propose trade
          </button>
        }
      />
      <Ticker
        stats={[
          { label: "Roster strength", value: `${team.ratings.overallRank} of 32`, className: team.ratings.overallRank <= 12 ? "good" : undefined },
          { label: "Cap space", value: millions(capSpace), className: capSpace >= 0 ? "good" : "bad" },
          { label: "Cap used", value: millions(capUsed), className: "sm" },
          {
            // the 53-man target makes the gap legible — teams are topped up
            // to their starters only, the rest is yours to sign
            label: "Roster",
            value: (
              <>
                {roster.length}
                <span style={{ fontSize: 12, color: "var(--ink-faint)", fontWeight: 400 }}> / 53</span>
              </>
            ),
            className: roster.length < 46 || roster.length > 53 ? "bad" : undefined,
          },
        ]}
      />
      {(capSpace < 0 || roster.length > 53) && (
        <div className="notice bad" role="status">
          <strong>Not season-legal yet.</strong>{" "}
          {[
            capSpace < 0 ? `${millions(-capSpace)} over the cap` : null,
            roster.length > 53 ? `${roster.length - 53} over the 53-man limit` : null,
          ]
            .filter(Boolean)
            .join(" and ")}
          . Release players below to get compliant — otherwise your staff makes
          the cuts for you when the league advances to the preseason.
        </div>
      )}
      <Tabs
        tabs={[
          { id: "roster", label: "Roster" },
          { id: "cap", label: "Cap table" },
          { id: "needs", label: "Positional needs" },
        ]}
        active={active}
        onChange={setActive}
      />

      <Panel open={active === "roster"}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, marginBottom: 16, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <label style={{ fontSize: 11.5, color: "var(--ink-faint)" }}>Position</label>
            <select value={group} onChange={(e) => setGroup(e.target.value as PositionGroup)}>
              {POSITION_GROUPS.map((g) => (
                <option key={g} value={g}>
                  {GROUP_LABEL[g]}
                </option>
              ))}
            </select>
          </div>
          <button onClick={() => positionsInGroup.forEach((pos) => s.setDepthOrder(code, pos, []))}>
            Auto-reorder by overall
          </button>
        </div>

        {ordered.length === 0 ? (
          <div className="emptystate">No players in this group.</div>
        ) : (
          ordered.map((p) => (
            <ExpandableRow
              key={p.id}
              gridTemplate="28px 1.5fr 0.5fr 0.5fr 0.7fr 0.9fr 16px"
              columns={
                <>
                  <span className="rank-num">{lineAt(p.position).indexOf(p) + 1}</span>
                  <span className="pname">
                    {p.name} <span className="ppos">{p.position}</span>
                  </span>
                  <OvrPill value={p.overall} />
                  <span className="pcell">{p.age}</span>
                  <span className="pcell">{p.contract ? `${p.contract.years_remaining}y` : "FA"}</span>
                  <span style={{ fontSize: 13, textAlign: "right", fontWeight: 500 }}>
                    {p.contract ? millions(p.contract.cap_hit_by_year[0] ?? 0) : "—"}
                  </span>
                </>
              }
              detail={
                <>
                  <div className="grid4">
                    <div>
                      <p>{s.season} cap hit</p>
                      <p>{p.contract ? millions(p.contract.cap_hit_by_year[0] ?? 0) : "—"}</p>
                    </div>
                    <div>
                      <p>Years left</p>
                      <p>{p.contract?.years_remaining ?? 0}</p>
                    </div>
                    <div>
                      <p>Guaranteed</p>
                      <p>{p.contract ? millions(p.contract.guaranteed) : "—"}</p>
                    </div>
                    <div>
                      <p>Scheme fit</p>
                      {/* computed against the coordinators this team has right
                          now, not a number frozen into the player: a hiring
                          window changes every fit on the roster, and the
                          engine's pool carries no `scheme_fit` at all, so the
                          stored field read "—%" for every real player. */}
                      <p>{sim.computeSchemeFit(p, oc, dc)}%</p>
                    </div>
                  </div>
                  <div className="actions">
                    <button
                      onClick={() => nudge(p, -1)}
                      disabled={lineAt(p.position)[0]?.id === p.id}
                      title={`Move up the ${p.position} depth chart`}
                    >
                      Move up
                    </button>
                    <button
                      onClick={() => nudge(p, 1)}
                      disabled={lineAt(p.position).at(-1)?.id === p.id}
                      title={`Move down the ${p.position} depth chart`}
                    >
                      Move down
                    </button>
                    <button
                      onClick={() => {
                        const r = s.restructurePlayer(p.id);
                        setMoveNote({
                          id: p.id,
                          ok: r.ok,
                          text: r.ok
                            ? `Restructured — ${millions(r.freed ?? 0)} off this year's cap, moved into the rest of the deal.`
                            : (r.reason ?? "Couldn't restructure that deal."),
                        });
                      }}
                      disabled={!previewRestructure(p).ok}
                      title={previewRestructure(p).reason ?? "Convert salary to bonus: cheaper now, dearer later"}
                    >
                      Restructure
                    </button>
                    <button onClick={() => setExtending(p)}>Extend</button>
                    {confirming === p.id ? (
                      <>
                        <button className="btn-danger" onClick={() => { s.releasePlayer(p.id); setConfirming(null); }}>
                          Confirm release
                        </button>
                        <button onClick={() => setConfirming(null)}>Keep him</button>
                      </>
                    ) : (
                      <button className="btn-danger" onClick={() => setConfirming(p.id)}>
                        Release
                      </button>
                    )}
                  </div>
                  <p
                    className={moveNote?.id === p.id && !moveNote.ok ? "form-error" : undefined}
                    style={
                      moveNote?.id === p.id && !moveNote.ok
                        ? { margin: "8px 0 0", fontSize: 11.5 }
                        : { margin: "8px 0 0", fontSize: 11, color: "var(--ink-faint)" }
                    }
                  >
                    {moveNote?.id === p.id
                      ? moveNote.text
                      : confirming === p.id
                        ? `Releasing ${p.name} frees ${millions(p.contract?.cap_hit_by_year[0] ?? 0)} and sends him to the free agent market. This can't be undone.`
                        : "A restructure moves money into later years; it doesn't make it go away. Releasing a player frees his full cap hit — there's no dead money in this build."}
                  </p>
                </>
              }
            />
          ))
        )}
      </Panel>

      <Panel open={active === "cap"}>
        <p className="sectionlabel">Cap allocation</p>
        <CapBar label="Offense" value={capByUnit.offense} max={capUsed} />
        <CapBar label="Defense" value={capByUnit.defense} max={capUsed} />
        <CapBar label="Special teams" value={capByUnit.special} max={capUsed} />
        <p style={{ margin: "16px 0 0", fontSize: 11, color: "var(--ink-faint)" }}>
          Coaching staff costs {millions(staffCap)}/yr, paid outside the player cap.
        </p>
        <p className="sectionlabel" style={{ marginTop: 22 }}>
          Cap summary
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", background: "var(--panel-sunken)", border: "1px solid var(--line)", borderRadius: "var(--r-md)", overflow: "hidden" }}>
          <ProjCell label="Cap total" value={millions(capTotalM)} />
          <ProjCell label="Cap used" value={millions(capUsed)} />
          <ProjCell label="Cap space" value={millions(capSpace)} />
        </div>
      </Panel>

      <Panel open={active === "needs"}>
        <p className="sectionlabel" style={{ marginBottom: 4 }}>
          Positions needing attention
        </p>
        <p style={{ margin: "0 0 16px", fontSize: 11, color: "var(--ink-faint)" }}>
          Only spots below roster-health thresholds are listed.
        </p>
        {needs.length === 0 ? (
          <div className="emptystate">No positional needs flagged.</div>
        ) : (
          needs.map((n) => (
            <div
              key={n.g}
              style={{ display: "flex", gap: 12, padding: "12px 4px 12px 14px", borderLeft: "2px solid var(--bad)", marginBottom: 8, background: "var(--panel-sunken)", borderRadius: "0 var(--r-sm) var(--r-sm) 0" }}
            >
              <span style={{ fontSize: 13, fontWeight: 600, minWidth: 120 }}>{GROUP_LABEL[n.g]}</span>
              <span style={{ fontSize: 12, color: "var(--ink-dim)" }}>{n.reason}</span>
            </div>
          ))
        )}
      </Panel>

      <Footer>
        <button onClick={() => nav("/league-rosters")}>League Rosters</button>
        <button onClick={() => nav("/free-agency")}>Free agency board</button>
        <button className="btn-primary" onClick={() => nav(back.to)}>
          {back.label}
        </button>
      </Footer>

      {isDepthChartStage && (
        <ReadinessGate title="Depth chart readiness" onAdvance={(r) => nav(r)} />
      )}

      {extending && (
        <ContractNegotiation
          title={`Extend — ${extending.name}`}
          subtitle={`${extending.position} · age ${extending.age} · ${extending.overall} OVR · ${extending.contract?.years_remaining ?? 0}y left`}
          priorities={{
            ...playerPriorities(extending),
            // an extension is negotiated against what he'd get on the open
            // market a year from now, not what a free agent asks today
            expectation: { ...extensionAsk(extending), signingBonus: 0 },
          }}
          error={extendError}
          onClose={() => {
            setExtendError(null);
            setExtending(null);
          }}
          onSubmit={(offer) => {
            const r = s.extendPlayer(extending.id, {
              baseSalary: offer.baseSalary,
              years: offer.years,
              guaranteed: offer.guaranteed,
            });
            if (r.ok) {
              setExtendError(null);
              setMoveNote({
                id: extending.id,
                ok: true,
                text: `Extended — ${offer.years} more years at ${millions(offer.baseSalary)} a year.`,
              });
              setExtending(null);
            } else {
              setExtendError(r.reason ?? "He turned it down.");
            }
          }}
        />
      )}
    </Card>
  );
}

function CapBar({ label, value, max }: { label: string; value: number; max: number }) {
  return (
    <div className="capbar-row">
      <div className="capbar-label">
        <span>{label}</span>
        <span>{millions(value)}</span>
      </div>
      <div className="capbar-track">
        <div className="capbar-fill" style={{ width: `${max ? Math.round((value / max) * 100) : 0}%` }} />
      </div>
    </div>
  );
}

function ProjCell({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ padding: 13, textAlign: "center", borderRight: "1px solid var(--line)" }}>
      <p style={{ margin: 0, fontSize: 10.5, color: "var(--ink-faint)" }}>{label}</p>
      <p className="oswald" style={{ margin: "5px 0 0", fontSize: 16, fontWeight: 500 }}>
        {value}
      </p>
    </div>
  );
}
