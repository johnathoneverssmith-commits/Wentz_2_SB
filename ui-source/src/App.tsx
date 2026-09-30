import { useEffect, useRef, useState } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";

import { AppShell } from "@/components/AppShell";
import { ScreenBoundary } from "@/components/ScreenBoundary";
import { OnlineIntro } from "@/components/OnlineIntro";
import { Checkpoint } from "./screens/Checkpoint.tsx";
import { isOnline, onOnlineChange, resumeLeague, lastLeagueId, takeRemoval, type Removal, type ResumeFailure } from "@/state/online";
import { currentBlock } from "@/state/revealBlocks";
import { stepOf } from "@/state/reveal";
import { currentScreen, STAGE_HOME, STAGE_LABEL } from "@/state/stageMachine";
import { useStore } from "@/state/store";

import { CoachingDraftRoom } from "./screens/CoachingDraftRoom.tsx";
import { CoachingDraftSummary } from "./screens/CoachingDraftSummary.tsx";
import { FreeAgencyBoardTurns } from "./screens/FreeAgencyBoardTurns.tsx";
import { FreeAgencySummary } from "./screens/FreeAgencySummary.tsx";
import { TrainingCamp } from "./screens/TrainingCamp.tsx";
import { TrainingCampResults } from "./screens/TrainingCampResults.tsx";
import { CoachingStaffHub } from "./screens/CoachingStaffHub.tsx";
import { DraftPreview } from "./screens/DraftPreview.tsx";
import { DraftRoom } from "./screens/DraftRoom.tsx";
import { EndOfSeasonAnnounce, SeasonComplete } from "./screens/EndOfSeason.tsx";
import { FantasyDraftSummary } from "./screens/FantasyDraftSummary.tsx";
import { FreeAgencyBoard } from "./screens/FreeAgencyBoard.tsx";
import { FullBoxScore } from "./screens/FullBoxScore.tsx";
import { HoodedFigureEncounter } from "./screens/HoodedFigureEncounter.tsx";
import { LeagueDevelopments } from "./screens/LeagueDevelopments.tsx";
import { SeasonResults } from "./screens/SeasonResults.tsx";
import { PlayoffRoundResults } from "./screens/PlayoffRoundResults.tsx";
import { RookieDraftSummary } from "./screens/RookieDraftSummary.tsx";
import { TradeDeadlineRoom } from "./screens/TradeDeadlineRoom.tsx";
import { TradeSummary } from "./screens/TradeSummary.tsx";
import { WatchGame } from "./screens/WatchGame.tsx";
import { FullSchedule } from "./screens/FullSchedule.tsx";
import { GameDay } from "./screens/GameDay.tsx";
import { LeagueHistory } from "./screens/LeagueHistory.tsx";
import { LeagueRosters } from "./screens/LeagueRosters.tsx";
import { LeagueSetup } from "./screens/LeagueSetup.tsx";
import { LeagueStatsRankings } from "./screens/LeagueStatsRankings.tsx";
import { OnlineLobby } from "./screens/OnlineLobby.tsx";
import { PlayerStatistics } from "./screens/PlayerStatistics.tsx";
import { PostseasonBracket } from "./screens/PostseasonBracket.tsx";
import { RetirementReview } from "./screens/RetirementReview.tsx";
import { RookieSignings } from "./screens/RookieSignings.tsx";
import { RosterCapManagement } from "./screens/RosterCapManagement.tsx";
import { ScreenGallery } from "./screens/ScreenGallery.tsx";
import { TradeProposal } from "./screens/TradeProposal.tsx";
import { WeeklyTeamHub } from "./screens/WeeklyTeamHub.tsx";

/** Redirect the bare "/" to the current stage's canonical screen. */
/**
 * Where a GM belongs right now.
 *
 * Almost always a pure function of the league stage. The exception is Change
 * 12's offseason, where one stage holds two screens and each GM crosses
 * between them on their own — so the marker, when set, wins. This is also
 * what puts a returning disconnected GM back on the screen they committed
 * to rather than at the start of the stage.
 */
function StageHome() {
  const stage = useStore((s) => s.stage);
  const step = useStore((s) => stepOf(s, s.viewerGmId));
  return <Navigate to={currentScreen(stage, step).route} replace />;
}

/**
 * Put the online session back, without holding the app hostage to it.
 *
 * The store rehydrates the league from localStorage on its own, so a refresh
 * renders a shared league that is no longer connected to the server unless
 * the session is restored — and until it is, actions would write to a private
 * copy. That is worth fixing, and it was fixed by blocking the first paint
 * until the reconnect finished.
 *
 * That was the wrong trade. The league server sleeps when idle and takes the
 * better part of a minute to wake, and a request to a sleeping host can stall
 * for far longer than that. Blocking meant the entire app — including the
 * single-player game, which needs no server at all — showed nothing but
 * "Reconnecting to your league…" with no way out. One slow request took the
 * whole product down.
 *
 * So it reconnects in the background and the app renders immediately. The
 * window where local state is showing un-reconnected is small, visible (the
 * shell says so), and self-correcting; a dead app is none of those. The
 * timeout exists because a stalled fetch has no deadline of its own, and
 * "still trying" must not be forever.
 */
