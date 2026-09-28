import { useEffect, useMemo, useState } from "react";
import { careerArc } from "@/state/careerArc";
import { useNavigate } from "react-router-dom";

import { OvrPill, TeamBadge } from "@/components/bits";
import { Card, CardHeader, Footer, Panel, Tabs, Ticker, useTabs } from "@/components/primitives";
import { FitTag } from "@/components/FitTag";
import { RosterNeeds } from "@/components/RosterNeeds";
import { TEAMS_BY_CODE } from "@/data/teams";
import type { Player } from "@/domain";
import { STAGE_HOME } from "@/state/stageMachine";
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
import { fitFor } from "@/state/unitReport";
import { draftValue, useStore } from "@/state/store";
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
  const nav = useNavigate();
  const actions = useLeagueActions();
  const code = viewerTeamCode(s);
  const { active, setActive } = useTabs("unsigned");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [offering, setOffering] = useState<Player | null>(null);

  // The fifth round resolving ends the market and moves the stage on from
  // inside `freeAgencyTurn` itself — there is no gate to press, so nothing
  // here would otherwise notice. Without this the league advanced to the
  // summary while this screen went on showing a finished board with
  // "On the clock" and a Pass button that no longer did anything.
  const inMarket = s.stage === "freeAgency" || s.stage === "midseasonFreeAgency";
  useEffect(() => {
    if (!inMarket) nav(STAGE_HOME[s.stage], { replace: true });
  }, [inMarket, s.stage, nav]);

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

  const [sortBy, setSortBy] = useState<"value" | "fit">("value");
  const fit = useMemo(() => (code ? fitFor({ players: s.players }, code) : null), [s.players, code]);

  const pool = useMemo(
    // Position-adjusted, the same way the draft board is: sorted on raw
    // overall, an 84 punter and an 84 kicker outrank every starter in the
    // market and the top of the list stops meaning anything. `draftValue` is
    // the league's own view of what a position is worth.
    // "Best fit" sorts by what a player would add to your starting units —
    // the reading the Master AI signs by — so a GM can see a line with one
    // hole in it is worth more than another star at a full position.
    () => {
      const list = unsignedPool(s);
      if (sortBy === "fit" && fit) {
        const g = new Map(list.map((p) => [p.id, fit(p.position, p.overall).gain]));
        return list.sort(
          (a, b) =>
            g.get(b.id)! - g.get(a.id)! ||
            draftValue(b.overall, b.position) - draftValue(a.overall, a.position),
        );
      }
      return list.sort((a, b) => draftValue(b.overall, b.position) - draftValue(a.overall, a.position));
    },
    [s.players, s.freeAgencyEvent, sortBy, fit], // eslint-disable-line react-hooks/exhaustive-deps
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

  // still live: an offer stays on file after its player signs (with you or
  // anyone), and counting those said "1 offer out" beside a man you'd won
  const settled = new Set(e.signed.map((x) => x.playerId));
  const myOffers = Object.entries(e.offers)
    .filter(([playerId]) => !settled.has(playerId))
    .flatMap(([playerId, list]) => list.filter((o) => o.teamCode === code).map((o) => ({ playerId, ...o })));

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
        <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 12 }}>
          <label htmlFor="fa-sort" style={{ fontSize: 11.5, color: "var(--ink-faint)" }}>
            Sort
          </label>
          <select id="fa-sort" value={sortBy} onChange={(ev) => setSortBy(ev.target.value as "value" | "fit")}>
            <option value="value">Best value (rating + position)</option>
            <option value="fit">Best fit for your units</option>
          </select>
        </div>
        {pool.length === 0 ? (
          <div className="emptystate">Everybody has signed.</div>
        ) : (
          pool.slice(0, 80).map((p) => {
            const lead = leadingOffer(s, p.id);
            const ask = expectedSalary(p);
            const isOffering = offering?.id === p.id;
            return (
              <div key={p.id}>
                <div className="lobby-row">
                  <div>
                    <p className="pname">
                      {p.name}
                      <span className="ppos">{p.position}</span>
                      {fit && <FitTag fit={fit(p.position, p.overall)} />}
                    </p>
                    <p className="lobby-sub">
                      Age {p.age}{" "}
                      <span style={{ color: careerArc(p).color }} title={careerArc(p).hint}>
                        ({careerArc(p).label})
                      </span>{" "}
                      · asking {millions(ask)}/yr · wants{" "}
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
                      aria-label={isOffering ? `Cancel offer to ${p.name}` : `Offer ${p.name}`}
                      onClick={() => setOffering(isOffering ? null : p)}
                    >
                      {isOffering ? "Cancel" : "Offer"}
                    </button>
                  </div>
                </div>
                {isOffering && (
                  <OfferDialog
                    player={p}
                    busy={busy}
                    onCancel={() => setOffering(null)}
                    onSubmit={(salary, years) => act({ playerId: p.id, salary, years })}
                  />
                )}
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
