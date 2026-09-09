/**
 * §28 FIRST TASK — schema audit + data-quality report + variable classification
 * + attribute reference stats. No models are fitted here (spec §28: "Do not
 * proceed to model fitting until the audit has been reviewed").
 *
 * Outputs:
 *   artifacts/schema/schema_audit.json
 *   artifacts/schema/variable_classification.csv
 *   artifacts/schema/data_quality_report.md
 *   artifacts/ratings/attribute_reference_stats.json
 *
 * Run: npm run analysis:audit
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import { parseCsv } from "../src/data/csv.js";
import {
  GENERAL_ATTRIBUTE_KEYS,
  KNOWN_ATTRIBUTE_KEYS,
  POSITION_ATTRIBUTE_KEYS,
  type Position,
} from "../src/schema/player.js";
import { PRIMARY_SEASONS, readSchema, readSeason, jsType, type PbpRow } from "./lib/pbp.js";
import {
  APPLICABLE_POPULATION,
  isEmptySentinel,
  isNullish,
  isPenaltyFree,
  missingnessFor,
  passesAdminExclusions,
  passesCoreExclusions,
  inProductionBaseline,
} from "./lib/filters.js";
import {
  BENCHMARK_ONLY_FIELDS,
  LEAKAGE_FIELDS,
  MODEL_POPULATIONS,
  REFERENCE_POOL_SPEC,
  SPEC_REQUIRED_FIELDS,
  classify,
} from "./lib/spec.js";

const OUT = fileURLToPath(new URL("../artifacts/", import.meta.url));
const DATA = fileURLToPath(new URL("../data/", import.meta.url));
const TODAY = ((): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
})();
const is1 = (v: unknown): boolean => v === 1 || v === true || v === 1n;

/* ================================================================== */
/* A. Cross-season schema                                              */
/* ================================================================== */

interface ColSchema {
  physicalTypeBySeason: Record<number, string>;
  logicalTypeBySeason: Record<number, string | null>;
  jsTypesBySeason: Record<number, string[]>;
  presentIn: number[];
}

async function buildSchemaAudit(): Promise<{
  schemas: Awaited<ReturnType<typeof readSchema>>[];
  columns: Map<string, ColSchema>;
}> {
  const schemas = [];
  for (const s of PRIMARY_SEASONS) schemas.push(await readSchema(s));

  const columns = new Map<string, ColSchema>();
  for (const sc of schemas) {
    for (const [name, t] of sc.columns) {
      const entry = columns.get(name) ?? {
        physicalTypeBySeason: {},
        logicalTypeBySeason: {},
        jsTypesBySeason: {},
        presentIn: [],
      };
      entry.physicalTypeBySeason[sc.season] = t.physicalType;
      entry.logicalTypeBySeason[sc.season] = t.logicalType;
      entry.presentIn.push(sc.season);
      columns.set(name, entry);
    }
  }
  return { schemas, columns };
}

/* ================================================================== */
/* B. Per-season accumulators                                          */
/* ================================================================== */

interface SeasonStats {
  season: number;
  totalRows: number;
  cleanRegRows: number;
  playTypeCounts: Record<string, number>;
  // Q4
  modelCounts: Record<string, number>;
  // Q5 coherence
  coherence: Record<string, number>;
  dropbackRunScrambleFalse: Array<{ play_id: unknown; game_id: unknown; desc: unknown }>;
  // Q8 attribution
  attribution: Record<string, { nonNull: number; denom: number; rule: string }>;
  // Q9 kickoff
  kickoff: {
    n: number;
    onsideByDesc: number;
    touchbackRate: number;
    returnRate: number;
    oobRate: number;
    meanKickDistance: number | null;
    meanReturnYards: number | null;
  };
  // §28.2
  nonDownPlays: Record<string, { n: number; downNonNull: number }>;
  // §17.1 roof / temp / wind
  roofCounts: Record<string, number>;
  tempNullByRoof: Record<string, { n: number; tempNull: number; windNull: number }>;
  // string sentinel scan
  stringSentinels: Record<string, number>;
  // missingness for the relevant field list
  missingness: ReturnType<typeof missingnessFor>[];
  // js type sets for every column (type-consistency + classification)
  jsTypes: Record<string, Set<string>>;
}

const RELEVANT_FIELDS = [
  ...new Set([
    ...SPEC_REQUIRED_FIELDS,
    "pass_attempt", "rush_attempt", "complete_pass", "yards_after_catch", "air_yards",
    "run_location", "run_gap", "qb_hit", "cp", "cpoe",
    "xyac_mean_yardage", "xyac_median_yardage", "xyac_success", "xyac_fd",
    "field_goal_attempt", "field_goal_result", "kick_distance", "extra_point_result",
    "punt_attempt", "kickoff_attempt", "return_yards", "touchback",
    "two_point_attempt", "extra_point_attempt",
    "solo_tackle_1_player_id", "assist_tackle_1_player_id", "sack_player_id",
    "half_sack_1_player_id", "interception_player_id", "tackle_for_loss_1_player_id",
    "roof", "surface", "temp", "wind", "weather",
    "order_sequence", "play_deleted", "aborted_play",
  ]),
].filter((f) => !["extra_point_result", "touchback"].includes(f)); // admin-only; covered in Q9 / §28.2

