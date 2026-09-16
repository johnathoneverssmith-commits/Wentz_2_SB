import { useMemo, useState } from "react";

import { TeamBadge } from "@/components/bits";
import { Card, CardHeader, Footer, Ticker } from "@/components/primitives";
import { TEAMS, TEAMS_BY_CODE } from "@/data/teams";
import { pickKey, pickLabel, picksOwnedBy } from "@/state/draftPicks";
import { teamRoster, viewerTeamCode } from "@/state/selectors";
import { useStore } from "@/state/store";
import {
  onTheClock,
  pendingFor,
  TRADE_DEADLINE_ROUNDS,
  type DeadlineOffer,
} from "@/state/tradeDeadline";
import { useLeagueActions } from "@/state/useLeagueActions";

import { TradeColumn } from "./TradeProposal";

/**
 * The deadline room: one turn at a time, and usually somebody else's.
 *
 * Three states, and the screen is only ever in one of them — which is the
 * benefit of serializing the whole event. Either it is this GM's turn to
 * propose, or there is an offer on their desk, or the league is working and
 * they are watching. Nothing here is a negotiation happening in parallel with
 * another one, so nothing on screen can be invalidated while it is read.
 *
 * Everything the GM can pick from is built from the rosters as they stand
 * right now, so a player traded two turns ago is simply absent rather than
 * present-and-refused.
 */
export function TradeDeadlineRoom() {
  const s = useStore();
  const actions = useLeagueActions();
  const code = viewerTeamCode(s);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const d = s.tradeDeadline;
  const duty = code ? pendingFor(s, code) : null;
  const clock = onTheClock(s);

  const submit = (move: Parameters<typeof actions.deadlineTurn>[0]): void => {
    setBusy(true);
    setError(null);
    void actions
      .deadlineTurn(move)
      .then((res) => {
        if (!res.ok) setError(res.reason ?? "That move isn't available.");
      })
      .finally(() => setBusy(false));
  };

  if (!d || !code) {
    return (
      <Card>
        <CardHeader badge="TD" title="Trade Deadline" subtitle="Not open" />
        <div className="panel open">
          <div className="emptystate">The deadline hasn&rsquo;t opened yet.</div>
        </div>
      </Card>
    );
  }

  return (
    <Card maxWidth={920}>
      <CardHeader
        badge={TEAMS_BY_CODE[code]!.abbr}
        title="Trade Deadline"
        subtitle={`Round ${Math.min(d.round, TRADE_DEADLINE_ROUNDS)} of ${TRADE_DEADLINE_ROUNDS}`}
      />
      <Ticker
        stats={[
          { label: "Round", value: `${Math.min(d.round, TRADE_DEADLINE_ROUNDS)}/${TRADE_DEADLINE_ROUNDS}` },
          { label: "Turn", value: `${d.index + 1}/${d.order.length}` },
          { label: "On the clock", value: clock ? TEAMS_BY_CODE[clock]!.abbr : "—" },
          { label: "Trades made", value: d.resolved.filter((o) => o.outcome === "accepted").length },
        ]}
      />

      {error && (
        <div className="notice bad" role="status">
          {error}
        </div>
      )}

      {duty === "propose" && <ProposeTurn code={code} busy={busy} onSubmit={submit} />}
      {(duty === "respond" || duty === "final") && (
        <RespondTurn offer={d.active!} code={code} duty={duty} busy={busy} onSubmit={submit} />
      )}
      {duty === null && <Waiting clock={clock} />}

      <RecentActivity resolved={d.resolved} />
    </Card>
  );
}

