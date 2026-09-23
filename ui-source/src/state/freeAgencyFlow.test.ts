import { describe, expect, it } from "vitest";

import { availableCoaches, vacantRoles } from "./coachingDraft.ts";
import { FREE_AGENCY_ROUNDS, onTheClock } from "./freeAgencyEvent.ts";
import { DEFAULT_CONFIG } from "./seed.ts";
import { useStore } from "./store.ts";

/**
 * Free agency, played rather than skipped.
 *
 * `playthrough.test.ts` walks every stage but has no `actOn` case for
 * `freeAgency` — it readies up and advances straight past, which is why a
 * market that never opened at all still passed a full-year test. This plays
 * the turns.
 *
 * It also uses the stock 3-GM config on purpose. Every other test overrides
 * `humanGmCount: 1`, so the configuration a new solo dynasty actually starts
 * in was never exercised end to end.
 */
const TIMEOUT = 300_000;

function s() {
  return useStore.getState();
}

async function advance(): Promise<void> {
  const st = useStore.getState();
  st.autoReadyNonViewers();
  st.setReady(st.viewerGmId, true);
  const moved = await useStore.getState().tryAdvance();
  expect(moved.moved, `stage ${st.stage} refused to advance`).toBe(true);
}

/** Setup -> fantasy draft -> coaching draft -> free agency, as a player would. */
async function reachFreeAgency(): Promise<void> {
  await useStore.getState().newLeague(7, DEFAULT_CONFIG);
  const me = s().viewerGmId;
  useStore.getState().pickTeam(me, "GB");
  await advance(); // setup -> fantasyDraft

  expect(s().stage).toBe("fantasyDraft");
  useStore.getState().startDraft("fantasy");
  useStore.getState().autopickRemaining();
  await advance(); // fantasyDraft -> fantasyDraftSummary
  await advance(); // fantasyDraftSummary -> coachingDraft

  expect(s().stage).toBe("coachingDraft");
  // twelve hand-made picks; the CPU sweeps between them
  for (let i = 0; i < 40 && s().stage === "coachingDraft"; i++) {
    const open = vacantRoles(s(), "GB");
    const pick = availableCoaches(s()).find((c) => open.includes(c.role));
    if (!pick) break;
    useStore.getState().draftCoach(pick.id);
  }
  expect(s().stage).toBe("coachingDraftSummary");
  await advance(); // coachingDraftSummary -> freeAgency
}

describe("free agency (single-player store)", () => {
  it(
    "opens the market on arrival, takes turns, and reaches the summary",
    async () => {
      await reachFreeAgency();

      // the market exists at all — it used to stay null, leaving the board
      // on "One moment." forever because nothing called beginFreeAgencyEvent
      expect(s().stage).toBe("freeAgency");
      expect(s().freeAgencyEvent, "free agency never opened").toBeTruthy();
      expect(s().freeAgencyEvent!.round).toBe(1);

      // the CPU teams ahead of the viewer took their turns on the way in
      expect(onTheClock(s())).toBe("GB");

      // one real offer, timed: this runs ~30 CPU turns inside a single immer
      // producer, which is where a slow evaluator becomes a frozen tab
      const pool = Object.values(s().players)
        .filter((p) => p.free_agent && !p.retired)
        .sort((a, b) => b.overall - a.overall);
      const target = pool[0]!;
      const before = s().freeAgencyEvent!.turnIndex;

      const t0 = Date.now();
      const res = useStore.getState().freeAgencyTurn({
        playerId: target.id,
        salary: Math.max(1, Math.round(target.overall / 3)),
        years: 3,
      });
      const elapsed = Date.now() - t0;

      expect(res.ok, res.reason).toBe(true);
      // the offer is on the board and the turn actually moved
      expect(Object.keys(s().freeAgencyEvent!.offers)).toContain(target.id);
      expect(
        s().freeAgencyEvent!.turnIndex !== before || s().freeAgencyEvent!.round > 1,
        "the turn never advanced",
      ).toBe(true);
      // play the rest of the market out by passing
      let guard = 0;
      while (guard++ < 200 && s().stage === "freeAgency" && !s().freeAgencyEvent!.complete) {
        if (onTheClock(s()) !== "GB") break;
        useStore.getState().freeAgencyTurn({ pass: true });
      }

      expect(s().freeAgencyEvent!.round).toBeLessThanOrEqual(FREE_AGENCY_ROUNDS);
      expect(s().freeAgencyEvent!.complete, "the five rounds never finished").toBe(true);
      // finishing the market has to leave the stage, the way the coaching
      // draft and the trade deadline do
      expect(s().stage, "free agency completed but the stage never moved").toBe(
        "freeAgencySummary",
      );

      // A turn is one click, and it sweeps ~30 CPU teams inside one immer
      // producer. It measured 1325ms before the round index was hoisted out
      // of the per-team loop and 189ms after; this guards the gap rather
      // than the exact number, since a regression here is a frozen tab.
      expect(elapsed, `one free-agency turn took ${elapsed}ms`).toBeLessThan(400);
    },
    TIMEOUT,
  );
});
