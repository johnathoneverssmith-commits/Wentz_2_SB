import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { OvrPill } from "@/components/bits";
import { ExpandableRow } from "@/components/ExpandableRow";
import { Card, CardHeader, Footer, Panel, Tabs, Ticker, useTabs } from "@/components/primitives";
import { ReadinessGate } from "@/components/ReadinessGate";
import { RosterNeeds } from "@/components/RosterNeeds";
import { TEAMS_BY_CODE } from "@/data/teams";
import { POSITIONS, type Position } from "@/domain";
import { picksOwnedBy } from "@/state/draftPicks";
import { useStore } from "@/state/store";
import { teamRoster, viewerTeamCode } from "@/state/selectors";

export function DraftPreview() {
  const nav = useNavigate();
  const s = useStore();
  const { active, setActive } = useTabs("prospects");
  const [posFilter, setPosFilter] = useState<"ALL" | Position>("ALL");
  const code = viewerTeamCode(s);
  const myPicks = code ? picksOwnedBy(s, code, s.season) : [];
  const toggleTarget = useStore((st) => st.toggleDraftTarget);
  const startDraft = useStore((st) => st.startDraft);

  // targets are stored on the draft object; make sure one exists for marking
  const targets = s.draft?.targetsByGm[s.viewerGmId] ?? [];
  const ensureDraft = () => {
    if (!s.draft || s.draft.mode !== "rookie") startDraft("rookie");
  };

  const prospects = useMemo(
    () =>
      [...s.draftClass].sort((a, b) => a.projectedRound - b.projectedRound || b.collegeOverall - a.collegeOverall),
    [s.draftClass],
  );

  const myRoster = useMemo(() => (code ? teamRoster(s, code) : []), [s, code]);
  const filtered = prospects.filter((p) => posFilter === "ALL" || p.position === posFilter);
  const targetProspects = prospects.filter((p) => targets.includes(p.id));

  return (
    <Card maxWidth={820}>
      <CardHeader
        badge={code ? TEAMS_BY_CODE[code]!.abbr : "FS"}
        title="Draft Preview"
        subtitle={`${s.season} rookie class · scouting`}
      />
      <Ticker
        stats={[
          { label: "Prospects", value: prospects.length },
          { label: "Your targets", value: targets.length, className: "accent" },
          { label: "Top prospect", value: prospects[0]?.projectedRange ?? "—", className: "sm" },
          // "R1" was a constant — it said the same thing whether you held
          // three firsts or had traded them all away
          {
            label: "Your picks",
            value: myPicks.length === 0 ? "None" : myPicks.map((p) => `R${p.round}`).join(" "),
            className: "sm",
          },
        ]}
      />
      {myPicks.length === 0 && (
        <div className="notice bad" role="status">
          <strong>You have no picks in this draft.</strong> Every one of them has been traded away
          — you'll sit this one out unless you deal for a pick before it starts.
        </div>
      )}
      <Tabs
        tabs={[
          { id: "prospects", label: "Prospects" },
          { id: "needs", label: "Roster Needs" },
          { id: "targets", label: "Draft Targets" },
        ]}
        active={active}
        onChange={setActive}
      />

      <Panel id="prospects" open={active === "prospects"}>
        <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 14 }}>
          <label style={{ fontSize: 11.5, color: "var(--ink-faint)" }}>Position</label>
          <select value={posFilter} onChange={(e) => setPosFilter(e.target.value as "ALL" | Position)}>
            <option value="ALL">All positions</option>
            {POSITIONS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
        <div style={{ maxHeight: 460, overflowY: "auto" }}>
          {filtered.slice(0, 80).map((p) => {
            const starred = targets.includes(p.id);
            return (
              <ExpandableRow
                key={p.id}
                gridTemplate="24px 1.7fr 0.5fr 0.8fr 16px"
                columns={
                  <>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        ensureDraft();
                        toggleTarget(s.viewerGmId, p.id);
                      }}
                      style={{ border: "none", background: "none", padding: 0, color: starred ? "var(--notice)" : "var(--ink-faint)", fontSize: 14, cursor: "pointer" }}
                    >
                      {starred ? "★" : "☆"}
                    </button>
                    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                      <p className="pname">
                        {p.name} <span className="ppos">{p.position}</span>
                      </p>
                      <p style={{ margin: 0, fontSize: 11, color: "var(--ink-faint)" }}>
                        {p.school} · {p.classYear}
                      </p>
                    </div>
                    <OvrPill value={p.collegeOverall} />
                    <span className="pcell" style={{ fontSize: 11 }}>{p.projectedRange}</span>
                  </>
                }
                detail={
                  <>
                    <div className="grid4">
                      <div>
                        <p>Height</p>
                        <p>{Math.floor(p.heightIn / 12)}'{p.heightIn % 12}"</p>
                      </div>
                      <div>
                        <p>Weight</p>
                        <p>{p.weightLb} lb</p>
                      </div>
                      <div>
                        <p>40 time</p>
                        <p>{p.fortyTime ? `${p.fortyTime}s` : "—"}</p>
                      </div>
                      <div>
                        <p>Projected</p>
                        <p style={{ fontSize: 12 }}>{p.projectedRange}</p>
                      </div>
                    </div>
                    <p className="blurb">{p.scoutingNote}</p>
                  </>
                }
              />
            );
          })}
        </div>
      </Panel>

      <Panel id="needs" open={active === "needs"}>
        {code ? <RosterNeeds roster={myRoster} /> : <div className="emptystate">Pick a team first.</div>}
      </Panel>

      <Panel id="targets" open={active === "targets"}>
        {targetProspects.length === 0 ? (
          <div className="emptystate">No prospects marked yet. Star a prospect on the Prospects tab.</div>
        ) : (
          targetProspects.map((p) => (
            <div key={p.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "11px 6px", borderBottom: "1px solid var(--line)" }}>
              <span style={{ fontSize: 13.5, fontWeight: 500 }}>
                {p.name} <span className="ppos">{p.position}</span>
              </span>
              <span style={{ fontSize: 12, color: "var(--ink-dim)" }}>
                {p.school} · {p.projectedRange}
              </span>
            </div>
          ))
        )}
      </Panel>

      <Footer>
        <span style={{ flex: 1, fontSize: 11, color: "var(--ink-faint)", alignSelf: "center" }}>
          Draft Targets are private — no other GM sees your stars.
        </span>
      </Footer>

      <ReadinessGate title="Draft preview readiness" onAdvance={(r) => nav(r)} />
    </Card>
  );
}
