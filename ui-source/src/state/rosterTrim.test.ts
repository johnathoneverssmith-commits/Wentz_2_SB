import { describe, expect, it } from "vitest";

import { DEFAULT_CONFIG } from "./seed.ts";
import { useStore } from "./store.ts";

/**
 * Leaving the fantasy draft must not cut the team's best player.
 *
 * A 20-round fantasy draft signs every pick at market value, which puts most
 * teams well over the cap, and `fillRosterGaps` trims them back to legal on
 * the way to the summary. `trimToLegalRoster` is written to protect the one
 * man a team cannot replace at each position — but its tiers fell through to
 * "largest cap hit on the roster" whenever every player was a projected
 * starter, which is precisely the shape of a 20-man post-fantasy roster.
 *
 * The symptom was the worst kind: a stock solo dynasty where the viewer took
 * Lamar Jackson first overall and then found him on the free-agent list,
 * having never seen his own roster in between. Nothing told the player.
 */
const s = () => useStore.getState();

/** Ready up and take the one transition the stage offers. */
async function advance(): Promise<void> {
  s().autoReadyNonViewers();
  s().setReady(s().viewerGmId, true);
  const moved = await useStore.getState().tryAdvance();
  expect(moved.moved, `stage ${s().stage} refused to advance`).toBe(true);
}

/** A fresh dynasty sitting in the draft room with the board built. */
async function draftRoom(seed: number): Promise<void> {
  await useStore.getState().newLeague(seed, { ...DEFAULT_CONFIG, humanGmCount: 1 });
  useStore.getState().pickTeam(s().viewerGmId, "GB");
  await advance(); // setup -> fantasyDraft, which is what makes startDraft stick
  expect(s().stage).toBe("fantasyDraft");
  useStore.getState().startDraft("fantasy");
}

describe("trimming to a legal roster", () => {
  it("does not release the viewer's best pick on the way out of the draft", async () => {
    await draftRoom(4);
    useStore.getState().autopickRemaining();

    const mine = s()
      .draft!.results.filter((r) => r.teamCode === "GB")
      .map((r) => s().players[r.selectedId ?? ""]!)
      .filter(Boolean)
      .sort((a, b) => b.overall - a.overall);
    const best = mine[0]!;

    // stage entry is what trims: fantasyDraft -> fantasyDraftSummary
    await advance();
    expect(s().stage).toBe("fantasyDraftSummary");

    const after = s().players[best.id]!;
    expect(
      after.nfl_team,
      `${best.name} (${best.position} ${best.overall}) was cut on the way to the summary`,
    ).toBe("GB");
    expect(after.free_agent).toBe(false);
  }, 180_000);

  it("keeps every team's single best player through the trim", async () => {
    await draftRoom(9);

    const bestPickOf = new Map<string, string>();
    for (const code of Object.keys(s().teams)) {
      const picks = s()
        .draft!.results.filter((r) => r.teamCode === code)
        .map((r) => s().players[r.selectedId ?? ""]!)
        .filter(Boolean);
      if (picks.length === 0) continue;
      bestPickOf.set(code, picks.reduce((a, b) => (b.overall > a.overall ? b : a)).id);
    }
    useStore.getState().autopickRemaining();
    for (const code of Object.keys(s().teams)) {
      const picks = s()
        .draft!.results.filter((r) => r.teamCode === code)
        .map((r) => s().players[r.selectedId ?? ""]!)
        .filter(Boolean);
      if (picks.length > 0) {
        bestPickOf.set(code, picks.reduce((a, b) => (b.overall > a.overall ? b : a)).id);
      }
    }

    await advance();
    expect(s().stage).toBe("fantasyDraftSummary");

    const lost: string[] = [];
    for (const [code, id] of bestPickOf) {
      const p = s().players[id]!;
      if (p.nfl_team !== code) lost.push(`${code}: ${p.name} ${p.position} ${p.overall}`);
    }
    expect(lost, `top pick released: ${lost.join(" | ")}`).toEqual([]);

    // and no pick at all: each squad is priced to fit its cap
    // (`fitDraftedPayrolls`), so the trim has no starter to find money in
    const cut = s()
      .draft!.results.filter((r) => s().players[r.selectedId ?? ""]?.nfl_team !== r.teamCode)
      .map((r) => `${r.teamCode}: ${r.selectedName}`);
    expect(cut, `picks released: ${cut.join(" | ")}`).toEqual([]);
    for (const code of Object.keys(s().teams)) {
      const t = s().teams[code]!;
      expect(t.cap.used, `${code} over the cap`).toBeLessThanOrEqual(t.cap.total);
    }
  }, 180_000);
});
