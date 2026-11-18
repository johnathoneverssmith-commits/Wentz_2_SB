import { afterEach, describe, expect, it } from "vitest";
import type { LeagueState } from "@/domain";
import { createLeague, DEFAULT_CONFIG, fillRosterGaps, recomputeTeamRatings } from "./seed.ts";
import { beginDraft } from "./rules.ts";
import { scoutBatch, scoutingEnv, setScoutingProvider, spendReport, HUMAN_POINTS, reportsFor } from "./scouting.ts";
import { asViewer } from "./online.ts";
import { useStore } from "./store.ts";

/**
 * What a host (the online server) can do to the shared scouting rules, and what the solo game keeps.
 * The provider is the only seam: with none set, the draw is the seed-derived one and every save reads as before.
 */
function atDraft(seed = 11): { s: LeagueState; me: string } {
  const s = createLeague(seed, { ...DEFAULT_CONFIG, humanGmCount: 1, scouting: true } as never);
  fillRosterGaps(s);
  recomputeTeamRatings(s);
  const me = Object.keys(s.teams).sort()[0]!;
  s.gms.find((g) => g.isHuman)!.teamCode = me;
  return { s, me };
}
afterEach(() => setScoutingProvider(null));

describe("the host seam", () => {
  it("with no provider the report is the seed-derived one (solo is unchanged)", () => {
    expect(scoutingEnv()).toBeUndefined();
    const a = atDraft(), b = atDraft();
    beginDraft(a.s, "rookie");
    beginDraft(b.s, "rookie");
    const id = a.s.draftClass[40]!.id;
    const ra = spendReport(a.s, a.me, id, HUMAN_POINTS);
    const rb = spendReport(b.s, b.me, id, HUMAN_POINTS);
    expect(ra.ok && rb.ok && ra.report).toEqual(rb.ok && rb.report);
  });

  it("a provider's draw replaces the seed's, and the same draw gives the same report", () => {
    const { s, me } = atDraft();
    beginDraft(s, "rookie");
    const id = s.draftClass[40]!.id;
    const solo = spendReport(s, me, id, HUMAN_POINTS);
    delete s.scouting!.reports[me];
    setScoutingProvider(() => ({ noise: () => 2.5 }));
    const hosted = spendReport(s, me, id, HUMAN_POINTS);
    expect(solo.ok && hosted.ok).toBe(true);
    delete s.scouting!.reports[me];
    const again = spendReport(s, me, id, HUMAN_POINTS);
    expect(again).toEqual(hosted);
  });

  it("a provider that says off: no ledger opens, nothing is bought, CPU teams spend nothing", () => {
    const { s, me } = atDraft();
    setScoutingProvider(() => null);
    beginDraft(s, "rookie");
    expect(s.scouting).toBeUndefined();
    expect(spendReport(s, me, s.draftClass[0]!.id, HUMAN_POINTS)).toEqual({ ok: false, reason: "disabled" });
    expect(s.scouting).toBeUndefined();
  });

  it("scoutBatch: deduplicates in order, reports owned and refused, and a repeat buys nothing", () => {
    const { s, me } = atDraft();
    beginDraft(s, "rookie");
    const ids = s.draftClass.map((p) => p.id).slice(60, 70);
    const first = scoutBatch(s, me, [ids[0]!, "zz", ids[1]!, ids[0]!], HUMAN_POINTS);
    expect(first.purchased.map((p) => p.id)).toEqual([ids[0], ids[1]]);
    expect(first.refused).toEqual([{ id: "zz", reason: "unknown-prospect" }]);
    expect(first.owned).toEqual([]);
    const again = scoutBatch(s, me, [ids[0]!, "zz", ids[1]!, ids[0]!], HUMAN_POINTS);
    expect(again.purchased).toEqual([]);
    expect(again.owned.map((p) => p.id)).toEqual([ids[0], ids[1]]);
    expect(again.left).toBe(HUMAN_POINTS - 2);
    // a budget that runs out mid-batch keeps what fit
    const tight = scoutBatch(s, me, ids.slice(2), 4);
    expect(tight.purchased).toHaveLength(2);
    expect(tight.refused.every((r) => r.reason === "no-points")).toBe(true);
    expect(Object.keys(reportsFor(s, me, s.draft!.year))).toHaveLength(4);
  });
});

describe("the client merge: a ledger the server cleared leaves the screen", () => {
  it("asViewer writes the scouting key even when the server sent none, so the store's shallow merge clears it", () => {
    const { s, me } = atDraft();
    beginDraft(s, "rookie");
    spendReport(s, me, s.draftClass[50]!.id, HUMAN_POINTS);
    useStore.setState({ ...(s as object), viewerGmId: "gm_you" } as never);
    expect(useStore.getState().scouting).toBeDefined();
    // the server's next pull: no ledger (JSON drops the key). Without the explicit key this would be a no-op.
    const { scouting: _gone, ...pulled } = JSON.parse(JSON.stringify(s)) as LeagueState;
    useStore.setState({ ...pulled } as never);
    expect(useStore.getState().scouting).toBeDefined(); // the failure mode this guards against
    useStore.setState(asViewer(pulled as LeagueState, "gm_you") as never);
    expect(useStore.getState().scouting).toBeUndefined();
  });
});
