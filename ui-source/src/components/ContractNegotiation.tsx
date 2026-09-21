import { useMemo, useState } from "react";

import type { ContractOffer, FreePriorities } from "@/domain";
import { millions } from "@/util/format";

import { useDialog } from "./useDialog.ts";

/**
 * The negotiation state: base salary, signing bonus, years, guaranteed
 * money, plus the derived total and how the offer reads against the
 * target's expectation. Defaults come from the target's opening
 * expectation, or the prior offer if you've bid before. Shared so the modal
 * (roster-page contract extensions) and the inline Free Agency panel
 * (playtest finding 5: the offer popup used to open at the bottom of the
 * page, disconnected from the player it was for) don't carry two copies of
 * the same arithmetic.
 */
function useNegotiation(priorities: FreePriorities, prior?: ContractOffer) {
  const start = prior ?? { ...priorities.expectation, teamCode: "" };
  const [base, setBase] = useState(round1(start.baseSalary));
  const [bonus, setBonus] = useState(round1(start.signingBonus));
  const [years, setYears] = useState(start.years);
  const [gtd, setGtd] = useState(round1(start.guaranteed));

  const total = useMemo(() => round1(base * years + bonus), [base, years, bonus]);
  const exp = priorities.expectation;
  const meetsSalary = base >= exp.baseSalary * 0.95;
  const meetsGtd = gtd >= exp.guaranteed * 0.9;
  const verdict = meetsSalary && meetsGtd ? "In range" : meetsSalary || meetsGtd ? "Light" : "Below market";
  const offer = (): Omit<ContractOffer, "teamCode"> => ({
    baseSalary: round1(base),
    signingBonus: round1(bonus),
    years,
    guaranteed: round1(gtd),
  });

  return { base, setBase, bonus, setBonus, years, setYears, gtd, setGtd, total, verdict, exp, offer };
}

type Negotiation = ReturnType<typeof useNegotiation>;

/** The priority chips, the four controls, and the value/verdict summary — no chrome, no actions. */
function NegotiationFields({ priorities, n }: { priorities: FreePriorities; n: Negotiation }) {
  return (
    <>
      <p className="subhead" style={{ marginTop: 0 }}>
        What they're prioritising
      </p>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16 }}>
        {priorities.ranked.map((p, i) => (
          <span key={p} className="prio-chip">
            {i + 1}. {p}
          </span>
        ))}
      </div>

      <NegRow label="Base salary / yr" value={n.base} setValue={n.setBase} step={0.5} suffix="M" />
      <NegRow label="Signing bonus" value={n.bonus} setValue={n.setBonus} step={0.5} suffix="M" />
      <NegRow label="Contract length" value={n.years} setValue={n.setYears} step={1} min={1} max={7} suffix=" yrs" integer />
      <NegRow label="Guaranteed money" value={n.gtd} setValue={n.setGtd} step={0.5} suffix="M" />

      <div className="neg-summary">
        <span>Total value</span>
        <span className="oswald">{millions(n.total)}</span>
      </div>
      <div className="neg-summary">
        <span>Their read</span>
        <span
          style={{
            color: n.verdict === "In range" ? "var(--good)" : n.verdict === "Light" ? "var(--notice)" : "var(--bad)",
            fontWeight: 600,
          }}
        >
          {n.verdict} — they expect ~{millions(n.exp.baseSalary)}/yr, {millions(n.exp.guaranteed)} gtd
        </span>
      </div>
    </>
  );
}

interface NegotiationProps {
  priorities: FreePriorities;
  prior?: ContractOffer;
  /** Shown without closing the form. */
  error?: string | null;
  onSubmit: (offer: Omit<ContractOffer, "teamCode">) => void;
  onClose: () => void;
}

/** The negotiation popup used for contract extensions on your own roster. */
export function ContractNegotiation({
  title,
  subtitle,
  priorities,
  prior,
  error,
  onSubmit,
  onClose,
}: NegotiationProps & { title: string; subtitle?: string }) {
  const n = useNegotiation(priorities, prior);
  const dialogRef = useDialog(onClose);
  return (
    <div className="modal-scrim" onClick={onClose}>
      <div
        ref={dialogRef}
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="negotiation-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <div>
            <p className="modal-title" id="negotiation-title">
              {title}
            </p>
            {subtitle && <p className="modal-sub">{subtitle}</p>}
          </div>
          <button className="modal-x" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="modal-body">
          <NegotiationFields priorities={priorities} n={n} />
        </div>

        {/* outside the scrolling body: a rejection the player can't see is a
            submit button that silently does nothing */}
        {error && (
          <p className="form-error modal-error" role="alert">
            {error}
          </p>
        )}

        <div className="modal-foot">
          <button onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={() => onSubmit(n.offer())}>
            Submit offer
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * The same negotiation, inline under the player's own row instead of in a
 * popup — Free Agency's `ExpandableRow` detail panel (finding 5).
 */
export function InlineNegotiation({ priorities, prior, error, onSubmit, onClose }: NegotiationProps) {
  const n = useNegotiation(priorities, prior);
  return (
    <div onClick={(e) => e.stopPropagation()}>
      <NegotiationFields priorities={priorities} n={n} />
      {error && (
        <p className="form-error" role="alert" style={{ marginTop: 10 }}>
          {error}
        </p>
      )}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 14 }}>
        <button onClick={onClose}>Cancel</button>
        <button className="btn-primary" onClick={() => onSubmit(n.offer())}>
          Submit offer
        </button>
      </div>
    </div>
  );
}

function NegRow({
  label,
  value,
  setValue,
  step,
  min = 0,
  max = 60,
  suffix = "",
  integer = false,
}: {
  label: string;
  value: number;
  setValue: (n: number) => void;
  step: number;
  min?: number;
  max?: number;
  suffix?: string;
  integer?: boolean;
}) {
  const clamp = (n: number) => Math.min(max, Math.max(min, integer ? Math.round(n) : round1(n)));
  return (
    <div className="neg-row">
      <span className="neg-label">{label}</span>
      <div className="neg-ctrl">
        <button onClick={() => setValue(clamp(value - step))}>−</button>
        <span className="oswald neg-val">
          {integer ? value : value.toFixed(1)}
          {suffix}
        </span>
        <button onClick={() => setValue(clamp(value + step))}>+</button>
      </div>
    </div>
  );
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
