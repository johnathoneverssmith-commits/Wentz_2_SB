import { describe, expect, it } from "vitest";

import { cleanConfigPatch } from "./rules.ts";
import { createLeague, DEFAULT_CONFIG } from "./seed.ts";

/**
 * Online league settings are the commissioner's, saved on the server; the
 * settings screen used to change only the viewer's local copy.
 */
describe("a commissioner's settings change", () => {
  const league = () => createLeague(9, { ...DEFAULT_CONFIG });

  it("accepts the rules a league can still change before it starts", () => {
    const res = cleanConfigPatch(league(), { draftSimulateAfterPicks: 3, draftType: "snake", talentImpact: "extreme" });
    expect(res).toEqual({ ok: true, patch: { draftSimulateAfterPicks: 3, draftType: "snake", talentImpact: "extreme" } });
  });

  it("refuses unknown settings, bad values and the seat count", () => {
    expect(cleanConfigPatch(league(), { fantasyDraftRounds: 7 }).ok).toBe(false);
    expect(cleanConfigPatch(league(), { humanGmCount: 8 }).ok).toBe(false);
    expect(cleanConfigPatch(league(), { cap: 999 }).ok).toBe(false);
  });

  it("locks once the league starts", () => {
    const s = league();
    s.stage = "fantasyDraft";
    expect(cleanConfigPatch(s, { draftType: "snake" }).ok).toBe(false);
  });

  it("keeps a humans-only league drafting", () => {
    const res = cleanConfigPatch(league(), { leagueFormat: "humansOnly", fantasyDraft: false });
    expect(res.ok && res.patch.fantasyDraft).toBe(true);
  });
});
