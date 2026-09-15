import { useEffect, useState } from "react";

import { Card, CardHeader } from "@/components/primitives";
import { isOnline } from "@/state/online";
import { STAGE_LABEL } from "@/state/stageMachine";
import { useStore } from "@/state/store";
import { useLeagueActions } from "@/state/useLeagueActions";

/**
 * The only place a league waits for anybody.
 *
 * Change 2 pulls readiness out of the sections themselves. A GM plays their
 * own stage alone, decides they are done, and commits — and only then arrives
 * here, where the league is assembled. The screen deliberately tells you
 * almost nothing: no GM names, no counts, no "waiting on 2 of 3". Knowing
 * *who* the league is waiting for invites chasing people, and the count
 * moving is the only thing it would add.
 *
 * What it does say is where you are in the calendar, because that is the one
 * thing a person staring at a spinner actually wants: the stage just
 * finished, and the stage about to start.
 *
 * There is no timer here and no override. A league waits indefinitely for
 * every registered human GM, which is a deliberate choice recorded in the
 * change log: one GM who never returns ends that league. The alternative —
 * a deadline that plays for an absent GM — was rejected because it means the
 * league can move without you, which is exactly what committing was supposed
 * to rule out.
 *
 * Arriving here is a fact about saved state, not about navigation: you are at
 * the checkpoint because the server has you down as ready for a stage that
 * has not advanced yet. So a disconnect brings you back here, not to the
 * section you already finished, and the league is unaffected by your absence.
 */
export function Checkpoint({
  previousStage,
  nextStage,
}: {
  /** Label for the stage just completed. */
  previousStage: string;
  /** Label for the stage about to begin. */
  nextStage: string;
}) {
  const actions = useLeagueActions();
  const stage = useStore((s) => s.stage);
  const [failed, setFailed] = useState(false);
  const [checking, setChecking] = useState(false);

  // The stream pushes the new league the moment the last GM commits, so this
  // is a backstop rather than the mechanism — it exists because a dropped
  // stream would otherwise leave someone here after the league had moved on.
  useEffect(() => {
    if (!isOnline()) return;
    let live = true;
    let misses = 0;
    const timer = setInterval(() => {
      if (!live) return;
      setChecking(true);
      void actions
        .refresh()
        .then(() => {
          if (!live) return;
          misses = 0;
          setFailed(false);
        })
        .catch(() => {
          if (!live) return;
          misses += 1;
          // a couple of dropped polls is a phone changing networks; a steady
          // run of them is worth admitting to
          if (misses >= 3) setFailed(true);
        })
        .finally(() => {
          if (live) setChecking(false);
        });
    }, 8_000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [actions, stage]);

  return (
    <Card maxWidth={620}>
      <CardHeader badge="··" title="Waiting for other players" subtitle="The league moves on together" />
      <div className="panel open">
        <div className="checkpoint">
          <div className="checkpoint-spinner" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>

          <p className="checkpoint-wait" role="status" aria-live="polite">
            Waiting for other players
          </p>

          <div className="checkpoint-stages">
            <div>
              <span className="checkpoint-label">Previous stage</span>
              <span className="checkpoint-stage">{previousStage}</span>
            </div>
            <span className="checkpoint-arrow" aria-hidden="true">
              →
            </span>
            <div>
              <span className="checkpoint-label">Next stage</span>
              <span className="checkpoint-stage next">{nextStage}</span>
            </div>
          </div>

          <p className="checkpoint-note">
            You&rsquo;re in. The league starts the next stage once every GM has committed, and
            you&rsquo;ll be taken there automatically — you can close this and come back.
          </p>

          {failed && (
            <div className="notice bad" role="status" style={{ marginTop: 18 }}>
              <strong>Connection failed.</strong> Couldn&rsquo;t reach the league server to check
              whether the stage has moved.{" "}
              <button
                type="button"
                className="btnlink"
                disabled={checking}
                onClick={() => {
                  setChecking(true);
                  void actions
                    .refresh()
                    .then(() => setFailed(false))
                    .catch(() => setFailed(true))
                    .finally(() => setChecking(false));
                }}
              >
                Retry
              </button>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

/** Convenience for the common case: name the stages from the stage machine. */
export function stageLabel(stage: string): string {
  return STAGE_LABEL[stage as keyof typeof STAGE_LABEL] ?? stage;
}
