import { describe, expect, it } from "vitest";

import type { LeagueState, Stage } from "@/domain";
import { DEFAULT_CONFIG } from "./seed.ts";
import { useStore } from "./store.ts";
import { bestCoachingPick, coachingOnTheClock } from "./coachingDraft.ts";
import { pendingFor } from "./tradeDeadline.ts";
import { rosterMinimumViolations } from "./rosterRepair.ts";

/**
 * A genuine single-player journey through the real store entry point
 * (`tryAdvance` / `finishGameDay`): the human GM's team loses its only kicker
 * at the door of the regular season, and the staff — not the GM — replaces him
 * as the stage opens. Nothing here calls the repair module.
 */
const state = (): LeagueState => useStore.getState();
const viewer = (): string => {
  const s = state();
  return s.gms.find((g) => g.id === s.viewerGmId)?.teamCode ?? "";
};
const unclaimed = (): string => {
  const s = state();
  const taken = new Set(s.gms.map((g) => g.teamCode).filter(Boolean));
  return Object.keys(s.teams).find((c) => !taken.has(c))!;
};

async function actOn(stage: Stage): Promise<void> {
  const s = useStore.getState();
  switch (stage) {
    case "setup":
      for (const g of s.gms) if (g.isHuman && !g.teamCode) s.pickTeam(g.id, unclaimed());
      break;
    case "fantasyDraft":
      s.startDraft("fantasy");
      useStore.getState().autopickRemaining();
      break;
    case "coachingHiring":
    case "offseasonFreeAgency": {
      const subject = stage === "coachingHiring" ? "coaches" : "players";
      useStore.getState().startBidding(subject);
      for (let i = 0; i < 6; i++) useStore.getState().advanceBiddingDay(subject);
      break;
    }
    case "preseason":
    case "regularSeason":
      await useStore.getState().simulateGameDay();
      break;
    case "coachingDraft":
      for (let g = 0; g < 400 && state().stage === "coachingDraft"; g++) {
        const team = coachingOnTheClock(state());
        const pick = team ? bestCoachingPick(state(), team) : null;
        if (!pick) break;
        useStore.getState().draftCoach(pick);
      }
      break;
    case "freeAgency":
      for (let g = 0; g < 400 && state().stage === stage; g++) {
        if (!state().freeAgencyEvent || state().freeAgencyEvent!.complete) break;
        useStore.getState().freeAgencyTurn({ pass: true });
      }
      break;
    case "tradeDeadline":
      for (let g = 0; g < 400 && state().stage === "tradeDeadline"; g++) {
        const duty = pendingFor(state(), viewer());
        if (!duty) break;
        useStore.getState().deadlineTurn(duty === "propose" ? { kind: "skip" } : { kind: "deny" });
      }
      break;
    default:
      break;
  }
}

async function playStage(): Promise<Stage> {
  const stage = state().stage;
  await actOn(stage);
  if (state().stage !== stage) return state().stage;
  const s = useStore.getState();
  s.autoReadyNonViewers();
  s.setReady(s.viewerGmId, true);
  if (stage === "preseason" || stage === "regularSeason" || stage === "playoffs") {
    await useStore.getState().finishGameDay();
  } else {
    const moved = await useStore.getState().tryAdvance();
    expect(moved.moved, `stage ${stage} refused to advance`).toBe(true);
  }
  return state().stage;
}

describe("single-player: a released star is not signed back, and the franchise still advances", () => {
  it(
    "release a surplus star, lose the rest of the position, and play on to the regular season",
    async () => {
      await useStore.getState().newLeague(11, { ...DEFAULT_CONFIG, humanGmCount: 1 });
      let guard = 80;
      while (guard-- > 0 && state().stage !== "preseason") await playStage();
      expect(state().stage).toBe("preseason");
      const mine = viewer();
      const roster = () => Object.values(state().players).filter((p) => p.nfl_team === mine && !p.retired);
      const qbs = () => roster().filter((p) => p.position === "QB");

      // a release that would open a hole is refused here too, exactly as online
      const kicker = roster().find((p) => p.position === "K")!;
      useStore.getState().releasePlayer(kicker.id);
      expect(state().players[kicker.id]!.nfl_team, "a release into a hole is refused").toBe(mine);

      // a surplus star: allowed, and remembered
      const star = [...qbs()].sort((a, b) => b.overall - a.overall)[0]!;
      useStore.setState((s) => void (s.players[star.id]!.overall = 95));
      expect(qbs().length).toBeGreaterThan(1);
      useStore.getState().releasePlayer(star.id);
      expect(qbs().map((p) => p.id)).not.toContain(star.id);
      const history = (state() as unknown as { recentReleases?: { byTeam: Record<string, string[]> } }).recentReleases;
      expect(history?.byTeam[mine]).toContain(star.id);

      // the rest of the position leaves (a natural hole)
      useStore.setState((s) => {
        for (const p of Object.values(s.players)) if (p.nfl_team === mine && p.position === "QB") { p.nfl_team = "FA"; p.free_agent = true; p.contract = null as never; }
      });
      expect(rosterMinimumViolations(state(), mine).some((v) => v.position === "QB")).toBe(true);

      for (let g = 0; g < 8 && state().stage !== "regularSeason"; g++) await playStage();
      expect(state().stage).toBe("regularSeason");
      expect(qbs().length, "the hole was filled").toBeGreaterThanOrEqual(1);
      expect(qbs().map((p) => p.id), "but not by the player the GM released").not.toContain(star.id);
      expect(rosterMinimumViolations(state(), mine)).toEqual([]);
      // and the release history survives a save and reload
      const saved = JSON.parse(JSON.stringify(state())) as LeagueState;
      expect((saved as unknown as { recentReleases?: { byTeam: Record<string, string[]> } }).recentReleases?.byTeam[mine]).toContain(star.id);
    },
    300_000,
  );
});
