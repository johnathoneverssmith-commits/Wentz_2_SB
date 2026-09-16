import { describe, expect, it } from "vitest";

import type { LeagueState, Player } from "@/domain";
import { createLeague, DEFAULT_CONFIG, fillRosterGaps } from "@/state/seed.ts";
import {
  bestOfferFor,
  expectedSalary,
  fitFor,
  offerEligible,
  PRIMARY_VALUES,
  primaryValueOf,
  scoreOffer,
  type Offer,
} from "@/state/freeAgencyValues.ts";

/**
 * Change 4 — what a free agent is weighing.
 *
 * Money is the floor: an offer under what a player expects is not eligible
 * whatever else it has. The primary value decides between offers that clear
 * it, and the seven values are deliberately different kinds of thing rather
 * than seven flavours of money — a market where everyone optimises the same
 * quantity is an auction with extra steps.
 */
function league(): LeagueState {
  const s = createLeague(3690, { ...DEFAULT_CONFIG, humanGmCount: 2 });
  fillRosterGaps(s);
  s.gms[0]!.teamCode = "KC";
  s.gms[0]!.isHuman = true;
  s.gms[1]!.teamCode = "BUF";
  s.gms[1]!.isHuman = true;
  return s;
}

const anyPlayer = (s: LeagueState): Player =>
  Object.values(s.players).find((p) => !p.retired)!;

const offer = (teamCode: string, salary: number, extra: Partial<Offer> = {}): Offer => ({
  teamCode,
  salary,
  years: 3,
  round: 1,
  sequence: 0,
  ...extra,
});

describe("primary values", () => {
  it("gives every player exactly one, from the published list", () => {
    const s = league();
    for (const p of Object.values(s.players).slice(0, 300)) {
      expect(PRIMARY_VALUES).toContain(primaryValueOf(p));
    }
  }, 60_000);

  it("is fixed to the player, not to the league", () => {
    const a = league();
    const b = league();
    const p = anyPlayer(a);
    // same person, a different league object: same motive
    expect(primaryValueOf(p)).toBe(primaryValueOf(b.players[p.id]!));
  }, 60_000);

  it("spreads across the league rather than collapsing onto one", () => {
    const s = league();
    const seen = new Set(Object.values(s.players).slice(0, 400).map(primaryValueOf));
    // not a market where everybody wants the same thing
    expect(seen.size).toBeGreaterThan(3);
  }, 60_000);
});

describe("what a player expects to be paid", () => {
  it("asks more of a better player", () => {
    const s = league();
    const players = Object.values(s.players).filter((p) => !p.retired && p.age === 26);
    const good = players.reduce((a, b) => (a.overall > b.overall ? a : b));
    const weak = players.reduce((a, b) => (a.overall < b.overall ? a : b));
    expect(expectedSalary(good)).toBeGreaterThan(expectedSalary(weak));
  }, 60_000);

  it("discounts an older player at the same rating", () => {
    const s = league();
    const p = anyPlayer(s);
    const young = { ...p, age: 25 };
    const old = { ...p, age: 33 };
    expect(expectedSalary(old)).toBeLessThan(expectedSalary(young));
  }, 60_000);
});

describe("eligibility", () => {
  it("refuses anything under the asking price, however good the fit", () => {
    const s = league();
    const p = anyPlayer(s);
    const ask = expectedSalary(p);
    expect(offerEligible(p, offer("KC", ask - 0.1))).toBe(false);
    expect(offerEligible(p, offer("KC", ask))).toBe(true);
  }, 60_000);

  it("signs nobody when every offer is short", () => {
    const s = league();
    const p = anyPlayer(s);
    const ask = expectedSalary(p);
    const best = bestOfferFor(s, p, [offer("KC", ask - 1), offer("BUF", ask - 2)]);
    expect(best).toBeNull();
  }, 60_000);
});

describe("choosing between offers", () => {
  it("prefers more money, all else equal", () => {
    const s = league();
    const p = anyPlayer(s);
    const ask = expectedSalary(p);
    const best = bestOfferFor(s, p, [offer("KC", ask), offer("KC", ask * 1.5)]);
    expect(best!.salary).toBeCloseTo(ask * 1.5, 5);
  }, 60_000);

  it("lets fit decide between offers that both clear the price", () => {
    const s = league();
    // find a player whose motive is not salary, so fit is the live term
    const p = Object.values(s.players).find(
      (x) => !x.retired && primaryValueOf(x) !== "salary",
    )!;
    const ask = expectedSalary(p);
    const kc = scoreOffer(s, p, offer("KC", ask));
    const buf = scoreOffer(s, p, offer("BUF", ask));
    // identical money, so any difference is fit — and fit is bounded, so the
    // scores stay comparable rather than one dominating
    expect(Math.abs(kc - buf)).toBeLessThan(0.4);
  }, 60_000);

  it("breaks a dead heat on salary, then on who offered first", () => {
    const s = league();
    const p = anyPlayer(s);
    const ask = expectedSalary(p);
    const early = offer("KC", ask, { round: 1, sequence: 1 });
    const late = offer("KC", ask, { round: 2, sequence: 0 });
    expect(bestOfferFor(s, p, [late, early])).toBe(early);
  }, 60_000);

  it("keeps every fit between nothing and everything", () => {
    const s = league();
    for (const p of Object.values(s.players).slice(0, 120)) {
      for (const team of ["KC", "BUF", "MIA"]) {
        const f = fitFor(s, p, team);
        expect(f, `${p.name} @ ${team}`).toBeGreaterThanOrEqual(0);
        expect(f, `${p.name} @ ${team}`).toBeLessThanOrEqual(1);
      }
    }
  }, 60_000);
});
