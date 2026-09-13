import { describe, expect, it } from "vitest";

import { useStore } from "./store.ts";

/**
 * A trade involving a 90+ overall player goes to a league vote. That vote used
 * to be the *only* gate: the proposal was created already `pending`, so
 * `resolveTrade` (which is what asks the AI partner) never ran, and the other
 * GMs auto-voted "for" whenever the deal wasn't bad *for the proposer*. Net
 * effect: a deal the partner rated 2% acceptable passed 3-0 and a star changed
 * hands against the AI team's will.
 *
 * Two rules now hold: an unwilling AI partner refuses regardless of any vote,
 * and the league blocks a lopsided deal instead of rubber-stamping it.
 */
function fixture() {
  const s = useStore.getState();
  const codes = Object.keys(s.teams);
  const mine = codes[0]!;
  const theirs = codes[1]!;
  useStore.setState((d) => {
    d.gms[0]!.teamCode = mine;
    // the other GMs are AI-run for these cases, so `theirs` has no human owner
    for (let i = 1; i < d.gms.length; i++) d.gms[i]!.isHuman = false;
    d.trades = [];
  });
  return { mine, theirs };
}

function rosterOf(code: string) {
  return Object.values(useStore.getState().players)
    .filter((p) => p.nfl_team === code && !p.retired)
    .sort((a, b) => b.overall - a.overall);
}

describe("trade consent", () => {
  it("an AI partner refuses a lopsided deal even though it needs a league vote", () => {
    const { mine, theirs } = fixture();
    const star = rosterOf(theirs).find((p) => p.overall >= 90);
    if (!star) return; // no blockbuster available in this fixture
    const scrub = rosterOf(mine).slice(-1)[0]!;

    // ask for their star, offer a bench player
    const id = useStore.getState().proposeTrade(theirs, [scrub.id], [star.id]);
    useStore.getState().resolveTrade(id);

    const t = useStore.getState().trades.find((x) => x.id === id)!;
    expect(t.aiAcceptLikelihood).toBeLessThan(0.5);
    expect(t.status).toBe("rejected");
    // and the star is still theirs
    expect(useStore.getState().players[star.id]!.nfl_team).toBe(theirs);
  });

  it("a deal the partner accepts is held pending the league vote, not applied yet", () => {
    const { mine, theirs } = fixture();
    const theirScrub = rosterOf(theirs).slice(-1)[0]!;
    const myStar = rosterOf(mine).find((p) => p.overall >= 90);
    if (!myStar) return;

    // overpay them: hand over a star for a bench player
    const id = useStore.getState().proposeTrade(theirs, [myStar.id], [theirScrub.id]);
    useStore.getState().resolveTrade(id);

    const t = useStore.getState().trades.find((x) => x.id === id)!;
    expect(t.aiAcceptLikelihood).toBeGreaterThanOrEqual(0.5);
    expect(t.status).toBe("pending");
    expect(t.vote).toBeDefined();
    // nothing has moved until the league votes
    expect(useStore.getState().players[myStar.id]!.nfl_team).toBe(mine);
  });

  it("the league blocks a lopsided deal rather than waving it through", () => {
    const { mine, theirs } = fixture();
    // put a second human GM back so there is someone to auto-vote
    useStore.setState((d) => {
      d.gms[1]!.isHuman = true;
    });
    const theirScrub = rosterOf(theirs).slice(-1)[0]!;
    const myStar = rosterOf(mine).find((p) => p.overall >= 90);
    if (!myStar) return;

    const id = useStore.getState().proposeTrade(theirs, [myStar.id], [theirScrub.id]);
    useStore.getState().resolveTrade(id);
    const before = useStore.getState().trades.find((x) => x.id === id)!;
    if (before.status !== "pending") return;

    useStore.getState().castTradeVote(id, useStore.getState().viewerGmId, "for");
    const t = useStore.getState().trades.find((x) => x.id === id)!;
    // giving a star away for a bench player is exactly what the vote is for
    expect(t.aiAcceptLikelihood).toBeGreaterThanOrEqual(0.85);
    expect(t.vote!.outcome).toBe("blocked");
    expect(t.status).toBe("blocked");
    expect(useStore.getState().players[myStar.id]!.nfl_team).toBe(mine);
  });
});