function ProposeTurn({
  code,
  busy,
  onSubmit,
}: {
  code: string;
  busy: boolean;
  onSubmit: (move: { kind: "propose"; toTeam: string; give: string[]; get: string[] } | { kind: "skip" }) => void;
}) {
  const s = useStore();
  const [partner, setPartner] = useState(() => TEAMS.find((t) => t.code !== code)!.code);
  const [give, setGive] = useState<string[]>([]);
  const [get, setGet] = useState<string[]>([]);

  const pickRows = (team: string) =>
    picksOwnedBy(s, team).map((pk) => ({
      id: `pick:${pickKey(pk.year, pk.round, pk.originalTeam)}`,
      name: pickLabel(pk),
      position: "PICK",
      overall: 0,
      badge: `R${pk.round}`,
    }));

  const mine = useMemo(
    () => [...pickRows(code), ...teamRoster(s, code)],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [s, code],
  );
  const theirs = useMemo(
    () => [...pickRows(partner), ...teamRoster(s, partner)],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [s, partner],
  );

  const toggle = (set: (fn: (xs: string[]) => string[]) => void) => (id: string) =>
    set((xs) => (xs.includes(id) ? xs.filter((x) => x !== id) : [...xs, id]));

  return (
    <>
      <div className="panel open">
        <div className="notice" role="status">
          <strong>You&rsquo;re on the clock.</strong> One offer, or pass — either way the turn is
          gone. Nothing here is checked against the cap or the roster limit; the deadline is
          allowed to break both, and you&rsquo;ll square it up afterwards.
        </div>
        <label style={{ display: "block", margin: "14px 0 6px", fontSize: 11.5, color: "var(--ink-dim)" }}>
          Trade with
        </label>
        <select
          value={partner}
          onChange={(e) => {
            setPartner(e.target.value);
            setGet([]);
          }}
          style={{ width: "100%", maxWidth: 280 }}
        >
          {TEAMS.filter((t) => t.code !== code).map((t) => (
            <option key={t.code} value={t.code}>
              {t.label}
            </option>
          ))}
        </select>
      </div>

      <div className="split-2" style={{ borderTop: "1px solid var(--line)" }}>
        <TradeColumn
          title="You send"
          role="you"
          roster={mine}
          selected={give}
          onToggle={toggle(setGive)}
        />
        <TradeColumn
          title={`${TEAMS_BY_CODE[partner]!.label} sends`}
          role="them"
          roster={theirs}
          selected={get}
          onToggle={toggle(setGet)}
        />
      </div>

      <Footer>
        <button
          type="button"
          className="btnlink"
          disabled={busy}
          onClick={() => {
            if (!confirm("Pass on this turn? You don't get it back.")) return;
            onSubmit({ kind: "skip" });
          }}
        >
          Skip Turn
        </button>
        <button
          type="button"
          className="btn-primary"
          disabled={busy || (give.length === 0 && get.length === 0)}
          onClick={() => onSubmit({ kind: "propose", toTeam: partner, give, get })}
        >
          {busy ? "Sending…" : "Send Offer"}
        </button>
      </Footer>
    </>
  );
}

function RespondTurn({
  offer,
  code,
  duty,
  busy,
  onSubmit,
}: {
  offer: DeadlineOffer;
  code: string;
  duty: "respond" | "final";
  busy: boolean;
  onSubmit: (
    move:
      | { kind: "accept" }
      | { kind: "deny" }
      | { kind: "modify"; proposerGives: string[]; proposerGets: string[] },
  ) => void;
}) {
  const s = useStore();
  const [countering, setCountering] = useState(false);
  // a counter is always stated in the original orientation, so the picker
  // edits the proposer's package and the recipient's package by name rather
  // than by "mine" and "theirs" — which flip depending on who is looking
  const [proposerGives, setProposerGives] = useState<string[]>(() => idsOf(offer.fromAssets));
  const [proposerGets, setProposerGets] = useState<string[]>(() => idsOf(offer.toAssets));

  const other = offer.fromTeam === code ? offer.toTeam : offer.fromTeam;
  const pickRows = (team: string) =>
    picksOwnedBy(s, team).map((pk) => ({
      id: `pick:${pickKey(pk.year, pk.round, pk.originalTeam)}`,
      name: pickLabel(pk),
      position: "PICK",
      overall: 0,
      badge: `R${pk.round}`,
    }));

  const toggle = (set: (fn: (xs: string[]) => string[]) => void) => (id: string) =>
    set((xs) => (xs.includes(id) ? xs.filter((x) => x !== id) : [...xs, id]));

  return (
    <>
      <div className="panel open">
        <div className="notice" role="status">
          <strong>
            {duty === "final" ? "They countered." : `${TEAMS_BY_CODE[other]!.label} made you an offer.`}
          </strong>{" "}
          {duty === "final"
            ? "Take it or leave it — a counter can only be countered once."
            : "Accept it, turn it down, or send one counter back."}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 14 }}>
          <Package title={`${TEAMS_BY_CODE[offer.fromTeam]!.label} sends`} assets={offer.fromAssets} />
          <Package title={`${TEAMS_BY_CODE[offer.toTeam]!.label} sends`} assets={offer.toAssets} />
        </div>
      </div>

      {countering && (
        <div className="split-2" style={{ borderTop: "1px solid var(--line)" }}>
          <TradeColumn
            title={`${TEAMS_BY_CODE[offer.fromTeam]!.label} sends`}
            role="you"
            roster={[...pickRows(offer.fromTeam), ...teamRoster(s, offer.fromTeam)]}
            selected={proposerGives}
            onToggle={toggle(setProposerGives)}
          />
          <TradeColumn
            title={`${TEAMS_BY_CODE[offer.toTeam]!.label} sends`}
            role="them"
            roster={[...pickRows(offer.toTeam), ...teamRoster(s, offer.toTeam)]}
            selected={proposerGets}
            onToggle={toggle(setProposerGets)}
          />
        </div>
      )}

      <Footer>
        <button
          type="button"
          className="btnlink"
          disabled={busy}
          onClick={() => onSubmit({ kind: "deny" })}
        >
          Turn It Down
        </button>
        {duty === "respond" && !offer.modified && (
          <button
            type="button"
            className="btnlink"
            disabled={busy}
            onClick={() => {
              if (!countering) {
                setCountering(true);
                return;
              }
              onSubmit({ kind: "modify", proposerGives, proposerGets });
            }}
          >
            {countering ? "Send Counter" : "Counter"}
          </button>
        )}
        <button
          type="button"
          className="btn-primary"
          disabled={busy}
          onClick={() => onSubmit({ kind: "accept" })}
        >
          Accept
        </button>
      </Footer>
    </>
  );
}

