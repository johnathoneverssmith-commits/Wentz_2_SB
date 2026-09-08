import { describe, expect, it } from "vitest";

import { PlayerPoolSchema } from "../src/schema/player.js";
import {
  aggregateSnapCounts,
  buildPoolFromRosterRows,
} from "../src/data/generate-pool.js";

/** Build an nflverse-roster-shaped row with sensible blanks. */
function rosterRow(over: Record<string, string> = {}): Record<string, string> {
  return {
    status: "ACT",
    gsis_id: `00-00${Math.random().toString().slice(2, 8)}`,
    esb_id: "",
    smart_id: "",
    full_name: "Test Player",
    first_name: "Test",
    last_name: "Player",
    position: "WR",
    depth_chart_position: "WR",
    ngs_position: "",
    years_exp: "3",
    draft_number: "40",
    team: "KC",
    birth_date: "1999-05-01",
    pfr_id: "",
    ...over,
  };
}

describe("aggregateSnapCounts", () => {
  const rows = [
    { pfr_player_id: "AAA", game_type: "REG", offense_pct: "1.0", defense_pct: "0", st_pct: "0.1" },
    { pfr_player_id: "AAA", game_type: "REG", offense_pct: "0.8", defense_pct: "0", st_pct: "0.1" },
    { pfr_player_id: "BBB", game_type: "REG", offense_pct: "0", defense_pct: "0.2", st_pct: "0.9" },
    { pfr_player_id: "AAA", game_type: "POST", offense_pct: "1.0", defense_pct: "0", st_pct: "0" },
  ];

  it("blends average snap share with games played, regular season only", () => {
    const perf = aggregateSnapCounts(rows);
    // AAA: avg share (1.0 + 0.8)/2 = 0.9 over 2 games -> 0.65*0.9 + 0.35*(2/17)
    expect(perf.get("AAA")).toBeCloseTo(0.65 * 0.9 + 0.35 * (2 / 17), 5);
    // BBB: max(0, 0.2, 0.9) = 0.9 over 1 game
    expect(perf.get("BBB")).toBeCloseTo(0.65 * 0.9 + 0.35 * (1 / 17), 5);
  });

  it("ignores rows with no player id", () => {
    expect(aggregateSnapCounts([{ pfr_player_id: "", game_type: "REG", offense_pct: "1" }]).size).toBe(0);
  });
});

describe("buildPoolFromRosterRows", () => {
  it("produces a schema-valid, overall-sorted pool with sequential ids", () => {
    const rows = [
      rosterRow({ full_name: "Alice Anderson", draft_number: "1", pfr_id: "AndeAl00" }),
      rosterRow({ full_name: "Bob Brown", draft_number: "255", pfr_id: "BrowBo00" }),
      rosterRow({ full_name: "Cara Carter", draft_number: "", pfr_id: "CartCa00" }),
    ];
    const { players } = buildPoolFromRosterRows(rows, { seasonYear: 2025 });
    expect(() => PlayerPoolSchema.parse(players)).not.toThrow();
    expect(players).toHaveLength(3);
    expect(players.map((p) => p.id)).toEqual(["p_00001", "p_00002", "p_00003"]);
    for (let i = 1; i < players.length; i++) {
      expect(players[i - 1]!.overall).toBeGreaterThanOrEqual(players[i]!.overall);
    }
  });

  it("maps nflverse positions onto the schema", () => {
    const rows = [
      rosterRow({ full_name: "Tackle Guy", depth_chart_position: "T", position: "OL" }),
      rosterRow({ full_name: "Edge Guy", depth_chart_position: "DE", position: "DL" }),
      rosterRow({ full_name: "Free Safety", depth_chart_position: "FS", position: "DB" }),
      rosterRow({ full_name: "Mike Backer", depth_chart_position: "MLB", position: "LB" }),
    ];
    const { players } = buildPoolFromRosterRows(rows, { seasonYear: 2025 });
    const pos = Object.fromEntries(players.map((p) => [p.name, p.position]));
    expect(pos).toEqual({
      "Tackle Guy": "OT",
      "Edge Guy": "EDGE",
      "Free Safety": "S",
      "Mike Backer": "LB",
    });
  });

  it("skips long snappers and other unmapped positions", () => {
    const rows = [
      rosterRow({ full_name: "Snap Master", depth_chart_position: "LS", position: "LS" }),
      rosterRow({ full_name: "Real Receiver" }),
    ];
    const { players, skipped } = buildPoolFromRosterRows(rows, { seasonYear: 2025 });
    expect(players.map((p) => p.name)).toEqual(["Real Receiver"]);
    expect(skipped[0]).toMatchObject({ name: "Snap Master" });
  });

  it("filters by roster status: ACT and RES in, CUT/RET out, DEV opt-in", () => {
    const rows = [
      rosterRow({ full_name: "Active Al", status: "ACT" }),
      rosterRow({ full_name: "Injured Ike", status: "RES" }),
      rosterRow({ full_name: "Cut Carl", status: "CUT" }),
      rosterRow({ full_name: "Retired Rob", status: "RET" }),
      rosterRow({ full_name: "Practice Pete", status: "DEV" }),
    ];
    const base = buildPoolFromRosterRows(rows, { seasonYear: 2025 });
    expect(base.players.map((p) => p.name).sort()).toEqual(["Active Al", "Injured Ike"]);

    const withPS = buildPoolFromRosterRows(rows, { seasonYear: 2025, includePracticeSquad: true });
    expect(withPS.players.map((p) => p.name).sort()).toEqual([
      "Active Al",
      "Injured Ike",
      "Practice Pete",
    ]);

    const noIR = buildPoolFromRosterRows(rows, { seasonYear: 2025, includeIR: false });
    expect(noIR.players.map((p) => p.name)).toEqual(["Active Al"]);
  });

  it("de-dupes one player across status rows, best status winning", () => {
    const rows = [
      rosterRow({ full_name: "Two Rows", gsis_id: "00-9999", status: "CUT" }),
      rosterRow({ full_name: "Two Rows", gsis_id: "00-9999", status: "ACT" }),
    ];
    const { players } = buildPoolFromRosterRows(rows, { seasonYear: 2025 });
    expect(players).toHaveLength(1);
  });

  it("counts how many players got a snap-share signal", () => {
    const rows = [
      rosterRow({ full_name: "Has Snaps", gsis_id: "00-1", pfr_id: "HasSn00" }),
      rosterRow({ full_name: "No Snaps", gsis_id: "00-2", pfr_id: "NoSna00" }),
    ];
    const perf = new Map([["HasSn00", 0.8]]);
    const { withPerfSignal } = buildPoolFromRosterRows(rows, { seasonYear: 2025 }, perf);
    expect(withPerfSignal).toBe(1);
  });

  it("falls back to an experience-based age when birth_date is missing", () => {
    const rows = [rosterRow({ full_name: "No DOB", birth_date: "", years_exp: "5" })];
    const { players } = buildPoolFromRosterRows(rows, { seasonYear: 2025 });
    expect(players[0]!.age).toBe(27); // 22 + 5
  });
});
