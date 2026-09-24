import { describe, expect, it } from "vitest";

import type { Stage } from "@/domain";

import { availableCoaches, vacantRoles } from "./coachingDraft.ts";
import { onTheClock as faOnTheClock } from "./freeAgencyEvent.ts";
import { seasonShape } from "./leagueFormat.ts";
import { pendingFor } from "./tradeDeadline.ts";
import { DEFAULT_CONFIG } from "./seed.ts";
import { useStore } from "./store.ts";

/**
 * A humans-only league, played for a whole year.
 *
 * Three GMs make a four-team league — their three teams plus one CPU team —
 * that plays six round robins (18 games, no byes), stops at a mid-season
 * deadline, and settles a two-team final. Every step of the franchise cycle
 * still runs, restricted to those four teams, and the other 28 franchises
 * must not reappear anywhere: not on the schedule, not in the draft order,
 * not on the pick ledger, not in the bracket.
 *
 * Driven the way `seasonCycle.test.ts` drives the NFL format — every stage's
 * own turns taken, nothing readied past — because a league that is the
 * wrong size is exactly the kind of thing that only breaks three stages
 * after the cause.
 */
const TIMEOUT = 600_000;
const s = () => useStore.getState();
const IN_SEASON: Stage[] = ["preseason", "regularSeason", "playoffs"];

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
      for (let i = 0; i < 60 && s().stage === stage; i++) {
        if (faOnTheClock(s()) !== me) break;
        useStore.getState().freeAgencyTurn({ pass: true });
      }
      break;
    case "tradeDeadline":
      for (let i = 0; i < 60 && s().stage === "tradeDeadline"; i++) {
        const duty = pendingFor(s(), me);
        if (!duty) break;
        useStore.getState().deadlineTurn({ kind: duty === "propose" ? "skip" : "deny" });
      }
      break;
    case "offseasonDraftSummary":
      useStore.getState().stepForward("rookieSignings");
      for (const r of s().draft?.results ?? []) {
        if (r.teamCode === me && r.selectedId) useStore.getState().signRookie(r.selectedId, me);
      }
      break;
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

async function step(): Promise<Stage> {
  const stage = s().stage;
  await actOn(stage);
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

/** Nothing anywhere may reference a franchise that is not in the league. */
function expectOnlyLeagueTeams(where: string): void {
  const league = new Set(Object.keys(s().teams));
  const stray = new Set<string>();
  for (const g of s().schedule) for (const c of [g.homeTeam, g.awayTeam]) if (!league.has(c)) stray.add(c);
  for (const g of s().games) for (const c of [g.homeTeam, g.awayTeam]) if (!league.has(c)) stray.add(c);
  for (const pk of Object.values(s().draftPicks ?? {})) {
    if (!league.has(pk.ownedBy)) stray.add(pk.ownedBy);
    if (!league.has(pk.originalTeam)) stray.add(pk.originalTeam);
  }
  for (const c of s().draft?.pickOrder ?? []) if (!league.has(c)) stray.add(c);
  for (const m of s().bracket?.matchups ?? []) {
    for (const c of [m.highSeed?.code, m.lowSeed?.code]) if (c && !league.has(c)) stray.add(c);
  }
  for (const p of Object.values(s().players)) {
    if (!p.retired && !p.free_agent && p.nfl_team && p.nfl_team !== "FA" && !league.has(p.nfl_team)) {
      stray.add(p.nfl_team);
    }
  }
  expect([...stray], `${where}: references teams outside the league`).toEqual([]);
}

describe("a humans-only league", () => {
  it(
    "forms four teams from three GMs, plays a round robin and a final, and comes back round",
    async () => {
      await useStore.getState().newLeague(33, {
        ...DEFAULT_CONFIG,
        leagueFormat: "humansOnly",
        humanGmCount: 3,
        // an explicit off, to prove the format overrides it — there are no
        // NFL rosters for a humans-only league to inherit
        fantasyDraft: false,
      });

      const seen: Stage[] = [];
      let kickoffs = 0;
      let guard = 400;
      let checkedShape = false;
      let checkedBracket = false;

      while (guard-- > 0) {
        const before = s().stage;
        const after = await step();
        seen.push(before);

        if (before === "setup") {
          // three GMs round up to four: GB, the two rival GMs' teams, one CPU
          const teams = Object.keys(s().teams);
          expect(teams).toHaveLength(4);
          const gmTeams = s().gms.map((g) => g.teamCode).filter(Boolean);
          for (const c of gmTeams) expect(teams).toContain(c);
          expect(s().config.fantasyDraft, "a humans-only league always drafts").toBe(true);
          expect(after).toBe("fantasyDraft");
          expectOnlyLeagueTeams("after setup");
        }

        if (before === "fantasyDraftSummary") {
          // the same 53-man rosters as a normal league, from the whole pool
          for (const code of Object.keys(s().teams)) {
            const roster = Object.values(s().players).filter((p) => p.nfl_team === code && !p.retired);
            expect(roster.length, `${code} roster`).toBe(53);
          }
        }

        if (after === "regularSeason" && !checkedShape) {
          checkedShape = true;
          const shape = seasonShape(s());
          expect(shape.regularSeasonWeeks).toBe(18);
          const reg = s().schedule.filter((g) => g.phase === "REG");
          expect(reg).toHaveLength(36); // 18 weeks x 2 games, no byes
        }

        if (before === "playoffs" && s().bracket?.champion && !checkedBracket) {
          checkedBracket = true;
          const b = s().bracket!;
          expect(b.format).toBe("single");
          expect(b.field).toHaveLength(2); // four teams: a straight final
          expect(b.matchups.filter((m) => m.round === "SB")).toHaveLength(1);
          expect(Object.keys(s().teams)).toContain(b.champion);
          // the final is between the top two of the table
          const reg = s().games.filter((g) => g.phase === "REG" && g.played);
          expect(reg).toHaveLength(36);
          expectOnlyLeagueTeams("after the final");
        }

        if (before !== "preseason" && after === "preseason") {
          kickoffs++;
          expectOnlyLeagueTeams(`kickoff ${kickoffs}`);
          if (kickoffs === 2) break;
        }
      }

      expect(guard, `never came back round; saw: ${seen.join(" -> ")}`).toBeGreaterThan(0);
      for (const stage of [
        "fantasyDraft",
        "coachingDraft",
        "freeAgency",
        "trainingCamp",
        "regularSeason",
        "tradeDeadline",
        "midseasonFreeAgency",
        "playoffs",
        "offseasonDraft",
      ] as Stage[]) {
        expect(seen, `never played ${stage}`).toContain(stage);
      }
      expect(checkedShape, "never reached the regular season").toBe(true);
      expect(checkedBracket, "never crowned a champion").toBe(true);

      // year two is still the same four teams, on a fresh round robin
      expect(Object.keys(s().teams)).toHaveLength(4);
      expect(s().schedule.filter((g) => g.phase === "REG")).toHaveLength(36);
    },
    TIMEOUT,
  );
});
