import { beforeEach, describe, expect, it } from "vitest";

import type { BracketMatchup, PlayoffRound } from "@/domain";
import { useStore } from "./store.ts";

/**
 * The rookie draft's order against the NFL's rules. The expected orders are
 * written out by hand from a scripted season, not computed by the rule under
 * test: teams are named by their index into `T`, and team `T[i]` went `i`-`31-i`
 * (so a higher index is a better record), which makes every expectation
 * readable as "worst record first".
 */
let T: string[] = [];

function game(home: string, away: string): never {
  return { phase: "REG", homeTeam: home, awayTeam: away } as never;
}

function setSeason(opts: { bracket?: boolean } = { bracket: true }): void {
  useStore.setState((s) => {
    T = Object.keys(s.teams).sort();
    T.forEach((c, i) => {
      const t = s.teams[c]!;
      t.wins = i;
      t.losses = 31 - i;
      t.ties = 0;
      t.pointsFor = 300 + i;
      t.pointsAgainst = 300;
    });
    s.games = [];
    s.draft = null;
    s.draftPicks = {};
    s.bracket = null;
    if (!opts.bracket) return;
    const code = (i: number) => T[i]!;
    const afc = [27, 25, 23, 21, 19, 17, 15];
    const nfc = [13, 11, 9, 7, 5, 3, 2];
    const m = (round: PlayoffRound, conference: "AFC" | "NFC" | "SB", hi: [number, number], lo: [number, number], winner: number): BracketMatchup => ({
      round,
      conference,
      highSeed: { code: code(hi[0]), seed: hi[1] },
      lowSeed: { code: code(lo[0]), seed: lo[1] },
      favoredWinProb: 60,
      homeScore: 24,
      awayScore: 17,
      winner: code(winner),
    });
    const seeds = (list: number[], k: number): [number, number] => [list[k - 1]!, k];
    s.bracket = {
      currentRound: "SB",
      seeds: { AFC: afc.map(code), NFC: nfc.map(code) },
      champion: code(13),
      matchups: [
        // AFC: 7 upsets 2, 3 holds, 5 upsets 4; then 1 holds, 5 upsets 3; then 5 upsets 1
        m("WC", "AFC", seeds(afc, 2), seeds(afc, 7), 15),
        m("WC", "AFC", seeds(afc, 3), seeds(afc, 6), 23),
        m("WC", "AFC", seeds(afc, 4), seeds(afc, 5), 19),
        m("DIV", "AFC", seeds(afc, 1), seeds(afc, 7), 27),
        m("DIV", "AFC", seeds(afc, 3), seeds(afc, 5), 19),
        m("CONF", "AFC", seeds(afc, 1), seeds(afc, 5), 19),
        // NFC: chalk in the wild card, 3 upsets 2, then 1 wins
        m("WC", "NFC", seeds(nfc, 2), seeds(nfc, 7), 11),
        m("WC", "NFC", seeds(nfc, 3), seeds(nfc, 6), 9),
        m("WC", "NFC", seeds(nfc, 4), seeds(nfc, 5), 7),
        m("DIV", "NFC", seeds(nfc, 1), seeds(nfc, 4), 13),
        m("DIV", "NFC", seeds(nfc, 2), seeds(nfc, 3), 9),
        m("CONF", "NFC", seeds(nfc, 1), seeds(nfc, 3), 13),
        m("SB", "SB", [19, 5], [13, 1], 13),
      ],
    };
  });
}

function draft(): string[] {
  useStore.setState((s) => {
    s.draft = null;
  });
  useStore.getState().startDraft("rookie");
  return useStore.getState().draft!.pickOrder;
}

const idx = (order: string[]): number[] => order.map((c) => T.indexOf(c));

beforeEach(() => {
  const s = useStore.getState();
  if (!s.gms.find((g) => g.id === s.viewerGmId)?.teamCode) s.pickTeam(s.viewerGmId, "DAL");
});

