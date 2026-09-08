import { describe, expect, it } from "vitest";

import { PlayerPoolSchema } from "../src/schema/player.js";
import {
  parseCsv,
  importMaddenCsv,
  MADDEN_POSITION_MAP,
  AGING_CURVES,
} from "../src/data/madden.js";

/* Long-form headers, one QB + one WR. */
const CSV_LONG = [
  "Full Name,Position,Team,Age,Years Pro,Overall Rating,Speed Rating,Acceleration Rating,Awareness Rating,Throw Power Rating,Throw Accuracy Short Rating,Catching Rating,Short Route Running Rating",
  "Sample Passer,QB,KC,29,7,94,80,86,97,95,93,40,30",
  "Sample Wideout,WR,CIN,26,5,91,93,94,84,20,25,90,88",
].join("\n");

/* Abbreviated headers + first/last name split + a HB and an LT. */
const CSV_ABBREV = [
  "firstName,lastName,pos,team,age,exp,ovr,SPD,ACC,STR,CAR,BTK,PBK,RBK",
  "Sample,Runner,HB,DAL,24,2,88,92,91,80,89,90,30,35",
  "Sample,Tackle,LT,DAL,28,6,90,74,72,88,20,20,88,87",
].join("\n");

describe("parseCsv", () => {
  it("parses headers and rows into objects", () => {
    const rows = parseCsv("a,b,c\n1,2,3\n4,5,6\n");
    expect(rows).toEqual([
      { a: "1", b: "2", c: "3" },
      { a: "4", b: "5", c: "6" },
    ]);
  });

  it("handles quoted fields with commas and escaped quotes", () => {
    const rows = parseCsv('name,note\n"Smith, Jr.","he said ""hi"""\n');
    expect(rows[0]).toEqual({ name: "Smith, Jr.", note: 'he said "hi"' });
  });

  it("handles CRLF line endings and a trailing newline-less row", () => {
    const rows = parseCsv("x,y\r\n1,2\r\n3,4");
    expect(rows).toEqual([
      { x: "1", y: "2" },
      { x: "3", y: "4" },
    ]);
  });

  it("skips fully blank lines", () => {
    const rows = parseCsv("a,b\n1,2\n\n3,4\n");
    expect(rows).toHaveLength(2);
  });
});

describe("convertMaddenRows — long-form headers", () => {
  const { players, skipped } = importMaddenCsv(CSV_LONG, { startId: 1 });

  it("produces a schema-valid pool", () => {
    expect(() => PlayerPoolSchema.parse(players)).not.toThrow();
    expect(skipped).toEqual([]);
    expect(players).toHaveLength(2);
  });

  it("orders by overall desc and assigns sequential ids", () => {
    expect(players.map((p) => p.name)).toEqual(["Sample Passer", "Sample Wideout"]);
    expect(players.map((p) => p.id)).toEqual(["p_00001", "p_00002"]);
  });

  it("maps core fields and keeps position-relevant attributes", () => {
    const qb = players[0]!;
    expect(qb.position).toBe("QB");
    expect(qb.nfl_team).toBe("KC");
    expect(qb.age).toBe(29);
    expect(qb.years_pro).toBe(7);
    expect(qb.overall).toBe(94);
    expect(qb.attributes.throw_power).toBe(95);
    expect(qb.attributes.throw_accuracy_short).toBe(93);
    expect(qb.attributes.speed).toBe(80);
  });

  it("drops attributes not in the position's schema subset", () => {
    const qb = players[0]!;
    // catching / short route running were columns but are not QB attributes
    expect(qb.attributes).not.toHaveProperty("catching");
    expect(qb.attributes).not.toHaveProperty("route_running_short");
  });

  it("sets franchise-draft defaults", () => {
    for (const p of players) {
      expect(p.free_agent).toBe(true);
      expect(p.contract).toBeNull();
      expect(p.retired).toBe(false);
      expect(p.scheme_tags).toEqual([]);
      expect(p.injury_history).toEqual([]);
    }
  });

  it("fills aging thresholds from the position curve", () => {
    const wr = players[1]!;
    expect(wr.dev_age_threshold).toBe(AGING_CURVES.WR.dev);
    expect(wr.decline_age_threshold).toBe(AGING_CURVES.WR.decline);
  });
});