function Waiting({ clock }: { clock: string | null }) {
  return (
    <div className="panel open">
      <div className="emptystate" style={{ padding: "34px 20px" }}>
        {clock ? (
          <>
            <p style={{ margin: 0, fontWeight: 600 }}>
              {TEAMS_BY_CODE[clock]?.label ?? clock} are on the clock.
            </p>
            <p style={{ margin: "8px 0 0", fontSize: 12 }}>
              One negotiation happens at a time, so nothing you see here can change while you read
              it. You&rsquo;ll be brought in when it&rsquo;s your turn or somebody makes you an
              offer.
            </p>
          </>
        ) : (
          <p style={{ margin: 0 }}>The deadline has passed.</p>
        )}
      </div>
    </div>
  );
}

function Package({ title, assets }: { title: string; assets: DeadlineOffer["fromAssets"] }) {
  const s = useStore();
  return (
    <div>
      <p className="subhead" style={{ marginTop: 0 }}>
        {title}
      </p>
      {assets.length === 0 && <p style={{ fontSize: 12, color: "var(--ink-faint)" }}>Nothing.</p>}
      {assets.map((a, i) => {
        if (a.kind === "pick" && a.pick) {
          return (
            <div key={`p${i}`} className="neg-row">
              <span className="pname">{pickLabel(a.pick)}</span>
              <span style={{ fontSize: 12, color: "var(--ink-faint)" }}>Round {a.pick.round}</span>
            </div>
          );
        }
        const p = s.players[a.playerId ?? ""];
        if (!p) return null;
        return (
          <div key={p.id} className="neg-row">
            <span className="pname">
              {p.name} <span className="ppos">{p.position}</span>
            </span>
            <span className="oswald" style={{ fontSize: 13, fontWeight: 600 }}>
              {p.overall}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function RecentActivity({ resolved }: { resolved: { outcome: string; fromTeam: string; toTeam: string; round: number }[] }) {
  if (resolved.length === 0) return null;
  const recent = [...resolved].slice(-8).reverse();
  return (
    <div className="panel open">
      <p className="subhead" style={{ marginTop: 0 }}>
        Around the league
      </p>
      {recent.map((o, i) => (
        <div key={i} className="neg-row">
          <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5 }}>
            <TeamBadge code={o.fromTeam} size={18} />
            <span>→</span>
            <TeamBadge code={o.toTeam} size={18} />
          </span>
          <span
            style={{
              fontSize: 11.5,
              fontWeight: 600,
              color: o.outcome === "accepted" ? "var(--good)" : "var(--ink-faint)",
            }}
          >
            {o.outcome === "accepted" ? "Trade made" : "No deal"} · R{o.round}
          </span>
        </div>
      ))}
    </div>
  );
}

function idsOf(assets: DeadlineOffer["fromAssets"]): string[] {
  return assets.flatMap((a) => {
    if (a.kind === "pick" && a.pick) {
      return [`pick:${pickKey(a.pick.year, a.pick.round, a.pick.originalTeam)}`];
    }
    return a.playerId ? [a.playerId] : [];
  });
}
