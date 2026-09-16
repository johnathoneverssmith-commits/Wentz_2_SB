import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { Card, CardHeader, Footer, Panel, Tabs, Ticker, useTabs } from "@/components/primitives";
import { ExpandableRow } from "@/components/ExpandableRow";
import { RowHeader } from "@/components/ListFilter";
import { TEAMS_BY_CODE } from "@/data/teams";
import { STAGE_HOME } from "@/state/stageMachine";
import { useStore } from "@/state/store";
import { useLeagueActions } from "@/state/useLeagueActions";
import { viewerTeamCode } from "@/state/selectors";
import { millions } from "@/util/format";

/** Slotted rookie contract value by round, $M total over 4 years. */
function slotValue(round: number): number {
  return Math.round((36 - round * 4.5) * 10) / 10;
}

const ROOKIE_GRID = "0.5fr 1.5fr 1fr 0.9fr auto 16px";

export function RookieSignings() {
  const nav = useNavigate();
  const s = useStore();
  const { active, setActive } = useTabs("signings");
  const code = viewerTeamCode(s);
  // Through the league's actions, not the store's: online this is a decision
  // the server has to make, and calling the store directly wrote it into a
  // private copy that the next frame from the league silently discarded.
  const actions = useLeagueActions();
  const [committing, setCommitting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const settle = (prospectId: string, released: boolean): void => {
    setBusy(true);
    setError(null);
    void actions
      .settleRookie(prospectId, released)
      .then((res) => {
        if (!res.ok) setError(res.reason ?? "That didn't go through.");
      })
      .finally(() => setBusy(false));
  };

  const myPicks = useMemo(
    () =>
      (s.draft?.results ?? [])
        .filter((r) => r.teamCode === code && r.selectedId)
        .map((r) => ({ pick: r, prospect: s.draftClass.find((d) => d.id === r.selectedId) }))
        .filter((x) => x.prospect),
    [s.draft, s.draftClass, code],
  );

  const outcomes = s.rookieOutcomes;
  const resolvedCount = myPicks.filter((x) => outcomes[x.prospect!.id]).length;
  // a team with no picks has nothing to resolve — never gate it here
  const allResolved = resolvedCount === myPicks.length;
  const signedCount = myPicks.filter((x) => outcomes[x.prospect!.id] === "signed").length;

  const team = code ? s.teams[code] : undefined;
  const capAfter = team ? team.cap.total - team.cap.used : 0;

  return (
    <Card maxWidth={820}>
      <CardHeader
        badge={code ? TEAMS_BY_CODE[code]!.abbr : "FS"}
        title="Rookie Signings"
        subtitle={`${s.season} Draft Class · ${code ? TEAMS_BY_CODE[code]!.label : ""}`}
      />
      <Ticker
        stats={[
          { label: "Draft picks", value: myPicks.length },
          { label: "Signed", value: `${signedCount} / ${myPicks.length}` },
          { label: "Resolved", value: `${resolvedCount} / ${myPicks.length}` },
          { label: "Cap space", value: millions(capAfter), className: capAfter >= 0 ? "good" : "bad" },
        ]}
      />
      <Tabs
        tabs={[
          { id: "signings", label: "Signings" },
          { id: "summary", label: "Draft Summary 🔒", locked: !allResolved },
        ]}
        active={active}
        onChange={setActive}
      />

      <Panel id="signings" open={active === "signings"}>
        {/* online a refusal arrives after a round trip, so it has to be shown
            rather than assumed away */}
        {error && (
          <div className="notice bad" role="status">
            {error}
          </div>
        )}
        {myPicks.length === 0 ? (
          <div className="emptystate">Your team didn't draft anyone this year — nothing to sign. You can advance whenever you're ready.</div>
        ) : null}
        <div className="rowlist">
          {myPicks.length > 0 && (
            <RowHeader
              gridTemplate={ROOKIE_GRID}
              labels={["Pick", { label: "Player", align: "left" }, "Slot value", "Year one", "", ""]}
            />
          )}
          {myPicks.map(({ pick, prospect }) => {
            const p = prospect!;
            const outcome = outcomes[p.id];
            const total = slotValue(pick.round);
            return (
              <ExpandableRow
                key={p.id}
                gridTemplate={ROOKIE_GRID}
                columns={
                  <>
                    <span style={{ fontSize: 11, color: "var(--ink-faint)" }}>R{pick.round}</span>
                    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                      <p className="pname">
                        {p.name} <span className="ppos">{p.position}</span>
                      </p>
                      <p style={{ margin: 0, fontSize: 11, color: "var(--ink-faint)" }}>{p.school}</p>
                    </div>
                    <span style={{ fontSize: 12.5, color: "var(--ink-dim)" }}>4yr / {millions(total)}</span>
                    <span style={{ fontSize: 12, color: "var(--ink-faint)" }}>Y1 {millions(total / 4)}</span>
                    {outcome ? (
                      <span
                        className="oswald"
                        style={{
                          fontSize: 13,
                          fontWeight: 700,
                          textAlign: "right",
                          color: outcome === "signed" ? "var(--good)" : "var(--bad)",
                        }}
                      >
                        {p.trueOverall} OVR
                        <span style={{ display: "block", fontSize: 9.5, fontWeight: 600, color: "var(--ink-faint)" }}>
                          {outcome === "signed" ? "SIGNED" : "RELEASED"}
                        </span>
                      </span>
                    ) : (
                      <span style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                        <button
                          className="btn-primary"
                          style={{ fontSize: 11, padding: "6px 10px" }}
                          disabled={busy}
                          onClick={(e) => {
                            e.stopPropagation();
                            settle(p.id, false);
                          }}
                        >
                          Sign
                        </button>
                        <button
                          className="btn-danger"
                          style={{ fontSize: 11, padding: "6px 10px" }}
                          disabled={busy}
                          onClick={(e) => {
                            e.stopPropagation();
                            settle(p.id, true);
                          }}
                        >
                          Release
                        </button>
                      </span>
                    )}
                  </>
                }
                detail={
                  <>
                    <div className="grid4" style={{ gridTemplateColumns: "repeat(5,1fr)" }}>
                      <div>
                        <p>Contract</p>
                        <p>4 years</p>
                      </div>
                      <div>
                        <p>Total value</p>
                        <p>{millions(total)}</p>
                      </div>
                      <div>
                        <p>Signing bonus</p>
                        <p>{millions(total * 0.4)}</p>
                      </div>
                      <div>
                        <p>College OVR</p>
                        <p>{p.collegeOverall}</p>
                      </div>
                      <div>
                        <p>True overall</p>
                        <p style={outcome ? { color: outcome === "signed" ? "var(--good)" : "var(--bad)" } : { color: "var(--ink-faint)", fontStyle: "italic", fontFamily: "Inter, sans-serif", fontSize: 11 }}>
                          {outcome ? `${p.trueOverall} OVR` : "Resolve to reveal"}
                        </p>
                      </div>
                    </div>
                    <p className="blurb">{p.scoutingNote}</p>
                    {outcome === "released" && (
                      <p style={{ margin: "8px 0 0", fontSize: 11, color: "var(--ink-faint)" }}>
                        {p.name} is now on the free-agent market.
                      </p>
                    )}
                  </>
                }
              />
            );
          })}
        </div>
      </Panel>

      <Panel id="summary" open={active === "summary"}>
        <p className="subhead" style={{ marginTop: 0 }}>
          Your class
        </p>
        <table className="stbl">
          <thead>
            <tr>
              <th>Player</th>
              <th className="c">Pos</th>
              <th className="c">Round</th>
              <th className="c">True OVR</th>
              <th className="c">Result</th>
            </tr>
          </thead>
          <tbody>
            {myPicks.map(({ pick, prospect }) => {
              const p = prospect!;
              const outcome = outcomes[p.id];
              return (
                <tr key={p.id}>
                  <td className="name">{p.name}</td>
                  <td className="c">{p.position}</td>
                  <td className="c">R{pick.round}</td>
                  <td className="c" style={{ fontWeight: 600 }}>{p.trueOverall}</td>
                  <td className="c" style={{ color: outcome === "signed" ? "var(--good)" : "var(--bad)", fontWeight: 600 }}>
                    {outcome === "signed" ? "Signed" : "Released"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p style={{ margin: "12px 0 0", fontSize: 12, color: "var(--ink-dim)" }}>
          Signed {signedCount} of {myPicks.length}. Average true overall of the class:{" "}
          {myPicks.length
            ? Math.round(myPicks.reduce((n, x) => n + x.prospect!.trueOverall, 0) / myPicks.length)
            : "—"}
          .
        </p>
      </Panel>

      {/*
        Change 13: one control, and no compliance check behind it. A team can
        leave here over the cap, over the roster limit and short at a
        position, because free agency is about to change all three — making
        a GM fix a roster they are about to rebuild is asking them to do the
        same work twice.
      */}
      <Footer>
        <span style={{ flex: 1, fontSize: 11, color: "var(--ink-faint)", alignSelf: "center" }}>
          {myPicks.length === 0
            ? "No picks this year."
            : allResolved
              ? "Every pick is settled."
              : `${resolvedCount} / ${myPicks.length} picks resolved — sign or release the rest.`}
        </span>
        <button
          type="button"
          className="btn-primary"
          disabled={!allResolved || committing}
          onClick={() => {
            if (!confirm("Continue to free agency? You can't come back to signings.")) return;
            setCommitting(true);
            void actions
              .readyUp(true)
              .then((res) => {
                if (!res.ok) alert(res.reason ?? "Couldn't advance.");
                else if (!actions.online) nav(STAGE_HOME[useStore.getState().stage]);
              })
              .finally(() => setCommitting(false));
          }}
        >
          {committing ? "Advancing…" : "Continue to Free Agency"}
        </button>
      </Footer>
    </Card>
  );
}
