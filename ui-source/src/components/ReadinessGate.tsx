/**
 * The "waiting on X of Y GMs" readiness gate. It is always the bottom-most
 * element on a screen. The viewer toggles their own ready state; other human
 * GMs auto-ready a moment after the stage loads. When all are ready:
 *  - by default `tryAdvance()` runs the stage transition, then `onAdvance()`;
 *  - if `action` is given (e.g. the hub's "simulate the week"), it runs instead.
 */
import { useEffect, useRef, useState } from "react";

import { STAGE_READY_LABEL } from "@/state/stageMachine";
import { useStore } from "@/state/store";

export function ReadinessGate({
  title,
  onAdvance,
  label,
  action,
  disabled = false,
  disabledHint,
}: {
  title?: string;
  onAdvance: (route: string) => void;
  /** override the button copy (defaults to the stage's label). */
  label?: string;
  /** run this instead of `tryAdvance` when everyone is ready. */
  action?: () =>
    | { route: string }
    | { moved: boolean; route: string }
    | Promise<{ route: string } | { moved: boolean; route: string }>;
  disabled?: boolean;
  disabledHint?: string;
}) {
  const gms = useStore((s) => s.gms);
  const readiness = useStore((s) => s.readiness);
  const viewerGmId = useStore((s) => s.viewerGmId);
  const stage = useStore((s) => s.stage);
  const setReady = useStore((s) => s.setReady);
  const autoReadyNonViewers = useStore((s) => s.autoReadyNonViewers);
  const tryAdvance = useStore((s) => s.tryAdvance);

  const humans = gms.filter((g) => g.isHuman);
  const readyCount = humans.filter((g) => readiness[g.id]).length;
  const viewerReady = !!readiness[viewerGmId];
  const allReady = readyCount === humans.length;

  useEffect(() => {
    const t = setTimeout(() => autoReadyNonViewers(), 1400);
    return () => clearTimeout(t);
  }, [stage, autoReadyNonViewers]);

  // Always call the latest onAdvance, and never drop it once the transition
  // has run: several screens unmount this gate the moment the stage changes
  // (League Setup locks, the FA window closes, the bracket hides it after the
  // Super Bowl), and swallowing the navigation there strands the player on
  // a screen whose stage has already moved on. The timer itself is still
  // cancelled on re-render so a transition can't be triggered twice.
  const [busy, setBusy] = useState(false);
  const onAdvanceRef = useRef(onAdvance);
  onAdvanceRef.current = onAdvance;
  const advancingRef = useRef(false);
  useEffect(() => {
    if (!allReady) return;
    const t = setTimeout(async () => {
      if (advancingRef.current) return;
      advancingRef.current = true;
      setBusy(true);
      try {
        const res = await (action ? action() : tryAdvance());
        const moved = "moved" in res ? res.moved : true;
        if (moved) onAdvanceRef.current(res.route);
      } finally {
        advancingRef.current = false;
        setBusy(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [allReady, action, tryAdvance]);

  const waiting = humans.length - readyCount;

  return (
    <div className="readiness">
      <div className="readiness-top">
        <p>{title ?? "Readiness"}</p>
        {/* the one thing on the page that changes without the player doing
            anything — other GMs readying up — so it's worth announcing */}
        <span aria-live="polite">
          {waiting === 0 ? "All GMs ready" : `Waiting on ${waiting} of ${humans.length} GMs`}
        </span>
      </div>
      <div className="gmchiprow">
        {humans.map((g) => (
          <div key={g.id} className={`gmchip ${readiness[g.id] ? "ready" : "pending"}`}>
            <span className="dot" />
            {g.id === viewerGmId ? "You" : g.name} &mdash; {readiness[g.id] ? "ready" : "pending"}
          </div>
        ))}
      </div>
      <button
        className="btn-primary"
        style={{ width: "100%" }}
        // Simulating a week is sixteen games over HTTP; without this the
        // player clicks, nothing visibly happens for a second or two, and
        // clicks again.
        disabled={disabled || busy}
        aria-busy={busy || undefined}
        onClick={() => setReady(viewerGmId, !viewerReady)}
      >
        {busy
          ? "Simulating…"
          : disabled
            ? (disabledHint ?? "Not ready yet")
            : viewerReady
              ? "You're ready — waiting on the league"
              : (label ?? STAGE_READY_LABEL[stage])}
      </button>
    </div>
  );
}
