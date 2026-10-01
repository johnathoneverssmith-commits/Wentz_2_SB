import { useMemo, useState } from "react";
import type { LeagueState, Player } from "@/domain";
import { useNavigate } from "react-router-dom";

import { Card, CardHeader, Footer, Panel, Tabs, Ticker, useTabs } from "@/components/primitives";
import { ExpandableRow } from "@/components/ExpandableRow";
import { RowHeader } from "@/components/ListFilter";
import { TEAMS_BY_CODE } from "@/data/teams";
import { MockSimulationService } from "@/sim/MockSimulationService";
import { RETIREMENT_AGE, ROSTER_TEMPLATE } from "@/sim/roster-template";
import { onlineSession } from "@/state/online";
import { useStore } from "@/state/store";
import { useLeagueActions } from "@/state/useLeagueActions";
import { viewerTeamCode } from "@/state/selectors";
import { millions } from "@/util/format";

const sim = new MockSimulationService();

const RETIREE_GRID = "1.6fr 0.5fr 0.9fr 16px";

export function RetirementReview() {
  const nav = useNavigate();
  const s = useStore();
  const { active, setActive } = useTabs("yours");
  const code = viewerTeamCode(s);
  const actions = useLeagueActions();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Online the league retires everyone the moment this stage opens, so the
  // players are already marked. Rolling the odds again here rolled them for
  // the *survivors*: the screen named a whole different set of retirees
  // (a 26-year-old 97 among them) while the real ones quietly left. Show what
  // was committed; only a single-player league, which commits on the way
  // out, still needs the preview.
  const retiringIds = useMemo(() => {
    // (not "anyone marked this season" alone: the free-agent market's prune
    // at the start of the season marks its cuts the same way, and a
    // single-player review would have shown those instead of its preview)
    if (onlineSession()) {
      const committed = Object.values(s.players).filter(
        (p) => p.retired && p.retired_season === s.season && p.retirement_status === "retiring",
      );
      return new Set(committed.map((p) => p.id));
    }
    const preview = sim.retirementOutcomes(s.season, Object.values(s.players).filter((p) => !p.retired));
    return new Set(preview.filter((o) => o.decision === "retiring").map((o) => o.playerId));
  }, [s.season, s.players]);
  const retiring = [...retiringIds];

  const yours = Object.values(s.players).filter((p) => p.nfl_team === code && retiringIds.has(p.id));
  const league = Object.values(s.players)
    .filter((p) => retiringIds.has(p.id) && p.nfl_team !== code)
    .sort((a, b) => b.overall - a.overall)
    .slice(0, 14);
  // a 39-year-old backup leaving and the starting quarterback leaving looked
  // the same; which of these were starting is what tells a GM to shop
  const starting = new Set(
    yours
      .filter((p) => {
        const slots = ROSTER_TEMPLATE.find((t) => t.pos === p.position)?.starters ?? 0;
        const order = s.depthChart[code ?? ""]?.[p.position];
        const room = Object.values(s.players)
          .filter((q) => q.nfl_team === code && q.position === p.position && (!q.retired || retiringIds.has(q.id)))
          .sort((a, b) => {
            const ia = order?.indexOf(a.id) ?? -1;
            const ib = order?.indexOf(b.id) ?? -1;
            if (ia >= 0 || ib >= 0) return (ia < 0 ? 1e9 : ia) - (ib < 0 ? 1e9 : ib);
            return b.overall - a.overall;
          });
        return room.findIndex((q) => q.id === p.id) < slots;
      })
      .map((p) => p.id),
  );
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
          // players leaving teams; the unsigned free agents who drift out of
          // the market too made "League-wide: 426" read like an exodus
          {
            label: "From rosters",
            value: retiring.filter((id) => {
              const p = s.players[id];
              return !!p && p.nfl_team !== "FA" && !p.free_agent;
            }).length,
          },
          // league-wide, beside two figures that are yours: name the team, or it
          // read as your own loss
          { label: "League's best retiree", value: best ? `${best.name} (${best.nfl_team}), ${best.overall}` : "—", className: "sm" },
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
        {starting.size > 0 && (
          <div className="notice" role="status">
            You&rsquo;re losing {starting.size === 1 ? "a starter" : `${starting.size} starters`} (
            {[...new Set(yours.filter((p) => starting.has(p.id)).map((p) => p.position))].join(", ")}) — the draft and
            free agency are where to replace {starting.size === 1 ? "him" : "them"}.
          </div>
        )}
        <div className="rowlist">
          {yours.length > 0 && (
            <RowHeader gridTemplate={RETIREE_GRID} labels={["Player", "Ovr", "Status", ""]} />
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
                      {starting.has(p.id) && <strong style={{ color: "var(--bad)" }}>Starter · </strong>}
                      Age {p.age} · typical {p.position} retirement {RETIREMENT_AGE[p.position]}
                    </p>
                  </div>
                  {/* the column says Ovr; it showed his age */}
                  <span className="pcell">{p.overall}</span>
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
                  {careerSummary(s, p) && (
                    <p style={{ margin: "12px 0 0", fontSize: 12.5, color: "var(--ink-dim)" }}>{careerSummary(s, p)}</p>
                  )}
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

      {/*
        Change 12: the roster, free agency and trade links come off this
        screen. The draft class has already been generated and the order is
        already fixed, so none of those could change anything the next screen
        is about — and free agency does not open for two more stages.
      */}
      <Footer>
        <span style={{ flex: 1, fontSize: 11.5, color: error ? "var(--bad)" : "var(--ink-faint)", alignSelf: "center" }}>
          {error ?? "Review the retirements, then continue to the draft preview."}
        </span>
        <button
          type="button"
          className="btn-primary"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setError(null);
            void actions
              .stepForward("draftPreview")
              .then((res) => {
                if (res.ok) nav("/draft-preview");
                else setError(res.reason ?? "Couldn't move on. Try again.");
              })
              .finally(() => setBusy(false));
          }}
        >
          Advance to Draft Preview
        </button>
      </Footer>
    </Card>
  );
}

/** A retiring player's career in this league, in a line: his totals and his honours. */
function careerSummary(s: LeagueState, p: Player): string | null {
  const c = p.career;
  const honours = [
    ...(s.awards ?? []).filter((a) => a.playerId === p.id).map((a) => `${a.season} ${a.award}`),
    ...((s.allPro ?? []).some((a) => a.playerId === p.id) ? [`${(s.allPro ?? []).filter((a) => a.playerId === p.id).length}x All-Pro`] : []),
  ];
  const totals: string[] = [];
  if (c) {
    if ((c.passYds ?? 0) > 0) totals.push(`${c.passYds!.toLocaleString("en-US")} pass yds, ${c.passTd ?? 0} TD`);
    if ((c.rushYds ?? 0) > 300) totals.push(`${c.rushYds!.toLocaleString("en-US")} rush yds`);
    if ((c.recYds ?? 0) > 300) totals.push(`${c.recYds!.toLocaleString("en-US")} rec yds`);
    if ((c.sacks ?? 0) > 5) totals.push(`${c.sacks} sacks`);
    if ((c.defInt ?? 0) > 3) totals.push(`${c.defInt} INT`);
  }
  if (!totals.length && !honours.length) return null;
  return [c ? `${c.seasons} season${c.seasons === 1 ? "" : "s"} in this league` : null, ...totals, ...honours].filter(Boolean).join(" · ");
}
