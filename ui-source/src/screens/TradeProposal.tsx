import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { pressable } from "@/components/bits";
import { Card, Footer } from "@/components/primitives";
import { TEAMS, TEAMS_BY_CODE } from "@/data/teams";
import { MockSimulationService } from "@/sim/MockSimulationService";
import {
  futureDiscount,
  pickKey,
  pickLabel,
  picksOwnedBy,
} from "@/state/draftPicks";
import { pickTradeValue } from "@/sim/MockSimulationService";
import { checkTrade, useStore } from "@/state/store";
import { teamRoster, viewerTeamCode } from "@/state/selectors";
import { ordinal } from "@/util/format";

const sim = new MockSimulationService();

export function TradeProposal() {
  const nav = useNavigate();
  const s = useStore();
  const myCode = viewerTeamCode(s);
  const proposeTrade = useStore((st) => st.proposeTrade);
  const castVote = useStore((st) => st.castTradeVote);
  const resolveTrade = useStore((st) => st.resolveTrade);

  const [partner, setPartner] = useState(() => TEAMS.find((t) => t.code !== myCode)!.code);
  const [give, setGive] = useState<string[]>([]);
  const [get, setGet] = useState<string[]>([]);
  const [tradeId, setTradeId] = useState<string | null>(null);

  // live cap/roster preview of the deal as it's being built
  const legality = useMemo(
    () =>
      !myCode || (give.length === 0 && get.length === 0)
        ? { ok: true }
        : checkTrade(s, {
            fromTeam: myCode,
            toTeam: partner,
            fromAssets: give.map((playerId) => ({ kind: "player" as const, playerId })),
            toAssets: get.map((playerId) => ({ kind: "player" as const, playerId })),
          }),
    [s, myCode, partner, give, get],
  );

  /** Picks appear in the same lists as players, under a `pick:` id. */
  const pickRows = (code: string) =>
    picksOwnedBy(s, code).map((pk) => ({
      id: `pick:${pickKey(pk.year, pk.round, pk.originalTeam)}`,
      name: pickLabel(pk),
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

  const toAssets = (ids: string[]) =>
    ids.map((id) =>
      id.startsWith("pick:")
        ? { kind: "pick" as const, pick: s.draftPicks[id.slice(5)] }
        : { kind: "player" as const, playerId: id },
    );

  const evalResult = useMemo(() => {
    if (!myCode) return { valueDelta: 0, acceptLikelihood: 0.5 };
    return sim.evaluateTrade(s, myCode, partner, toAssets(give), toAssets(get));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s, myCode, partner, give, get]);

  const involves90 = [...give, ...get].some((id) => (s.players[id]?.overall ?? 0) >= 90);
  const partnerIsHuman = s.gms.some((g) => g.isHuman && g.teamCode === partner);
  const needsVote = involves90 && (partnerIsHuman || true /* viewer is human */);

  const trade = tradeId ? s.trades.find((t) => t.id === tradeId) : undefined;
  const offers = s.trades.filter((t) => t.status === "offered" && t.toTeam === myCode);
  const respond = useStore((st) => st.respondToOffer);

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
              {TEAMS_BY_CODE[myCode]!.city} ↔ {TEAMS_BY_CODE[partner]!.city}
            </p>
          </div>
        </div>
        <select
          value={partner}
          onChange={(e) => {
            setPartner(e.target.value);
            setGet([]);
            setTradeId(null);
          }}
        >
          {TEAMS.filter((t) => t.code !== myCode).map((t) => (
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
            const asked = o.toAssets
              .map((a) => s.players[a.playerId ?? ""]?.name)
              .filter(Boolean)
              .join(", ");
            const back = o.fromAssets
              .map((a) =>
                a.kind === "pick" && a.pick
                  ? pickLabel(a.pick)
                  : (s.players[a.playerId ?? ""]?.name ?? "a player"),
              )
              .join(" + ");
            return (
              <div key={o.id} className="neg-row" style={{ alignItems: "flex-start", gap: 14 }}>
                <div style={{ flex: 1 }}>
                  <p style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>
                    {TEAMS_BY_CODE[o.fromTeam]?.city ?? o.fromTeam} want {asked}
                  </p>
                  <p style={{ margin: "3px 0 0", fontSize: 12, color: "var(--ink-dim)" }}>
                    They're offering {back}.
                  </p>
                  {o.blockedReason && <p className="form-error">{o.blockedReason}</p>}
                </div>
                <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                  <button className="btn-primary" onClick={() => respond(o.id, true)}>
                    Accept
                  </button>
                  <button onClick={() => respond(o.id, false)}>Decline</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="split-2">
        <TradeColumn
          title={`${TEAMS_BY_CODE[myCode]!.city} sends`}
          role="you"
          roster={myRoster}
          selected={give}
          onToggle={(id) => setGive((g) => (g.includes(id) ? g.filter((x) => x !== id) : [...g, id]))}
        />
        <TradeColumn
          title={`${TEAMS_BY_CODE[partner]!.city} sends`}
          role="them"
          roster={theirRoster}
          selected={get}
          onToggle={(id) => setGet((g) => (g.includes(id) ? g.filter((x) => x !== id) : [...g, id]))}
        />
      </div>

      <div style={{ padding: "22px 26px", borderTop: "1px solid var(--line)" }}>
        <div style={{ marginBottom: 16 }}>
          <ValueBar label={TEAMS_BY_CODE[myCode]!.city} pct={(giveVal / total) * 100} value={Math.round(giveVal)} kind="you" />
          <ValueBar label={TEAMS_BY_CODE[partner]!.city} pct={(getVal / total) * 100} value={Math.round(getVal)} kind="them" />
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
          <p style={{ margin: 0, fontSize: 13, color: "var(--ink-dim)" }}>
            AI value delta:{" "}
            <span className="oswald" style={{ color: "var(--ink)", fontWeight: 600 }}>
              {evalResult.valueDelta >= 0 ? "+" : ""}
              {evalResult.valueDelta}
            </span>{" "}
            (for {TEAMS_BY_CODE[myCode]!.city})
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
            {TEAMS_BY_CODE[partner]!.city} accept likelihood: {Math.round(evalResult.acceptLikelihood * 100)}%
          </span>
        </div>

        {needsVote && !trade && (
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
              ? `${TEAMS_BY_CODE[partner]!.city} accepted the trade.`
              : (trade.blockedReason ?? `${TEAMS_BY_CODE[partner]!.city} rejected the trade.`)}
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
      </div>

      <Footer>
        <button type="button" className="btnlink" onClick={() => nav(s.returnTo ?? "/hub")}>
          {s.returnTo === "/retirement" ? "Return to retirements" : "Return to team hub"}
        </button>
        <button onClick={() => { setGive([]); setGet([]); setTradeId(null); }}>Reset</button>
        {!trade ? (
          <button
            className="btn-primary"
            disabled={(give.length === 0 && get.length === 0) || !legality?.ok}
            title={legality?.ok === false ? legality.reason : undefined}
            onClick={() => {
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
        Overall/offense/defense — {TEAMS_BY_CODE[myCode]!.city} {ordinal(s.teams[myCode]!.ratings.overallRank)} · {TEAMS_BY_CODE[partner]!.city} {ordinal(s.teams[partner]!.ratings.overallRank)}
      </p>
    </Card>
  );
}

function TradeColumn({
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
  const [pos, setPos] = useState("ALL");
  // "PICK" sorts to the front of the filter so draft capital is one click away
  const positions = ["ALL", ...Array.from(new Set(roster.map((p) => p.position)))];
  const shown = roster.filter((p) => pos === "ALL" || p.position === pos);
  return (
    <div style={{ padding: "22px 24px", borderRight: role === "you" ? "1px solid var(--line)" : undefined }}>
      <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 10 }}>
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: role === "you" ? "var(--team)" : "var(--partner)" }} />
        <span className="oswald" style={{ fontSize: 15, fontWeight: 600 }}>
          {title}
        </span>
      </div>
      <select value={pos} onChange={(e) => setPos(e.target.value)} style={{ marginBottom: 12, fontSize: 12 }}>
        {positions.map((p) => (
          <option key={p} value={p}>
            {p === "ALL" ? "All positions" : p === "PICK" ? "Draft picks" : p}
          </option>
        ))}
      </select>
      <div style={{ maxHeight: 320, overflowY: "auto" }}>
        {shown.slice(0, 40).map((p) => {
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
