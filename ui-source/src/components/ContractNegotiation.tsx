import { useMemo, useState } from "react";

import type { ContractOffer, FreePriorities } from "@/domain";
import { millions } from "@/util/format";

/**
 * The negotiation popup used by Free Agency and the coaching hiring window.
 * You set base salary, signing bonus, years and guaranteed money; the target's
 * priorities are shown so you know what to lean into. Defaults come from the
 * target's opening expectation, or your prior offer if you've bid before.
 */
export function ContractNegotiation({
  title,
  subtitle,
  priorities,
  prior,
  error,
  onSubmit,
  onClose,
}: {
  title: string;
  subtitle?: string;
  priorities: FreePriorities;
  prior?: ContractOffer;
  /** Shown inline (e.g. "not enough cap space") without closing the modal. */
  error?: string | null;
  onSubmit: (offer: Omit<ContractOffer, "teamCode">) => void;
  onClose: () => void;
}) {
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

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <p className="modal-title">{title}</p>
            {subtitle && <p className="modal-sub">{subtitle}</p>}
          </div>
          <button className="modal-x" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="modal-body">
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

          <NegRow label="Base salary / yr" value={base} setValue={setBase} step={0.5} suffix="M" />
          <NegRow label="Signing bonus" value={bonus} setValue={setBonus} step={0.5} suffix="M" />
          <NegRow label="Contract length" value={years} setValue={setYears} step={1} min={1} max={7} suffix=" yrs" integer />
          <NegRow label="Guaranteed money" value={gtd} setValue={setGtd} step={0.5} suffix="M" />

          <div className="neg-summary">
            <span>Total value</span>
            <span className="oswald">{millions(total)}</span>
          </div>
          <div className="neg-summary">
            <span>Their read</span>
            <span
              style={{
                color:
                  verdict === "In range" ? "var(--good)" : verdict === "Light" ? "var(--notice)" : "var(--bad)",
                fontWeight: 600,
              }}
            >
              {verdict} — they expect ~{millions(exp.baseSalary)}/yr, {millions(exp.guaranteed)} gtd
            </span>
          </div>
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
          <button
            className="btn-primary"
            onClick={() =>
              onSubmit({ baseSalary: round1(base), signingBonus: round1(bonus), years, guaranteed: round1(gtd) })
            }
          >
            Submit offer
          </button>
        </div>
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
