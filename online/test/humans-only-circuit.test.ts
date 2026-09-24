import { describe, expect, it } from "vitest";

import type { LeagueState, Stage } from "@/domain";
import { availableCoaches, coachingOnTheClock, vacantRoles } from "@/state/coachingDraft.ts";
import { onTheClock as faOnTheClock } from "@/state/freeAgencyEvent.ts";
import { seasonShape } from "@/state/leagueFormat.ts";
import { reconciliationIssues } from "@/state/reconciliation.ts";
import { revealedRounds } from "@/state/reveal.ts";
import { bestAvailable } from "@/state/rules.ts";
import { createLeague, DEFAULT_CONFIG } from "@/state/seed.ts";
import { pendingFor } from "@/state/tradeDeadline.ts";
import { bracketRounds } from "@/domain";
import {
  decideCoachingPick,
  decideDeadlineTurn,
  decideDraftPick,
  decideFreeAgencyTurn,
  decideRelease,
  decideReveal,
  decideRevealRound,
  decideRookieOutcome,
  decideStep,
  decideTrainingCamp,
} from "../src/decide.js";
import { readyUpLocal } from "../src/phases.js";

/**
 * A humans-only league with three real GMs, a whole year, over the server.
 *
 * Three people claim teams; the league forms as those three plus one CPU
 * team when setup closes, and from then on every stage is driven the way the
 * screens drive it — each GM taking *their own* picks and turns through the
 * `decide*` actions, each watching the season at their own pace, and the
 * league moving only when all three have said they're done.
 *
 * This is the multi-human half of the humans-only format: the local game is
 * single-human by design, so more than one person exists only here.
 */
const HUMANS = ["GB", "KC", "PIT"];

function newLeague(): LeagueState {
  const s = createLeague(4242, { ...DEFAULT_CONFIG, leagueFormat: "humansOnly", humanGmCount: 3 });
  // online creation clears every seat, then people claim them
  for (const g of s.gms) {
    g.teamCode = "";
    g.isHuman = false;
  }
  HUMANS.forEach((code, i) => {
    const g = s.gms[i]!;
    g.teamCode = code;
    g.isHuman = true;
    s.teams[code]!.controlledBy = { kind: "human", gmId: g.id };
  });
  s.stage = "setup";
  return s;
}

const humans = (s: LeagueState) => s.gms.filter((g) => g.isHuman);
const actor = (s: LeagueState, gmId: string) => {
  const g = s.gms.find((x) => x.id === gmId)!;
  return { leagueId: "t", gmId: g.id, teamCode: g.teamCode, userId: `u-${g.id}` };
};
const actorForTeam = (s: LeagueState, team: string | null | undefined) => {
  const g = humans(s).find((x) => x.teamCode === team);
  return g ? actor(s, g.id) : null;
};

/** Each GM takes whatever this stage asks of them. */
function act(s: LeagueState): void {
  const stage = s.stage;
  switch (stage) {
    case "fantasyDraft":
    case "offseasonDraft":
      for (let i = 0; i < 400 && s.stage === stage; i++) {
        const d = s.draft;
        const a = d ? actorForTeam(s, d.pickOrder[d.currentPickIndex]) : null;
        const pick = a ? bestAvailable(s) : null;
        if (!a || !pick) break;
        decideDraftPick(s, a, pick);
      }
      break;
    case "coachingDraft":
      for (let i = 0; i < 200 && s.stage === stage; i++) {
        const a = actorForTeam(s, coachingOnTheClock(s));
        if (!a) break;
        const open = vacantRoles(s, a.teamCode);
        const c = availableCoaches(s).find((x) => open.includes(x.role));
        if (!c) break;
        decideCoachingPick(s, a, c.id);
      }
      break;
    case "freeAgency":
    case "midseasonFreeAgency":
      for (let i = 0; i < 200 && s.stage === stage; i++) {
        const a = actorForTeam(s, faOnTheClock(s));
        if (!a) break;
        decideFreeAgencyTurn(s, a, { pass: true });
      }
      break;
    case "tradeDeadline":
      for (let i = 0; i < 200 && s.stage === stage; i++) {
        const g = humans(s).find((h) => pendingFor(s, h.teamCode));
        if (!g) break;
        const duty = pendingFor(s, g.teamCode);
        decideDeadlineTurn(s, actor(s, g.id), { kind: duty === "propose" ? "skip" : "deny" });
      }
      break;
    case "trainingCamp":
      for (const g of humans(s)) {
        if (s.trainingCamp?.plans[g.teamCode]?.submitted) continue;
        decideTrainingCamp(s, actor(s, g.id), { offensiveFocus: "QB", defensiveFocus: "DL", submitted: true });
      }
      break;
    case "preseason":
    case "regularSeason": {
      // each GM watches the block on their own; the second one ends at the
      // season's last week, the first at the deadline
      const shape = seasonShape(s);
      const last =
        stage === "preseason"
          ? shape.preseasonWeeks
          : s.games.some((x) => x.phase === "REG" && x.played && x.week > shape.deadlineWeek)
            ? shape.regularSeasonWeeks
            : shape.deadlineWeek;
      for (const g of humans(s)) decideReveal(s, actor(s, g.id), last);
      break;
    }
    case "playoffs":
      for (const g of humans(s)) {
        const rounds = s.bracket ? bracketRounds(s.bracket) : [];
        while (revealedRounds(s, g.id).length < rounds.length) decideRevealRound(s, actor(s, g.id));
      }
      break;
    case "offseasonDraftSummary":
      for (const g of humans(s)) {
        decideStep(s, actor(s, g.id), "rookieSignings");
        for (const r of s.draft?.results ?? []) {
          if (r.teamCode === g.teamCode && r.selectedId && !s.rookieOutcomes[r.selectedId]) {
            decideRookieOutcome(s, actor(s, g.id), r.selectedId, false);
          }
        }
      }
      break;
    default:
      break;
  }
}

