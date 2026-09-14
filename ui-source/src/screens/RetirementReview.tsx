import { useMemo } from "react";
import { useNavigate } from "react-router-dom";

import { Card, CardHeader, Footer, Panel, Tabs, Ticker, useTabs } from "@/components/primitives";
import { ExpandableRow } from "@/components/ExpandableRow";
import { RowHeader } from "@/components/ListFilter";
import { ReadinessGate } from "@/components/ReadinessGate";
import { TEAMS_BY_CODE } from "@/data/teams";
import { MockSimulationService } from "@/sim/MockSimulationService";
import { RETIREMENT_AGE } from "@/sim/roster-template";
import { useStore } from "@/state/store";
import { viewerTeamCode } from "@/state/selectors";
import { millions } from "@/util/format";

const sim = new MockSimulationService();

const RETIREE_GRID = "1.6fr 0.5fr 0.9fr 16px";

export function RetirementReview() {
  const nav = useNavigate();
  const s = useStore();
  const { active, setActive } = useTabs("yours");
  const code = viewerTeamCode(s);
  const setReturnTo = useStore((st) => st.setReturnTo);
  const goPreview = (to: string) => {
    setReturnTo("/retirement");
    nav(to);
  };

  const outcomes = useMemo(
    () => sim.retirementOutcomes(s.season, Object.values(s.players).filter((p) => !p.retired)),
    [s.season, s.players],
  );
  const retiring = outcomes.filter((o) => o.decision === "retiring");
  const retiringIds = new Set(retiring.map((o) => o.playerId));

  const yours = Object.values(s.players).filter((p) => p.nfl_team === code && retiringIds.has(p.id));
  const league = Object.values(s.players)
    .filter((p) => retiringIds.has(p.id) && p.nfl_team !== code)
    .sort((a, b) => b.overall - a.overall)
    .slice(0, 14);
  const best = [...yours, ...league].sort((a, b) => b.overall - a.overall)[0];
  const capFreed = yours.reduce((n, p) => n + (p.contract?.cap_hit_by_year[0] ?? 0), 0);

  return (
    <Card maxWidth={800}>
      <CardHeader
        badge={code ? TEAMS_BY_CODE[code]!.abbr : "FS"}
        title="Retirement Review"
        subtitle={`Offseason · ${code ? TEAMS_BY_CODE[code]!.label : ""}`}
      />
      <Ticker
        stats={[
          { label: "Your retirements", value: yours.length },
          { label: "League-wide", value: retiring.length },
          { label: "Best retiree", value: best ? `${best.name}, ${best.overall}` : "—", className: "sm" },
          { label: "Cap freed up", value: millions(capFreed), className: "good" },
        ]}
      />
      <Tabs
        tabs={[
          { id: "yours", label: "Your Team" },
          { id: "league", label: "League-wide" },
        ]}
        active={active}
        onChange={setActive}
      />

      <Panel id="yours" open={active === "yours"}>
        <div className="infonote" style={{ padding: "11px 14px", marginBottom: 16, background: "var(--panel-sunken)", border: "1px solid var(--line)", borderRadius: "var(--r-md)", fontSize: 11.5, color: "var(--ink-faint)", lineHeight: 1.5 }}>
          Retirement odds rise with age relative to the position-typical retirement age and with prior significant injuries.
        </div>
        {yours.length === 0 ? (
          <div className="emptystate">No players on your team are retiring this offseason.</div>
        ) : null}
        <div className="rowlist">
          {yours.length > 0 && (
            <RowHeader gridTemplate={RETIREE_GRID} labels={["Player", "Ovr", "Chance", ""]} />
          )}
          {yours.map((p) => (
            <ExpandableRow
              key={p.id}
              gridTemplate={RETIREE_GRID}
              columns={
                <>
                  <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    <p className="pname">
                      {p.name} <span className="ppos">{p.position}</span>
                    </p>
                    <p style={{ margin: 0, fontSize: 11, color: "var(--ink-faint)" }}>
                      Age {p.age} · typical {p.position} retirement {RETIREMENT_AGE[p.position]}
                    </p>
                  </div>
                  <span className="pcell">{p.age}</span>
                  <span style={{ fontSize: 10.5, fontWeight: 600, padding: "4px 10px", borderRadius: 20, textAlign: "center", background: "rgba(226,105,74,0.14)", color: "var(--bad)" }}>
                    Retiring
                  </span>
                </>
              }
              detail={
                <>
                  <div className="grid4">
                    <div>
                      <p>Overall</p>
                      <p>{p.overall}</p>
                    </div>
                    <div>
                      <p>Age</p>
                      <p>{p.age}</p>
                    </div>
                    <div>
                      <p>Seasons</p>
                      <p>{p.years_pro}</p>
                    </div>
                    <div>
                      <p>Injuries</p>
                      <p>{p.injury_history.length}</p>
                    </div>
                  </div>
                  <p style={{ margin: "12px 0 0", paddingTop: 12, borderTop: "1px solid var(--line)", fontSize: 12.5, color: "var(--ink-dim)" }}>
                    Frees <strong style={{ color: "var(--good)" }}>{millions(p.contract?.cap_hit_by_year[0] ?? 0)}</strong> in cap space once the contract clears.
                  </p>
                </>
              }
            />
          ))}
        </div>
      </Panel>

      <Panel id="league" open={active === "league"}>
        <table className="stbl">
          <thead>
            <tr>
              <th>Player</th>
              <th className="c">Team</th>
              <th className="c">OVR</th>
              <th className="c">Age</th>
            </tr>
          </thead>
          <tbody>
            {league.map((p) => (
              <tr key={p.id}>
                <td className="name">
                  {p.name} <span className="pos">{p.position}</span>
                </td>
                <td className="c">{p.nfl_team}</td>
                <td className="c" style={{ color: "var(--ink)", fontWeight: 600 }}>
                  {p.overall}
                </td>
                <td className="c">{p.age}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      <Footer>
        <button type="button" className="btnlink" onClick={() => goPreview("/roster")}>
          Preview roster &amp; cap
        </button>
        <button type="button" className="btnlink" onClick={() => goPreview("/free-agency")}>
          Free agency
        </button>
        <button type="button" className="btnlink" onClick={() => goPreview("/trade")}>
          Propose trade
        </button>
      </Footer>

      <ReadinessGate title="Retirement review readiness" onAdvance={(r) => nav(r)} />
    </Card>
  );
}
