import { describe, expect, it } from "vitest";

import { useStore } from "./store.ts";

/**
 * Draft order used to be `[...humanGMs, ...shuffled AI]`, repeated every
 * round — so in a 3-human league the humans held picks 1-3 of all 20 rounds
 * of the fantasy draft, which is a large standing advantage and isn't what
 * the League Settings copy promises ("Randomized shuffles the pick order").
 */
function orderFor(mode: "fantasy" | "rookie"): string[] {
  // the viewer starts without a team; League Setup won't let anyone reach a
  // draft that way, so give them one before asking for the order
  const s = useStore.getState();
  if (!s.gms.find((g) => g.id === s.viewerGmId)?.teamCode) s.pickTeam(s.viewerGmId, "DAL");
  useStore.getState().startDraft(mode);
  return useStore.getState().draft!.pickOrder;
}

function humanCodes(): string[] {
  const s = useStore.getState();
  return s.gms.filter((g) => g.isHuman && g.teamCode).map((g) => g.teamCode);
}

describe("draft order", () => {
  it("randomized does not park the human GMs at the top of every round", () => {
    useStore.setState((s) => {
      s.config.draftOrder = "randomized";
      s.config.draftType = "linear";
    });
    const humans = new Set(humanCodes());
    const order = orderFor("fantasy");
    const teams = Object.keys(useStore.getState().teams).length;
    const firstRound = order.slice(0, teams);

    expect(firstRound).toHaveLength(teams);
    expect(new Set(firstRound).size).toBe(teams); // every team picks once a round
    // the humans occupying exactly the first N slots is the bug
    const topSlots = firstRound.slice(0, humans.size);
    expect(topSlots.every((c) => humans.has(c))).toBe(false);
  });

  it("in order still gives GM 1 the first pick, as the setting describes", () => {
    useStore.setState((s) => {
      s.config.draftOrder = "inOrder";
      s.config.draftType = "linear";
    });
    const order = orderFor("fantasy");
    expect(order.slice(0, humanCodes().length)).toEqual(humanCodes());
  });

  it("the rookie draft runs worst record first", () => {
    useStore.setState((s) => {
      const codes = Object.keys(s.teams);
      codes.forEach((c, i) => {
        // i = 0 is the worst team, and should therefore pick first
        s.teams[c]!.wins = i;
        s.teams[c]!.losses = codes.length - i;
        s.teams[c]!.ties = 0;
      });
    });
    const order = orderFor("rookie");
    const codes = Object.keys(useStore.getState().teams);
    expect(order[0]).toBe(codes[0]);
    expect(order[codes.length - 1]).toBe(codes[codes.length - 1]);
  });
});