/** A human whose roster is illegal cuts his most expensive man until it isn't. */
function reconcile(s: LeagueState): void {
  for (const g of humans(s)) {
    for (let i = 0; i < 20 && reconciliationIssues(s, g.teamCode).length > 0; i++) {
      const dearest = Object.values(s.players)
        .filter((p) => p.nfl_team === g.teamCode && !p.retired && !p.free_agent && p.contract)
        .sort((a, b) => (b.contract!.cap_hit_by_year[0] ?? 0) - (a.contract!.cap_hit_by_year[0] ?? 0))[0];
      if (!dearest) break;
      try {
        decideRelease(s, actor(s, g.id), dearest.id);
      } catch {
        break;
      }
    }
  }
}

function everyoneReady(s: LeagueState): boolean {
  for (const g of humans(s)) s.readiness[g.id] = true;
  return readyUpLocal(s);
}

describe("a humans-only league with three human GMs, online", () => {
  it("forms, drafts, plays a round robin and a final, and turns the season", () => {
    const s = newLeague();
    const seen: Stage[] = [];
    let kickoffs = 0;
    let crowned: string | null = null;

    for (let guard = 0; guard < 600; guard++) {
      const before = s.stage;
      act(s);
      if (s.stage === before) {
        reconcile(s);
        everyoneReady(s);
      }
      if (s.stage === before && guard > 0 && seen.at(-1) === before && seen.at(-2) === before && seen.at(-3) === before) {
        throw new Error(`stuck at ${before}; saw ${seen.slice(-12).join(" -> ")}`);
      }
      seen.push(before);

      if (before === "setup") {
        expect(Object.keys(s.teams).sort(), "the league formed").toHaveLength(4);
        for (const c of HUMANS) expect(Object.keys(s.teams)).toContain(c);
      }
      if (before === "playoffs" && s.bracket?.champion && !crowned) {
        crowned = s.bracket.champion;
        expect(s.bracket.format).toBe("single");
        expect(s.games.filter((g) => g.phase === "REG" && g.played)).toHaveLength(36);
      }
      if (before !== "preseason" && s.stage === "preseason" && ++kickoffs === 2) break;
    }

    expect(crowned, `never crowned a champion; saw ${seen.slice(-15).join(" -> ")}`).not.toBeNull();
    expect(kickoffs, "never reached a second season").toBe(2);
    // year two: the same four teams, a fresh round robin
    expect(Object.keys(s.teams)).toHaveLength(4);
    expect(s.schedule.filter((g) => g.phase === "REG")).toHaveLength(36);
    for (const stage of ["fantasyDraft", "coachingDraft", "freeAgency", "tradeDeadline", "playoffs", "offseasonDraft"] as Stage[]) {
      expect(seen, `never played ${stage}`).toContain(stage);
    }
  }, 900_000);
});
