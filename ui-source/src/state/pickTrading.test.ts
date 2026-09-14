import { describe, expect, it } from "vitest";

import type { LeagueState } from "@/domain";

import {
  DRAFT_ROUNDS,
  ensureDraftPicks,
  forgetSpentPicks,
  futureDiscount,
  pickKey,
  pickLabel,
  pickOrderFor,
  picksOwnedBy,
} from "./draftPicks.ts";
import { MockSimulationService } from "@/sim/MockSimulationService";

import { createLeague, DEFAULT_CONFIG } from "./seed.ts";
import { useStore } from "./store.ts";

/**
 * `DraftPickAsset` and `TradeAsset.kind === "pick"` were in the domain from
 * the start and nothing ever produced one: the rookie draft gave every slot to
 * the team that earned it and the trade screen could only move players. The
 * rebuild that sells a veteran for a first, the contender that spends three
 * years of capital on one player — none of it was expressible.
 */
function fixture(): LeagueState {
  const s = createLeague(29, DEFAULT_CONFIG);
  ensureDraftPicks(s, s.season);
  return s;
}

describe("the pick ledger", () => {
  it("gives every team its own seven picks, for three drafts", () => {
    const s = fixture();
    const codes = Object.keys(s.teams);
    expect(Object.keys(s.draftPicks)).toHaveLength(codes.length * DRAFT_ROUNDS * 3);
    expect(picksOwnedBy(s, codes[0]!)).toHaveLength(DRAFT_ROUNDS * 3);
  });

  it("names a traded pick after where it came from", () => {
    const s = fixture();
    const [a, b] = Object.keys(s.teams);
    const pick = s.draftPicks[pickKey(s.season, 1, b!)]!;
    expect(pickLabel(pick)).toBe(`${s.season} Round 1`);
    pick.ownedBy = a!;
    expect(pickLabel(pick)).toBe(`${s.season} Round 1 (via ${b})`);
  });

  it("discounts a pick for being years away", () => {
    const s = fixture();
    const now = s.draftPicks[pickKey(s.season, 1, Object.keys(s.teams)[0]!)]!;
    const later = s.draftPicks[pickKey(s.season + 2, 1, Object.keys(s.teams)[0]!)]!;
    expect(futureDiscount(now, s.season)).toBe(1);
    expect(futureDiscount(later, s.season)).toBeLessThan(1);
  });

  it("forgets a draft once it has been held", () => {
    const s = fixture();
    forgetSpentPicks(s, s.season + 1);
    expect(Object.values(s.draftPicks).some((p) => p.year === s.season)).toBe(false);
  });

  it("hands the slot to whoever owns the pick, not whoever earned it", () => {
    const s = fixture();
    const [a, b] = Object.keys(s.teams);
    s.draftPicks[pickKey(s.season, 1, b!)]!.ownedBy = a!;
    const order = pickOrderFor(s, s.season, [b!, a!], 1);
    expect(order).toEqual([a, a]); // b's own first-rounder now belongs to a
  });
});

describe("trading a pick", () => {
  it("moves it, and the draft order follows", () => {
    useStore.setState(() => createLeague(31, DEFAULT_CONFIG) as never);
    useStore.setState((d) => {
      ensureDraftPicks(d, d.season);
      d.gms[0]!.teamCode = Object.keys(d.teams)[0]!;
      for (let i = 1; i < d.gms.length; i++) d.gms[i]!.isHuman = false;
      d.trades = [];
    });
    const s = useStore.getState();
    const mine = s.gms[0]!.teamCode;
    const theirs = Object.keys(s.teams).find((c) => c !== mine)!;
    const theirFirst = pickKey(s.season, 1, theirs);

    // give up a good player for their first-round pick
    const star = Object.values(s.players)
      .filter((p) => p.nfl_team === mine && !p.retired)
      .sort((a, b) => b.overall - a.overall)[0]!;
    const id = s.proposeTrade(theirs, [star.id], [`pick:${theirFirst}`]);
    useStore.getState().resolveTrade(id);

    const after = useStore.getState();
    const t = after.trades.find((x) => x.id === id)!;
    if (t.status !== "accepted") return; // the AI is allowed to say no
    expect(after.draftPicks[theirFirst]!.ownedBy).toBe(mine);
    expect(picksOwnedBy(after, mine).some((p) => p.originalTeam === theirs)).toBe(true);
  });

  it("prices a first-rounder as real value, not as nothing", () => {
    useStore.setState(() => createLeague(33, DEFAULT_CONFIG) as never);
    useStore.setState((d) => {
      ensureDraftPicks(d, d.season);
    });
    const s = useStore.getState();
    const [a, b] = Object.keys(s.teams);
    const first = s.draftPicks[pickKey(s.season, 1, b!)]!;
    const seventh = s.draftPicks[pickKey(s.season, 7, b!)]!;

    const sim = new MockSimulationService();
    const forFirst = sim.evaluateTrade(s, a!, b!, [], [{ kind: "pick", pick: first }]);
    const forSeventh = sim.evaluateTrade(s, a!, b!, [], [{ kind: "pick", pick: seventh }]);
    expect(forFirst.valueDelta).toBeGreaterThan(forSeventh.valueDelta);
    expect(forFirst.valueDelta).toBeGreaterThan(10);
  });
});
