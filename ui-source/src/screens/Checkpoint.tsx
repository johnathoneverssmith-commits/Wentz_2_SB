import { useEffect, useState } from "react";

import { Card, CardHeader } from "@/components/primitives";
import { WaitingStakes } from "@/components/WaitingStakes";
import { isOnline, onlineSession, pull } from "@/state/online";
import { STAGE_LABEL } from "@/state/stageMachine";
import { useStore } from "@/state/store";
import { useLeagueActions } from "@/state/useLeagueActions";
import { andList } from "@/util/format";

/**
 * The only place a league waits for anybody.
 *
 * Change 2 pulls readiness out of the sections themselves. A GM plays their
 * own stage alone, decides they are done, and commits — and only then arrives
 * here, where the league is assembled. The screen deliberately tells you
 * who the league is still waiting on, when its clock runs out, and — for the
 * commissioner — a way to move it on.
 *
 * What it does say is where you are in the calendar, because that is the one
 * thing a person staring at a spinner actually wants: the stage just
 * finished, and the stage about to start.
 *
 * A check-in waits for every GM — only the turn-based events (drafts, the
 * market, the deadline) have a clock that plays an absent GM's turn
 * (phases.ts, `autopilotAbsent`). The commissioner's force is the backstop.
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
  const gms = useStore((s) => s.gms);
  const readiness = useStore((s) => s.readiness);
  const [forcing, setForcing] = useState(false);
  const [forcingSlow, setForcingSlow] = useState(false);
  useEffect(() => {
    if (!forcing) {
      setForcingSlow(false);
      return;
    }
    const t = setTimeout(() => setForcingSlow(true), 3_000);
    return () => clearTimeout(t);
  }, [forcing]);
  const [forceError, setForceError] = useState<string | null>(null);
  const isCommissioner = onlineSession()?.isCommissioner ?? false;
  // who the league is waiting for, by name — the wait used to be anonymous
  const waitingNames = gms.filter((g) => g.isHuman && g.teamCode && !readiness[g.id]).map((g) => g.name);
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
      // a backstop, not the mechanism: every poll is the whole league, and at
      // 8 seconds a phone waiting here pulled megabytes a minute
    }, 30_000);
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

          <WaitingStakes />

          {waitingNames.length > 0 && (
            <p className="checkpoint-note" style={{ marginTop: 8 }}>
              Waiting on {andList(waitingNames)}.
              {/* check-ins have no clock — the league waits (a note here once
                  promised a staff would step in; none does) */}
              {" The league waits for everyone to check in"}
              {isCommissioner ? " — you can move it on below." : "; your commissioner can move it on."}
              {/* moving on is for once; a GM who has gone for good holds every
                  stage after this too */}
              {isCommissioner &&
                " If someone isn't coming back, reopen their seat from Manage GMs in the lobby — the AI runs the team until a new GM claims it."}
            </p>
          )}

          {/* The lobby promises the commissioner can move a stuck league on;
              until now the only such control was at league setup. */}
          {isCommissioner && waitingNames.length > 0 && (
            <button
              type="button"
              className="btnlink"
              style={{ marginTop: 12 }}
              disabled={forcing}
              onClick={() => {
                if (
                  !confirm(
                    `Move the league on without ${andList(waitingNames)}?

` +
                      "They skip this stage's check-in and the league moves to the next stage for everyone.",
                  )
                ) {
                  return;
                }
                setForcing(true);
                void actions
                  .forceAdvance()
                  .then((res) => {
                    setForceError(res.ok ? null : (res.reason ?? "The league wouldn't move."));
                  })
                  .finally(() => setForcing(false));
              }}
            >
              {forcing ? "Moving the league on…" : "Commissioner: move the league on without them"}
            </button>
          )}
          {/* checking in was one-way: a GM who remembered an extension or a
              depth-chart move after pressing it had no way back short of the
              rest of the league waiting on nothing */}
          {waitingNames.length > 0 && (
            <button
              type="button"
              className="btnlink"
              style={{ marginTop: 12, marginLeft: isCommissioner ? 16 : 0 }}
              disabled={forcing}
              onClick={() => {
                setForcing(true);
                void actions
                  .readyUp(false)
                  .then((res) => setForceError(res.ok ? null : (res.reason ?? "Couldn't take it back.")))
                  .finally(() => setForcing(false));
              }}
            >
              Take back my check-in
            </button>
          )}
          {/* a commissioner gone for a week left nobody able to move the
              league on; any GM can now take the role (the server checks) */}
          {!isCommissioner && onlineSession()?.canClaimCommissioner && waitingNames.length > 0 && (
            <div className="checkpoint-note" style={{ marginTop: 12 }}>
              Your commissioner hasn&rsquo;t been around for a week.{" "}
              <button
                type="button"
                className="btnlink"
                disabled={forcing}
                onClick={() => {
                  if (!confirm("Take over as commissioner? You'll be able to move the league on, open seats and change the turn clock. The league is told.")) return;
                  const s = onlineSession();
                  if (!s) return;
                  setForcing(true);
                  void s.client
                    .claimCommissioner(s.leagueId)
                    .then(() => pull())
                    .then(() => setForceError(null))
                    .catch((err: unknown) => setForceError(err instanceof Error ? err.message : "Couldn't take over."))
                    .finally(() => setForcing(false));
                }}
              >
                Take over as commissioner
              </button>
            </div>
          )}
          {/* moving on past a block gate plays the next stretch of games, and
              "Moving the league on…" sat there for a minute with no reason */}
          {forcingSlow && (
            <p className="checkpoint-note" role="status" style={{ marginTop: 8 }}>
              Still working — when the league moves into a stretch of games, those games are played
              now, which can take a minute or two.
            </p>
          )}
          {forceError && (
            <p className="form-error" role="status" style={{ margin: "8px 0 0" }}>
              {forceError}
            </p>
          )}

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
