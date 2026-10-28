import { describe, expect, it } from "vitest";

import type { LeagueState } from "@/domain";
import { commitRetirements } from "@/state/rules.ts";
import { createLeague, DEFAULT_CONFIG } from "@/state/seed.ts";

/**
 * Retirement is one rule for the local store and the online server
 * (`commitRetirements`, called from `store.ts` and `online/src/phases.ts`).
 * Each player's fate must depend on the season and his id only: the server
 * keeps players in whatever order its JSON round trip gives it, a client in
 * another, and the two must retire the same people.
 */
function aged(): LeagueState {
  const s = createLeague(5, { ...DEFAULT_CONFIG, fantasyDraft: false });
  let n = 0;
  for (const p of Object.values(s.players)) {
    if (n++ % 3 === 0) p.age += 8;
  }
  return s;
}
const base = aged();
const copy = (): LeagueState => JSON.parse(JSON.stringify(base)) as LeagueState;
const retiredIds = (s: LeagueState): string[] =>
  Object.values(s.players).filter((p) => p.retired).map((p) => p.id).sort();

describe("commitRetirements across storage order and reload", () => {
  it("retires the same players whatever order the players map is stored in", () => {
    const a = copy();
    const b = copy();
    b.players = Object.fromEntries(Object.entries(b.players).reverse());
    commitRetirements(a);
    commitRetirements(b);
    expect(retiredIds(a).length).toBeGreaterThan(10);
    expect(retiredIds(b)).toEqual(retiredIds(a));
  });

  it("retires the same players after the state is serialised and read back, as the server does", () => {
    const a = copy();
    const b = copy();
    commitRetirements(a);
    commitRetirements(b);
    expect(retiredIds(b)).toEqual(retiredIds(a));
  });

  it("retires a different group in a different season", () => {
    const a = copy();
    const b = copy();
    b.season += 1;
    commitRetirements(a);
    commitRetirements(b);
    expect(retiredIds(b)).not.toEqual(retiredIds(a));
  });
});
