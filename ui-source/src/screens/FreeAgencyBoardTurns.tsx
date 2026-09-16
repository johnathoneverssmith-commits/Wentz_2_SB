import { useMemo, useState } from "react";

import { OvrPill, TeamBadge } from "@/components/bits";
import { Card, CardHeader, Footer, Panel, Tabs, Ticker, useTabs } from "@/components/primitives";
import { RosterNeeds } from "@/components/RosterNeeds";
import { TEAMS_BY_CODE } from "@/data/teams";
import type { Player } from "@/domain";
import {
  FREE_AGENCY_ROUNDS,
  leadingOffer,
  onTheClock,
  unsignedPool,
} from "@/state/freeAgencyEvent";
import {
  expectedSalary,
  PRIMARY_VALUE_LABEL,
  primaryValueOf,
} from "@/state/freeAgencyValues";
import { viewerTeamCode } from "@/state/selectors";
import { useStore } from "@/state/store";
import { useLeagueActions } from "@/state/useLeagueActions";
import { millions } from "@/util/format";

/**
 * Turn-based free agency.
 *
 * One offer or one pass per turn, and nothing signs until the round ends —
 * which is why the board shows the leading offer on every player rather than
 * a signing. A GM's whole decision is "is that beatable, and is he worth
 * beating it for", so the leading bid has to be visible or there is nothing
 * to decide against.
 *
 * Each player shows what he is asking and what he cares about. The asking
 * price is a hard floor — an offer under it is not eligible whatever else it
 * has — and the motive is what decides between offers that clear it. Both are
 * on the row because a GM guessing at either is just bidding blind.
 */
export function FreeAgencyBoardTurns() {
  const s = useStore();
  const actions = useLeagueActions();
  const code = viewerTeamCode(s);
  const { active, setActive } = useTabs("unsigned");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [offering, setOffering] = useState<Player | null>(null);

  const e = s.freeAgencyEvent;
  const clock = onTheClock(s);
  const yourTurn = !!code && clock === code;

  const myRoster = useMemo(
    () =>
      Object.values(s.players).filter(
        (p) => p.nfl_team === code && !p.retired && !p.free_agent,
      ),
    [s.players, code],
  );

  const pool = useMemo(
    () => unsignedPool(s).sort((a, b) => b.overall - a.overall),
    [s.players, s.freeAgencyEvent], // eslint-disable-line react-hooks/exhaustive-deps
  );

  if (!e || !code) {
    return (
      <Card>
        <CardHeader badge="FA" title="Free Agency" subtitle="Opening the market" />
        <div className="panel open">
          <div className="emptystate">One moment.</div>
        </div>
      </Card>
    );
  }

  const act = (move: { playerId?: string; salary?: number; years?: number; pass?: boolean }) => {
    setBusy(true);
    setError(null);
    void actions
      .freeAgencyTurn(move)
      .then((res) => {
        if (!res.ok) setError(res.reason ?? "That didn't go through.");
        else setOffering(null);
      })
      .finally(() => setBusy(false));
  };

  const myOffers = Object.entries(e.offers).flatMap(([playerId, list]) =>
    list.filter((o) => o.teamCode === code).map((o) => ({ playerId, ...o })),
  );

  return (
    <Card maxWidth={920}>
      <CardHeader
        badge={TEAMS_BY_CODE[code]!.abbr}
        title="Free Agency"
        subtitle={`Round ${e.round} of ${FREE_AGENCY_ROUNDS} · one offer or pass per round`}
        right={
          <>
            <p>{yourTurn ? "Your turn" : "On the clock"}</p>
            <p>{clock ? TEAMS_BY_CODE[clock]?.label ?? clock : "Resolving"}</p>
          </>
        }
      />
      <Ticker
        stats={[
          { label: "Round", value: `${e.round} / ${FREE_AGENCY_ROUNDS}` },
          { label: "Unsigned", value: pool.length },
          { label: "Your offers out", value: myOffers.length },
          { label: "Signed so far", value: e.signed.length },
        ]}
      />

      {error && (
        <div className="notice bad" role="status">
          {error}
        </div>
      )}

      {yourTurn && (
        <div className="notice" role="status">
          <strong>You&rsquo;re up.</strong> Make one offer or pass. Offers are binding and stay
          live until the player signs — the cap and roster limits are suspended until
          reconciliation, so you can bid for someone you can&rsquo;t yet fit.
        </div>
      )}

      <Tabs
        tabs={[
          { id: "unsigned", label: `Unsigned (${pool.length})` },
          { id: "needs", label: "Roster Needs" },
          { id: "signed", label: `Signed (${e.signed.length})` },
        ]}
        active={active}
        onChange={setActive}
        label="Free agency"
      />

      <Panel id="unsigned" open={active === "unsigned"}>
        {pool.length === 0 ? (
          <div className="emptystate">Everybody has signed.</div>
        ) : (
          pool.slice(0, 80).map((p) => {
            const lead = leadingOffer(s, p.id);
            const ask = expectedSalary(p);
            return (
              <div key={p.id} className="lobby-row">
                <div>
                  <p className="pname">
                    {p.name}
                    <span className="ppos">{p.position}</span>
                  </p>
                  <p className="lobby-sub">
                    Age {p.age} · asking {millions(ask)}/yr · wants{" "}
                    {PRIMARY_VALUE_LABEL[primaryValueOf(p)]}
                  </p>
                  {lead && (
                    <p className="lobby-sub" style={{ color: "var(--accent)" }}>
                      Leading: {TEAMS_BY_CODE[lead.teamCode]?.abbr ?? lead.teamCode} ·{" "}
                      {millions(lead.salary)}/yr × {lead.years}y
                    </p>
                  )}
                </div>
                <div className="lobby-actions">
                  <OvrPill value={p.overall} />
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={!yourTurn || busy}
                    onClick={() => setOffering(p)}
                  >
                    Offer
                  </button>
                </div>
              </div>
            );
          })
        )}
      </Panel>

      <Panel id="needs" open={active === "needs"}>
        <RosterNeeds roster={myRoster} />
      </Panel>

      <Panel id="signed" open={active === "signed"}>
        {e.signed.length === 0 ? (
          <div className="emptystate">Nobody has signed yet — signings happen when a round ends.</div>
        ) : (
          [...e.signed].reverse().map((sig, i) => {
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
                <div className="lobby-actions">
                  <TeamBadge code={sig.teamCode} size={22} />
                </div>
              </div>
            );
          })
        )}
      </Panel>

      <Footer>
        <span style={{ flex: 1, fontSize: 11.5, color: "var(--ink-faint)", alignSelf: "center" }}>
          Nothing signs until every team has acted this round.
        </span>
        <button
          type="button"
          className="btnlink"
          disabled={!yourTurn || busy}
          onClick={() => act({ pass: true })}
        >
          Pass this round
        </button>
      </Footer>

      {offering && (
        <OfferDialog
          player={offering}
          busy={busy}
          onCancel={() => setOffering(null)}
          onSubmit={(salary, years) => act({ playerId: offering.id, salary, years })}
        />
      )}
    </Card>
  );
}

