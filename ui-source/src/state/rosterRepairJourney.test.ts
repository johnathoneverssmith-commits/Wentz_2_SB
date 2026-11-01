import { describe, expect, it } from "vitest";

import type { LeagueState, Stage } from "@/domain";
import { DEFAULT_CONFIG } from "./seed.ts";
import { useStore } from "./store.ts";
import { bestCoachingPick, coachingOnTheClock } from "./coachingDraft.ts";
import { pendingFor } from "./tradeDeadline.ts";
import { rosterMinimumViolations, repairsFor } from "./rosterRepair.ts";

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

describe("single-player roster repair through the store", () => {
  it(
    "the staff replaces a human team's missing kicker as the regular season opens, and the GM is told",
    async () => {
      await useStore.getState().newLeague(11, { ...DEFAULT_CONFIG, humanGmCount: 1 });
      let guard = 80;
      while (guard-- > 0 && state().stage !== "preseason") await playStage();
      expect(state().stage).toBe("preseason");

      const mine = viewer();
      const cpu = Object.keys(state().teams).find((c) => c !== mine)!;
      const strip = (): void => {
        for (const team of [mine, cpu]) {
          for (const p of Object.values(state().players)) {
            if (p.nfl_team === team && p.position === "K") useStore.setState((s) => void delete s.players[p.id]);
          }
        }
      };
      // The preseason already tops a team up each week (an older mechanism), so a hole opened before
      // an early press is filled by that. Open it before EVERY press: only the last press, the one that
      // crosses into the regular season, has nothing else to fill it - that is what the repair is for.
      for (let g = 0; g < 8 && state().stage !== "regularSeason"; g++) {
        if (state().stage === "preseason") strip();
        await playStage();
      }
      expect(state().stage).toBe("regularSeason");
      for (const team of [mine, cpu]) {
        expect(rosterMinimumViolations(state(), team), `${team} repaired`).toEqual([]);
        const kickers = Object.values(state().players).filter((p) => p.nfl_team === team && p.position === "K" && !p.retired);
        expect(kickers).toHaveLength(1);
      }
      const record = repairsFor(state(), mine, state().season)[0]!;
      expect(record.human).toBe(true);
      expect(record.signed).toHaveLength(1);
      expect(record.signed[0]!.position).toBe("K");
      // nobody is over the cap or the roster limit because of it
      for (const code of Object.keys(state().teams)) {
        const used = Object.values(state().players).filter((p) => p.nfl_team === code && !p.retired).reduce((n, p) => n + (p.contract?.cap_hit_by_year[0] ?? 0), 0);
        expect(used, `${code} cap`).toBeLessThanOrEqual(state().teams[code]!.cap.total + 1e-6);
      }
    },
    300_000,
  );
});
