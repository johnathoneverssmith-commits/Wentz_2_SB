import { useState } from "react";

import { RosterByPosition } from "@/components/RosterByPosition";
import { Card, CardHeader, Footer, Panel, Tabs, Ticker } from "@/components/primitives";
import { TEAMS_BY_CODE } from "@/data/teams";
import { pickLabel } from "@/state/draftPicks";
import { reconciliationIssues, rosterOf } from "@/state/reconciliation";
import { viewerTeamCode } from "@/state/selectors";
import { useStore } from "@/state/store";
import { tradesFor, type ResolvedOffer } from "@/state/tradeDeadline";
import { useLeagueActions } from "@/state/useLeagueActions";
import { millions } from "@/util/format";

/**
 * What the deadline did, from one GM's side.
 *
 * The violations are shown and not enforced. A GM can leave here $12M over
 * the cap with 55 players and no kicker, because the deadline was allowed to
 * do that on purpose — blocking the last trade of the year on arithmetic is
 * how a deadline stops being used. Reconciliation is the stage that makes
 * them fix it, so this screen's job is to make sure nothing is a surprise
 * when they get there.
 */
export function TradeSummary() {
  const s = useStore();
  const actions = useLeagueActions();
  const code = viewerTeamCode(s);
  const [active, setActive] = useState("mine");
  const [busy, setBusy] = useState(false);

  if (!code) {
    return (
      <Card>
        <CardHeader badge="TD" title="Trade Summary" subtitle="No team" />
        <div className="panel open">
          <div className="emptystate">Pick a team first.</div>
        </div>
      </Card>
    );
  }

  const { mine, league, rejected } = tradesFor(s, code);
  const issues = reconciliationIssues(s, code);
  const roster = rosterOf(s, code);
  const team = s.teams[code]!;
  const room = Math.round((team.cap.total - team.cap.used) * 10) / 10;

  return (
    <Card maxWidth={900}>
      <CardHeader
        badge={TEAMS_BY_CODE[code]!.abbr}
        title="Trade Summary"
        subtitle={`${s.season} deadline · ${mine.length} trade${mine.length === 1 ? "" : "s"} made`}
      />
      <Ticker
        stats={[
          { label: "Your trades", value: mine.length },
          { label: "League trades", value: league.length },
          { label: "Roster", value: roster.length, className: issues.some((i) => i.kind === "roster") ? "bad" : undefined },
          { label: "Cap space", value: millions(room), className: room < 0 ? "bad" : undefined },
        ]}
      />

      {issues.length > 0 && (
        <div className="notice bad" role="status">
          <strong>You&rsquo;ll have to square this up.</strong>
          <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
            {issues.map((i, n) => (
              <li key={n} style={{ fontSize: 12.5 }}>
                {i.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      <Tabs
        label="Trade summary"
        tabs={[
          { id: "mine", label: "Your Trades" },
          { id: "league", label: "League Trades" },
          { id: "rejected", label: "Rejected Offers" },
          { id: "roster", label: "Updated Roster" },
        ]}
        active={active}
        onChange={setActive}
      />

      <Panel id="mine" open={active === "mine"}>
        <TradeList offers={mine} empty="You didn't make a trade this deadline." />
      </Panel>
      <Panel id="league" open={active === "league"}>
        <TradeList offers={league} empty="Nobody traded. It happens." />
      </Panel>
      <Panel id="rejected" open={active === "rejected"}>
        <TradeList
          offers={rejected}
          empty="No offers of yours were turned down, and you turned none down."
        />
      </Panel>
      <Panel id="roster" open={active === "roster"}>
        <RosterByPosition teamCode={code} />
      </Panel>

      <Footer>
        <span style={{ flex: 1, fontSize: 11.5, color: "var(--ink-faint)", alignSelf: "center" }}>
          Advancing is final, and the league waits for everyone.
        </span>
        <button
          type="button"
          className="btn-primary"
          disabled={busy}
          onClick={() => {
            if (!confirm("Advance to Mid-Season Free Agency? You can't come back here.")) return;
            setBusy(true);
            void actions.readyUp(true).finally(() => setBusy(false));
          }}
        >
          Advance to Mid-Season Free Agency
        </button>
      </Footer>
    </Card>
  );
}

function TradeList({ offers, empty }: { offers: ResolvedOffer[]; empty: string }) {
  const s = useStore();
  if (offers.length === 0) return <div className="emptystate">{empty}</div>;

  const name = (a: ResolvedOffer["fromAssets"][number]): string => {
    if (a.kind === "pick" && a.pick) return pickLabel(a.pick);
    const p = s.players[a.playerId ?? ""];
    return p ? `${p.name} (${p.position} ${p.overall})` : "—";
  };

  return (
    <>
      {offers.map((o) => (
        <div
          key={o.id + o.outcome}
          style={{
            padding: "12px 14px",
            marginBottom: 10,
            background: "var(--panel-sunken)",
            border: "1px solid var(--line)",
            borderRadius: "var(--r-md)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
            <span className="oswald" style={{ fontSize: 13.5, fontWeight: 600 }}>
              {TEAMS_BY_CODE[o.fromTeam]!.label} · {TEAMS_BY_CODE[o.toTeam]!.label}
            </span>
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: o.outcome === "accepted" ? "var(--good)" : "var(--ink-faint)",
              }}
            >
              Round {o.round} · {o.outcome === "accepted" ? "Completed" : "No deal"}
              {o.modified ? " · countered" : ""}
            </span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <Side title={`${TEAMS_BY_CODE[o.fromTeam]!.abbr} sends`} items={o.fromAssets.map(name)} />
            <Side title={`${TEAMS_BY_CODE[o.toTeam]!.abbr} sends`} items={o.toAssets.map(name)} />
          </div>
        </div>
      ))}
    </>
  );
}

function Side({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <p style={{ margin: "0 0 4px", fontSize: 10.5, color: "var(--ink-faint)", letterSpacing: 0.4 }}>
        {title.toUpperCase()}
      </p>
      {items.length === 0 ? (
        <p style={{ margin: 0, fontSize: 12, color: "var(--ink-faint)" }}>Nothing</p>
      ) : (
        items.map((t, i) => (
          <p key={i} style={{ margin: "2px 0", fontSize: 12.5 }}>
            {t}
          </p>
        ))
      )}
    </div>
  );
}
