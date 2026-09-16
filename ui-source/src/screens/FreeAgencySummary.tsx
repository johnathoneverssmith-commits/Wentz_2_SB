import { useMemo, useState } from "react";

import { OvrPill, TeamBadge } from "@/components/bits";
import { Card, CardHeader, Footer, Panel, Tabs, Ticker, useTabs } from "@/components/primitives";
import { TEAMS_BY_CODE } from "@/data/teams";
import { unsignedPool } from "@/state/freeAgencyEvent";
import { expectedSalary } from "@/state/freeAgencyValues";
import {
  capUsed,
  checkRelease,
  isReconciled,
  reconciliationIssues,
  releasePenalty,
  rosterOf,
} from "@/state/reconciliation";
import { ROSTER_SIZE } from "@/sim/roster-template";
import { viewerTeamCode } from "@/state/selectors";
import { useStore } from "@/state/store";
import { useLeagueActions } from "@/state/useLeagueActions";
import { millions } from "@/util/format";

/**
 * How free agency went, and the bill.
 *
 * Four tabs, and the fourth is the one with teeth. Everything else is a
 * record of what happened; Roster & Budget is where the cap and the roster
 * limits come back, and advancing is locked until the team is legal on all
 * three counts at once.
 *
 * The tab glows while anything is wrong, because a GM reading their signings
 * has no other reason to look at it and the block would otherwise arrive as a
 * surprise at the moment they tried to leave.
 */
