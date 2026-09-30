import { PAST_DEADLINE_MESSAGE, pastTradeDeadline } from "@/state/tradeDeadline";
import { onlineSession } from "@/state/online";
import { useMemo, useRef, useState } from "react";
import { careerArc } from "@/state/careerArc";
import { displaySeason } from "@/state/stageMachine";
import { useNavigate } from "react-router-dom";

import { OvrPill } from "@/components/bits";
import { ContractNegotiation } from "@/components/ContractNegotiation";
import { ExpandableRow } from "@/components/ExpandableRow";
import { RowHeader } from "@/components/ListFilter";
import { useLeagueActions } from "@/state/useLeagueActions";
import { Card, CardHeader, Footer, Panel, Tabs, Ticker, useTabs } from "@/components/primitives";
import { ReadinessGate } from "@/components/ReadinessGate";
import { UnitGrades } from "@/components/UnitGrades";
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
import { onInjuredReserve } from "@/state/injuries";
import { capUsed as contractsUsed, checkRelease, releasePenalty } from "@/state/reconciliation";
import { teamRoster, viewerTeamCode } from "@/state/selectors";
import { millions } from "@/util/format";

const sim = new HybridSimulationService();

const GROUP_LABEL: Record<PositionGroup, string> = {
  QB: "Quarterback", RB: "Running back", WR: "Wide receiver", TE: "Tight end",
  OL: "Offensive line", DL: "Defensive line", EDGE: "Edge rusher", LB: "Linebacker",
  CB: "Cornerback", S: "Safety", K: "Kicker", P: "Punter",
};

const ROSTER_GRID = "28px 1.5fr 0.5fr 0.5fr 0.7fr 0.9fr 16px";

