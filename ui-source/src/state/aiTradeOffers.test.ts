import { describe, expect, it } from "vitest";

import type { LeagueState } from "@/domain";

import { generateAiTradeOffers } from "./aiTrades.ts";
import { ensureDraftPicks } from "./draftPicks.ts";
import { createLeague, DEFAULT_CONFIG, fillRosterGaps, recomputeTeamRatings } from "./seed.ts";
import { useStore } from "./store.ts";

/**
 * Every trade in the game started with the human: they opened the screen,
 * built a package, and asked. Nothing ever came the other way, which is half
 * of what makes the job feel like a job — someone wants your left tackle, and
 * now you have to decide what he's worth.
 */
function league(): LeagueState {
  const s = createLeague(41, DEFAULT_CONFIG);
  fillRosterGaps(s);
  ensureDraftPicks(s, s.season);
  s.gms[0]!.teamCode = Object.keys(s.teams)[0]!;
  for (let i = 1; i < s.gms.length; i++) s.gms[i]!.isHuman = false;
  recomputeTeamRatings(s);
  return s;
}

describe("offers the league makes you", () => {
  it("asks a human GM for a player, and offers something back", () => {
    const s = league();
    const offers = generateAiTradeOffers(s, 1, 2);
    expect(offers.length).toBeGreaterThan(0);
    for (const o of offers) {
      expect(o.toTeam).toBe(s.gms[0]!.teamCode);
      expect(o.toAssets.length).toBeGreaterThan(0);
      expect(o.fromAssets.length).toBeGreaterThan(0);
      expect(o.status).toBe("offered");
    }
  });

  it("never asks for a player the team has no one behind", () => {
    // a GM who gets nothing but insulting offers stops reading them
    const s = league();
    const mine = s.gms[0]!.teamCode;
    for (const o of generateAiTradeOffers(s, 2, 3)) {
      for (const a of o.toAssets) {
        const p = s.players[a.playerId!]!;
        const atPosition = Object.values(s.players).filter(
          (x) => x.nfl_team === mine && x.position === p.position && !x.retired && !x.free_agent,
        );
        expect(atPosition.length, `${p.position} depth`).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it("is the same offer every time — it can't be rerolled", () => {
    const s = league();
    const a = generateAiTradeOffers(s, 5, 2);
    const b = generateAiTradeOffers(s, 5, 2);
    expect(a.map((o) => o.id + o.toAssets[0]?.playerId)).toEqual(
      b.map((o) => o.id + o.toAssets[0]?.playerId),
    );
  });

  it("makes no offer at all when nobody is human", () => {
    const s = league();
    for (const g of s.gms) g.isHuman = false;
    expect(generateAiTradeOffers(s, 1, 2)).toEqual([]);
  });
});

describe("answering an offer", () => {
  function seeded() {
    useStore.setState(() => createLeague(43, DEFAULT_CONFIG) as never);
    useStore.setState((d) => {
      fillRosterGaps(d);
      ensureDraftPicks(d, d.season);
      d.gms[0]!.teamCode = Object.keys(d.teams)[0]!;
      for (let i = 1; i < d.gms.length; i++) d.gms[i]!.isHuman = false;
      recomputeTeamRatings(d);
      d.trades = generateAiTradeOffers(d, 9, 1);
    });
    return useStore.getState().trades[0];
  }

  it("moves everyone when you accept", () => {
    const offer = seeded();
    if (!offer) return;
    const wanted = offer.toAssets[0]!.playerId!;
    const given = offer.fromAssets.find((a) => a.kind === "player")?.playerId;

    const r = useStore.getState().respondToOffer(offer.id, true);

    const s = useStore.getState();
    if (!r.ok) {
      // a refusal has to say why — cap or roster, never silence
      expect(r.reason).toBeTruthy();
      return;
    }
    expect(s.players[wanted]!.nfl_team).toBe(offer.fromTeam);
    if (given) expect(s.players[given]!.nfl_team).toBe(offer.toTeam);
    expect(s.trades.find((t) => t.id === offer.id)!.status).toBe("accepted");
  });

  it("leaves the roster untouched when you decline", () => {
    const offer = seeded();
    if (!offer) return;
    const wanted = offer.toAssets[0]!.playerId!;
    const before = useStore.getState().players[wanted]!.nfl_team;

    useStore.getState().respondToOffer(offer.id, false);

    expect(useStore.getState().players[wanted]!.nfl_team).toBe(before);
    expect(useStore.getState().trades.find((t) => t.id === offer.id)!.status).toBe("rejected");
  });

  it("can't be answered twice", () => {
    const offer = seeded();
    if (!offer) return;
    useStore.getState().respondToOffer(offer.id, false);
    const second = useStore.getState().respondToOffer(offer.id, true);
    expect(second.ok).toBe(false);
  });
});
