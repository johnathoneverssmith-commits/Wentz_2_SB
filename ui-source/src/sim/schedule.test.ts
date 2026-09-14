import { describe, expect, it } from "vitest";

import { TEAMS } from "@/data/teams";
import { MockSimulationService } from "@/sim/MockSimulationService";

/**
 * The schedule has to be a season, not thirty-two teams paired off at random.
 *
 * It used to be the latter. The counts were all correct — seventeen games
 * each, byes in a plausible range — so nothing looked wrong until a GM
 * noticed they had gone a year without playing the team they share a division
 * with. Measured across two seasons before the fix: 6 of 48 division pairs
 * met twice in one year, 2 of 48 in the next, and 24 and 33 pairs never met
 * at all. Standings mean nothing if the division doesn't actually play.
 */
const sim = new MockSimulationService();
const codes = TEAMS.map((t) => t.code);
const divisionOf = new Map(TEAMS.map((t) => [t.code, `${t.conference} ${t.division}`]));

const regularSeason = (season: number) =>
  sim.generateSchedule(season, codes).filter((g) => g.phase === "REG");

/** Every unordered pair of teams sharing a division. */
function divisionPairs(): [string, string][] {
  const out: [string, string][] = [];
  for (let i = 0; i < codes.length; i++) {
    for (let j = i + 1; j < codes.length; j++) {
      const a = codes[i]!;
      const b = codes[j]!;
      if (divisionOf.get(a) === divisionOf.get(b)) out.push([a, b]);
    }
  }
  return out;
}

describe("the regular-season schedule", () => {
  // three consecutive years, because the division-pairing rotation changes
  // with the year and a fluke in one season would hide behind it
  for (const season of [2026, 2027, 2028]) {
    describe(`${season}`, () => {
      const games = regularSeason(season);

      it("plays every division rival exactly twice", () => {
        const pairs = divisionPairs();
        expect(pairs).toHaveLength(48); // 8 divisions × 6 pairs
        for (const [a, b] of pairs) {
          const meetings = games.filter(
            (g) =>
              (g.homeTeam === a && g.awayTeam === b) || (g.homeTeam === b && g.awayTeam === a),
          );
          expect(meetings, `${a} v ${b}`).toHaveLength(2);
        }
      });

      it("plays each rival once at home and once away", () => {
        for (const [a, b] of divisionPairs()) {
          const aHome = games.filter((g) => g.homeTeam === a && g.awayTeam === b);
          const bHome = games.filter((g) => g.homeTeam === b && g.awayTeam === a);
          expect(aHome, `${a} hosts ${b}`).toHaveLength(1);
          expect(bHome, `${b} hosts ${a}`).toHaveLength(1);
        }
      });

      it("gives every team seventeen games and one bye", () => {
        for (const code of codes) {
          const mine = games.filter((g) => g.homeTeam === code || g.awayTeam === code);
          expect(mine, code).toHaveLength(17);
          const weeks = new Set(mine.map((g) => g.week));
          expect(weeks.size, `${code} plays twice in a week`).toBe(17);
          const byes = [...Array(18).keys()].map((w) => w + 1).filter((w) => !weeks.has(w));
          expect(byes, `${code} bye`).toHaveLength(1);
          // the real NFL confines byes to weeks 5–14
          expect(byes[0]).toBeGreaterThanOrEqual(5);
          expect(byes[0]).toBeLessThanOrEqual(14);
        }
      });

      it("never schedules a team against itself", () => {
        for (const g of games) expect(g.homeTeam).not.toBe(g.awayTeam);
      });
    });
  }

  it("keeps working for a league that isn't the real thirty-two", () => {
    // a fixture league has no division rotation to follow; it must still get
    // a usable schedule rather than throwing
    const four = ["KC", "BUF", "GB", "SF"];
    const games = sim.generateSchedule(2026, four).filter((g) => g.phase === "REG");
    expect(games.length).toBeGreaterThan(0);
    for (const g of games) expect(four).toContain(g.homeTeam);
  });
});
