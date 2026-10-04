import { useMemo } from "react";
import { displaySeason } from "@/state/stageMachine";
import { useNavigate } from "react-router-dom";

import { OvrPill } from "@/components/bits";
import { ExpandableRow } from "@/components/ExpandableRow";
import { Card, CardHeader, Footer, Panel, Tabs, Ticker, useTabs } from "@/components/primitives";
import { ReadinessGate } from "@/components/ReadinessGate";
import { RosterNeeds } from "@/components/RosterNeeds";
import { RowHeader, useListFilter } from "@/components/ListFilter";
import { TEAMS_BY_CODE } from "@/data/teams";
import { DRAFT_ROUNDS, picksOwnedBy } from "@/state/draftPicks";
import { projectedRookieRange } from "@/sim/draft-outcomes";
import { useStore } from "@/state/store";
import { draftTargetsFor } from "@/state/rules";
import { useLeagueActions } from "@/state/useLeagueActions";
import { teamRoster, viewerTeamCode } from "@/state/selectors";
import { posLabel } from "@/util/format";

const PROSPECT_GRID = "24px 1.7fr 0.5fr 0.8fr 16px";

export function DraftPreview() {
  const s = useStore();
  const nav = useNavigate();
  const { active, setActive } = useTabs("prospects");
  const code = viewerTeamCode(s);
  const myPicks = code ? picksOwnedBy(s, code, s.season, true) : [];
  const actions = useLeagueActions();
  // league-level and saved on the server, so they survive the preview, a
  // reload and the start of the draft (they used to live on last season's
  // draft object, and vanished online on the next refresh)
  const targets = draftTargetsFor(s, s.viewerGmId);

  const prospects = useMemo(
    () =>
      [...s.draftClass].sort((a, b) => a.projectedRound - b.projectedRound || b.collegeOverall - a.collegeOverall),
    [s.draftClass],
  );

  // The class is projected against a 32-team draft. In a humans-only league
  // of four, "Top 10" and "Mid Round 1" were both a pick nobody would get
  // to make; there the board rank and the round it falls in *this* league's
  // draft are what mean something.
  const teamCount = Object.keys(s.teams).length;
  const projected = useMemo(() => {
    const rank = new Map(prospects.map((p, i) => [p.id, i + 1]));
    return (p: (typeof prospects)[number]): string => {
      if (teamCount === 32) return p.projectedRange;
      const r = rank.get(p.id) ?? 0;
      const round = Math.ceil(r / Math.max(1, teamCount));
      return round <= DRAFT_ROUNDS ? `Round ${round} · #${r}` : `Undrafted · #${r}`;
    };
  }, [prospects, teamCount]);

  const myRoster = useMemo(() => (code ? teamRoster(s, code) : []), [s, code]);
  const market = useListFilter(prospects, 120);
  const targetProspects = prospects.filter((p) => targets.includes(p.id));

  return (
    <Card maxWidth={820}>
      <CardHeader
        badge={code ? TEAMS_BY_CODE[code]!.abbr : "FS"}
        title="Draft Preview"
        subtitle={`${displaySeason(s)} rookie class · scouting`}
      />
      <Ticker
        stats={[
          { label: "Prospects", value: prospects.length },
          { label: "Your targets", value: targets.length, className: "accent" },
          // his name, not his projected range ("Top prospect: Top 10")
          { label: "Top prospect", value: prospects[0] ? `${prospects[0].name} (${prospects[0].position})` : "—", className: "sm" },
          // "R1" was a constant — it said the same thing whether you held
          // three firsts or had traded them all away
          {
            label: "Your picks",
            value: myPicks.length === 0 ? "None" : myPicks.map((p) => `R${p.round}${p.comp ? "c" : ""}`).join(" "),
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
        {market.controls}
        {market.matched === 0 && (
          <div className="emptystate">No prospect matches that search.</div>
        )}
        <div className="scroll-list">
          {market.matched > 0 && (
            <RowHeader
              gridTemplate={PROSPECT_GRID}
              // a college grade, which runs high — not the NFL overall he
              // arrives with, so it isn't labelled as one
              labels={["", { label: "Prospect", align: "left" }, "Grade", "Projected", ""]}
            />
          )}
          {market.shown.map((p) => {
            const starred = targets.includes(p.id);
            return (
              <ExpandableRow
                key={p.id}
                gridTemplate={PROSPECT_GRID}
                columns={
                  <>
                    <button
                      type="button"
                      aria-pressed={starred}
                      aria-label={starred ? `Remove ${p.name} from your targets` : `Add ${p.name} to your targets`}
                      title={starred ? "Remove from your targets" : "Add to your targets"}
                      onClick={(e) => {
                        e.stopPropagation();
                        void actions.toggleDraftTarget(p.id);
                      }}
                      style={{ border: "none", background: "none", padding: 0, color: starred ? "var(--notice)" : "var(--ink-faint)", fontSize: 14, cursor: "pointer" }}
                    >
                      {starred ? "★" : "☆"}
                    </button>
                    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                      <p className="pname">
                        {p.name} <span className="ppos">{posLabel(p.position)}</span>
                      </p>
                      <p style={{ margin: 0, fontSize: 11, color: "var(--ink-faint)" }}>
                        {p.school} · {p.classYear} · projects{" "}
                        {(() => {
                          const [lo, hi] = projectedRookieRange(p);
                          return `${lo}–${hi}`;
                        })()}{" "}
                        as a rookie
                      </p>
                    </div>
                    <OvrPill value={p.collegeOverall} />
                    <span className="pcell" style={{ fontSize: 11 }}>{projected(p)}</span>
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
                        <p style={{ fontSize: 12 }}>{projected(p)}</p>
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
                {p.name} <span className="ppos">{posLabel(p.position)}</span>
              </span>
              <span style={{ fontSize: 12, color: "var(--ink-dim)" }}>
                {p.school} · {projected(p)}
              </span>
            </div>
          ))
        )}
      </Panel>

      {/*
        Change 12: one control, from either tab, and it is the commitment —
        the league waits at the checkpoint on the far side of it while the
        last GM finishes reading. The stars survive it; they stay editable on
        the draft board itself.
      */}
      <Footer>
        <span style={{ flex: 1, fontSize: 11, color: "var(--ink-faint)", alignSelf: "center" }}>
          {/* in a solo dynasty there is nobody to hide them from */}
          {actions.online
            ? "Draft Targets are private — no other GM sees your stars."
            : "Star the prospects you want — on the clock, the draft room suggests the best one still on the board."}
        </span>
      </Footer>

      <ReadinessGate title="Draft prep readiness" label="Advance to Draft" onAdvance={(r) => nav(r)} />
    </Card>
  );
}