export function FreeAgencySummary() {
  const s = useStore();
  const actions = useLeagueActions();
  const code = viewerTeamCode(s);
  const { active, setActive } = useTabs("yours");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const e = s.freeAgencyEvent;
  const issues = useMemo(
    () => (code ? reconciliationIssues(s, code) : []),
    [s.players, s.teams, code], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const legal = !!code && isReconciled(s, code);

  if (!code || !e) {
    return (
      <Card>
        <CardHeader badge="FA" title="Free Agency Summary" subtitle="Loading" />
        <div className="panel open">
          <div className="emptystate">One moment.</div>
        </div>
      </Card>
    );
  }

  const mySignings = e.signed.filter((x) => x.teamCode === code);
  const myLostBids = Object.entries(e.offers)
    .filter(([playerId, list]) => {
      const mine = list.some((o) => o.teamCode === code);
      const won = e.signed.find((x) => x.playerId === playerId);
      return mine && won && won.teamCode !== code;
    })
    .map(([playerId]) => playerId);

  const roster = rosterOf(s, code);
  const used = capUsed(s, code);
  const total = s.teams[code]?.cap.total ?? 0;

  const release = (playerId: string) => {
    setBusy(true);
    setError(null);
    void actions
      .releasePlayer(playerId)
      .then((res) => {
        if (!res.ok) setError(res.reason ?? "Couldn't release him.");
      })
      .finally(() => setBusy(false));
  };

  return (
    <Card maxWidth={920}>
      <CardHeader
        badge={TEAMS_BY_CODE[code]!.abbr}
        title="Free Agency Summary"
        subtitle={`${s.season} · ${mySignings.length} signed`}
      />
      <Ticker
        stats={[
          { label: "Signed", value: mySignings.length },
          { label: "Roster", value: `${roster.length} / ${ROSTER_SIZE}`, className: roster.length > ROSTER_SIZE ? "bad" : undefined },
          { label: "Cap used", value: millions(used), className: used > total ? "bad" : "good" },
          { label: "Cap space", value: millions(Math.round((total - used) * 10) / 10), className: used > total ? "bad" : undefined },
        ]}
      />

      {error && (
        <div className="notice bad" role="status">
          {error}
        </div>
      )}

      <Tabs
        tabs={[
          { id: "yours", label: "Your Results" },
          { id: "league", label: "League Signings" },
          { id: "pool", label: "Remaining Pool" },
          {
            id: "budget",
            label: legal ? "Roster & Budget" : `Roster & Budget (${issues.length})`,
          },
        ]}
        active={active}
        onChange={setActive}
        label="Free agency summary"
      />

      <Panel id="yours" open={active === "yours"}>
        <p className="subhead" style={{ marginTop: 0 }}>
          Signed ({mySignings.length})
        </p>
        {mySignings.length === 0 ? (
          <div className="emptystate">You didn&rsquo;t sign anybody.</div>
        ) : (
          mySignings.map((sig, i) => {
            const p = s.players[sig.playerId];
            return (
              <div key={`${sig.playerId}-${i}`} className="lobby-row">
                <div>
                  <p className="pname">
                    {p?.name ?? sig.playerId}
                    <span className="ppos">{p?.position}</span>
                  </p>
                  <p className="lobby-sub">
                    Round {sig.round} · {millions(sig.salary)}/yr × {sig.years}y
                  </p>
                </div>
                <div className="lobby-actions">{p && <OvrPill value={p.overall} />}</div>
              </div>
            );
          })
        )}

        <p className="subhead">Outbid ({myLostBids.length})</p>
        {myLostBids.length === 0 ? (
          <div className="emptystate">You weren&rsquo;t outbid on anybody.</div>
        ) : (
          myLostBids.map((playerId) => {
            const p = s.players[playerId];
            const won = e.signed.find((x) => x.playerId === playerId)!;
            return (
              <div key={playerId} className="lobby-row">
                <div>
                  <p className="pname">
                    {p?.name ?? playerId}
                    <span className="ppos">{p?.position}</span>
                  </p>
                  <p className="lobby-sub">
                    Went to {TEAMS_BY_CODE[won.teamCode]?.label ?? won.teamCode} ·{" "}
                    {millions(won.salary)}/yr × {won.years}y
                  </p>
                </div>
                <div className="lobby-actions">
                  <TeamBadge code={won.teamCode} size={22} />
                </div>
              </div>
            );
          })
        )}
      </Panel>

      <Panel id="league" open={active === "league"}>
        {e.signed.length === 0 ? (
          <div className="emptystate">Nobody signed anywhere.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="stbl">
              <thead>
                <tr>
                  <th>Player</th>
                  <th className="c">Pos</th>
                  <th>Team</th>
                  <th className="c">Salary</th>
                  <th className="c">Yrs</th>
                  <th className="c">Rd</th>
                </tr>
              </thead>
              <tbody>
                {e.signed.map((sig, i) => {
                  const p = s.players[sig.playerId];
                  return (
                    <tr key={`${sig.playerId}-${i}`} className={sig.teamCode === code ? "highlight" : ""}>
                      <td className="name">{p?.name ?? sig.playerId}</td>
                      <td className="c">{p?.position}</td>
                      <td>{TEAMS_BY_CODE[sig.teamCode]?.abbr ?? sig.teamCode}</td>
                      <td className="c">{millions(sig.salary)}</td>
                      <td className="c">{sig.years}</td>
                      <td className="c">{sig.round}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel id="pool" open={active === "pool"}>
        <p style={{ margin: "0 0 12px", fontSize: 11.5, color: "var(--ink-faint)" }}>
          Still unsigned. They stay in the league-wide pool and are available again later.
        </p>
        {unsignedPool(s)
          .sort((a, b) => b.overall - a.overall)
          .slice(0, 60)
          .map((p) => (
            <div key={p.id} className="lobby-row">
              <div>
                <p className="pname">
                  {p.name}
                  <span className="ppos">{p.position}</span>
                </p>
                <p className="lobby-sub">
                  Age {p.age} · was asking {millions(expectedSalary(p))}/yr
                </p>
              </div>
              <div className="lobby-actions">
                <OvrPill value={p.overall} />
              </div>
            </div>
          ))}
      </Panel>

      <Panel id="budget" open={active === "budget"}>
        {legal ? (
          <div className="notice" role="status">
            <strong>You&rsquo;re legal.</strong> Under the cap, within the roster limit, and
            covered at every position.
          </div>
        ) : (
          <div className="notice bad" role="status">
            <strong>Not ready to advance.</strong>
            <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
              {issues.map((i, n) => (
                <li key={n} style={{ marginBottom: 3 }}>
                  {i.message}
                </li>
              ))}
            </ul>
          </div>
        )}

        <p className="subhead">Your roster ({roster.length})</p>
        {roster
          .slice()
          .sort((a, b) => (b.contract?.cap_hit_by_year[0] ?? 0) - (a.contract?.cap_hit_by_year[0] ?? 0))
          .map((p) => {
            const can = checkRelease(s, code, p.id);
            return (
              <div key={p.id} className="lobby-row">
                <div>
                  <p className="pname">
                    {p.name}
                    <span className="ppos">{p.position}</span>
                  </p>
                  <p className="lobby-sub">
                    {millions(p.contract?.cap_hit_by_year[0] ?? 0)}/yr ·{" "}
                    {p.contract?.years_remaining ?? 0}y left
                    {can.ok ? ` · release costs ${millions(releasePenalty(p))}` : ` · ${can.reason}`}
                  </p>
                </div>
                <div className="lobby-actions">
                  <OvrPill value={p.overall} />
                  <button
                    type="button"
                    className="btn-danger"
                    disabled={!can.ok || busy}
                    onClick={() => release(p.id)}
                  >
                    Release
                  </button>
                </div>
              </div>
            );
          })}
      </Panel>

      <Footer>
        <span style={{ flex: 1, fontSize: 11.5, color: "var(--ink-faint)", alignSelf: "center" }}>
          {legal
            ? "Advancing is final — you can't come back to free agency."
            : "Fix everything on Roster & Budget before you can advance."}
        </span>
        <button
          type="button"
          className="btn-primary"
          disabled={!legal || busy}
          onClick={() => {
            if (!confirm("Advance to Training Camp? You can't return to free agency.")) return;
            setBusy(true);
            void actions
              .readyUp(true)
              .then((res) => {
                if (!res.ok) setError(res.reason ?? "Couldn't advance.");
              })
              .finally(() => setBusy(false));
          }}
        >
          {legal ? "Advance to Training Camp" : "Roster not legal"}
        </button>
      </Footer>
    </Card>
  );
}