/**
 * Making one offer.
 *
 * Opens at the asking price rather than empty, because that is the number
 * that matters — anything under it cannot be accepted at all — and a GM who
 * wants to beat somebody can move up from a floor rather than guess at one.
 */
function OfferDialog({
  player,
  busy,
  onCancel,
  onSubmit,
}: {
  player: Player;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (salary: number, years: number) => void;
}) {
  const ask = expectedSalary(player);
  const [salary, setSalary] = useState(String(ask));
  const [years, setYears] = useState("3");
  const value = Number(salary);
  const short = Number.isFinite(value) && value < ask;

  return (
    <div className="lobby-claim" style={{ marginTop: 16 }}>
      <p className="subhead" style={{ marginTop: 0 }}>
        Offer to {player.name} ({player.position})
      </p>
      <p style={{ margin: "0 0 12px", fontSize: 11.5, color: "var(--ink-dim)" }}>
        He&rsquo;s asking {millions(ask)}/yr and cares most about{" "}
        {PRIMARY_VALUE_LABEL[primaryValueOf(player)]}. An offer below the asking price
        can&rsquo;t be accepted, however good the fit.
      </p>
      <div className="lobby-form inline">
        <label>
          <span>Salary ($M/yr)</span>
          <input
            type="number"
            min={0.1}
            step={0.1}
            value={salary}
            onChange={(ev) => setSalary(ev.target.value)}
          />
        </label>
        <label>
          <span>Years</span>
          <select value={years} onChange={(ev) => setYears(ev.target.value)}>
            {[1, 2, 3, 4, 5].map((y) => (
              <option key={y} value={String(y)}>
                {y}
              </option>
            ))}
          </select>
        </label>
      </div>
      {short && (
        <p style={{ margin: "8px 0 0", fontSize: 11.5, color: "var(--bad)" }}>
          Below his asking price — he can&rsquo;t accept this.
        </p>
      )}
      <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
        <button
          type="button"
          className="btn-primary"
          disabled={busy || !Number.isFinite(value) || value <= 0}
          onClick={() => onSubmit(Math.round(value * 10) / 10, Number(years))}
        >
          {busy ? "Submitting…" : "Submit offer"}
        </button>
        <button type="button" className="btnlink" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
      <p style={{ margin: "10px 0 0", fontSize: 11, color: "var(--ink-faint)" }}>
        Binding once submitted. It ends your turn and stays live until he signs.
      </p>
    </div>
  );
}