export function RosterCapManagement() {
  const nav = useNavigate();
  const s = useStore();
  const actions = useLeagueActions();
  const { active, setActive } = useTabs("roster");
  const [group, setGroup] = useState<PositionGroup>("QB");
  const [confirming, setConfirming] = useState<string | null>(null);
  const [extending, setExtending] = useState<Player | null>(null);
  const [extendError, setExtendError] = useState<string | null>(null);
  const [moveNote, setMoveNote] = useState<{ id: string; ok: boolean; text: string } | null>(null);
  // the guard itself: state lags a render, so two quick clicks both passed it
  const nudgingRef = useRef(false);
  const [reordering, setReordering] = useState(false);
  const code = viewerTeamCode(s);
  // Change 9 reuses this screen at midseason, so the flag is about what the
  // stage is for rather than about one stage's name
  const tradesShut =
    pastTradeDeadline(s) || (onlineSession() !== null && (s.stage === "preseason" || s.stage === "regularSeason"));
  // the server locks the chart while a block of weeks is being revealed
  // (`refuseDuringBlock`); every move button used to find that out by being
  // refused one click at a time
  const depthLocked = onlineSession() !== null && (s.stage === "preseason" || s.stage === "regularSeason");
  const isDepthChartStage =
    s.stage === "offseasonDepthChart" || s.stage === "midseasonDepthChart";
  const back = s.returnTo
    ? { to: s.returnTo, label: "Return to retirements" }
    : { to: "/hub", label: "Return to team hub" };

  const roster = useMemo(() => (code ? teamRoster(s, code) : []), [s, code]);
  // players on injured reserve don't hold one of the 53 spots
  const onIr = roster.filter((p) => onInjuredReserve(p, s.stage)).length;
  const activeCount = roster.length - onIr;
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
  const overContracts = Math.round((contractsUsed(s, code) - capTotalM) * 10) / 10;
  const staffCap = Object.values(s.coaches)
    .filter((c) => c.team === code)
    .reduce((n, c) => n + (c.contract?.annualValue ?? 0), 0);

  // Depth is per position, not per group: "OL" covers three of them, and a
  // left tackle isn't competing with a centre for a spot.
  const positionsInGroup = (Object.keys(POSITION_TO_GROUP) as Position[]).filter(
    (pos) => POSITION_TO_GROUP[pos] === group,
  );
  const ordered = positionsInGroup.flatMap((pos) => depthAt(s, code, pos));

  /**
   * Move a player one place up or down the chart at his own position.
   *
   * One move at a time: online, two quick clicks both read the chart as it
   * was before either landed, so the second undid the first.
   */
  const nudge = (p: Player, by: -1 | 1): void => {
    if (nudgingRef.current) return;
    const line = depthAt(s, code, p.position).map((x) => x.id);
    const i = line.indexOf(p.id);
    const j = i + by;
    if (i < 0 || j < 0 || j >= line.length) return;
    [line[i], line[j]] = [line[j]!, line[i]!];
    nudgingRef.current = true;
    void actions
      .setDepthOrder(p.position, line)
      .then((r) => {
        if (!r.ok) setMoveNote({ id: p.id, ok: false, text: r.reason ?? "Couldn't change the depth chart." });
      })
      .finally(() => {
        nudgingRef.current = false;
      });
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
        subtitle={`${TEAMS_BY_CODE[code]!.label} · ${isDepthChartStage ? "Re-order the depth chart" : "Roster management"}`}
        action={
          <button
            className="btn-ghost"
            onClick={() => nav("/trade")}
            // it led to a "trading is closed" notice mid-block and after the deadline
            disabled={tradesShut}
            title={tradesShut ? (pastTradeDeadline(s) ? PAST_DEADLINE_MESSAGE : "Trading reopens at the next break in the season.") : undefined}
          >
            Propose trade
          </button>
        }
      />
      <Ticker
        stats={[
          {
            // this league's size, not the NFL's: a humans-only league has a handful
            label: "Roster strength",
            value: `${team.ratings.overallRank} of ${Object.keys(s.teams).length}`,
            className: team.ratings.overallRank <= Object.keys(s.teams).length * 0.375 ? "good" : undefined,
          },
          { label: "Cap space", value: millions(capSpace), className: capSpace >= 0 ? "good" : "bad" },
          { label: "Cap used", value: millions(capUsed), className: "sm" },
          ...(team.cap.dead > 0 ? [{ label: "Dead money", value: millions(team.cap.dead), className: "sm bad" }] : []),
          {
            // the 53-man target makes the gap legible — teams are topped up
            // to their starters only, the rest is yours to sign
            label: "Roster",
            value: (
              <>
                {activeCount}
                <span style={{ fontSize: 12, color: "var(--ink-faint)", fontWeight: 400 }}>
                  {" "}/ 53{onIr > 0 ? ` · ${onIr} on IR` : ""}
                </span>
              </>
            ),
            className: activeCount < 46 || activeCount > 53 ? "bad" : undefined,
          },
        ]}
      />
      {/* legality is the contracts — dead money shrinks the room to add
          anyone, but it can't make this roster illegal (reconciliation.ts) */}
      {(overContracts > 0 || activeCount > 53) && (
        <div className="notice bad" role="status">
          <strong>Not season-legal yet.</strong>{" "}
          {[
            overContracts > 0 ? `${millions(overContracts)} over the cap` : null,
            activeCount > 53 ? `${activeCount - 53} over the 53-man limit` : null,
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
          { id: "units", label: "Unit grades" },
          { id: "needs", label: "Positional needs" },
        ]}
        active={active}
        onChange={setActive}
      />

      <Panel id="roster" open={active === "roster"}>
        {depthLocked && (
          <div className="notice" role="status" style={{ marginBottom: 12 }}>
            The depth chart and releases are locked while this stretch of games plays out — they
            were played with today&rsquo;s roster. Both open again at the next break.
          </div>
        )}
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
          {/* through the league actions, not the local store: online the
              store-only reset never reached the server and the next refresh
              put the old order back */}
          <button
            disabled={reordering || depthLocked}
            onClick={() => {
              // one batch and one download, and a refusal (the chart locks
              // while a block of weeks plays out) is shown, not swallowed
              setReordering(true);
              void actions
                .setDepthOrders(positionsInGroup.map((position) => ({ position, playerIds: [] })))
                .then((r) => {
                  if (!r.ok) setMoveNote({ id: "", ok: false, text: r.reason ?? "Couldn't reorder." });
                })
                .finally(() => setReordering(false));
            }}
          >
            {reordering ? "Reordering…" : "Auto-reorder by overall"}
          </button>
        </div>
        {moveNote?.id === "" && !moveNote.ok && (
          <p className="form-error" role="status" style={{ margin: "-6px 0 12px" }}>
            {moveNote.text}
          </p>
        )}

        {ordered.length === 0 && (
          <div className="emptystate">No players in this group.</div>
        )}
        <div className="rowlist roster-list">
          {ordered.length > 0 && (
            <RowHeader
              gridTemplate={ROSTER_GRID}
              labels={[
                "#",
                { label: "Player", align: "left" },
                "Ovr",
                "Age",
                "Yrs",
                { label: "Cap hit", align: "right" },
                "",
              ]}
            />
          )}
          {ordered.map((p) => (
            <ExpandableRow
              key={p.id}
              gridTemplate={ROSTER_GRID}
              columns={
                <>
                  <span className="rank-num">{lineAt(p.position).indexOf(p) + 1}</span>
                  <span className="pname">
                    {p.name} <span className="ppos">{p.position}</span>
                    {p.injury_status && (
                      <span
                        title={`${p.injury_status.description}${p.injury_status.weeks_out_est ? `, ${p.injury_status.weeks_out_est[0]}-${p.injury_status.weeks_out_est[1]} weeks` : ""}`}
                        style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, color: "var(--bad)" }}
                      >
                        {onInjuredReserve(p, s.stage) ? "IR" : p.injury_status.status === "questionable" ? "Q" : p.injury_status.status === "doubtful" ? "D" : "OUT"}
                      </span>
                    )}
                  </span>
                  <OvrPill value={p.overall} />
                  <span className="pcell" title={arcOf(p).hint}>
                    {p.age}
                    <span style={{ display: "block", fontSize: 9.5, color: arcOf(p).color }}>{arcOf(p).label}</span>
                  </span>
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
                      <p>{displaySeason(s)} cap hit</p>
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
                      disabled={depthLocked || lineAt(p.position)[0]?.id === p.id}
                      title={`Move up the ${p.position} depth chart`}
                    >
                      Move up
                    </button>
                    <button
                      onClick={() => nudge(p, 1)}
                      disabled={depthLocked || lineAt(p.position).at(-1)?.id === p.id}
                      title={`Move down the ${p.position} depth chart`}
                    >
                      Move down
                    </button>
                    <button
                      onClick={() => {
                        // the local action knows exactly what it freed;
                        // the server answers with the new league instead, so
                        // online the preview's arithmetic stands in
                        const estimate = previewRestructure(p, s.season).freed;
                        void actions.restructure(p.id).then((r) => {
                          setMoveNote({
                            id: p.id,
                            ok: r.ok,
                            text: r.ok
                              ? `Restructured — ${millions(r.freed ?? estimate ?? 0)} off this year's cap, moved into the rest of the deal.`
                              : (r.reason ?? "Couldn't restructure that deal."),
                          });
                        });
                      }}
                      disabled={!previewRestructure(p, s.season).ok}
                      title={previewRestructure(p, s.season).reason ?? "Convert salary to bonus: cheaper now, dearer later"}
                    >
                      Restructure
                    </button>
                    <button onClick={() => setExtending(p)}>Extend</button>
                    {confirming === p.id ? (
                      <>
                        <button
                          className="btn-danger"
                          onClick={() => {
                            void actions.releasePlayer(p.id).then((r) => {
                              if (!r.ok) setMoveNote({ id: p.id, ok: false, text: r.reason ?? "Couldn't release him." });
                            });
                            setConfirming(null);
                          }}
                        >
                          Confirm release
                        </button>
                        <button onClick={() => setConfirming(null)}>Keep him</button>
                      </>
                    ) : (
                      <button
                        className="btn-danger"
                        onClick={() => setConfirming(p.id)}
                        // the server won't release anyone mid-block either (`refuseDuringBlock`)
                        disabled={depthLocked || !checkRelease(s, code, p.id).ok}
                        title={depthLocked ? "Releases open again at the next break." : checkRelease(s, code, p.id).reason}
                      >
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
                        ? `Releasing ${p.name} takes his ${millions(p.contract?.cap_hit_by_year[0] ?? 0)} off the books and leaves ${millions(releasePenalty(p))} of dead money this year. He goes to the free agent market. This can't be undone.`
                        : "A restructure moves money into later years; it doesn't make it go away. Releasing a player costs dead money this year: part of what's left on his deal."}
                  </p>
                </>
              }
            />
          ))}
        </div>
      </Panel>

      <Panel id="cap" open={active === "cap"}>
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
        <div className="split-3" style={{ background: "var(--panel-sunken)", border: "1px solid var(--line)", borderRadius: "var(--r-md)", overflow: "hidden" }}>
          <ProjCell label="Cap total" value={millions(capTotalM)} />
          <ProjCell label="Cap used" value={millions(capUsed)} />
          <ProjCell label="Cap space" value={millions(capSpace)} />
        </div>
      </Panel>

      <Panel id="units" open={active === "units"}>
        {active === "units" && <UnitGrades teamCode={code} />}
      </Panel>

      <Panel id="needs" open={active === "needs"}>
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
        {/* on the depth-chart stage this screen *is* the stage: "back to
            stage" went round to itself */}
        {!(isDepthChartStage && !s.returnTo) && (
          <button className="btn-primary" onClick={() => nav(back.to)}>
            {back.label}
          </button>
        )}
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
          noBonus
          onClose={() => {
            setExtendError(null);
            setExtending(null);
          }}
          onSubmit={(offer) => {
            const who = extending.id;
            void actions
              .extend(who, {
                baseSalary: offer.baseSalary,
                years: offer.years,
                guaranteed: offer.guaranteed,
              })
              .then((r) => {
                if (r.ok) {
                  setExtendError(null);
                  setMoveNote({
                    id: who,
                    ok: true,
                    text: `Extended — ${offer.years} more year${offer.years === 1 ? "" : "s"} at ${millions(offer.baseSalary)} a year.`,
                  });
                  setExtending(null);
                } else {
                  setExtendError(r.reason ?? "He turned it down.");
                }
              });
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

const arcOf = careerArc;