describe("the rookie draft order, by the NFL's rules", () => {
  it("non-playoff teams first by record, then the playoff teams by the round they went out in", () => {
    setSeason();
    const order = idx(draft());
    expect(order.slice(0, 32)).toEqual([
      // picks 1-18: the teams that missed the playoffs, worst record first
      0, 1, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 29, 30, 31,
      // 19-24: out in the wild card
      2, 3, 5, 17, 21, 25,
      // 25-28: out in the divisional round
      7, 11, 15, 23,
      // 29-30: out in the conference championship
      9, 27,
      // 31: the Super Bowl runner-up, 32: the champion
      19, 13,
    ]);
  });

  it("the champion picks last and the runner-up second to last, in every round", () => {
    setSeason();
    const order = idx(draft());
    for (let round = 0; round < 7; round++) {
      const slice = order.slice(round * 32, round * 32 + 32);
      expect(slice[31]).toBe(13);
      expect(slice[30]).toBe(19);
      expect(new Set(slice).size).toBe(32);
    }
    expect(order).toHaveLength(224);
  });

  it("a playoff team never picks ahead of a team that missed the playoffs", () => {
    setSeason();
    const order = idx(draft());
    const playoff = new Set([2, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23, 25, 27]);
    expect(order.slice(0, 18).some((i) => playoff.has(i))).toBe(false);
    expect(order.slice(18, 32).every((i) => playoff.has(i))).toBe(true);
  });

  it("without a bracket (or a finished one) the order is the record alone", () => {
    setSeason({ bracket: false });
    expect(idx(draft()).slice(0, 32)).toEqual(Array.from({ length: 32 }, (_, i) => i));
    setSeason();
    useStore.setState((s) => {
      s.bracket!.champion = null;
    });
    expect(idx(draft()).slice(0, 32)).toEqual(Array.from({ length: 32 }, (_, i) => i));
  });

  it("teams level on record are split by strength of schedule, the weaker schedule first", () => {
    setSeason({ bracket: false });
    // T[10] and T[11] level on record; T[10] played a strong team, T[11] a weak one
    useStore.setState((s) => {
      s.teams[T[11]!]!.wins = 10;
      s.teams[T[11]!]!.losses = 21;
      s.teams[T[11]!]!.pointsFor = s.teams[T[10]!]!.pointsFor + 50; // net points favour the other order
      s.games = [game(T[10]!, T[30]!), game(T[11]!, T[1]!)];
    });
    const order = idx(draft()).slice(0, 32);
    expect(order.indexOf(11)).toBeLessThan(order.indexOf(10));
  });

  it("a pair level on everything alternates between rounds; a group of three rotates one place", () => {
    setSeason({ bracket: false });
    useStore.setState((s) => {
      for (const i of [4, 5]) {
        s.teams[T[i]!]!.wins = 4;
        s.teams[T[i]!]!.losses = 27;
        s.teams[T[i]!]!.pointsFor = 304;
      }
      for (const i of [20, 21, 22]) {
        s.teams[T[i]!]!.wins = 20;
        s.teams[T[i]!]!.losses = 11;
        s.teams[T[i]!]!.pointsFor = 320;
      }
    });
    const order = idx(draft());
    const round = (r: number) => order.slice((r - 1) * 32, r * 32);
    const slots = (r: number, group: number[]) => group.map((g) => round(r).indexOf(g));
    const pair = (r: number) => round(r).filter((i) => i === 4 || i === 5);
    expect(pair(2)).toEqual([...pair(1)].reverse());
    expect(pair(3)).toEqual(pair(1));
    const trio = (r: number) => round(r).filter((i) => [20, 21, 22].includes(i));
    const first = trio(1);
    expect(trio(2)).toEqual([first[1], first[2], first[0]]);
    expect(trio(3)).toEqual([first[2], first[0], first[1]]);
    // the group keeps the same three slots, only who fills them moves
    expect(slots(1, [20, 21, 22]).sort((a, b) => a - b)).toEqual(slots(2, [20, 21, 22]).sort((a, b) => a - b));
  });

  it("a traded pick is used by its new owner, in the slot the original team earned", () => {
    setSeason();
    useStore.setState((s) => {
      s.draftPicks = {};
    });
    const s0 = useStore.getState();
    // the first pick of round 1 (T[0]'s) goes to T[13], the champion's last pick of round 2 to T[0]
    s0.startDraft("rookie");
    useStore.setState((s) => {
      const year = s.season;
      s.draftPicks![`${year}-1-${T[0]}`] = { year, round: 1, ownedBy: T[13]!, originalTeam: T[0]! };
      s.draftPicks![`${year}-2-${T[13]}`] = { year, round: 2, ownedBy: T[0]!, originalTeam: T[13]! };
    });
    const order = idx(draft());
    expect(order[0]).toBe(13);
    expect(order[32 + 31]).toBe(0);
    expect(order[32]).toBe(0); // T[0]'s own round-2 pick, untouched
  });

  it("an established draft board is not rebuilt", () => {
    setSeason();
    useStore.getState().startDraft("rookie");
    const before = useStore.getState().draft!.pickOrder.slice();
    useStore.setState((s) => {
      s.teams[T[0]!]!.wins = 31; // the season's books change; the board must not
      s.bracket = null;
    });
    useStore.getState().startDraft("rookie");
    expect(useStore.getState().draft!.pickOrder).toEqual(before);
  });
});
