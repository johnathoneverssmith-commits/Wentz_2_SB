import { describe, expect, it } from "vitest";

import type { Stage } from "@/domain";

import { availableCoaches, coachingOnTheClock, isDelegated, vacantRoles } from "./coachingDraft.ts";
import { onTheClock as faOnTheClock } from "./freeAgencyEvent.ts";
import { pendingFor } from "./tradeDeadline.ts";
import { hasBoxScore } from "./selectors.ts";
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


async function playUntil(stage: Stage, guard = 200): Promise<void> {
  while (s().stage !== stage && guard-- > 0) await step();
  expect(s().stage).toBe(stage);
}

describe("transaction windows and season shortcuts (single player)", () => {
  it(
    "delegates coaching picks, closes instant signing/trading, and fast-forwards through the normal sim",
    async () => {
      await useStore.getState().newLeague(33, DEFAULT_CONFIG);
      useStore.getState().pickTeam(s().viewerGmId, "GB");
      const me = "GB";

      // --- coaching draft: a partial manual run, then delegate -------------
      await playUntil("coachingDraft");
      // solo: the human is on the clock after the CPU teams ahead of them
      expect(coachingOnTheClock(s())).toBe(me);
      const first = availableCoaches(s()).find((c) => vacantRoles(s(), me).includes(c.role))!;
      expect(useStore.getState().draftCoach(first.id).ok).toBe(true);
      expect(vacantRoles(s(), me)).toHaveLength(11);
      const before = JSON.stringify(s().coachingDraft!.results.filter((r) => r.teamCode !== me));
      expect(useStore.getState().delegateCoaching().ok).toBe(true);
      // solo: the staff finished everything and the draft ended on its own
      expect(vacantRoles(s(), me)).toHaveLength(0);
      expect(s().stage).not.toBe("coachingDraft");
      const mine = s().coachingDraft!.results.filter((r) => r.teamCode === me);
      expect(mine).toHaveLength(12);
      expect(mine[0]!.byStaff).toBeUndefined();
      expect(mine.slice(1).every((r) => r.byStaff)).toBe(true);
      expect(isDelegated(s(), me)).toBe(true);
      // other teams' recorded picks are untouched by the delegation (prefix)
      expect(JSON.stringify(s().coachingDraft!.results.filter((r) => r.teamCode !== me)).startsWith(before.slice(0, 40))).toBe(true);
      // a second press is harmless
      expect(useStore.getState().delegateCoaching().ok).toBe(true);

      // --- the instant paths are closed in the store layer -----------------
      const fa = Object.values(s().players).find((p) => p.free_agent && !p.retired);
      if (fa) {
        const r = useStore.getState().signStandingFreeAgent(fa.id, {
          teamCode: me, baseSalary: 1, signingBonus: 0, years: 1, guaranteed: 0,
        });
        expect(r.ok).toBe(false);
        expect(s().players[fa.id]!.free_agent).toBe(true);
      }

      // --- preseason shortcut ------------------------------------------------
      await playUntil("preseason");
      const planBefore = JSON.stringify(s().gamePlans ?? null);
      const [a, b] = await Promise.all([
        useStore.getState().fastForwardSeason(),
        useStore.getState().fastForwardSeason(),
      ]);
      expect(a).toBe(b); // a duplicate click is the same run, not a second one
      expect(a.ok).toBe(true);
      expect(a.phase).toBe("PRE");
      expect(a.weeksPlayed).toBeGreaterThan(0);
      expect(s().stage).not.toBe("preseason");
      const scheduledPre = s().schedule.filter((g) => g.phase === "PRE").length;
      const playedPre = s().games.filter((g) => g.phase === "PRE" && g.played);
      expect(playedPre.length).toBe(scheduledPre);
      expect(new Set(playedPre.map((g) => g.id)).size).toBe(playedPre.length); // no game twice
      expect(JSON.stringify(s().gamePlans ?? null)).toBe(planBefore);
      expect(s().pendingGameDay).toBeNull();

      // --- regular season: stops at the trade-deadline checkpoint ----------
      await playUntil("regularSeason");
      const deadlineWeek = 9;
      const reg = await useStore.getState().fastForwardSeason();
      expect(reg.ok).toBe(true);
      expect(reg.stoppedIn).toBe("tradeDeadline");
      expect(reg.to).toBe(deadlineWeek);
      const playedReg = s().games.filter((g) => g.phase === "REG" && g.played);
      expect(Math.max(...playedReg.map((g) => g.week))).toBe(deadlineWeek);
      expect(s().tradeDeadline).toBeTruthy();
      // standings reflect exactly the games played
      const totalGames = Object.values(s().teams).reduce((n, t) => n + t.wins + t.losses + (t.ties ?? 0), 0);
      expect(totalGames).toBe(playedReg.length * 2);
      // the shortcut does nothing at the deadline: that is a decision for the GM
      const none = await useStore.getState().fastForwardSeason();
      expect(none.ok).toBe(false);
      expect(none.weeksPlayed).toBe(0);

      // box scores for the human's games survive for the play-by-play screen
      const mineGames = playedReg.filter((g) => g.homeTeam === me || g.awayTeam === me);
      expect(mineGames.length).toBeGreaterThan(0);
      expect(mineGames.every((g) => hasBoxScore(g))).toBe(true);

      // --- the rest of the year, after the deadline's own turns -------------
      await playUntil("regularSeason");
      const rest = await useStore.getState().fastForwardSeason();
      expect(rest.ok).toBe(true);
      expect(rest.stoppedIn).toBe("playoffs");
      const scheduled = s().schedule.filter((g) => g.phase === "REG").length;
      expect(s().games.filter((g) => g.phase === "REG" && g.played).length).toBe(scheduled);
    },
    TIMEOUT,
  );
});

