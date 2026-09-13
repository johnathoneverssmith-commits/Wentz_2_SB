import { describe, expect, it } from "vitest";

import type { LeagueState, Player, Stage } from "@/domain";
import { OFFSEASON_ROSTER_SIZE, ROSTER_SIZE } from "@/sim/roster-template.ts";

import { DEFAULT_CONFIG } from "./seed.ts";
import { useStore } from "./store.ts";

/**
 * Drives the store through a whole franchise year the way a player does —
 * every stage, in order, taking each stage's required action — and checks the
 * league is still legal and still moving at every step.
 *
 * This is the guard for the class of bug that only shows up several stages
 * downstream of its cause: a roster that quietly grows past 53 across an
 * offseason, a team that ends the draft over the cap and can then sign nobody,
 * a stage whose gate never opens. Unit tests cover each of those pieces; only
 * playing the year catches them interacting.
 */
const TIMEOUT = 180_000;

function state(): LeagueState {
  return useStore.getState();
}

function rosterOf(s: LeagueState, code: string): Player[] {
  return Object.values(s.players).filter((p) => p.nfl_team === code && !p.retired);
}

/** Everything that must be true of a league about to take the field. */
function expectSeasonLegal(s: LeagueState): void {
  for (const code of Object.keys(s.teams)) {
    const roster = rosterOf(s, code);
    expect(roster.length, `${code} roster size`).toBe(ROSTER_SIZE);

    const used = roster.reduce((n, p) => n + (p.contract?.cap_hit_by_year[0] ?? 0), 0);
    expect(Math.round(used * 10) / 10, `${code} cap`).toBeLessThanOrEqual(s.teams[code]!.cap.total);

    // a legal lineup needs someone at every position, not just 53 bodies
    for (const pos of ["QB", "K", "P", "C", "OT"] as const) {
      expect(roster.some((p) => p.position === pos), `${code} has a ${pos}`).toBe(true);
    }
  }
}

/** Does whatever this stage needs before its readiness gate can open. */
async function actOn(stage: Stage): Promise<void> {
  const s = useStore.getState();
  switch (stage) {
    case "setup":
      for (const g of s.gms) if (g.isHuman && !g.teamCode) s.pickTeam(g.id, unclaimedTeam());
      break;
    case "fantasyDraft":
      s.startDraft("fantasy");
      useStore.getState().autopickRemaining();
      break;
    case "offseasonDraft":
      s.startDraft("rookie");
      useStore.getState().autopickRemaining();
      break;
    case "offseasonSignings": {
      const mine = viewerTeam();
      for (const r of useStore.getState().draft?.results ?? []) {
        if (r.teamCode === mine && r.selectedId) useStore.getState().signRookie(r.selectedId, mine);
      }
      break;
    }
    case "coachingHiring":
    case "offseasonFreeAgency": {
      // run the live window out to its last day, the way the clock does
      const subject = stage === "coachingHiring" ? "coaches" : "players";
      useStore.getState().startBidding(subject);
      for (let i = 0; i < 6; i++) useStore.getState().advanceBiddingDay(subject);
      break;
    }
    case "preseason":
    case "regularSeason":
    case "playoffs":
      await useStore.getState().simulateGameDay();
      break;
    default:
      break;
  }
}

function unclaimedTeam(): string {
  const s = useStore.getState();
  const taken = new Set(s.gms.map((g) => g.teamCode).filter(Boolean));
  return Object.keys(s.teams).find((c) => !taken.has(c))!;
}

function viewerTeam(): string {
  const s = useStore.getState();
  return s.gms.find((g) => g.id === s.viewerGmId)?.teamCode ?? "";
}

/** One stage's worth of play. Returns the stage we ended up in. */
async function playStage(): Promise<Stage> {
  const stage = state().stage;
  await actOn(stage);

  const s = useStore.getState();
  s.autoReadyNonViewers();
  s.setReady(s.viewerGmId, true);

  // in-season stages step through Game Day, everything else through the gate
  if (stage === "preseason" || stage === "regularSeason" || stage === "playoffs") {
    await useStore.getState().finishGameDay();
  } else {
    const moved = await useStore.getState().tryAdvance();
    expect(moved.moved, `stage ${stage} refused to advance`).toBe(true);
  }
  return state().stage;
}

describe("a full franchise year", () => {
  it(
    "plays setup through the next season's kickoff without stalling or going illegal",
    async () => {
      await useStore.getState().newLeague(11, { ...DEFAULT_CONFIG, humanGmCount: 1 });

      const seen: Stage[] = [];
      let guard = 120;
      let checkedKickoff = false;

      while (guard-- > 0) {
        const before = state().stage;
        const after = await playStage();
        seen.push(before);

        // entering the preseason is the hard stop: rosters must be legal here
        if (before === "coachingHiring" && after === "preseason") {
          expectSeasonLegal(state());
          checkedKickoff = true;
        }
        // free agency has to open on a legal roster with money to spend —
        // walking in seven players over and tens of millions past the cap
        // means the board refuses every signing
        if (before === "offseasonSignings" && after === "offseasonFreeAgency") {
          const s = state();
          for (const code of Object.keys(s.teams)) {
            const roster = rosterOf(s, code);
            expect(roster.length, `${code} roster into free agency`).toBeLessThanOrEqual(
              OFFSEASON_ROSTER_SIZE,
            );
            const used = roster.reduce((n, p) => n + (p.contract?.cap_hit_by_year[0] ?? 0), 0);
            expect(Math.round(used * 10) / 10, `${code} cap into free agency`).toBeLessThanOrEqual(
              s.teams[code]!.cap.total,
            );
          }
        }
        // and again a year later, after aging, retirements, the draft and FA
        if (before === "offseasonDepthChart" && after === "preseason") {
          expectSeasonLegal(state());
          expect(state().season, "season rolled over").toBe(2027);
          return;
        }
        expect(checkedKickoff || before !== "regularSeason", "reached the season un-checked").toBe(
          true,
        );
      }
      throw new Error(`never completed a year; stages seen: ${seen.join(" -> ")}`);
    },
    TIMEOUT,
  );
});

/**
 * League Setup offers a league with no fantasy draft, which keeps every team's
 * real roster. Those rosters are lopsided by NFL standards next to
 * `ROSTER_TEMPLATE`, and that shape found a bug the fantasy path never did:
 * trimming only the total left the surplus in place, the fill topped up the
 * short positions, and three teams kicked off at 56.
 */
describe("a league with no fantasy draft", () => {
  it("still reaches the preseason with a legal roster everywhere", async () => {
    await useStore.getState().newLeague(55, { ...DEFAULT_CONFIG, humanGmCount: 1, fantasyDraft: false });

    let guard = 12;
    while (state().stage !== "preseason" && guard-- > 0) await playStage();

    expect(state().stage).toBe("preseason");
    expectSeasonLegal(state());
  }, TIMEOUT);
});
