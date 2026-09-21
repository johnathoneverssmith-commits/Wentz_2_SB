import { describe, expect, it } from "vitest";

import { createLeague, DEFAULT_CONFIG, fillRosterGaps } from "./seed.ts";
import { resolveBiddingDay } from "./rules.ts";
import type { ContractOffer, LeagueState } from "@/domain";

/**
 * Deployed multiplayer playtest finding 6 (September 2026): "Josh Allen, the
 * best player in the league, accepted the first and smallest offer submitted
 * by the testing user." `resolveBiddingDay` only ever called `aiOfferForPlayer`
 * as a fallback for a player with *no* bids at all — once a human placed any
 * offer, however small, no AI team was ever asked whether it wanted the
 * player too, so the human's own bid simply won every time.
 */
function fixtureWithOneFreeAgent(seed: number): { s: LeagueState; starId: string; human: string } {
  const s = createLeague(seed, DEFAULT_CONFIG);
  fillRosterGaps(s);
  // the offseason roster ceiling (not the 53-man in-season one) — every
  // roster is already full at ROSTER_SIZE after fillRosterGaps, so signing
  // anyone at all needs the wider offseason limit or nothing ever resolves
  s.stage = "offseasonFreeAgency";
  // shrink the pool to exactly one name, so resolveBiddingDay's power-law
  // draw (over the whole market) always lands on the player this test cares
  // about, instead of fighting the draw for a specific one
  const star = Object.values(s.players)
    .filter((p) => !p.retired)
    .sort((a, b) => b.overall - a.overall)[0]!;
  for (const p of Object.values(s.players)) p.free_agent = p.id === star.id;
  const human = Object.keys(s.teams)[0]!;
  s.gms[0]!.teamCode = human;
  s.gms[0]!.isHuman = true;
  // `aiControlledTeams` reads `team.controlledBy`, a separate field from
  // `gm.isHuman` that the store's `pickTeam` action normally keeps in sync —
  // set directly here since this fixture builds state without going through it.
  s.teams[human]!.controlledBy = { kind: "human", gmId: s.gms[0]!.id };
  return { s, starId: star.id, human };
}

describe("resolveBiddingDay — AI competition on a contested player", () => {
  it("doesn't always let a human's lowball offer win a star uncontested", () => {
    let aiWonAtLeastOnce = false;
    const lowball: ContractOffer = {
      teamCode: "",
      baseSalary: 0.6,
      years: 1,
      signingBonus: 0,
      guaranteed: 0,
    };
    for (let seed = 1; seed <= 25 && !aiWonAtLeastOnce; seed++) {
      const { s, starId, human } = fixtureWithOneFreeAgent(seed);
      s.freeAgency = {
        subject: "players",
        mode: "main",
        day: 1,
        secondsRemaining: 0,
        interstitialVisible: false,
        bids: { [starId]: [{ ...lowball, teamCode: human }] },
        signed: [],
      };
      resolveBiddingDay(s, "players", s.freeAgency);
      const signing = s.freeAgency.signed.find((x) => x.id === starId);
      if (signing && signing.toTeam !== human) aiWonAtLeastOnce = true;
    }
    expect(aiWonAtLeastOnce).toBe(true);
  });
});
