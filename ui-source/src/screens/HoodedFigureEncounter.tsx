import { useState, type CSSProperties } from "react";
import { useNavigate } from "react-router-dom";

import { Card, CardHeader, Footer } from "@/components/primitives";
import { ReadinessGate } from "@/components/ReadinessGate";
import { TEAMS_BY_CODE } from "@/data/teams";
import {
  checkHoodedFigurePayment,
  hoodedFigureEncounterFor,
  hoodedFigureMaxPayment,
  isHoodedFigureEligible,
} from "@/state/hoodedFigure";
import { viewerTeamCode } from "@/state/selectors";
import { useStore } from "@/state/store";
import { useLeagueActions } from "@/state/useLeagueActions";
import { millions } from "@/util/format";

const MIN_PAYMENT = 1.0;
const PAYMENT_STEP = 0.5;

/**
 * The catch-up mechanic's offer (11_HOODED_FIGURE_FINAL_IMPLEMENTATION_SPEC.md).
 *
 * Only a human team stuck losing two seasons running ever sees this — anyone
 * else gets a plain pass-through. The stepper is deliberate: a numeric field
 * would invite a value the mechanic was never meant to take, and this way
 * every reachable amount is a legal one. Once submitted the payment is gone
 * and the result is locked in — there is no preview of what it bought.
 */
export function HoodedFigureEncounter() {
  const s = useStore();
  const actions = useLeagueActions();
  const nav = useNavigate();
  const code = viewerTeamCode(s);
  const [payment, setPayment] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const eligible = code ? isHoodedFigureEligible(s, code) : false;
  const encounter = code ? hoodedFigureEncounterFor(s, code) : null;
  const done = !eligible || (encounter?.resolved ?? false);
  const paid = !!encounter?.resolved && encounter.payment >= MIN_PAYMENT;

  if (!code || done) {
    return (
      <Card>
        <CardHeader
          badge="—"
          title="Training Camp Complete"
          subtitle={
            paid
              ? `The figure took ${millions(encounter!.payment)} and was gone`
              : encounter?.resolved
                ? "You sent the figure away"
                : "Nothing unusual this year"
          }
        />
        <div className="panel open">
          <div className="emptystate">
            {paid
              ? "Nobody saw where it went. Whatever it bought, the league finds out after the preseason."
              : encounter?.resolved
                ? "It's gone, and your cap space is where you left it. Advance when you're ready."
                : "Nothing to see here. Advance when you're ready."}
          </div>
        </div>
        <ReadinessGate
          title="Training camp readiness"
          label="Advance to Re-order Depth Chart"
          onAdvance={(r) => nav(r)}
        />
      </Card>
    );
  }

  const max = hoodedFigureMaxPayment(s, code);
  const check = checkHoodedFigurePayment(s, code, payment);

  const nudge = (dir: 1 | -1): void => {
    setPayment((p) => {
      if (p === 0) return dir > 0 ? MIN_PAYMENT : 0;
      const next = round1(p + dir * PAYMENT_STEP);
      if (next < MIN_PAYMENT) return 0;
      if (next > max) return p;
      return next;
    });
  };

  const submit = (): void => {
    setBusy(true);
    setError(null);
    void actions
      .submitHoodedFigurePayment(payment)
      .then((res) => {
        if (!res.ok) {
          setError(res.reason ?? "Something went wrong.");
          return;
        }
      })
      .finally(() => setBusy(false));
  };

  return (
    <Card maxWidth={640}>
      <div
        style={{
          background: "linear-gradient(180deg, #05050a 0%, #0d0d16 100%)",
          borderRadius: 8,
          padding: "28px 24px",
          marginBottom: 16,
          color: "#d8d4e6",
          border: "1px solid #2a2438",
        }}
      >
        <div style={{ fontSize: 40, textAlign: "center", marginBottom: 8, filter: "grayscale(1)" }}>
          🖤🔪
        </div>
        <p style={{ textAlign: "center", fontSize: 12, letterSpacing: 2, textTransform: "uppercase", color: "#8b7fae", margin: "0 0 16px" }}>
          {TEAMS_BY_CODE[code]?.name ?? code} — after training camp
        </p>
        <p style={{ fontStyle: "italic", lineHeight: 1.7, fontSize: 14.5, margin: 0 }}>
          A hooded figure is waiting outside the facility, leaning on a scythe that definitely
          wasn&rsquo;t there this morning.
        </p>
        <p style={{ fontStyle: "italic", lineHeight: 1.7, fontSize: 14.5, margin: "12px 0 0" }}>
          &ldquo;Your team is struggling,&rdquo; the figure says. &ldquo;Pay me at least $1 million
          from your cap space and I can help. How much would you like to pay this figure?&rdquo;
        </p>
      </div>

      {error && (
        <div className="notice bad" role="status">
          {error}
        </div>
      )}

      <div className="panel open">
        {max <= 0 ? (
          <p style={{ fontSize: 12.5, color: "var(--ink-faint)" }}>
            You don&rsquo;t have enough cap space to make an offer this figure would take seriously.
            Declining is the only real option.
          </p>
        ) : (
          <>
            <p className="subhead" style={{ marginTop: 0 }}>
              Your offer
            </p>
            <div style={{ display: "flex", alignItems: "center", gap: 16, justifyContent: "center", margin: "16px 0" }}>
              <button type="button" onClick={() => nudge(-1)} disabled={payment === 0} style={stepperBtn}>
                −
              </button>
              <div style={{ minWidth: 120, textAlign: "center", fontSize: 28, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                {millions(payment)}
              </div>
              <button type="button" onClick={() => nudge(1)} disabled={payment >= max} style={stepperBtn}>
                +
              </button>
            </div>
            <p style={{ textAlign: "center", fontSize: 11, color: "var(--ink-faint)", margin: "0 0 4px" }}>
              $0.0M declines. $1.0M minimum, then $0.5M steps, up to {millions(max)} of cap space.
            </p>
          </>
        )}

        {!check.ok && (
          <p style={{ margin: "12px 0 0", fontSize: 11.5, color: "var(--bad)", textAlign: "center" }}>{check.reason}</p>
        )}
      </div>

      <Footer>
        <span style={{ flex: 1, fontSize: 11.5, color: "var(--ink-faint)", alignSelf: "center" }}>
          Submitting is final. There is no undo, and no preview of what it buys.
        </span>
        <button type="button" className="btn-primary" disabled={!check.ok || busy} onClick={submit}>
          {busy ? "…" : payment === 0 ? "Decline" : `Pay ${millions(payment)}`}
        </button>
      </Footer>
    </Card>
  );
}

const stepperBtn: CSSProperties = {
  width: 40,
  height: 40,
  borderRadius: "50%",
  fontSize: 20,
  lineHeight: 1,
  border: "1px solid var(--line)",
  background: "var(--panel-bg, transparent)",
  cursor: "pointer",
};

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