describe("convertMaddenRows — abbreviated headers + position aliases", () => {
  const { players } = importMaddenCsv(CSV_ABBREV, { startId: 1 });

  it("maps HB -> RB and LT -> OT", () => {
    const runner = players.find((p) => p.name === "Sample Runner")!;
    const tackle = players.find((p) => p.name === "Sample Tackle")!;
    expect(runner.position).toBe("RB");
    expect(tackle.position).toBe("OT");
  });

  it("reads 3-letter attribute codes", () => {
    const runner = players.find((p) => p.name === "Sample Runner")!;
    expect(runner.attributes.speed).toBe(92);
    expect(runner.attributes.carrying).toBe(89);
    expect(runner.attributes.break_tackle).toBe(90);
  });
});

describe("edge cases", () => {
  it("skips rows with an unmapped position, keeping the rest", () => {
    const csv = [
      "name,position,age,ovr,SPD",
      "Long Snapper,LS,30,60,55",
      "Good Corner,CB,25,88,93",
    ].join("\n");
    const { players, skipped } = importMaddenCsv(csv);
    expect(players.map((p) => p.name)).toEqual(["Good Corner"]);
    expect(skipped).toEqual([
      { row: 2, name: "Long Snapper", reason: "unmapped position: LS" },
    ]);
  });

  it("skips rows missing a required field", () => {
    const csv = ["name,position,age,ovr", "No Overall,QB,28,"].join("\n");
    const { players, skipped } = importMaddenCsv(csv);
    expect(players).toEqual([]);
    expect(skipped[0]?.reason).toBe("no overall");
  });

  it("clamps out-of-range ratings into 0-99", () => {
    const csv = ["name,position,age,ovr,SPD", "Blazing,WR,24,120,140"].join("\n");
    const { players } = importMaddenCsv(csv);
    expect(players[0]!.overall).toBe(99);
    expect(players[0]!.attributes.speed).toBe(99);
  });

  it("derives years_pro from rookieYear + season when no explicit column", () => {
    const csv = ["name,position,age,ovr,rookieYear", "Vet,QB,30,90,2016"].join("\n");
    const { players, warnings } = importMaddenCsv(csv, { seasonYear: 2025 });
    expect(players[0]!.years_pro).toBe(9);
    expect(warnings.some((w) => w.includes("years_pro"))).toBe(false);
  });

  it("defaults years_pro to 0 and warns when it cannot be derived", () => {
    const csv = ["name,position,age,ovr", "Mystery,QB,25,80"].join("\n");
    const { players, warnings } = importMaddenCsv(csv);
    expect(players[0]!.years_pro).toBe(0);
    expect(warnings.some((w) => w.includes("years_pro"))).toBe(true);
  });

  it("normalises free-agent team tokens to FA", () => {
    const csv = ["name,position,age,ovr", "Unsigned,WR,27,79"].join("\n");
    const { players } = importMaddenCsv(csv, { defaultTeam: "Free Agent" });
    expect(players[0]!.nfl_team).toBe("FA");
  });

  it("uses a stable source id column when given", () => {
    const csv = ["id,name,position,age,ovr", "1234,Star,QB,28,95"].join("\n");
    const { players } = importMaddenCsv(csv, { idColumn: "id" });
    expect(players[0]!.id).toBe("p_01234");
  });
});

describe("mapping tables", () => {
  it("every MADDEN_POSITION_MAP value is a real schema position", () => {
    for (const v of Object.values(MADDEN_POSITION_MAP)) {
      expect(AGING_CURVES).toHaveProperty(v);
    }
  });
});
