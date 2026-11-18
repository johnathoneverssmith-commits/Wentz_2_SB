/**
 * Scouting pilot, flag off: the rookie draft must be byte-identical to the draft before scouting existed.
 * The golden hashes were produced on origin/master @ 2f2eeb4 (before the scouting code), over the draft results,
 * teams, players, class and rookie outcomes after the whole draft is signed. If a deliberate change to the draft
 * moves them, regenerate them on a build without scouting enabled and say so in the commit.
 */
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import type { LeagueState } from "@/domain";
import { createLeague, DEFAULT_CONFIG, fillRosterGaps, recomputeTeamRatings } from "@/state/seed.ts";
import { cleanConfigPatch, runAiPicks, signAiDraftPicks, signUnresolvedHumanPicks } from "@/state/rules.ts";
import { onStageEntered } from "../src/phases.js";

const GOLDEN: Record<number, string> = {
  9901: "24fe218e7da3d22818babc5f71ed357bb637c0c1ab594ecb5defa8c9e77db0ab",
  9902: "07a944f58fbf39e007aa7c1604cb1fc9342cd64ba1fb39d36f3a0b2cca38ee9d",
  9903: "44aaf8445d54ac8cbb00f1680aed8a85a158a40a4dd1cc29f56503f00c1c1e27",
};

function draft(seed: number, scouting?: boolean): LeagueState {
  const s = createLeague(seed, { ...DEFAULT_CONFIG, humanGmCount: 1, ...(scouting === undefined ? {} : { scouting }) } as any);
  for (const g of s.gms) g.isHuman = false;
  fillRosterGaps(s);
  recomputeTeamRatings(s);
  s.stage = "offseasonDraft" as any;
  onStageEntered(s, "offseasonRetirement");
  let guard = 0;
  while (s.draft && s.draft.currentPickIndex < s.draft.pickOrder.length && guard++ < 600) runAiPicks(s);
  signAiDraftPicks(s);
  signUnresolvedHumanPicks(s);
  recomputeTeamRatings(s);
  return s;
}
const hash = (s: LeagueState) =>
  createHash("sha256").update(JSON.stringify({ r: s.draft!.results, t: s.teams, p: s.players, c: s.draftClass, o: s.rookieOutcomes })).digest("hex");

describe("scouting pilot: flag off", () => {
  for (const seed of Object.keys(GOLDEN).map(Number)) {
    it(`seed ${seed}: the draft matches the pre-scouting golden hash and buys no reports`, () => {
      const s = draft(seed);
      expect(s.scouting).toBeUndefined();
      expect(s.config.scouting).toBeUndefined();
      expect(hash(s)).toBe(GOLDEN[seed]);
    });
  }
  it("config.scouting = false is the same draft as absent", () => {
    expect(hash(draft(9901, false))).toBe(GOLDEN[9901]);
  });
  it("turning it on changes the draft (the flag is wired) and the ledger is cleared once the draft is signed", () => {
    const s = draft(9901, true);
    expect(hash(s)).not.toBe(GOLDEN[9901]);
    expect(s.scouting).toBeUndefined();
  });
  it("online cannot turn it on: the config patch cleaner rejects the key, at setup and creation", () => {
    const base = { stage: "setup", config: DEFAULT_CONFIG } as LeagueState;
    expect(cleanConfigPatch(base, { scouting: true }).ok).toBe(false);
    expect(cleanConfigPatch(base, { scouting: true }, { creating: true }).ok).toBe(false);
  });
});
