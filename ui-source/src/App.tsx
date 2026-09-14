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
 * Put the online session back before anything reads the league.
 *
 * The store rehydrates the league from localStorage on its own, so without
 * this a refresh renders a shared league that is no longer connected to the
 * server — and every action writes to a private copy instead. Holding the
 * first paint for one request is the cheaper mistake: it only happens when
 * this browser was in a league, and getting it wrong is silent.
 */
function useResumeOnline(): boolean {
  const [settled, setSettled] = useState(() => isOnline() || lastLeagueId() === null);
  useEffect(() => {
    if (settled) return;
    let live = true;
    void resumeLeague()
      .then((state) => {
        if (live && state) useStore.setState(state as never);
      })
      .finally(() => {
        if (live) setSettled(true);
      });
    return () => {
      live = false;
    };
  }, [settled]);
  return settled;
}

export function App() {
  // keyed on the route so navigating away from a crashed screen clears it
  const { pathname } = useLocation();
  const settled = useResumeOnline();
  if (!settled) {
    return (
      <AppShell>
        <div className="emptystate">Reconnecting to your league…</div>
      </AppShell>
    );
  }
  return (
    <AppShell>
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
