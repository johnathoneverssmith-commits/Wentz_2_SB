/**
 * Where the game meets the soundtrack.
 *
 * Two jobs, and they want different shapes.
 *
 * **The mood** follows where you are, which is a function of the route and
 * the stage. It is idempotent: the director ignores a request for the mood
 * already playing, so this can run on every render without thinking about it.
 *
 * **The cues** follow what just happened, which is a function of a *change*
 * in state — and that is the part worth being careful about. React renders
 * whenever it likes, and a cue that fires on a value rather than on a
 * transition fires a dozen times. So everything here compares against what
 * it saw last render and keeps the comparison in a ref.
 *
 * Nothing in here fires for something the player clicked. Those moments
 * already have visible feedback; a noise on top is the thing people turn the
 * sound off over. These are for what happens *to* you.
 */
import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";

import { useStore } from "@/state/store";
import { viewerTeamCode } from "@/state/selectors";

import { cue } from "./cues.ts";
import { audio } from "./engine.ts";
import { MusicDirector, type MoodName } from "./score.ts";

const director = new MusicDirector();

/** Where you are, in one word the score understands. */
function moodFor(pathname: string, stage: string): MoodName {
  if (pathname.startsWith("/game-day") || pathname.startsWith("/box/")) return "gameday";
  if (pathname.startsWith("/draft") && stage !== "setup") return "draft";
  if (pathname.startsWith("/free-agency")) return "freeAgency";
  if (stage === "endOfSeasonWin") return "champion";
  if (stage === "playoffs" || pathname.startsWith("/bracket")) return "playoffs";
  if (stage === "setup") return "lobby";
  if (stage === "fantasyDraft" || stage === "offseasonDraft") return "draft";
  if (stage === "coachingHiring") return "freeAgency";
  // everything else is a desk job: roster, cap, trades, standings, history
  return "frontOffice";
}

export function useGameAudio(): void {
  const { pathname } = useLocation();
  const stage = useStore((s) => s.stage);
  const draft = useStore((s) => s.draft);
  const trades = useStore((s) => s.trades);
  const bracket = useStore((s) => s.bracket);
  const pending = useStore((s) => s.pendingGameDay);
  const games = useStore((s) => s.games);
  const gms = useStore((s) => s.gms);
  const viewerGmId = useStore((s) => s.viewerGmId);
  const myTeam = gms.find((g) => g.id === viewerGmId)?.teamCode ?? "";

  // --- the score --------------------------------------------------------
  const mood = moodFor(pathname, stage);
  useEffect(() => {
    const bus = audio.music;
    if (!bus) {
      director.stop();
      return;
    }
    director.play(mood, bus);
  }, [mood]);

  // Sound being switched on mid-session has to start the music too — the
  // effect above won't re-run, because the mood hasn't changed.
  useEffect(
    () =>
      audio.onChange(() => {
        const bus = audio.music;
        if (bus) director.play(mood, bus);
        else director.stop();
      }),
    [mood],
  );

  // --- on the clock -----------------------------------------------------
  const wasOnClock = useRef(false);
  useEffect(() => {
    const onClock = !!draft && !!myTeam && draft.pickOrder[draft.currentPickIndex] === myTeam;
    if (onClock && !wasOnClock.current) cue("onTheClock");
    wasOnClock.current = onClock;
  }, [draft, myTeam]);

  // --- a pick of yours landing -----------------------------------------
  const lastPickCount = useRef<number | null>(null);
  useEffect(() => {
    const mine = draft?.results.filter((r) => r.teamCode === myTeam).length ?? 0;
    if (lastPickCount.current !== null && mine > lastPickCount.current) cue("pickMade");
    lastPickCount.current = mine;
  }, [draft, myTeam]);

  // --- an offer arriving ------------------------------------------------
  const lastOffers = useRef<number | null>(null);
  useEffect(() => {
    const offers = trades.filter((t) => t.status === "offered" && t.toTeam === myTeam).length;
    if (lastOffers.current !== null && offers > lastOffers.current) cue("tradeOffer");
    lastOffers.current = offers;
  }, [trades, myTeam]);

  // --- your week's result ----------------------------------------------
  const lastResultId = useRef<string | null>(null);
  useEffect(() => {
    if (!pending || !myTeam) return;
    const mine = games.find(
      (g) => pending.gameIds.includes(g.id) && (g.homeTeam === myTeam || g.awayTeam === myTeam),
    );
    if (!mine?.played || mine.id === lastResultId.current) return;
    lastResultId.current = mine.id;
    const mineScore = mine.homeTeam === myTeam ? mine.homeScore : mine.awayScore;
    const theirs = mine.homeTeam === myTeam ? mine.awayScore : mine.homeScore;
    if (mineScore === theirs) return; // a tie is not a moment
    cue(mineScore > theirs ? "gameWon" : "gameLost");
  }, [pending, games, myTeam]);

  // --- the one that matters --------------------------------------------
  const crowned = useRef(false);
  useEffect(() => {
    const won = !!bracket?.champion && bracket.champion === myTeam;
    if (won && !crowned.current) cue("champion");
    crowned.current = won;
  }, [bracket, myTeam]);
}

/** Team code the audio should consider "yours" — exported for the gamecast. */
export function useMyCode(): string {
  const s = useStore();
  return viewerTeamCode(s) ?? "";
}