const RESUME_TIMEOUT_MS = 12_000;

function useResumeOnline(): { resuming: boolean; failed: ResumeFailure | null } {
  const [resuming, setResuming] = useState(() => !isOnline() && lastLeagueId() !== null);
  const [failed, setFailed] = useState<ResumeFailure | null>(null);
  useEffect(() => {
    if (!resuming) return;
    let live = true;
    const done = () => {
      if (live) setResuming(false);
    };
    const timer = setTimeout(() => {
      done();
      if (live) setFailed((f) => f ?? "unreachable");
    }, RESUME_TIMEOUT_MS);
    let retry: ReturnType<typeof setTimeout> | null = null;
    const tryResume = (left: number): void => {
      void resumeLeague()
        .then((result) => {
          if (!live) return;
          if (result === "signedOut" || result === "unreachable") setFailed(result);
          else if (result) {
            setFailed(null);
            useStore.setState(result as never);
          }
          // A server waking from sleep fails the first try more often than
          // not. Keep trying quietly for a couple of minutes, so the league
          // comes back on its own instead of waiting for a reload.
          if (result === "unreachable" && left > 0) retry = setTimeout(() => tryResume(left - 1), 20_000);
        })
        .finally(() => {
          clearTimeout(timer);
          done();
        });
    };
    tryResume(6);
    return () => {
      live = false;
      clearTimeout(timer);
      if (retry) clearTimeout(retry);
    };
    // deliberately once, on mount: a bounded retry, not a loop
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return { resuming, failed };
}

/**
 * Stages that end at a checkpoint, and what the checkpoint says.
 *
 * A stage is listed here when finishing it is a commitment rather than a
 * navigation — the GM is done, the league is not, and they wait. Change 2
 * adds them one at a time as each section is converted; anything absent still
 * advances the old way.
 */
const CHECKPOINTS: Partial<Record<string, { from: string; to: string }>> = {
  // finding 4: this one was never added when Draft Preview's own "Change 12"
  // comment already promised it — the league waited at nothing, and the
  // button just sat there once the viewer was ready.
  offseasonDraftPrep: { from: "Draft Preview", to: "NFL Draft" },
  leagueDevelopments: { from: "League Developments", to: "Regular Season" },
  hoodedFigureEncounter: { from: "Training Camp", to: "Re-order Depth Chart" },
  fantasyDraftSummary: { from: "Draft Summary", to: "Coaching Fantasy Draft" },
  coachingDraftSummary: { from: "Coaching Draft Summary", to: "Free Agency" },
  freeAgencySummary: { from: "Free Agency", to: "Training Camp" },
  // Training camp itself is single-player — the checkpoint is after the depth
  // chart, which is the last thing before the league needs to be in step.
  offseasonDepthChart: { from: "Re-order Depth Chart", to: "Preseason" },
  // Change 8: the summary is the last thing before mid-season free agency,
  // and advancing out of it is the commitment.
  tradeDeadlineSummary: { from: "Trade Deadline", to: "Mid-Season Free Agency" },
  // Change 13: rookie signings are the last screen of this stage, so its
  // checkpoint is the one that opens annual free agency.
  offseasonDraftSummary: { from: "Rookie Signings", to: "Free Agency" },
  midseasonFreeAgencySummary: { from: "Mid-Season Free Agency", to: "Depth Chart" },
  // Change 9: the last gate before weeks 10-18 are simulated, which is why
  // this one actually has to hold everyone — the block is built from the
  // rosters and depth charts on the far side of it.
  midseasonDepthChart: { from: "Midseason Roster Finalization", to: "Week 10" },
};

/**
 * Hold a committed GM at the checkpoint.
 *
 * This is what makes committing irreversible, and it is deliberately a fact
 * about saved state rather than about navigation: you are here because the
 * server has you ready for a stage that has not advanced. Typing a URL, going
 * back, or reconnecting on another device all land here too, because all of
 * them ask the same question and get the same answer.
 */
function useCheckpoint(): { from: string; to: string } | null {
  const stage = useStore((s) => s.stage);
  const readiness = useStore((s) => s.readiness);
  const viewerGmId = useStore((s) => s.viewerGmId);
  const block = useStore(currentBlock);
  if (!isOnline()) return null;
  if (!readiness[viewerGmId]) return null;
  // Changes 6 and 7: the preseason and each half of the regular season end at
  // a checkpoint too, and which one depends on the block rather than on the
  // stage — `regularSeason` is the stage on both sides of the trade deadline.
  if (block) return block.checkpoint;
  return CHECKPOINTS[stage] ?? null;
}

/**
 * Leaving the checkpoint for the stage the league moved into.
 *
 * The overlay lifts when the last GM commits, and underneath it is whatever
 * screen this GM committed from — the hub, a summary — for a stage that is
 * over. Finding 4 asked that every advance land on the next screen; this is
 * the half of that the button cannot do, because the move happens on someone
 * else's click. Only on release from the checkpoint, never otherwise: a GM
 * browsing rosters while the league moves is not yanked anywhere.
 */
function useFollowReleasedCheckpoint(held: boolean): void {
  const nav = useNavigate();
  const stage = useStore((s) => s.stage);
  const was = useRef<{ held: boolean; stage: string }>({ held, stage });
  useEffect(() => {
    const before = was.current;
    was.current = { held, stage };
    if (before.held && !held && before.stage !== stage) nav(STAGE_HOME[stage]);
  }, [held, stage, nav]);
}

/**
 * Online, the league moves when the last GM checks in — usually someone
 * else, over the stream. The GM who checked in first was left on the old
 * stage's screen, reading "waiting on the league" for a wait that was over.
 * Take them along, but only from that screen: someone browsing rosters while
 * they wait stays where they are.
 */
function useFollowLeague(held: boolean): [string | null, () => void] {
  const nav = useNavigate();
  const { pathname } = useLocation();
  const stage = useStore((s) => s.stage);
  const ready = useStore((s) => !!s.readiness[s.viewerGmId]);
  const step = useStore((s) => stepOf(s, s.viewerGmId));
  // the screen they were on counts as the stage's whether it's the stage's
  // home or a step inside it (the draft preview, rookie signings)
  const route = currentScreen(stage, step).route;
  const was = useRef({ stage, ready, pathname, route });
  // Moved without this device seeing the GM check in — they checked in from
  // another device, the commissioner moved the league on, or the clock ran
  // out. The old screen used to stay up with the *next* stage's check-in
  // button on it ("Ready to advance to the draft" under last season's
  // results), which checked them into a stage they had never seen.
  const [movedOn, setMovedOn] = useState<string | null>(null);
  useEffect(() => {
    const before = was.current;
    was.current = { stage, ready, pathname, route };
    if (!isOnline() || held || before.stage === stage) return;
    if (before.pathname === before.route && pathname === before.pathname) {
      if (!before.ready) setMovedOn(STAGE_LABEL[stage] ?? "the next stage");
      nav(route);
    }
  }, [stage, ready, pathname, route, held, nav]);
  return [movedOn, () => setMovedOn(null)];
}

/** The league a seat was taken from while it was open here, if any. */
function useRemoval(): [Removal | null, () => void] {
  const [name, setName] = useState<Removal | null>(null);
  useEffect(
    () =>
      onOnlineChange(() => {
        const gone = takeRemoval();
        if (gone) setName(gone);
      }),
    [],
  );
  return [name, () => setName(null)];
}

export function App() {
  // keyed on the route so navigating away from a crashed screen clears it
  const { pathname } = useLocation();
  const { resuming, failed: resumeFailed } = useResumeOnline();
  const [removedFrom, dismissRemoval] = useRemoval();
  const checkpoint = useCheckpoint();
  // The waiting room covers only the screen a GM checked in from. It used to
  // replace every route, so a GM waiting hours on the rest of the league
  // couldn't look at a roster, a stat or the history in the meantime.
  const stage = useStore((s) => s.stage);
  const step = useStore((s) => stepOf(s, s.viewerGmId));
  const waitingRoom = currentScreen(stage, step).route;
  const holding = checkpoint !== null && (pathname === waitingRoom || pathname === "/");
  useFollowReleasedCheckpoint(holding);
  const [movedOn, dismissMovedOn] = useFollowLeague(holding);
  return (
    <AppShell>
      {resuming && (
        <div className="notice" role="status" style={{ maxWidth: 820, margin: "0 auto 16px" }}>
          Reconnecting to your online league… the server may need a moment to wake. Everything
          below is your last saved copy until it does.
        </div>
      )}
      {isOnline() && pathname !== "/online" && <OnlineIntro />}
      {movedOn && (
        <div className="notice" role="status" style={{ maxWidth: 820, margin: "0 auto 16px" }}>
          <strong>The league moved on to {movedOn}.</strong> You&rsquo;ve been brought along.{" "}
          <button type="button" className="btnlink sm" onClick={dismissMovedOn}>
            OK
          </button>
        </div>
      )}
      {removedFrom && (
        <div className="notice bad" role="status" style={{ maxWidth: 820, margin: "0 auto 16px" }}>
          {removedFrom.why === "signedOut" ? (
            <>
              <strong>You&rsquo;ve been signed out of {removedFrom.league}.</strong> Moves are paused
              until you sign in again.{" "}
              <a href="#/online" onClick={dismissRemoval}>
                Sign in
              </a>
            </>
          ) : (
            <>
              <strong>You&rsquo;re no longer in {removedFrom.league}.</strong> Your seat was reopened
              or the league was closed. What you see is its last copy on this device.{" "}
              <a href="#/online" onClick={dismissRemoval}>
                Online leagues
              </a>
            </>
          )}
        </div>
      )}
      {!resuming && resumeFailed && !isOnline() && pathname !== "/online" && (
        // it used to vanish and leave a local copy looking like the league
        <div className="notice bad" role="status" style={{ maxWidth: 820, margin: "0 auto 16px" }}>
          {resumeFailed === "signedOut" ? (
            <>
              <strong>You&rsquo;re signed out of your online league.</strong> What you see is a saved
              copy, and moves are paused until you&rsquo;re back in.{" "}
              <a href="#/online">Sign in again</a>
            </>
          ) : (
            <>
              <strong>Couldn&rsquo;t reach your online league.</strong> What you see is a saved copy,
              and moves are paused until it reconnects.{" "}
              <a href="" onClick={() => window.location.reload()}>
                Try again
              </a>
            </>
          )}
        </div>
      )}
      {holding && checkpoint ? (
        <Checkpoint previousStage={checkpoint.from} nextStage={checkpoint.to} />
      ) : (
      <>
      {checkpoint && (
        <div className="notice" role="status" style={{ maxWidth: 820, margin: "0 auto 16px" }}>
          <strong>You&rsquo;re checked in</strong> — the league moves on to {checkpoint.to} once
          everyone has. Browse freely in the meantime.{" "}
          <a href={`#${waitingRoom}`}>Back to the waiting room</a>
        </div>
      )}
      <ScreenBoundary resetKey={pathname}>
        <Routes>
          <Route path="/" element={<StageHome />} />
          <Route path="/setup" element={<LeagueSetup />} />
          <Route path="/hub" element={<WeeklyTeamHub />} />
          <Route path="/game-day" element={<GameDay />} />
          <Route path="/bracket" element={<PostseasonBracket />} />
          <Route path="/draft" element={<DraftRoom />} />
          <Route
            path="/fantasy-draft-summary"
            element={<FantasyDraftSummary />}
          />
          <Route path="/coaching-draft" element={<CoachingDraftRoom />} />
          <Route path="/coaching-draft-summary" element={<CoachingDraftSummary />} />
          <Route path="/free-agency-board" element={<FreeAgencyBoardTurns />} />
          <Route path="/free-agency-summary" element={<FreeAgencySummary />} />
          <Route path="/training-camp" element={<TrainingCamp />} />
          <Route path="/training-camp-results" element={<TrainingCampResults />} />
          <Route path="/hooded-figure" element={<HoodedFigureEncounter />} />
          <Route path="/league-developments" element={<LeagueDevelopments />} />
          <Route path="/coaching" element={<CoachingStaffHub />} />
          <Route path="/roster" element={<RosterCapManagement />} />
          <Route path="/league-rosters" element={<LeagueRosters />} />
          <Route path="/trade" element={<TradeProposal />} />
          <Route path="/trade-deadline" element={<TradeDeadlineRoom />} />
          <Route path="/trade-summary" element={<TradeSummary />} />
          <Route path="/free-agency" element={<FreeAgencyBoard />} />
          <Route path="/schedule" element={<FullSchedule />} />
          <Route path="/league-stats" element={<LeagueStatsRankings />} />
          <Route path="/player-stats" element={<PlayerStatistics />} />
          <Route path="/box/:gameId" element={<FullBoxScore />} />
          <Route path="/watch/:gameId" element={<WatchGame />} />
          <Route path="/results/round/:round" element={<PlayoffRoundResults />} />
          <Route path="/results/:phase/:from/:to" element={<SeasonResults />} />
          <Route path="/results/:phase/:from/:to/:week" element={<SeasonResults />} />
          <Route path="/retirement" element={<RetirementReview />} />
          <Route path="/rookie-draft-summary" element={<RookieDraftSummary />} />
          <Route path="/rookie-signings" element={<RookieSignings />} />
          <Route path="/draft-preview" element={<DraftPreview />} />
          <Route path="/end-of-season" element={<EndOfSeasonAnnounce />} />
          <Route path="/season-complete" element={<SeasonComplete />} />
          <Route path="/history" element={<LeagueHistory />} />
          <Route path="/online" element={<OnlineLobby />} />
          <Route path="/gallery" element={<ScreenGallery />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </ScreenBoundary>
      </>
      )}
    </AppShell>
  );
}
