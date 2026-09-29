import { useMemo, useRef, useState } from "react";
import { PAST_DEADLINE_MESSAGE, pastTradeDeadline } from "@/state/tradeDeadline";
import { tradeUnitImpact } from "@/state/unitReport";
import { useNavigate } from "react-router-dom";

import { pressable } from "@/components/bits";
import { useListFilter } from "@/components/ListFilter";
import { Card, Footer } from "@/components/primitives";
import { TEAMS, TEAMS_BY_CODE } from "@/data/teams";
import { MockSimulationService } from "@/sim/MockSimulationService";
import {
  futureDiscount,
  pickKey,
  pickLabel,
  picksOwnedBy,
  tradedPickLabel,
} from "@/state/draftPicks";
import { pickTradeValue } from "@/sim/MockSimulationService";
import { checkTrade, useStore } from "@/state/store";
import { useLeagueActions } from "@/state/useLeagueActions";
import { teamRoster, viewerTeamCode } from "@/state/selectors";
import { ordinal } from "@/util/format";

const sim = new MockSimulationService();

export function TradeProposal() {
  const nav = useNavigate();
  const s = useStore();
  const myCode = viewerTeamCode(s);
  const actions = useLeagueActions();
  const proposeTrade = useStore((st) => st.proposeTrade);
  const castVote = useStore((st) => st.castTradeVote);
  const resolveTrade = useStore((st) => st.resolveTrade);

  const [partner, setPartner] = useState(() => TEAMS.find((t) => t.code !== myCode && s.teams[t.code])!.code);
  const [give, setGive] = useState<string[]>([]);
  const [get, setGet] = useState<string[]>([]);
  const [tradeId, setTradeId] = useState<string | null>(null);
  // a refusal from the server, which arrives after the click rather than
  // before it — locally `checkTrade` has already greyed the button out
  const [onlineError, setOnlineError] = useState<string | null>(null);
  // one answer in flight: a second click on Accept used to report the trade
  // "could not be accepted" after the first had already accepted it
  const [responding, setResponding] = useState<string | null>(null);
  const [proposing, setProposing] = useState(false);
  const [onlineResult, setOnlineResult] = useState<{ ok: boolean; text: string } | null>(null);
  // online the season's weeks are played ahead of time, so rosters are
  // frozen through them — the server refuses a trade; say so before one is built
  const tradingClosed = actions.online && (s.stage === "preseason" || s.stage === "regularSeason");
  const pastDeadline = pastTradeDeadline(s);
  // the guard itself: state lags a render, so two quick clicks both passed it
  const inFlight = useRef(false);
  const respond = (id: string, accept: boolean): void => {
    if (inFlight.current) return;
    inFlight.current = true;
    setResponding(id);
    setOnlineError(null);
    void actions
      .respondToTrade(id, accept)
      .then((res) => {
        if (!res.ok) {
          setOnlineError(res.reason ?? `That trade could not be ${accept ? "accepted" : "declined"}.`);
        }
      })
      .finally(() => {
        inFlight.current = false;
        setResponding(null);
      });
  };

  // live cap/roster preview of the deal as it's being built
  const assetOf = (id: string) =>
    id.startsWith("pick:")
      ? { kind: "pick" as const, pick: s.draftPicks[id.slice(5)] }
      : { kind: "player" as const, playerId: id };
  const legality = useMemo(
    () =>
      !myCode || (give.length === 0 && get.length === 0)
        ? { ok: true }
        : checkTrade(s, {
            fromTeam: myCode,
            toTeam: partner,
            // picks ride in the same lists under a `pick:` id; read as players
            // they were never on either roster, so any deal with a pick in it
            // was refused as "stale"
            fromAssets: give.map(assetOf),
            toAssets: get.map(assetOf),
          }),
    [s, myCode, partner, give, get],
  );

  /** Picks appear in the same lists as players, under a `pick:` id. */
  // where this year's picks would fall if the season ended today
  const standing = useMemo(() => {
    const order = Object.keys(s.teams).sort(
      (a, b) =>
        s.teams[a]!.wins - s.teams[b]!.wins || s.teams[b]!.losses - s.teams[a]!.losses || a.localeCompare(b),
    );
    return new Map(order.map((c, i) => [c, i + 1]));
  }, [s.teams]);
  const projectedSlot = (pk: { year: number; round: number; originalTeam: string }): string => {
    const played = Object.values(s.teams).some((t) => t.wins + t.losses > 0);
    if (!played || pk.year !== s.season) return ""; // this season's draft
    const slot = standing.get(pk.originalTeam);
    const n = Object.keys(s.teams).length;
    return slot ? ` · projected #${(pk.round - 1) * n + slot}` : "";
  };

  const pickRows = (code: string) =>
    picksOwnedBy(s, code).map((pk) => ({
      id: `pick:${pickKey(pk.year, pk.round, pk.originalTeam)}`,
      name: pickLabel(pk) + projectedSlot(pk),
      position: "PICK",
      overall: 0,
      badge: `R${pk.round}`,
    }));

  const myRoster = useMemo(
    () => (myCode ? [...pickRows(myCode), ...teamRoster(s, myCode)] : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [s, myCode],
  );
  const theirRoster = useMemo(
    () => [...pickRows(partner), ...teamRoster(s, partner)],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [s, partner],
  );

  const toAssets = (ids: string[]) => ids.map(assetOf);

  const evalResult = useMemo(() => {
    if (!myCode) return { valueDelta: 0, acceptLikelihood: 0.5 };
    return sim.evaluateTrade(s, myCode, partner, toAssets(give), toAssets(get));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s, myCode, partner, give, get]);

  // what this trade does to your starting units, the way the engine reads them
  const unitImpact = useMemo(
    () =>
      myCode
        ? tradeUnitImpact(
            s,
            myCode,
            give.filter((id) => !id.startsWith("pick:")),
            get.filter((id) => !id.startsWith("pick:")),
          )
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [s.players, s.teams, s.depthChart, myCode, give, get],
  );

  const involves90 = [...give, ...get].some((id) => (s.players[id]?.overall ?? 0) >= 90);
  const partnerIsHuman = s.gms.some((g) => g.isHuman && g.teamCode === partner);
  const needsVote = involves90 && (partnerIsHuman || true /* viewer is human */);

  const trade = tradeId ? s.trades.find((t) => t.id === tradeId) : undefined;
  const offers = s.trades.filter((t) => t.status === "offered" && t.toTeam === myCode);
  // yours, still waiting on the other GM: the form clears when you send one,
  // and nothing on the screen said it was out there
  const outgoing = s.trades.filter((t) => t.status === "offered" && t.fromTeam === myCode);
  // what came of your offers to other GMs — the answer arrives whenever they
  // get to it, and it used to show up only as a line on the wire
  const answered = s.trades
    .filter(
      (t) =>
        t.fromTeam === myCode &&
        (t.status === "accepted" || t.status === "rejected" || t.status === "blocked") &&
        s.gms.some((g) => g.isHuman && g.teamCode === t.toTeam),
    )
    .slice(-3)
    .reverse();
  const describe = (assets: (typeof s.trades)[number]["fromAssets"]): string =>
    assets
      .map((a) =>
        a.kind === "pick" && a.pick ? tradedPickLabel(a.pick) : (s.players[a.playerId ?? ""]?.name ?? "a player"),
      )
      .join(" + ") || "nothing";
  const gmName = (team: string) => s.gms.find((g) => g.isHuman && g.teamCode === team)?.name;

  // the bars have to price a pick too, or a first-rounder reads as worth nothing
  const assetVal = (id: string): number => {
    if (id.startsWith("pick:")) {
      const pk = s.draftPicks[id.slice(5)];
      return pk ? Math.round(pickTradeValue(pk.round) * futureDiscount(pk, s.season)) : 0;
    }
    return Math.max(0, (s.players[id]?.overall ?? 0) - 50);
  };
  const giveVal = give.reduce((n, id) => n + assetVal(id), 0);
  const getVal = get.reduce((n, id) => n + assetVal(id), 0);
  const total = giveVal + getVal || 1;

  if (!myCode) {
    return (
      <Card maxWidth={880}>
        <div className="panel open">
          <div className="emptystate">Pick a team in League Setup first.</div>
        </div>
      </Card>
    );
  }

  return (
    <Card maxWidth={880} twoTeam>
      <div className="header two-team">
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div className="badge" style={{ background: "var(--team)" }}>
            {TEAMS_BY_CODE[myCode]!.abbr}
          </div>
          <span style={{ fontSize: 12, color: "rgba(255,255,255,0.5)" }}>⇄</span>
          <div className="badge" style={{ background: "var(--partner)" }}>
            {TEAMS_BY_CODE[partner]!.abbr}
          </div>
          <div style={{ marginLeft: 6 }}>
            <h1 style={{ fontSize: 12, letterSpacing: "0.08em", color: "rgba(255,255,255,0.55)" }}>Trade Proposal</h1>
            <p style={{ fontSize: 17, fontWeight: 600, margin: "3px 0 0" }}>
              {TEAMS_BY_CODE[myCode]!.label} ↔ {TEAMS_BY_CODE[partner]!.label}
            </p>
          </div>
        </div>
        <select
          aria-label="Trade partner"
          value={partner}
          onChange={(e) => {
            setPartner(e.target.value);
            setGet([]);
            setTradeId(null);
            // the last answer was about another team
            setOnlineResult(null);
          }}
        >
          {TEAMS.filter((t) => t.code !== myCode && s.teams[t.code]).map((t) => (
            <option key={t.code} value={t.code}>
              {t.city} {t.name}
            </option>
          ))}
        </select>
      </div>

      {/* Offers the league made you. Every trade in the game used to start
          with the human — the phone never rang, which is half of what makes
          the job feel like a job. */}
      {offers.length > 0 && (
        <div style={{ padding: "18px 26px 4px", borderBottom: "1px solid var(--line)" }}>
          <p className="sectionlabel" style={{ marginTop: 0 }}>
            Offers on the table ({offers.length})
          </p>
          {offers.map((o) => {
            // picks too: an ask for a pick read "want" and then nothing
            const asked = describe(o.toAssets);
            const back = describe(o.fromAssets);
            const from = gmName(o.fromTeam);
            return (
              <div key={o.id} className="neg-row" style={{ alignItems: "flex-start", gap: 14 }}>
                <div style={{ flex: 1 }}>
                  <p style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>
                    {from ? `${from} (${TEAMS_BY_CODE[o.fromTeam]?.label ?? o.fromTeam})` : (TEAMS_BY_CODE[o.fromTeam]?.label ?? o.fromTeam)}{" "}
                    {from ? "wants" : "want"} {asked}
                  </p>
                  <p style={{ margin: "3px 0 0", fontSize: 12, color: "var(--ink-dim)" }}>
                    They're offering {back}.
                  </p>
                  {o.blockedReason && <p className="form-error">{o.blockedReason}</p>}
                </div>
                <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                  <button
                    className="btn-primary"
                    disabled={responding !== null || tradingClosed || pastDeadline}
                    title={tradingClosed ? "Trades complete at the next break in the season" : pastDeadline ? PAST_DEADLINE_MESSAGE : undefined}
                    onClick={() => respond(o.id, true)}
                  >
                    {responding === o.id ? "Working…" : "Accept"}
                  </button>
                  <button disabled={responding !== null} onClick={() => respond(o.id, false)}>
                    Decline
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {pastDeadline && !tradingClosed && (
        <div className="notice" role="status" style={{ margin: "14px 26px 0" }}>
          {PAST_DEADLINE_MESSAGE} Offers already on the table can still be turned down.
        </div>
      )}
      {tradingClosed && (
        <div className="notice" role="status" style={{ margin: "14px 26px 0" }}>
          Trading is closed while this stretch of the season plays out — the games are already
          decided with today&rsquo;s rosters. It opens again at the trade deadline and in the
          offseason.
        </div>
      )}

      {outgoing.length > 0 && (
        <div style={{ padding: "14px 26px 4px", borderBottom: "1px solid var(--line)" }}>
          <p className="sectionlabel" style={{ marginTop: 0 }}>
            Your offers awaiting a reply ({outgoing.length})
          </p>
          {outgoing.map((o) => (
            <div key={o.id} className="neg-row">
              <span style={{ fontSize: 12.5 }}>
                To {gmName(o.toTeam) ?? TEAMS_BY_CODE[o.toTeam]?.label ?? o.toTeam}: {describe(o.fromAssets)} for{" "}
                {describe(o.toAssets)}
              </span>
              <span style={{ fontSize: 11, color: "var(--ink-faint)" }}>Waiting</span>
            </div>
          ))}
        </div>
      )}

      {answered.length > 0 && (
        <div style={{ padding: "14px 26px 4px", borderBottom: "1px solid var(--line)" }}>
          <p className="sectionlabel" style={{ marginTop: 0 }}>
            Answered
          </p>
          {answered.map((o) => (
            <div key={o.id} className="neg-row">
              <span style={{ fontSize: 12.5 }}>
                To {gmName(o.toTeam) ?? TEAMS_BY_CODE[o.toTeam]?.label ?? o.toTeam}: {describe(o.fromAssets)} for{" "}
                {describe(o.toAssets)}
              </span>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: o.status === "accepted" ? "var(--good)" : "var(--bad)",
                }}
              >
                {o.status === "accepted" ? "Accepted" : o.status === "blocked" ? "Blocked by the league" : "Turned down"}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="split-2">
        <TradeColumn
          title={`${TEAMS_BY_CODE[myCode]!.label} sends`}
          role="you"
          roster={myRoster}
          selected={give}
          onToggle={(id) => setGive((g) => (g.includes(id) ? g.filter((x) => x !== id) : [...g, id]))}
        />
        <TradeColumn
          title={`${TEAMS_BY_CODE[partner]!.label} sends`}
          role="them"
          roster={theirRoster}
          selected={get}
          onToggle={(id) => setGet((g) => (g.includes(id) ? g.filter((x) => x !== id) : [...g, id]))}
        />
      </div>

      <div style={{ padding: "22px 26px", borderTop: "1px solid var(--line)" }}>
        <div style={{ marginBottom: 16 }}>
          <ValueBar label={TEAMS_BY_CODE[myCode]!.label} pct={(giveVal / total) * 100} value={Math.round(giveVal)} kind="you" />
          <ValueBar label={TEAMS_BY_CODE[partner]!.label} pct={(getVal / total) * 100} value={Math.round(getVal)} kind="them" />
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
          <p style={{ margin: 0, fontSize: 13, color: "var(--ink-dim)" }}>
            AI value delta:{" "}
            <span className="oswald" style={{ color: "var(--ink)", fontWeight: 600 }}>
              {evalResult.valueDelta >= 0 ? "+" : ""}
              {evalResult.valueDelta}
            </span>{" "}
            (for {TEAMS_BY_CODE[myCode]!.label})
          </p>
          <span
            style={{
              fontSize: 12,
              fontWeight: 600,
              padding: "6px 12px",
              borderRadius: 20,
              background:
                evalResult.acceptLikelihood >= 0.65
                  ? "rgba(111,200,150,0.14)"
                  : evalResult.acceptLikelihood >= 0.35
                    ? "rgba(232,179,76,0.14)"
                    : "rgba(226,105,74,0.14)",
              color:
                evalResult.acceptLikelihood >= 0.65
                  ? "var(--good)"
                  : evalResult.acceptLikelihood >= 0.35
                    ? "var(--notice)"
                    : "var(--bad)",
            }}
          >
            {TEAMS_BY_CODE[partner]!.label} accept likelihood: {Math.round(evalResult.acceptLikelihood * 100)}%
          </span>
        </div>

        {/* online: the other GM decides, then the league blocks it only if it's
            lopsided (the server's collusion guard) — there is no ballot */}
        {actions.online && involves90 && partnerIsHuman && (
          <div style={{ display: "flex", gap: 10, marginTop: 16, padding: "12px 14px", background: "rgba(232,179,76,0.08)", border: "1px solid rgba(232,179,76,0.35)", borderRadius: "var(--r-md)" }}>
            <span style={{ color: "var(--notice)", fontWeight: 700 }}>⚠</span>
            <p style={{ margin: 0, fontSize: 12.5, color: "var(--ink-dim)", lineHeight: 1.5 }}>
              <strong style={{ color: "var(--notice)" }}>League review.</strong> This trade includes a 90+ overall
              player. If it&rsquo;s accepted, the league blocks it when it&rsquo;s this one-sided either way
              (under 18% or over 82% by the value chart above).
            </p>
          </div>
        )}
        {!actions.online && needsVote && !trade && (
          <div style={{ display: "flex", gap: 10, marginTop: 16, padding: "12px 14px", background: "rgba(232,179,76,0.08)", border: "1px solid rgba(232,179,76,0.35)", borderRadius: "var(--r-md)" }}>
            <span style={{ color: "var(--notice)", fontWeight: 700 }}>⚠</span>
            <p style={{ margin: 0, fontSize: 12.5, color: "var(--ink-dim)", lineHeight: 1.5 }}>
              <strong style={{ color: "var(--notice)" }}>League vote required.</strong> This trade includes a 90+ overall player. All human GMs vote once you submit — a tie defaults to blocked.
            </p>
          </div>
        )}

        {trade?.vote && (
          <div style={{ marginTop: 16, padding: "12px 14px", background: "var(--panel-sunken)", border: "1px solid var(--line)", borderRadius: "var(--r-md)" }}>
            <p style={{ margin: "0 0 8px", fontSize: 12.5, fontWeight: 600 }}>
              League vote — {trade.vote.outcome}
            </p>
            {Object.entries(trade.vote.votes).map(([gid, v]) => (
              <div key={gid} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "3px 0", color: "var(--ink-dim)" }}>
                <span>{s.gms.find((g) => g.id === gid)?.name ?? gid}</span>
                <span style={{ color: v === "for" ? "var(--good)" : v === "against" ? "var(--bad)" : "var(--ink-faint)" }}>
                  {v ?? "—"}
                </span>
              </div>
            ))}
          </div>
        )}

        {trade && !trade.vote && (
          <p style={{ marginTop: 12, fontSize: 12.5, color: trade.status === "accepted" ? "var(--good)" : "var(--bad)", fontWeight: 600 }}>
            {trade.status === "accepted"
              ? `${TEAMS_BY_CODE[partner]!.label} accepted the trade.`
              : (trade.blockedReason ?? `${TEAMS_BY_CODE[partner]!.label} rejected the trade.`)}
          </p>
        )}

        {/* The cap and roster answer is knowable before anyone is asked, so
            say it here rather than letting the player build a deal that gets
            refused on arithmetic. */}
        {!trade && legality && !legality.ok && (
          <p className="form-error" style={{ marginTop: 12 }}>
            {legality.reason}
          </p>
        )}

        {/* Online the same check runs again at commit time, against a league
            that may have moved since this page loaded — the offer the other
            GM accepted a minute ago spends the cap room this one needed. */}
        {onlineError && (
          <p className="form-error" style={{ marginTop: 12 }}>
            {onlineError}
          </p>
        )}

        {unitImpact.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <p className="sectionlabel" style={{ marginBottom: 6 }}>
              Your units after this trade
            </p>
            {unitImpact.map((u) => {
              const up = u.after > u.before;
              return (
                <div key={u.key} style={{ display: "flex", gap: 10, fontSize: 12, alignItems: "baseline" }}>
                  <span style={{ minWidth: 130 }}>{u.label}</span>
                  <span className="oswald">
                    {Math.round(u.before)} → {Math.round(u.after)}
                  </span>
                  <span style={{ color: up ? "var(--good)" : "var(--bad)", fontWeight: 600 }}>
                    {ordinalRank(u.rankBefore)} → {ordinalRank(u.rankAfter)} in the league
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {actions.online && onlineResult && (
          <p
            style={{ marginTop: 12, fontSize: 12.5, fontWeight: 600, color: onlineResult.ok ? "var(--good)" : "var(--bad)" }}
          >
            {onlineResult.text}
          </p>
        )}
        {actions.online && !trade && (
          <p style={{ margin: "12px 0 0", fontSize: 11.5, color: "var(--ink-faint)" }}>
            {partnerIsHuman
              ? "Proposing sends the offer to the other GM. They'll see it next time they open the league — there's no answer to wait for here."
              : "A CPU team answers on the spot."}
          </p>
        )}
      </div>

      <Footer>
        <button type="button" className="btnlink" onClick={() => nav(s.returnTo ?? "/hub")}>
          {s.returnTo === "/retirement" ? "Return to retirements" : "Return to team hub"}
        </button>
        <button onClick={() => { setGive([]); setGet([]); setTradeId(null); }}>Reset</button>
        {!trade ? (
          <button
            className="btn-primary"
            disabled={(give.length === 0 && get.length === 0) || !legality?.ok || proposing || tradingClosed || pastDeadline}
            title={legality?.ok === false ? legality.reason : undefined}
            onClick={() => {
              setOnlineError(null);
              if (actions.online) {
                // the server re-checks both rosters and both caps at commit
                // time, then leaves the offer for a person to answer — there
                // is no AI partner to decide on the spot. One in flight: a
                // double click on a slow link sent the offer twice.
                if (inFlight.current) return;
                inFlight.current = true;
                setProposing(true);
                void actions
                  .proposeTrade(partner, give, get)
                  .then((res) => {
                    if (res.ok) {
                      setGive([]);
                      setGet([]);
                      // a CPU team answers on the spot — say what it said
                      const sent = [...useStore.getState().trades]
                        .reverse()
                        .find((t) => t.fromTeam === myCode && t.toTeam === partner);
                      const who = TEAMS_BY_CODE[partner]!.label;
                      setOnlineResult(
                        sent?.status === "accepted"
                          ? { ok: true, text: `${who} accepted. The players have moved.` }
                          : sent?.status === "rejected"
                            ? { ok: false, text: `${who} turned it down.` }
                            : { ok: true, text: `Sent to ${gmName(partner) ?? who}. They'll answer from their own screen.` },
                      );
                    } else {
                      setOnlineError(res.reason ?? "That trade was refused.");
                    }
                  })
                  .finally(() => {
                    inFlight.current = false;
                    setProposing(false);
                  });
                return;
              }
              const id = proposeTrade(partner, give, get);
              setTradeId(id);
              // resolveTrade decides: an AI partner can refuse outright, and
              // only a deal it accepts goes on to the league vote
              resolveTrade(id);
            }}
          >
            Propose trade
          </button>
        ) : trade.vote && trade.vote.outcome === "pending" ? (
          <>
            <button className="btn-primary" onClick={() => castVote(trade.id, s.viewerGmId, "for")}>
              Vote for
            </button>
            <button className="btn-danger" onClick={() => castVote(trade.id, s.viewerGmId, "against")}>
              Vote against
            </button>
          </>
        ) : (
          <button className="btn-primary" onClick={() => nav(s.returnTo ?? "/hub")}>
            Done
          </button>
        )}
      </Footer>

      <p style={{ margin: 0, padding: "0 26px 18px", fontSize: 11, color: "var(--ink-faint)", textAlign: "center" }}>
        Overall/offense/defense — {TEAMS_BY_CODE[myCode]!.label} {ordinal(s.teams[myCode]!.ratings.overallRank)} · {TEAMS_BY_CODE[partner]!.label} {ordinal(s.teams[partner]!.ratings.overallRank)}
      </p>
    </Card>
  );
}

/**
 * One side's tradeable assets, as a filterable list of toggles.
 *
 * Exported because the trade deadline builds its offers with exactly this
 * control. The spec asks for the existing trade interface rather than a
 * second one, and two pickers that had to agree about what a pick id looks
 * like would eventually stop agreeing.
 */
export function TradeColumn({
  title,
  role,
  roster,
  selected,
  onToggle,
}: {
  title: string;
  role: "you" | "them";
  roster: { id: string; name: string; position: string; overall: number; badge?: string }[];
  selected: string[];
  onToggle: (id: string) => void;
}) {
  // "PICK" sorts to the front of the filter so draft capital is one click away
  const market = useListFilter(roster, 150);
  return (
    <div style={{ padding: "22px 24px", borderRight: role === "you" ? "1px solid var(--line)" : undefined }}>
      <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 10 }}>
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: role === "you" ? "var(--team)" : "var(--partner)" }} />
        <span className="oswald" style={{ fontSize: 15, fontWeight: 600 }}>
          {title}
        </span>
      </div>
      {market.controls}
      <div className="scroll-list short">
        {market.shown.map((p) => {
          const on = selected.includes(p.id);
          return (
            <div
              key={p.id}
              {...pressable(() => onToggle(p.id))}
              aria-pressed={on}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "9px 10px",
                marginBottom: 6,
                background: on ? "var(--panel-sunken)" : "transparent",
                border: `1px ${on ? "solid" : "dashed"} var(--line-strong)`,
                borderRadius: "var(--r-sm)",
                opacity: on ? 1 : 0.5,
                cursor: "pointer",
              }}
            >
              <span className="oswald" style={{ fontSize: 13, fontWeight: 600, color: p.overall >= 85 ? "var(--good)" : "var(--ink-dim)", minWidth: 26, textAlign: "center" }}>
                {p.badge ?? p.overall}
              </span>
              <span style={{ fontSize: 13, fontWeight: 500, flex: 1 }}>
                {p.name}
                {/* a pick's "position" is only there to drive the filter */}
                {p.position !== "PICK" && <span className="ppos"> {p.position}</span>}
              </span>
              <span style={{ fontSize: 13, color: on ? "var(--bad)" : "var(--good)" }}>{on ? "×" : "+"}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ValueBar({ label, pct, value, kind }: { label: string; pct: number; value: number; kind: "you" | "them" }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
      <span style={{ width: 90, fontSize: 11.5, color: "var(--ink-dim)", flexShrink: 0 }}>{label}</span>
      <div style={{ flex: 1, height: 8, background: "var(--panel-sunken)", borderRadius: 4, overflow: "hidden" }}>
        <div style={{ height: "100%", borderRadius: 4, width: `${pct}%`, background: kind === "you" ? "var(--team)" : "var(--partner)" }} />
      </div>
      <span className="oswald" style={{ width: 28, textAlign: "right", fontSize: 12.5, fontWeight: 600 }}>
        {value}
      </span>
    </div>
  );
}

function ordinalRank(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${s}`;
}