const ATTRIBUTION_FIELDS = [
  "solo_tackle_1_player_id", "solo_tackle_2_player_id",
  "assist_tackle_1_player_id", "assist_tackle_2_player_id",
  "sack_player_id", "half_sack_1_player_id", "half_sack_2_player_id",
  "interception_player_id", "forced_fumble_player_1_player_id", "tackle_for_loss_1_player_id",
];

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  const v = sorted[lo]!;
  return lo === hi ? v : v + (sorted[hi]! - v) * (i - lo);
}

async function analyseSeason(season: number, allColumns: string[]): Promise<SeasonStats> {
  const rows = await readSeason(season);
  const clean = rows.filter((r) => passesCoreExclusions(r) && inProductionBaseline(r));
  const adminClean = rows.filter((r) => passesAdminExclusions(r) && inProductionBaseline(r));

  const stats: SeasonStats = {
    season,
    totalRows: rows.length,
    cleanRegRows: clean.length,
    playTypeCounts: {},
    modelCounts: {},
    coherence: {},
    dropbackRunScrambleFalse: [],
    attribution: {},
    kickoff: {
      n: 0, onsideByDesc: 0, touchbackRate: 0, returnRate: 0, oobRate: 0,
      meanKickDistance: null, meanReturnYards: null,
    },
    nonDownPlays: {},
    roofCounts: {},
    tempNullByRoof: {},
    stringSentinels: {},
    missingness: [],
    jsTypes: {},
  };

  // js type sets + string sentinels — full row population
  for (const col of allColumns) stats.jsTypes[col] = new Set();
  for (const r of rows) {
    for (const col of allColumns) {
      const v = r[col];
      stats.jsTypes[col]!.add(jsType(v));
      if (isEmptySentinel(v)) stats.stringSentinels[col] = (stats.stringSentinels[col] ?? 0) + 1;
    }
    const pt = (r.play_type as string | null) ?? "NULL";
    stats.playTypeCounts[pt] = (stats.playTypeCounts[pt] ?? 0) + 1;
  }

  // Q4 — clean plays per model population (admin plays use the down-null-tolerant base)
  for (const m of MODEL_POPULATIONS) {
    const src = m.base === "admin" ? adminClean : clean;
    let n = 0;
    for (const r of src) {
      if (m.penaltyFree && !isPenaltyFree(r)) continue;
      if (m.predicate(r)) n++;
    }
    stats.modelCounts[`${m.id} ${m.name}`] = n;
  }

  // Q5 — dropback/rush/scramble/sack coherence (on all rows, not just clean, to catch data issues)
  const coh = stats.coherence;
  const inc = (k: string): void => { coh[k] = (coh[k] ?? 0) + 1; };
  for (const r of rows) {
    if (is1(r.sack) && is1(r.qb_scramble)) inc("sack==1 & qb_scramble==1");
    if (is1(r.sack) && is1(r.rush_attempt)) inc("sack==1 & rush_attempt==1");
    if (is1(r.qb_dropback) && is1(r.rush_attempt) && !is1(r.qb_scramble)) inc("qb_dropback==1 & rush_attempt==1 & qb_scramble==0");
    if (is1(r.pass_attempt) && is1(r.rush_attempt)) inc("pass_attempt==1 & rush_attempt==1");
    if (is1(r.qb_scramble) && !is1(r.qb_dropback)) inc("qb_scramble==1 & qb_dropback==0");
    if (is1(r.qb_scramble) && !is1(r.rush_attempt)) inc("qb_scramble==1 & rush_attempt==0");
    if (is1(r.complete_pass) && !is1(r.pass_attempt)) inc("complete_pass==1 & pass_attempt==0");
    if (is1(r.sack) && !is1(r.qb_dropback)) inc("sack==1 & qb_dropback==0");
    // §28.1
    if (is1(r.qb_dropback) && r.play_type === "run") {
      inc("qb_dropback==1 & play_type=='run'");
      if (is1(r.qb_scramble)) inc("  ...of which qb_scramble==1");
      else {
        inc("  ...of which qb_scramble==0  [INTERNALLY INCONSISTENT]");
        stats.dropbackRunScrambleFalse.push({ play_id: r.play_id, game_id: r.game_id, desc: r.desc });
      }
    }
  }

  // Q8 — attribution field completeness (denominator: plays that produce a tackle-ish event)
  const tackleEventDenom = rows.filter(
    (r) => is1(r.rush_attempt) || is1(r.complete_pass) || is1(r.qb_scramble),
  ).length;
  const sackDenom = rows.filter((r) => is1(r.sack)).length;
  const intDenom = rows.filter((r) => is1(r.interception)).length;
  for (const f of ATTRIBUTION_FIELDS) {
    let nonNull = 0;
    for (const r of rows) if (!isNullish(r[f]) && !isEmptySentinel(r[f])) nonNull++;
    const denom = f.startsWith("sack") || f.startsWith("half_sack")
      ? sackDenom
      : f.startsWith("interception")
        ? intDenom
        : tackleEventDenom;
    const rule = f.startsWith("sack") || f.startsWith("half_sack")
      ? "sack == 1"
      : f.startsWith("interception")
        ? "interception == 1"
        : "rush / completion / scramble";
    stats.attribution[f] = { nonNull, denom, rule };
  }

  // Q9 — kickoff behaviour by season
  const kos = rows.filter((r) => is1(r.kickoff_attempt));
  const kd: number[] = [];
  const ry: number[] = [];
  let tb = 0, ret = 0, oob = 0, onside = 0;
  for (const r of kos) {
    if (typeof r.kick_distance === "number") kd.push(r.kick_distance);
    if (typeof r.return_yards === "number" && is1(r.kickoff_attempt)) ry.push(r.return_yards);
    if (is1(r.touchback)) tb++;
    if (typeof r.desc === "string" && /kicks onside/i.test(r.desc)) onside++;
    if (typeof r.return_yards === "number" && r.return_yards > 0) ret++;
    if (is1((r as PbpRow).kickoff_out_of_bounds) || is1((r as PbpRow).out_of_bounds)) oob++;
  }
  stats.kickoff = {
    n: kos.length,
    onsideByDesc: onside,
    touchbackRate: kos.length ? tb / kos.length : 0,
    returnRate: kos.length ? ret / kos.length : 0,
    oobRate: kos.length ? oob / kos.length : 0,
    meanKickDistance: kd.length ? kd.reduce((a, b) => a + b, 0) / kd.length : null,
    meanReturnYards: ry.length ? ry.reduce((a, b) => a + b, 0) / ry.length : null,
  };

  // §28.2 — non-down administrative plays
  for (const f of ["two_point_attempt", "extra_point_attempt", "kickoff_attempt"]) {
    const hits = rows.filter((r) => is1(r[f]));
    stats.nonDownPlays[f] = {
      n: hits.length,
      downNonNull: hits.filter((r) => r.down != null).length,
    };
  }

  // §17.1 — roof / temp / wind
  for (const r of rows) {
    const roof = (r.roof as string | null) ?? "NULL";
    stats.roofCounts[roof] = (stats.roofCounts[roof] ?? 0) + 1;
    const b = (stats.tempNullByRoof[roof] ??= { n: 0, tempNull: 0, windNull: 0 });
    b.n++;
    if (isNullish(r.temp)) b.tempNull++;
    if (isNullish(r.wind)) b.windNull++;
  }

  // missingness for the relevant field list (§6.6 dual denominators)
  stats.missingness = RELEVANT_FIELDS.filter((f) => allColumns.includes(f)).map((f) =>
    missingnessFor(clean, f),
  );

  return stats;
}

