import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

/**
 * "Your staff would ...": a plan shown in place, with a yes and a no.
 *
 * Every staff button (the roster fix, free agency, the deadline, re-signing
 * the core) used to put the plan in a browser `confirm()`, which is a wall of
 * text in a system dialog that can't be styled, wraps badly on a phone and
 * can't show a list. This puts the same plan on the screen where the button
 * is, as lines, and does nothing until the GM says yes. The resolved promise
 * is the decision, so a caller reads like it did with `confirm`:
 *
 *   if (!(await staff.ask({ title, lines }))) return;
 */
export interface StaffPlanRequest {
  /** "Your staff would ..." */
  title: string;
  /** one line per move, so a list of five signings reads as five lines */
  lines: string[];
  /** a note under the lines: what it costs, what it can't undo */
  note?: string;
  yes?: string;
  no?: string;
}

export function useStaffPlan(): { ask: (r: StaffPlanRequest) => Promise<boolean>; card: ReactNode } {
  const [req, setReq] = useState<StaffPlanRequest | null>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);
  const yesRef = useRef<HTMLButtonElement | null>(null);

  const ask = useCallback(
    (r: StaffPlanRequest) =>
      new Promise<boolean>((resolve) => {
        // a second ask while one is open answers the first with a no
        resolver.current?.(false);
        resolver.current = resolve;
        setReq(r);
      }),
    [],
  );
  const answer = (ok: boolean): void => {
    resolver.current?.(ok);
    resolver.current = null;
    setReq(null);
  };
  // leaving the screen with the plan open is a no, not a hanging promise
  useEffect(
    () => () => {
      resolver.current?.(false);
      resolver.current = null;
    },
    [],
  );
  useEffect(() => {
    if (req) yesRef.current?.focus();
  }, [req]);

  const card = req ? (
    <div
      role="group"
      aria-label="Your staff's plan"
      className="notice"
      onKeyDown={(e) => {
        if (e.key === "Escape") answer(false);
      }}
      style={{ margin: "10px 0", borderLeft: "3px solid var(--team)" }}
    >
      <p style={{ margin: 0, fontWeight: 600, fontSize: 13 }}>{req.title}</p>
      {req.lines.length > 0 && (
        <ul style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: 12.5, display: "grid", gap: 3 }}>
          {req.lines.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
      )}
      {req.note && <p style={{ margin: "6px 0 0", fontSize: 11.5, color: "var(--ink-dim)" }}>{req.note}</p>}
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button ref={yesRef} type="button" className="btn-primary" onClick={() => answer(true)}>
          {req.yes ?? "Go ahead"}
        </button>
        <button type="button" onClick={() => answer(false)}>
          {req.no ?? "No thanks"}
        </button>
      </div>
    </div>
  ) : null;

  return { ask, card };
}
