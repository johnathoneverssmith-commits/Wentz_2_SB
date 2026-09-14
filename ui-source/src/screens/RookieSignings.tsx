import { useMemo } from "react";
import { useNavigate } from "react-router-dom";

import { Card, CardHeader, Footer, Panel, Tabs, Ticker, useTabs } from "@/components/primitives";
import { ExpandableRow } from "@/components/ExpandableRow";
import { RowHeader } from "@/components/ListFilter";
import { ReadinessGate } from "@/components/ReadinessGate";
import { TEAMS_BY_CODE } from "@/data/teams";
import { useStore } from "@/state/store";
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
  const signRookie = useStore((st) => st.signRookie);
  const releaseRookie = useStore((st) => st.releaseRookie);

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
        subtitle={`${s.season} Draft Class · ${code ? TEAMS_BY_CODE[code]!.city : ""}`}
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
                          onClick={(e) => {
                            e.stopPropagation();
                            if (code) signRookie(p.id, code);
                          }}
                        >
                          Sign
                        </button>
                        <button
                          className="btn-danger"
                          style={{ fontSize: 11, padding: "6px 10px" }}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (code) releaseRookie(p.id, code);
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

      <Footer>
        <span style={{ flex: 1, fontSize: 11, color: "var(--ink-faint)", alignSelf: "center" }}>
          {myPicks.length === 0
            ? "No picks this year."
            : "Sign or release every pick to unlock the draft summary and advance."}
        </span>
      </Footer>

      <ReadinessGate
        title="Rookie signings readiness"
        disabled={!allResolved}
        disabledHint={`${resolvedCount} / ${myPicks.length} picks resolved — sign or release the rest`}
        onAdvance={(r) => nav(r)}
      />
    </Card>
  );
}