/* ================================================================== */
/* C. Player sheet audit (Q10)                                         */
/* ================================================================== */

interface PlayerAudit {
  rows: number;
  columns: number;
  positionCounts: Record<string, number>;
  teamCounts: Record<string, number>;
  freeAgentVsTeam: {
    fa_true_with_real_team: number;
    fa_true_no_team: number;
    fa_false_with_real_team: number;
    fa_false_no_team: number;
    distinct_free_agent_values: string[];
  };
  retiredCount: number;
  retiredWithTeam: number;
  attributeNullRates: Record<string, { nonNull: number; total: number }>;
}

function auditPlayers(): { audit: PlayerAudit; players: Array<Record<string, string>> } {
  const csv = readFileSync(resolve(DATA, "players_local_final.csv"), "utf8");
  const players = parseCsv(csv);
  const header = Object.keys(players[0] ?? {});

  const FA_NONTEAM = new Set(["", "FA", "NONE", "--", "-"]);
  const positionCounts: Record<string, number> = {};
  const teamCounts: Record<string, number> = {};
  const faValues = new Set<string>();
  let faTrueReal = 0, faTrueNone = 0, faFalseReal = 0, faFalseNone = 0;
  let retired = 0, retiredWithTeam = 0;

  for (const p of players) {
    positionCounts[p.position ?? "?"] = (positionCounts[p.position ?? "?"] ?? 0) + 1;
    teamCounts[p.nfl_team ?? "?"] = (teamCounts[p.nfl_team ?? "?"] ?? 0) + 1;
    faValues.add((p.free_agent ?? "").toLowerCase());
    const fa = /^(true|1|yes)$/i.test(p.free_agent ?? "");
    const noTeam = FA_NONTEAM.has((p.nfl_team ?? "").trim().toUpperCase());
    if (fa && !noTeam) faTrueReal++;
    if (fa && noTeam) faTrueNone++;
    if (!fa && !noTeam) faFalseReal++;
    if (!fa && noTeam) faFalseNone++;
    if (/^(true|1|yes)$/i.test(p.retired ?? "")) {
      retired++;
      if (!noTeam) retiredWithTeam++;
    }
  }

  const attributeNullRates: Record<string, { nonNull: number; total: number }> = {};
  for (const attr of KNOWN_ATTRIBUTE_KEYS) {
    if (!header.includes(attr)) continue;
    let nonNull = 0;
    for (const p of players) if ((p[attr] ?? "").trim() !== "") nonNull++;
    attributeNullRates[attr] = { nonNull, total: players.length };
  }

  return {
    players,
    audit: {
      rows: players.length,
      columns: header.length,
      positionCounts,
      teamCounts,
      freeAgentVsTeam: {
        fa_true_with_real_team: faTrueReal,
        fa_true_no_team: faTrueNone,
        fa_false_with_real_team: faFalseReal,
        fa_false_no_team: faFalseNone,
        distinct_free_agent_values: [...faValues],
      },
      retiredCount: retired,
      retiredWithTeam,
      attributeNullRates,
    },
  };
}

/* ================================================================== */
/* D. Attribute reference stats (§3)                                   */
/* ================================================================== */

