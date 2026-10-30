import { pruneComparison } from "@/components/decisions/decision-view";
import { DecisionFrame, DecisionHeading, DecisionError, DecisionComparison, CompareToggle, DecisionSortControl, toggleComparison } from "@/components/decisions/DecisionWorkspace";
import { publicDecisionRow, sortDecisionRows, type DecisionSort } from "@/components/decisions/decision-view";
import { RosterFinance } from "@/components/roster/RosterFinance";
import { PlayerStatsModal } from "@/components/PlayerStatsModal";
import { getMotionLevel } from "@/motion/level";
import { SkipToggle } from "@/components/SkipToggle";
import { useStaffPlan } from "@/components/StaffPlan";
import { CommissionerTakeTurn } from "@/components/CommissionerTakeTurn";
import { StageLoading } from "@/components/StageLoading";
import { useEffect, useMemo, useRef, useState } from "react";
import { careerArc } from "@/state/careerArc";
import { useNavigate } from "react-router-dom";

import { OvrPill, TeamBadge } from "@/components/bits";
import { Card, CardHeader, Footer, Panel, Tabs, Ticker, useTabs } from "@/components/primitives";
import { FitTag } from "@/components/FitTag";
import { RosterNeeds } from "@/components/RosterNeeds";
import { TEAMS_BY_CODE } from "@/data/teams";
import { POSITIONS, type Player } from "@/domain";
import {
  chooseFaMove,
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
import { marketScale } from "@/state/capEconomy";
import { useLeagueActions } from "@/state/useLeagueActions";
import { millions, posLabel } from "@/util/format";

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
  const staff = useStaffPlan();
  const code = viewerTeamCode(s);
  const { active, setActive } = useTabs("unsigned");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [offering, setOffering] = useState<Player | null>(null);
  // the guard itself: busy state lags a render, and a second click on a spent
  // turn came back as "It isn't your turn"
  const acting = useRef(false);
  // ~400 players and only the first 80 on screen: a GM hunting a kicker
  // couldn't reach one
  const [search, setSearch] = useState("");
  const [displaySort,setDisplaySort] = useState<DecisionSort>("board");
  const [compared,setCompared] = useState<string[]>([]);
  const [inspecting,setInspecting] = useState<string|null>(null);
  const [limit,setLimit] = useState(80);
  const [posFilter, setPosFilter] = useState<string>("all");

  // The fifth round resolving ends the market and moves the stage on from
  // inside `freeAgencyTurn` itself — there is no gate to press, so nothing
  // here would otherwise notice. Without this the league advanced to the
  // summary while this screen went on showing a finished board with
  // "On the clock" and a Pass button that no longer did anything.
  const inMarket = s.stage === "freeAgency" || s.stage === "midseasonFreeAgency";
  useEffect(() => {
    if (!inMarket) nav("/", { replace: true });
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

  useEffect(() => { if (!yourTurn || !pool.some(p=>p.id===offering?.id)) setOffering(null); }, [yourTurn,pool,offering?.id]);
  useEffect(() => setOffering(null), [e?.round,e?.turnIndex]);
  useEffect(()=>setCompared(ids=>pruneComparison(ids,pool)),[pool]);
  if (!e || !code) {
    return (
      <Card>
        <CardHeader badge="FA" title="Free Agency" subtitle="Opening the market" />
        <div className="panel open">
          <StageLoading />
        </div>
      </Card>
    );
  }

  const act = (move: { playerId?: string; salary?: number; years?: number; pass?: boolean }) => {
    if (acting.current) return;
    acting.current = true;
    setBusy(true);
    setError(null);
    void actions
      .freeAgencyTurn(move)
      .then((res) => {
        if (!res.ok) setError(res.reason ?? "That didn't go through.");
        else setOffering(null);
      })
      .finally(() => {
        acting.current = false;
        setBusy(false);
      });
  };
  const team = s.teams[code];
  const capRoom = team ? Math.round((team.cap.total - team.cap.used) * 10) / 10 : 0;
  const shown = sortDecisionRows(pool.map(p=>({...p,rating:p.overall})),displaySort).filter(p=>(posFilter === "all" || p.position === posFilter)&&p.name.toLowerCase().includes(search.trim().toLowerCase()));
  const publicRows = pool.map(p=>publicDecisionRow(p,`${careerArc(p).label} · asks ${millions(expectedSalary(p,marketScale(s)))}/yr · ${PRIMARY_VALUE_LABEL[primaryValueOf(p)]}`));
  const selectedOffer = pool.find(p=>p.id===offering?.id);


  // still live: an offer stays on file after its player signs (with you or
  // anyone), and counting those said "1 offer out" beside a man you'd won
  const settled = new Set(e.signed.map((x) => x.playerId));
  const myOffers = Object.entries(e.offers)
    .filter(([playerId]) => !settled.has(playerId))
    .flatMap(([playerId, list]) => list.filter((o) => o.teamCode === code).map((o) => ({ playerId, ...o })));
  // how your bids came out in the round that just closed — the round used to
  // end silently, and a GM who'd just landed (or lost) his top target only
  // found out by going looking in the Signed tab
  const lastRound = e.round - 1;
  const lastResults =
    lastRound >= 1
      ? e.signed.filter((x) => x.round === lastRound && (e.offers[x.playerId] ?? []).some((o) => o.teamCode === code))
      : [];

  return (
    <DecisionFrame kind="market" code={code} focused={!!offering}><Card maxWidth={1440}>
      <DecisionHeading code={code} title={s.stage === "midseasonFreeAgency" ? "Mid-Season Free Agency" : "Free Agency"} subtitle={`Round ${e.round} of ${FREE_AGENCY_ROUNDS} · one offer or pass per round`}><p>{yourTurn ? "Your turn" : "On the clock"}</p><p>{clock ? TEAMS_BY_CODE[clock]?.label ?? clock : "Resolving"}</p></DecisionHeading>
      <Ticker
        stats={[
          { label: "Round", value: `${e.round} / ${FREE_AGENCY_ROUNDS}` },
          { label: "Unsigned", value: pool.length },
          { label: "Your offers out", value: myOffers.length },
          { label: "Signed so far", value: e.signed.length },
        ]}
      />

      <DecisionError message={error}/><div className="decision-layout"><div className="decision-main">

      {lastResults.length > 0 && (
        <div className="panel open" style={{ paddingBottom: 4 }}>
          <p className="subhead" style={{ marginTop: 0 }}>
            {/* only the players you bid on; "results" beside a ticker that
                counted every signing read as the whole round */}
            Round {lastRound} · your bids
          </p>
          {lastResults.map((x) => {
            const p = s.players[x.playerId];
            const won = x.teamCode === code;
            return (
              <div key={x.playerId} className="neg-row">
                <span style={{ fontSize: 12.5 }}>
                  {p?.name ?? x.playerId} <span className="ppos">{posLabel(p?.position)}</span> · {millions(x.salary)}/yr × {x.years}y
                </span>
                <span style={{ fontSize: 11.5, fontWeight: 600, color: won ? "var(--good)" : "var(--notice)" }}>
                  {won ? "Signed with you" : `Signed with ${TEAMS_BY_CODE[x.teamCode]?.abbr ?? x.teamCode}`}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {myOffers.length > 0 && (
        <div className="panel open" style={{ paddingBottom: 4 }}>
          <p className="subhead" style={{ marginTop: 0 }}>
            Your offers
          </p>
          {myOffers.map((o) => {
            const p = s.players[o.playerId];
            const lead = leadingOffer(s, o.playerId);
            const leading = lead?.teamCode === code;
            return (
              <div key={`${o.playerId}-${o.sequence}`} className="neg-row">
                <span style={{ fontSize: 12.5 }}>
                  {p?.name ?? o.playerId} <span className="ppos">{posLabel(p?.position)}</span> · {millions(o.salary)}/yr ×{" "}
                  {o.years}y
                </span>
                <span style={{ fontSize: 11.5, fontWeight: 600, color: leading ? "var(--good)" : "var(--notice)" }}>
                  {leading ? "Leading" : `Outbid by ${TEAMS_BY_CODE[lead?.teamCode ?? ""]?.abbr ?? "another team"}`}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {staff.card}
      {yourTurn && (
        <div className="notice" role="status">
          <strong>You&rsquo;re up.</strong> Make one offer or pass. Offers are binding and stay
          live until the player signs — the cap and roster limits are suspended until
          reconciliation, so you can bid for someone you can&rsquo;t yet fit.
          {/* at the top, where the decision is made, not under eighty rows */}
          <div style={{ marginTop: 8 }}>
            <button type="button" className="btnlink" disabled={busy} onClick={() => act({ pass: true })}>
              Pass this round
            </button>
            {" · "}
            {/* the staff plays the turn the way it would for a CPU team, led by your GM identity: shown first, done only on a yes */}
            <button
              type="button"
              className="btnlink"
              disabled={busy}
              onClick={() => {
                const st = useStore.getState();
                const move = chooseFaMove(st, code);
                if (move.kind === "pass") {
                  void staff
                    .ask({ title: "Your staff would pass this round.", lines: ["Nobody on the board is worth a bid."], yes: "Pass" })
                    .then((ok) => ok && act({ pass: true }));
                  return;
                }
                const p = st.players[move.playerId];
                const what = p ? `${p.name} (${posLabel(p.position)} ${p.overall}, age ${p.age})` : "a free agent";
                void staff
                  .ask({
                    title: "Your staff would make this offer:",
                    lines: [`${what}: ${millions(move.salary)} a year for ${move.years} year${move.years === 1 ? "" : "s"}`],
                    note: "Offers are binding and stay live until the player signs.",
                    yes: "Make the offer",
                  })
                  .then((ok) => ok && act({ playerId: move.playerId, salary: move.salary, years: move.years }));
              }}
            >
              Let my staff take this turn
            </button>
          </div>
        </div>
      )}
      <SkipToggle kind="freeAgency" />
      {/* eighty greyed-out Offer buttons and nothing saying why */}
      {!yourTurn && clock && code && (
        <div className="notice" role="status">
          {TEAMS_BY_CODE[clock]?.label ?? clock} is on the clock.{" "}
          {/* after a team's turn in the last round, "it opens when your turn
              comes round" promised a turn that was never coming */}
          {e.order.indexOf(code) < e.turnIndex && e.round >= FREE_AGENCY_ROUNDS
            ? "That was your last turn in this market — it closes once the rest of the league has gone. Offers you have out still count."
            : "Browse the board and line up your offer — it opens when your turn comes round."}
          <CommissionerTakeTurn team={clock} />
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
        <div className="decision-toolbar"><label>Search players <input type="search" value={search} onChange={ev=>setSearch(ev.target.value)} placeholder="Find a player"/></label><DecisionSortControl value={displaySort} onChange={setDisplaySort}/>
          <label htmlFor="fa-sort" style={{ fontSize: 11.5, color: "var(--ink-faint)" }}>
            Sort
          </label>
          <select id="fa-sort" value={sortBy} onChange={(ev) => setSortBy(ev.target.value as "value" | "fit")}>
            <option value="value">Best value (rating + position)</option>
            <option value="fit">Best fit for your units</option>
          </select>
          <select aria-label="Position" value={posFilter} onChange={(ev) => setPosFilter(ev.target.value)}>
            <option value="all">All positions</option>
            {POSITIONS.filter((pos) => pool.some((p) => p.position === pos)).map((pos) => (
              <option key={pos} value={pos}>
                {posLabel(pos)}
              </option>
            ))}
          </select>
          <span style={{ fontSize: 11, color: "var(--ink-faint)" }}>
            {shown.length > limit ? `Showing ${limit} of ${shown.length}` : `${shown.length} shown`}
          </span>
        </div>
        {shown.length === 0 ? (
          <div className="emptystate">{pool.length === 0 ? "Everybody has signed." : "Nobody left at that position."}</div>
        ) : (
          shown.slice(0, limit).map((p) => {
            const lead = leadingOffer(s, p.id);
            const ask = expectedSalary(p, marketScale(s));
            const isOffering = offering?.id === p.id;
            return (
              <div key={p.id} data-player-id={p.id}>
                <div className="lobby-row">
                  <div>
                    <p className="pname">
                      {p.name}
                      <span className="ppos">{posLabel(p.position)}</span>
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
                      <p className="lobby-sub" style={{ color: lead.teamCode === code ? "var(--good)" : "var(--accent)" }}>
                        Leading: {lead.teamCode === code ? "you" : (TEAMS_BY_CODE[lead.teamCode]?.abbr ?? lead.teamCode)} ·{" "}
                        {millions(lead.salary)}/yr × {lead.years}y
                      </p>
                    )}
                  </div>
                  <div className="lobby-actions">
                    <OvrPill value={p.overall} /><button type="button" className="btnlink" aria-label={`Player details ${p.name}`} onClick={()=>setInspecting(p.id)}>Details</button><CompareToggle row={publicRows.find(row=>row.id===p.id)!} selected={compared} onToggle={id=>setCompared(ids=>toggleComparison(ids,id))}/>
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
              </div>
            );
          })
        )}
        {shown.length>limit&&<button type="button" onClick={()=>setLimit(n=>n+80)}>Show more players</button>}
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
                    <span className="ppos">{posLabel(p?.position)}</span>
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
      </Footer>
      </div><aside className="decision-sidebar" aria-label="Free agency player workspace">

        {selectedOffer&&yourTurn ? <OfferDialog key={selectedOffer.id} player={selectedOffer} lead={(()=>{const lead=leadingOffer(s,selectedOffer.id);return lead&&lead.teamCode!==code?lead:null;})()} capRoom={capRoom} busy={busy} onCancel={()=>setOffering(null)} onSubmit={(salary,years)=>act({playerId:selectedOffer.id,salary,years})}/> : <section className="decision-context"><h2>Build your next offer</h2><p>Select Offer on a player to review their asking price, preferences and the current leading offer.</p><p>Offers stay pending until the round resolves. Cap and roster limits return at reconciliation.</p></section>}
        <DecisionComparison rows={publicRows} ids={compared} onClear={()=>setCompared([])}/>
        {team&&<RosterFinance total={team.cap.total} used={team.cap.used} room={capRoom} dead={team.cap.dead}/>}
      </aside></div>
      {inspecting&&s.players[inspecting]&&<PlayerStatsModal player={s.players[inspecting]!} onClose={()=>setInspecting(null)}/>}
    </Card></DecisionFrame>
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
  lead,
  capRoom,
  busy,
  onCancel,
  onSubmit,
}: {
  player: Player;
  /** Another team's offer currently in front, if any — the number to beat. */
  lead: { teamCode: string; salary: number; years: number } | null;
  /** This team's cap room now, before this offer. */
  capRoom: number;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (salary: number, years: number) => void;
}) {
  const ask = expectedSalary(player, marketScale({ capScale: useStore((st) => st.capScale) }));
  const [salary, setSalary] = useState(String(ask));
  const [years, setYears] = useState("3");
  const value = Number(salary);
  const short = Number.isFinite(value) && value < ask;
  // it opens above the list, often off-screen from the row that was
  // clicked — "Offer" looked like it did nothing
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous=document.activeElement as HTMLElement|null;
    box.current?.scrollIntoView({ block: "nearest", behavior: getMotionLevel()==="off" ? "auto" : "smooth" });
    box.current?.querySelector("input")?.focus({ preventScroll: true });
    return ()=>{if(previous?.isConnected) previous.focus({preventScroll:true});};
  }, [player.id]);

  return (
    <div ref={box} className="lobby-claim" style={{ marginTop: 16 }} role="group" aria-label={`Offer to ${player.name}`}>
      <p className="subhead" style={{ marginTop: 0 }}>
        Offer to {player.name} ({posLabel(player.position)})
      </p>
      <p style={{ margin: "0 0 12px", fontSize: 11.5, color: "var(--ink-dim)" }}>
        He&rsquo;s asking {millions(ask)}/yr and cares most about{" "}
        {PRIMARY_VALUE_LABEL[primaryValueOf(player)].toLowerCase()}. An offer below the asking price
        can&rsquo;t be accepted, however good the fit.
      </p>
      {lead && (
        <p style={{ margin: "0 0 12px", fontSize: 11.5, color: "var(--ink)" }}>
          <strong>{TEAMS_BY_CODE[lead.teamCode]?.label ?? lead.teamCode}</strong> lead at{" "}
          {millions(lead.salary)}/yr &times; {lead.years}. Offers are compared on more than salary, but that is
          the one to beat.
        </p>
      )}
      <div className="lobby-form inline">
        <label>
          <span>Salary ($M/yr)</span>
          <input
            type="number"
            // a phone's decimal keypad, not the full keyboard's number row
            inputMode="decimal"
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
      {/* the cap is suspended while bidding, but it comes back */}
      <p style={{ margin: "8px 0 0", fontSize: 11.5, color: "var(--ink-dim)" }}>
        Cap room now {millions(capRoom)}
        {Number.isFinite(value) && value > 0
          ? ` · ${millions(Math.round((capRoom - value) * 10) / 10)} if he signs`
          : ""}
        {Number.isFinite(value) && capRoom - value < 0 ? " — you'd have to clear room at reconciliation." : "."}
      </p>
      <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
        <button
          type="button"
          className="btn-primary"
          // below the ask he can't accept, and submitting would spend the turn
          disabled={busy || !Number.isFinite(value) || value <= 0 || short}
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
