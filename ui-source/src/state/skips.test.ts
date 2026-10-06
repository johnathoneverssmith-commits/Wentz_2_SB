import { describe, expect, it } from "vitest";

import { beginFreeAgencyEvent, onTheClock as faClock, runCpuTurns as faTurns } from "./freeAgencyEvent.ts";
import { setSkip, isSkipping } from "./skips.ts";
import { createLeague, DEFAULT_CONFIG, fillRosterGaps } from "./seed.ts";
import { beginTradeDeadline, onTheClock, pendingFor, runCpuTurns as deadlineTurns } from "./tradeDeadline.ts";
import type { LeagueState } from "@/domain";

function twoHumans(): LeagueState {
  const s = createLeague(61, { ...DEFAULT_CONFIG, humanGmCount: 2, fantasyDraft: false });
  fillRosterGaps(s);
  s.gms[0]!.isHuman = true;
  s.gms[0]!.teamCode = "GB";
  s.gms[1]!.isHuman = true;
  s.gms[1]!.teamCode = "KC";
  return s;
}

describe("skipping a stage", () => {
  it("is one GM's choice and no one else's", () => {
    const s = twoHumans();
    expect(setSkip(s, "GB", "freeAgency", true)).toBe(true);
    expect(isSkipping(s, "GB", "freeAgency")).toBe(true);
    expect(isSkipping(s, "KC", "freeAgency")).toBe(false);
    expect(isSkipping(s, "GB", "tradeDeadline")).toBe(false);
    expect(setSkip(s, "DAL", "freeAgency", true)).toBe(false); // no human runs DAL
  });

  it("passes a skipping GM's free-agency turns and stops at the one who isn't", () => {
    const s = twoHumans();
    s.stage = "freeAgency";
    setSkip(s, "GB", "freeAgency", true);
    beginFreeAgencyEvent(s);
    faTurns(s, new Set(["GB", "KC"]));
    // the market is waiting on KC (who didn't skip), never on GB
    expect(faClock(s)).toBe("KC");
    // and GB never made an offer
    const e = s.freeAgencyEvent!;
    expect(Object.values(e.offers).flat().some((o) => o.teamCode === "GB")).toBe(false);
  });

  it("opens every market and deadline with nobody skipping", () => {
    const s = twoHumans();
    setSkip(s, "GB", "freeAgency", true);
    setSkip(s, "GB", "tradeDeadline", true);
    beginFreeAgencyEvent(s);
    beginTradeDeadline(s);
    expect(s.gms.some((g) => g.skips?.freeAgency || g.skips?.tradeDeadline)).toBe(false);
  });

  it("finishes the whole market when every human skips it", () => {
    const s = twoHumans();
    s.stage = "freeAgency";
    // each market opens with everyone in; skipping is chosen once it is open
    beginFreeAgencyEvent(s);
    setSkip(s, "GB", "freeAgency", true);
    setSkip(s, "KC", "freeAgency", true);
    faTurns(s, new Set(["GB", "KC"]));
    expect(s.freeAgencyEvent!.complete).toBe(true);
  });

  it("passes a skipping GM's own deadline turns but still lets offers reach them", () => {
    const s = twoHumans();
    s.stage = "tradeDeadline";
    beginTradeDeadline(s);
    setSkip(s, "GB", "tradeDeadline", true);
    deadlineTurns(s);
    // the deadline stops only for GB to answer an offer, or for KC's turn — never for GB to propose
    expect(pendingFor(s, "GB")).not.toBe("propose");
    if (!s.tradeDeadline!.done && onTheClock(s) === "GB") {
      throw new Error("the deadline sat on a skipping GM's own turn");
    }
  });
});