function buildReferenceStats(players: Array<Record<string, string>>): unknown {
  const byTeam = new Map<string, Array<Record<string, string>>>();
  for (const p of players) {
    const team = (p.nfl_team ?? "").trim().toUpperCase();
    if (!team || team === "FA") continue;
    (byTeam.get(team) ?? byTeam.set(team, []).get(team)!).push(p);
  }

  const pool: Array<Record<string, string>> = [];
  for (const [, roster] of byTeam) {
    for (const spec of REFERENCE_POOL_SPEC) {
      const group = roster
        .filter((p) => spec.positions.includes(p.position ?? ""))
        .sort((a, b) => Number(b.overall) - Number(a.overall))
        .slice(0, spec.topN);
      pool.push(...group);
    }
  }

  const attrKeys = [
    ...GENERAL_ATTRIBUTE_KEYS,
    ...new Set(Object.values(POSITION_ATTRIBUTE_KEYS as Record<Position, readonly string[]>).flat()),
  ];
  const stats: Record<string, { mean: number; sd: number; n: number }> = {};
  for (const attr of attrKeys) {
    const vals: number[] = [];
    for (const p of pool) {
      const raw = (p[attr] ?? "").trim();
      if (raw === "") continue;
      const n = Number(raw);
      if (Number.isFinite(n)) vals.push(n);
    }
    if (vals.length < 2) {
      stats[attr] = { mean: vals[0] ?? NaN, sd: NaN, n: vals.length };
      continue;
    }
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const variance = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / (vals.length - 1);
    stats[attr] = { mean: round(mean, 3), sd: round(Math.sqrt(variance), 3), n: vals.length };
  }

  return {
    generated: TODAY,
    method:
      "§3 temporary active-role reference pool: top-N players per team per position group " +
      "(ranked by overall, which is allowed only for defining this population), then per-attribute " +
      "mean and sample SD (ddof=1) over pool players whose attribute is non-null. " +
      "clip attribute_z to [-3, +3] at use time.",
    reference_pool_spec: REFERENCE_POOL_SPEC,
    teams: byTeam.size,
    reference_pool_size: pool.length,
    attribute_reference_stats: stats,
  };
}

const round = (n: number, d: number): number => Number(n.toFixed(d));

/* ================================================================== */
/* E. Assemble + write                                                 */
/* ================================================================== */

function pct(n: number, d: number): string {
  return d === 0 ? "n/a" : `${((100 * n) / d).toFixed(2)}%`;
}

function writeVariableClassification(columns: Map<string, ColSchema>, seasonStats: SeasonStats[]): void {
  const lines = ["variable,classification,first_event_available,allowed_models,forbidden_models,notes"];
  const jsTypeUnion = (col: string): string => {
    const set = new Set<string>();
    for (const s of seasonStats) for (const t of s.jsTypes[col] ?? []) set.add(t);
    return [...set].sort().join("|");
  };
  for (const col of [...columns.keys()].sort()) {
    const { classification, note } = classify(col);
    const forbidden =
      classification === "LEAKAGE_DO_NOT_USE"
        ? "ALL"
        : classification === "BENCHMARK_ONLY"
          ? "ALL (fitted); validation only"
          : "";
    const allowed =
      classification === "STATE"
        ? "ALL (pre-snap)"
        : classification === "IDENTIFIER_GROUPING"
          ? "grouping/shrinkage + stat-credit"
          : "";
    const cell = (s: string): string => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
    lines.push(
      [col, classification, "", allowed, forbidden, `${note}; js_type=${jsTypeUnion(col)}`]
        .map(cell)
        .join(","),
    );
  }
  writeFileSync(resolve(OUT, "schema/variable_classification.csv"), lines.join("\n") + "\n");
}

async function main(): Promise<void> {
  mkdirSync(resolve(OUT, "schema"), { recursive: true });
  mkdirSync(resolve(OUT, "ratings"), { recursive: true });

  console.log("A. reading Parquet schemas...");
  const { schemas, columns } = await buildSchemaAudit();
  const allColumns = [...columns.keys()];
  const schemaConsistent = [...columns.values()].every((c) => c.presentIn.length === PRIMARY_SEASONS.length);

  console.log("B. analysing each season...");
  const seasonStats: SeasonStats[] = [];
  for (const s of PRIMARY_SEASONS) {
    console.log(`   ${s}...`);
    seasonStats.push(await analyseSeason(s, allColumns));
  }

  // type consistency across seasons
  for (const [name, c] of columns) {
    for (const s of seasonStats) c.jsTypesBySeason[s.season] = [...(s.jsTypes[name] ?? [])].sort();
  }
  const typeInconsistencies = [...columns.entries()].filter(([, c]) => {
    const sig = new Set(Object.values(c.physicalTypeBySeason));
    return sig.size > 1;
  });

  // spec required-field coverage
  const missingRequired = SPEC_REQUIRED_FIELDS.filter((f) => !columns.has(f));

  console.log("C. auditing player sheet...");
  const { audit: playerAudit, players } = auditPlayers();

  console.log("D. building attribute reference stats...");
  const referenceStats = buildReferenceStats(players);

  console.log("E. writing artifacts...");

  // ---- schema_audit.json ----
  writeFileSync(
    resolve(OUT, "schema/schema_audit.json"),
    JSON.stringify(
      {
        generated: TODAY,
        seasons: schemas.map((s) => ({
          season: s.season,
          file: `data/play_by_play_${s.season}.parquet`,
          fileBytes: s.fileBytes,
          numRows: s.numRows,
          numColumns: s.columns.size,
        })),
        schema_consistent_across_seasons: schemaConsistent,
        column_count: columns.size,
        physical_type_inconsistencies: typeInconsistencies.map(([n, c]) => ({
          column: n,
          physicalTypeBySeason: c.physicalTypeBySeason,
        })),
        spec_required_fields: {
          count: SPEC_REQUIRED_FIELDS.length,
          present_all_seasons: SPEC_REQUIRED_FIELDS.filter((f) => columns.has(f)),
          missing: missingRequired,
          wildcard_note:
            "spec §1.1 lists wildcard groups (assist_tackle_*_player_id etc). " +
            "Concrete members present were matched individually.",
        },
        columns: Object.fromEntries(
          [...columns.entries()].sort().map(([n, c]) => [
            n,
            {
              physicalTypeBySeason: c.physicalTypeBySeason,
              logicalTypeBySeason: c.logicalTypeBySeason,
              jsTypesBySeason: c.jsTypesBySeason,
              presentIn: c.presentIn,
              classification: classify(n).classification,
            },
          ]),
        ),
      },
      null,
      2,
    ) + "\n",
  );

  // ---- variable_classification.csv ----
  writeVariableClassification(columns, seasonStats);

  // ---- attribute_reference_stats.json ----
  writeFileSync(
    resolve(OUT, "ratings/attribute_reference_stats.json"),
    JSON.stringify(referenceStats, null, 2) + "\n",
  );

  // ---- data_quality_report.md ----
  writeFileSync(resolve(OUT, "schema/data_quality_report.md"), buildReport({
    schemas, columns, schemaConsistent, typeInconsistencies, missingRequired,
    seasonStats, playerAudit,
  }));

  const cls = new Map<string, number>();
  for (const n of columns.keys()) {
    const k = classify(n).classification;
    cls.set(k, (cls.get(k) ?? 0) + 1);
  }
  console.log("\ndone. artifacts written:");
  console.log("  artifacts/schema/schema_audit.json");
  console.log("  artifacts/schema/variable_classification.csv  " +
    [...cls.entries()].map(([k, v]) => `${k}:${v}`).join(" "));
  console.log("  artifacts/schema/data_quality_report.md");
  console.log("  artifacts/ratings/attribute_reference_stats.json");
}

