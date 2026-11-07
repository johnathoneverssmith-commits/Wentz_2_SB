import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { Footer } from "@/components/primitives";
import { ReadinessGate } from "@/components/ReadinessGate";
import { StagePage } from "@/components/stages/StagePage";
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
      <StagePage
        code={code}
        kicker="Training Camp Complete"
        sub={
          paid
            ? `The figure took ${millions(encounter!.payment)} and was gone`
            : encounter?.resolved
              ? "You sent the figure away"
              : "Nothing unusual this year"
        }
      >
        <div className="emptystate">
          {paid
            ? "Nobody saw where it went. Whatever it bought, the league finds out after the preseason."
            : encounter?.resolved
              ? "It's gone, and your cap space is where you left it. Advance when you're ready."
              : "Nothing to see here. Advance when you're ready."}
        </div>
        <ReadinessGate
          title="Readiness"
          label="Advance to Re-order Depth Chart"
          onAdvance={(r) => nav(r)}
        />
      </StagePage>
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
    // final, and a stray tap on the stepper's neighbour paid it
    if (payment > 0 && !confirm(`Pay the figure ${millions(payment)} of cap space? There's no undo.`)) return;
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
    <StagePage code={code} kicker="After training camp" sub={`${TEAMS_BY_CODE[code]?.name ?? code} — a visitor is waiting`} className="stage-hooded">
      <section className="stage-scene">
        <p>
          A hooded figure is waiting outside the facility, leaning on a scythe that definitely
          wasn&rsquo;t there this morning.
        </p>
        <p>
          &ldquo;Your team is struggling,&rdquo; the figure says. &ldquo;Pay me at least $1 million
          from your cap space and I can help. How much would you like to pay this figure?&rdquo;
        </p>
      </section>

      {error && (
        <div className="notice bad" role="status">
          {error}
        </div>
      )}

      <div className="stage-body">
        {max <= 0 ? (
          <p className="stage-text">
            You don&rsquo;t have enough cap space to make an offer this figure would take seriously.
            Declining is the only real option.
          </p>
        ) : (
          <section className="stage-offer">
            <h2 className="stage-h">Your offer</h2>
            <div className="stage-stepper">
              <button type="button" aria-label="Offer less" onClick={() => nudge(-1)} disabled={payment === 0}>
                −
              </button>
              <div className="stage-amount">{millions(payment)}</div>
              <button type="button" aria-label="Offer more" onClick={() => nudge(1)} disabled={payment >= max}>
                +
              </button>
            </div>
            <p className="stage-note">
              $0.0M declines. $1.0M minimum, then $0.5M steps, up to {millions(max)} of cap space.
            </p>
          </section>
        )}

        {!check.ok && <p className="stage-note stage-note--bad">{check.reason}</p>}
      </div>

      <Footer>
        <span className="stage-foot-note">
          Submitting is final. There is no undo, and no preview of what it buys.
        </span>
        <button type="button" className="btn-primary" disabled={!check.ok || busy} onClick={submit}>
          {busy ? "…" : payment === 0 ? "Decline" : `Pay ${millions(payment)}`}
        </button>
      </Footer>
    </StagePage>
  );
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
