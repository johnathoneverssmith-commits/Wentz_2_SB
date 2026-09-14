/**
 * The "waiting on X of Y GMs" readiness gate. It is always the bottom-most
 * element on a screen. The viewer toggles their own ready state; other human
 * GMs auto-ready a moment after the stage loads. When all are ready:
 *  - by default `tryAdvance()` runs the stage transition, then `onAdvance()`;
 *  - if `action` is given (e.g. the hub's "simulate the week"), it runs instead.
 *
 * Online it is the same control over a different machine, and the difference
 * is worth stating because it is the whole point of the mode. The other GMs
 * are people: nobody auto-readies, and "waiting on 2 of 4" means two humans
 * who may be asleep. And this client does not advance the league — it tells
 * the server it is ready, and the server decides, either when the last GM
 * readies up or when the phase clock runs out and the absent GMs' staffs act
 * for them. So the local transition is skipped entirely, and the new stage
 * arrives the same way any other change does: pushed.
 */
import { useEffect, useRef, useState } from "react";

import { STAGE_HOME, STAGE_READY_LABEL } from "@/state/stageMachine";
import { useStore } from "@/state/store";
import { useLeagueActions } from "@/state/useLeagueActions";

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
  const actions = useLeagueActions();
  const online = actions.online;
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
    // online the other GMs are people, and a person is ready when they say so
    if (online) return;
    const t = setTimeout(() => autoReadyNonViewers(), 1400);
    return () => clearTimeout(t);
  }, [stage, autoReadyNonViewers, online]);

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
    // the server owns the transition online; it arrives on the stream
    if (online || !allReady) return;
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
  }, [allReady, action, tryAdvance, online]);

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
        onClick={() => {
          if (!online) {
            setReady(viewerGmId, !viewerReady);
            return;
          }
          setBusy(true);
          void actions
            .readyUp(!viewerReady)
            .then(() => {
              // the server may have moved the league on the strength of this
              const next = useStore.getState().stage;
              if (next !== stage) onAdvanceRef.current(STAGE_HOME[next]);
            })
            .finally(() => setBusy(false));
        }}
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