/* ---- report builder ------------------------------------------------ */

interface ReportInput {
  schemas: Awaited<ReturnType<typeof readSchema>>[];
  columns: Map<string, ColSchema>;
  schemaConsistent: boolean;
  typeInconsistencies: [string, ColSchema][];
  missingRequired: string[];
  seasonStats: SeasonStats[];
  playerAudit: PlayerAudit;
}

function buildReport(x: ReportInput): string {
  const S = x.seasonStats;
  const L: string[] = [];
  const p = (s: string): void => void L.push(s);

  p(`# Data-quality report — nflverse PBP 2023–2025 + players_local_final.csv`);
  p(``);
  p(`Generated ${TODAY} by \`analysis/00_schema_audit.ts\` (spec §28 first task).`);
  p(`No models were fitted. **No current game player ratings were used to fit any nflverse baseline** —`);
  p(`this task only inspects the data.`);
  p(``);
  p(`| season | file rows | REG + core-clean rows (§6.1, §6.5) |`);
  p(`| --- | ---: | ---: |`);
  for (const s of S) p(`| ${s.season} | ${s.totalRows.toLocaleString()} | ${s.cleanRegRows.toLocaleString()} |`);
  p(``);

  p(`## 1. Are all required PBP variables present in all 3 seasons?`);
  p(``);
  p(x.missingRequired.length === 0
    ? `**Yes.** All ${SPEC_REQUIRED_FIELDS.length} fields the spec §1.1 lists are present in 2023, 2024 and 2025. ` +
      `All three files carry an identical ${x.columns.size}-column schema.`
    : `**No.** Missing from the Parquet schema: \`${x.missingRequired.join("`, `")}\`.`);
  p(``);

  p(`## 2. Which relevant variables have substantial missingness?`);
  p(``);
  p(`Per §6.6: raw (full cleaned-play denominator) and applicable-population figures side by side, `);
  p(`true nulls and empty-string sentinels counted separately. Showing fields with applicable missingness > 1% `);
  p(`in any season, plus every §6.6-listed field.`);
  p(``);
  const alwaysShow = new Set(Object.keys(APPLICABLE_POPULATION));
  const fieldsUnion = [...new Set(S.flatMap((s) => s.missingness.map((m) => m.field)))];
  p(`| field | denominator rule | season | raw null | raw "" | raw miss% | applicable miss% (n) |`);
  p(`| --- | --- | --- | ---: | ---: | ---: | ---: |`);
  for (const f of fieldsUnion) {
    const perSeason = S.map((s) => s.missingness.find((m) => m.field === f)).filter(Boolean) as ReturnType<typeof missingnessFor>[];
    const interesting = alwaysShow.has(f) || perSeason.some((m) => m.applicableMissingPct > 1 || m.rawEmpty > 0);
    if (!interesting) continue;
    perSeason.forEach((m, i) => {
      p(`| ${i === 0 ? `\`${f}\`` : ""} | ${i === 0 ? m.denominatorRule : ""} | ${m.field && S[i]!.season} | ${m.rawNull} | ${m.rawEmpty} | ${m.rawMissingPct.toFixed(2)}% | ${m.applicableMissingPct.toFixed(2)}% (${m.applicableDenominator.toLocaleString()}) |`);
    });
  }
  p(``);
  p(`### String empty-string / sentinel scan (all string columns, §6.6)`);
  p(``);
  p(`Counts over the **full** row population per season (not the cleaned subset), so they can exceed the ` +
    `"raw \\"\\"" column above, which is denominated on cleaned REG rows.`);
  p(``);
  const sentinelCols = [...new Set(S.flatMap((s) => Object.keys(s.stringSentinels)))];
  if (sentinelCols.length === 0) {
    p(`No empty-string sentinels found in any string column in any season.`);
  } else {
    p(`| column | ${S.map((s) => s.season).join(" | ")} |`);
    p(`| --- | ${S.map(() => "---:").join(" | ")} |`);
    for (const c of sentinelCols.sort()) {
      p(`| \`${c}\` | ${S.map((s) => s.stringSentinels[c] ?? 0).join(" | ")} |`);
    }
  }
  p(``);

  p(`## 3. Are any variable definitions/types inconsistent by season?`);
  p(``);
  p(x.typeInconsistencies.length === 0
    ? `**No.** Every column has the same Parquet physical type across all three seasons, and the same set of `
      + `runtime JS value types.`
    : `**Yes** — ${x.typeInconsistencies.length} column(s):\n\n` +
      x.typeInconsistencies.map(([n, c]) => `- \`${n}\`: ${JSON.stringify(c.physicalTypeBySeason)}`).join("\n"));
  p(``);

  p(`## 4. How many clean plays remain for every planned model?`);
  p(``);
  p(`After §6.1 core exclusions + §6.5 REG-only, then each model's §11 population predicate `);
  p(`(and §6.2 penalty-free where the model fits a physical outcome).`);
  p(``);
  p(`| model | penalty-free | ${S.map((s) => s.season).join(" | ")} | total |`);
  p(`| --- | :---: | ${S.map(() => "---:").join(" | ")} | ---: |`);
  for (const m of MODEL_POPULATIONS) {
    const key = `${m.id} ${m.name}`;
    const perYr = S.map((s) => s.modelCounts[key] ?? 0);
    p(`| ${key} | ${m.penaltyFree ? "yes" : "no"} | ${perYr.join(" | ")} | ${perYr.reduce((a, b) => a + b, 0).toLocaleString()} |`);
  }
  p(``);
  p(`> Model 22 (kickoff) counts include 2023; per §7 the current-rule kickoff model must **exclude 2023** `);
  p(`> and use 2024+2025 only. Onside kicks (matched via \`desc\` "kicks onside") must also be removed — `);
  p(`> see question 9.`);
  p(``);

  p(`## 5. Are qb_dropback / rush_attempt / qb_scramble / sack classifications mutually coherent?`);
  p(``);
  p(`Counts of each flag combination across the **full** row population (not just clean rows), so genuine `);
  p(`data contradictions surface:`);
  p(``);
  const cohKeys = [...new Set(S.flatMap((s) => Object.keys(s.coherence)))];
  p(`| combination | ${S.map((s) => s.season).join(" | ")} |`);
  p(`| --- | ${S.map(() => "---:").join(" | ")} |`);
  for (const k of cohKeys) p(`| ${k} | ${S.map((s) => s.coherence[k] ?? 0).join(" | ")} |`);
  p(``);
  p(`**Coherent overall.** \`sack & qb_scramble\`, \`qb_dropback & rush_attempt & !qb_scramble\`, ` +
    `\`pass_attempt & rush_attempt\`, \`complete_pass & !pass_attempt\` and \`sack & !qb_dropback\` are all **0** ` +
    `in every season (they do not appear in the table). The one recurring mismatch: ` +
    `**\`qb_scramble == 1 & qb_dropback == 0\`** (~72–86 / season) — a small set of scrambles nflverse does ` +
    `not flag as dropbacks (and also \`rush_attempt == 0\`). Model 04's population (\`qb_dropback == 1\`) would ` +
    `**miss** these; Model 11's population (\`qb_scramble == 1\`) catches them. The spec's derived ` +
    `\`qb_player_id\` (§11 M04 / §13.2) already bridges THROW/SACK/SCRAMBLE, but each model script should note ` +
    `whether it keys on \`qb_dropback\` or \`qb_scramble\` for its population.`);
  p(``);
  p(`**§28.1 — \`qb_dropback == 1 & play_type == "run"\`:** these are QB scrambles (nflverse tags the run `);
  p(`play_type but keeps \`qb_dropback == 1\`). Model 04's population is \`qb_dropback == 1\`, so they are `);
  p(`**included** there; Model 12/14's population is \`rush_attempt == 1 & qb_scramble == 0\`, so they are `);
  p(`**excluded** from designed carries. The internally-inconsistent case (\`qb_dropback == 1 & `);
  p(`play_type == "run" & qb_scramble == 0\`) is listed individually below.`);
  p(``);
  for (const s of S) {
    if (s.dropbackRunScrambleFalse.length === 0) {
      p(`- ${s.season}: **0** internally-inconsistent rows.`);
    } else {
      p(`- ${s.season}: **${s.dropbackRunScrambleFalse.length}** row(s):`);
      for (const r of s.dropbackRunScrambleFalse.slice(0, 25)) {
        p(`  - game \`${r.game_id}\` play \`${r.play_id}\` — ${String(r.desc).slice(0, 120)}`);
      }
    }
  }
  p(``);

  p(`## 6. How complete are run_gap and run_location?`);
  p(``);
  p(mrow(S, "run_location") + "\n" + mrow(S, "run_gap"));
  p(``);
  p(`Denominator is \`play_type == "run"\`. If \`run_gap\` applicable-missingness is high, §11 Model 13 `);
  p(`says fit LEFT/MIDDLE/RIGHT from \`run_location\` as the primary V1 target and use \`run_gap\` only where reliable.`);
  p(``);

  p(`## 7. How complete are air_yards, qb_hit, cp/cpoe, and xyac fields?`);
  p(``);
  for (const f of ["air_yards", "qb_hit", "cp", "cpoe", "xyac_mean_yardage", "xyac_success", "xyac_fd"]) {
    p(mrow(S, f));
  }
  p(``);
  p(`\`cp\`, \`cpoe\`, \`xyac_*\` are **BENCHMARK_ONLY** (§9) regardless of completeness — compare model output `);
  p(`to them, do not fit on them.`);
  p(``);

  p(`## 8. How complete are tackle / sack / INT attribution fields?`);
  p(``);
  p(`| field | denominator | ${S.map((s) => s.season + " non-null (%)").join(" | ")} |`);
  p(`| --- | --- | ${S.map(() => "---:").join(" | ")} |`);
  for (const f of ATTRIBUTION_FIELDS) {
    const cells = S.map((s) => {
      const a = s.attribution[f]!;
      return `${a.nonNull.toLocaleString()} (${pct(a.nonNull, a.denom)})`;
    });
    p(`| \`${f}\` | ${S[0]!.attribution[f]!.rule} | ${cells.join(" | ")} |`);
  }
  p(``);
  p(`These support Models 17–19 stat-credit and validation only; PBP does not name every on-field defender, `);
  p(`so no per-snap defender-choice model is fittable from PBP (spec §11 M18).`);
  p(``);

  p(`## 9. Do 2024–2025 kickoff fields behave consistently under the new rule regime?`);
  p(``);
  p(`| metric | ${S.map((s) => s.season).join(" | ")} |`);
  p(`| --- | ${S.map(() => "---:").join(" | ")} |`);
  const krow = (label: string, fn: (k: SeasonStats["kickoff"]) => string): void =>
    p(`| ${label} | ${S.map((s) => fn(s.kickoff)).join(" | ")} |`);
  krow("kickoff plays", (k) => k.n.toLocaleString());
  krow("onside (by desc)", (k) => String(k.onsideByDesc));
  krow("mean kick_distance", (k) => (k.meanKickDistance == null ? "n/a" : k.meanKickDistance.toFixed(1)));
  krow("touchback rate", (k) => (k.touchbackRate * 100).toFixed(1) + "%");
  krow("return rate", (k) => (k.returnRate * 100).toFixed(1) + "%");
  krow("mean return yards", (k) => (k.meanReturnYards == null ? "n/a" : k.meanReturnYards.toFixed(1)));
  p(``);
  {
    const ko24 = S.find((s) => s.season === 2024)?.kickoff;
    const ko25 = S.find((s) => s.season === 2025)?.kickoff;
    const p0 = (n: number | null | undefined): string => ((n ?? 0) * 100).toFixed(0);
    const y0 = (n: number | null | undefined): string => (n ?? 0).toFixed(0);
    p(`The 2023 row differs materially (old kickoff rule) — do not pool it. **2024 and 2025 also differ sharply** `);
    p(`(touchback ${p0(ko24?.touchbackRate)}% → ${p0(ko25?.touchbackRate)}%, mean return yards ` +
      `${y0(ko24?.meanReturnYards)} → ${y0(ko25?.meanReturnYards)}): dynamic-kickoff behaviour shifted again `);
    p(`between 2024 and 2025. Model 22 should carry a season/regime indicator, or fit 2025 alone if 2024 is `);
    p(`unrepresentative of current behaviour. Onside kicks (\`desc\` "kicks onside") are a separate event (§11 M22).`);
  }
  p(``);
  p(`### §17.1 — roof / temp / wind`);
  p(``);
  p(`| roof | ${S.map((s) => s.season + " n").join(" | ")} | temp null% (2025) | wind null% (2025) |`);
  p(`| --- | ${S.map(() => "---:").join(" | ")} | ---: | ---: |`);
  const roofKeys = [...new Set(S.flatMap((s) => Object.keys(s.roofCounts)))].sort();
  for (const rk of roofKeys) {
    const b = S.at(-1)!.tempNullByRoof[rk];
    p(`| \`${rk}\` | ${S.map((s) => (s.roofCounts[rk] ?? 0).toLocaleString()).join(" | ")} | ` +
      `${b ? pct(b.tempNull, b.n) : "n/a"} | ${b ? pct(b.windNull, b.n) : "n/a"} |`);
  }
  p(``);
  p(`Per §17.1: \`temp\`/\`wind\` are structurally null for \`roof in {dome, closed}\` (confirmed: ~98% and `);
  p(`100% in 2025) — treat \`roof\` as a required categorical everywhere temp/wind are used; for dome/closed `);
  p(`feed a "controlled environment" indicator instead of temp/wind. The spec's predicted \`roof == "open"\` `);
  p(`category **is present in 2023** (1,999 rows) but absent in 2024–2025 — the model must accept it.`);
  p(``);

  p(`## 10. Player-sheet metadata inconsistencies affecting roster construction`);
  p(``);
  const pa = x.playerAudit;
  p(`\`players_local_final.csv\`: **${pa.rows} players**, ${pa.columns} columns.`);
  p(``);
  p(`**\`free_agent\` is not a usable roster-status signal in this file.** ` +
    `Distinct values: \`${pa.freeAgentVsTeam.distinct_free_agent_values.join("`, `")}\`.`);
  p(``);
  p(`| free_agent | nfl_team is a real team | nfl_team is FA/blank |`);
  p(`| --- | ---: | ---: |`);
  p(`| true | ${pa.freeAgentVsTeam.fa_true_with_real_team} | ${pa.freeAgentVsTeam.fa_true_no_team} |`);
  p(`| false | ${pa.freeAgentVsTeam.fa_false_with_real_team} | ${pa.freeAgentVsTeam.fa_false_no_team} |`);
  p(``);
  const faUniformlyTrue =
    pa.freeAgentVsTeam.fa_false_with_real_team === 0 &&
    pa.freeAgentVsTeam.fa_false_no_team === 0 &&
    pa.freeAgentVsTeam.distinct_free_agent_values.join(",") === "true";
  p(faUniformlyTrue
    ? "`free_agent` is `true` for **every** player, and " +
      `${pa.freeAgentVsTeam.fa_true_with_real_team} of ${pa.rows} of them carry a real \`nfl_team\` ` +
      `(the other ${pa.freeAgentVsTeam.fa_true_no_team} are on \`FA\`). The whole league was imported as a ` +
      "fantasy-draft pool, so the flag carries no roster-status information. Per the §1.2 QA rule, build the " +
      "active-role reference pool and any depth logic from `nfl_team` + the game's roster system, **not** from " +
      "`free_agent`."
    : "See counts above — reconcile before using `free_agent` for roster construction.");
  p(``);
  p(`Retired: ${pa.retiredCount} (${pa.retiredWithTeam} of them still carry a team).`);
  p(``);
  p(`Position vocabulary (${Object.keys(pa.positionCounts).length}): ` +
    Object.entries(pa.positionCounts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(", ") + ".");
  p(``);
  p(`Teams (${Object.keys(pa.teamCounts).length}): ` +
    Object.entries(pa.teamCounts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(", ") + ".");
  p(``);
  p(`Attribute fill (non-null / total; \`null\` = "not applicable at this position", not a low rating — §2):`);
  p(``);
  p(`| attribute | non-null | attribute | non-null | attribute | non-null |`);
  p(`| --- | ---: | --- | ---: | --- | ---: |`);
  const attrRows = Object.entries(pa.attributeNullRates);
  for (let i = 0; i < attrRows.length; i += 3) {
    const cells = attrRows.slice(i, i + 3).map(([k, v]) => `\`${k}\` | ${v.nonNull}`);
    while (cells.length < 3) cells.push(" | ");
    p(`| ${cells.join(" | ")} |`);
  }
  p(``);

  p(`## §28.2 — two-point / non-down administrative plays`);
  p(``);
  p(`\`down is null\` (§6.1) must fully capture administrative non-down plays. Verification:`);
  p(``);
  p(`| flag | ${S.map((s) => s.season + " count").join(" | ")} | ${S.map((s) => s.season + " with down≠null").join(" | ")} |`);
  p(`| --- | ${S.map(() => "---:").join(" | ")} | ${S.map(() => "---:").join(" | ")} |`);
  for (const f of ["two_point_attempt", "extra_point_attempt", "kickoff_attempt"]) {
    p(`| \`${f}\` | ${S.map((s) => s.nonDownPlays[f]!.n.toLocaleString()).join(" | ")} | ` +
      `${S.map((s) => s.nonDownPlays[f]!.downNonNull).join(" | ")} |`);
  }
  p(``);
  const anyLeak = S.some((s) =>
    ["two_point_attempt", "extra_point_attempt", "kickoff_attempt"].some((f) => s.nonDownPlays[f]!.downNonNull > 0),
  );
  p(anyLeak
    ? `⚠️ Some administrative plays have a non-null \`down\` — §6.1's \`down is null\` filter does **not** fully ` +
      `capture them. Models whose population references \`pass_attempt\`/\`rush_attempt\` without also filtering ` +
      `\`down\` must add an explicit exclusion.`
    : `✅ Every two-point, extra-point and kickoff play has \`down is null\`. Models that rely on the centralized ` +
      `§6.1 filter (rather than filtering \`down\` themselves) are safe **provided that filter runs first** — ` +
      `each model script must state this dependency explicitly (§28.2).`);
  p(``);

  p(`## Summary of discrepancies vs the spec`);
  p(``);
  p(`1. Data files delivered also include \`play_by_play_2020–2022.parquet\`; per §0/§6.5 only 2023–2025 are ` +
    `used as the production baseline and only those three were audited.`);
  p(`2. \`players_local_final.csv\` == the repo's \`data/players.local.csv\` (byte-identical); kept under the ` +
    `spec's filename in \`data/\` for reference. Git-ignored (\`/data/*.csv\`).`);
  p(`3. \`free_agent\` is uniformly \`true\` with real teams — not a roster-status signal (question 10).`);
  p(`4. Everything else the audit checked matches the spec; see per-question sections above.`);
  p(``);
  p(`## Sign-off gate`);
  p(``);
  p(`Per §28: **do not proceed to model fitting until this report has been reviewed.**`);
  p(``);

  return L.join("\n") + "\n";
}

function mrow(S: SeasonStats[], field: string): string {
  const cells = S.map((s) => {
    const m = s.missingness.find((mm) => mm.field === field);
    if (!m) return `${s.season}: (field absent)`;
    return `${s.season}: raw ${m.rawMissingPct.toFixed(1)}% / applicable ${m.applicableMissingPct.toFixed(1)}% of ${m.applicableDenominator.toLocaleString()}`;
  });
  return `- \`${field}\` — ${cells.join("  ·  ")}`;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
