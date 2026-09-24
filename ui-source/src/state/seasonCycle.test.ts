import { describe, expect, it } from "vitest";

import type { Stage } from "@/domain";

import { availableCoaches, vacantRoles } from "./coachingDraft.ts";
import { onTheClock as faOnTheClock } from "./freeAgencyEvent.ts";
import { pendingFor } from "./tradeDeadline.ts";
import { DEFAULT_CONFIG } from "./seed.ts";
import { useStore } from "./store.ts";

/**
 * The half of the year nothing else plays.
 *
 * `playthrough.test.ts` is called "a full franchise year" but returns at the
 * first preseason: the stages it actually visits are setup through
 * offseasonDepthChart, and it never touches the preseason, the regular
 * season, the trade deadline, the midseason market, the playoffs or the
 * offseason draft cycle. That blind spot is how a mid-season dead end
 * shipped under a green suite — the deadline was reached only through
 * `finishGameDay`, which carried none of the stage-entry logic.
 *
 * This plays from kickoff all the way round to the next one, *taking each
 * stage's turns* rather than readying past them, and asserts the league
 * keeps moving and stays legal.
 */
const TIMEOUT = 600_000;

const s = () => useStore.getState();
const IN_SEASON: Stage[] = ["preseason", "regularSeason", "playoffs"];
let signedRookies = 0;

/** Play a stage's own turns. Some of these finish the stage by themselves. */
async function actOn(stage: Stage): Promise<void> {
  const me = s().gms.find((g) => g.id === s().viewerGmId)?.teamCode ?? "";
  switch (stage) {
    case "setup":
      useStore.getState().pickTeam(s().viewerGmId, "GB");
      break;

    case "fantasyDraft":
    case "offseasonDraft":
      useStore.getState().startDraft(stage === "fantasyDraft" ? "fantasy" : "rookie");
      useStore.getState().autopickRemaining();
      break;

    case "coachingDraft":
      for (let i = 0; i < 40 && s().stage === "coachingDraft"; i++) {
        const open = vacantRoles(s(), me);
        const pick = availableCoaches(s()).find((c) => open.includes(c.role));
        if (!pick) break;
        useStore.getState().draftCoach(pick.id);
      }
      break;

    case "freeAgency":
    case "midseasonFreeAgency":
      // pass every round: signing nothing keeps the roster legal, and the
      // point here is that the turns resolve and the market closes itself
      for (let i = 0; i < 60 && s().stage === stage; i++) {
        if (faOnTheClock(s()) !== me) break;
        useStore.getState().freeAgencyTurn({ pass: true });
      }
      break;

    case "tradeDeadline":
      for (let i = 0; i < 60 && s().stage === "tradeDeadline"; i++) {
        const duty = pendingFor(s(), me);
        if (!duty) break;
        if (duty === "propose") useStore.getState().deadlineTurn({ kind: "skip" });
        else useStore.getState().deadlineTurn({ kind: "deny" });
      }
      break;

    // Change 13: the summary and rookie signings are one stage and two
    // per-GM steps — `offseasonSignings` is never a stage the league lands
    // on, so signing the class means taking the step inside this one.
    case "offseasonDraftSummary": {
      useStore.getState().stepForward("rookieSignings");
      for (const r of s().draft?.results ?? []) {
        if (r.teamCode === me && r.selectedId) {
          useStore.getState().signRookie(r.selectedId, me);
          signedRookies++;
        }
      }
      break;
    }

    case "offseasonFreeAgency":
      useStore.getState().startBidding("players");
      for (let i = 0; i < 6; i++) useStore.getState().advanceBiddingDay("players");
      break;

    case "preseason":
    case "regularSeason":
    case "playoffs":
      await useStore.getState().simulateGameDay();
      break;

    default:
      break;
  }
}

/** One stage's worth of play; returns where the league ended up. */
async function step(): Promise<Stage> {
  const stage = s().stage;
  await actOn(stage);
  // several stages finish themselves once their turns run out — the draft
  // boards, both markets and the deadline all move the stage from inside
  // their own action rather than through a gate
  if (s().stage !== stage) return s().stage;

  const st = useStore.getState();
  st.autoReadyNonViewers();
  st.setReady(st.viewerGmId, true);

  if (IN_SEASON.includes(stage)) {
    await useStore.getState().finishGameDay();
  } else {
    const moved = await useStore.getState().tryAdvance();
    expect(moved.moved, `stage ${stage} refused to advance`).toBe(true);
  }
  return s().stage;
}

/** A stage that owns state has to have built it by the time you arrive. */
function expectOpened(stage: Stage): void {
  if (stage === "coachingDraft") expect(s().coachingDraft, "coaching draft never opened").toBeTruthy();
  if (stage === "tradeDeadline") expect(s().tradeDeadline, "trade deadline never opened").toBeTruthy();
  if (stage === "freeAgency" || stage === "midseasonFreeAgency") {
    expect(s().freeAgencyEvent, `${stage} never opened`).toBeTruthy();
  }
}

describe("a season, played rather than skipped", () => {
  it(
    "goes from kickoff through the deadline, the playoffs and the offseason to the next kickoff",
    async () => {
      await useStore.getState().newLeague(21, DEFAULT_CONFIG);

      signedRookies = 0;
      const seen: Stage[] = [];
      let kickoffs = 0;
      let guard = 400;

      while (guard-- > 0) {
        const before = s().stage;
        const after = await step();
        seen.push(before);
        expectOpened(after);

        // Every scheduled game is played before the playoffs. Visiting the
        // right stages is not enough: the league used to jump from week 1
        // straight to the deadline, skip weeks 2-9, and still pass here.
        if (before === "regularSeason" && after === "playoffs") {
          const scheduled = s().schedule.filter((g) => g.phase === "REG").length;
          const played = s().games.filter((g) => g.phase === "REG" && g.played).length;
          expect(played, "regular-season games played before the playoffs").toBe(scheduled);
        }

        if (before !== "preseason" && after === "preseason") {
          kickoffs++;
          // a second kickoff means a whole year went by in between
          if (kickoffs === 2) break;
        }
      }

      expect(guard, `never came back round; saw: ${seen.join(" -> ")}`).toBeGreaterThan(0);

      // the stages that only exist in the half nothing else plays
      for (const stage of [
        "regularSeason",
        "tradeDeadline",
        "midseasonFreeAgency",
        "midseasonDepthChart",
        "playoffs",
        "offseasonRetirement",
        "offseasonDraftPrep",
        "offseasonDraft",
        "offseasonDraftSummary",
      ] as Stage[]) {
        expect(seen, `never played ${stage}`).toContain(stage);
      }

      // the rookie class was actually put under contract, through the step
      // inside the draft summary rather than a stage of its own
      expect(signedRookies, "no rookie was ever signed").toBeGreaterThan(0);

      // and the deadline actually ran its three rounds rather than being
      // readied past
      expect(s().tradeDeadline?.done ?? true, "the deadline never finished").toBe(true);
    },
    TIMEOUT,
  );
});
