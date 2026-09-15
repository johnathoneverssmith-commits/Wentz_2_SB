import { useEffect, useState } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";

import { AppShell } from "@/components/AppShell";
import { ScreenBoundary } from "@/components/ScreenBoundary";
import { isOnline, resumeLeague, lastLeagueId } from "@/state/online";
import { STAGE_HOME } from "@/state/stageMachine";
import { useStore } from "@/state/store";

import { CoachingStaffHub } from "./screens/CoachingStaffHub.tsx";
import { DraftPreview } from "./screens/DraftPreview.tsx";
import { DraftRoom } from "./screens/DraftRoom.tsx";
import { EndOfSeasonAnnounce, SeasonComplete } from "./screens/EndOfSeason.tsx";
import { FantasyDraftSummary } from "./screens/FantasyDraftSummary.tsx";
import { FreeAgencyBoard } from "./screens/FreeAgencyBoard.tsx";
import { FullBoxScore } from "./screens/FullBoxScore.tsx";
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
function StageHome() {
  const stage = useStore((s) => s.stage);
  return <Navigate to={STAGE_HOME[stage]} replace />;
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

function useResumeOnline(): boolean {
  const [resuming, setResuming] = useState(() => !isOnline() && lastLeagueId() !== null);
  useEffect(() => {
    if (!resuming) return;
    let live = true;
    const done = () => {
      if (live) setResuming(false);
    };
    const timer = setTimeout(done, RESUME_TIMEOUT_MS);
    void resumeLeague()
      .then((state) => {
        if (live && state) useStore.setState(state as never);
      })
      .finally(() => {
        clearTimeout(timer);
        done();
      });
    return () => {
      live = false;
      clearTimeout(timer);
    };
    // deliberately once, on mount: retrying is the user's call, not a loop
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return resuming;
}

export function App() {
  // keyed on the route so navigating away from a crashed screen clears it
  const { pathname } = useLocation();
  const resuming = useResumeOnline();
  return (
    <AppShell>
      {resuming && (
        <div className="notice" role="status" style={{ maxWidth: 820, margin: "0 auto 16px" }}>
          Reconnecting to your online league… the server may need a moment to wake. Everything
          below is your last saved copy until it does.
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
          <Route path="/coaching" element={<CoachingStaffHub />} />
          <Route path="/roster" element={<RosterCapManagement />} />
          <Route path="/league-rosters" element={<LeagueRosters />} />
          <Route path="/trade" element={<TradeProposal />} />
          <Route path="/free-agency" element={<FreeAgencyBoard />} />
          <Route path="/schedule" element={<FullSchedule />} />
          <Route path="/league-stats" element={<LeagueStatsRankings />} />
          <Route path="/player-stats" element={<PlayerStatistics />} />
          <Route path="/box/:gameId" element={<FullBoxScore />} />
          <Route path="/retirement" element={<RetirementReview />} />
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
    </AppShell>
  );
}
