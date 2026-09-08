/**
 * Lossless CSV <-> player-pool conversion.
 *
 * `poolToCsv` writes one row per player with a column for every attribute seen
 * anywhere in the pool, so the whole pool is editable in a spreadsheet.
 * `csvToPool` reads it back, validates every row against the schema, and
 * preserves ids so edits map to the same players.
 *
 * Round-trips exactly for the pools we generate. Structural fields that a
 * ratings sheet has no natural column for (`contract`, `injury_history`,
 * `injury_status`) ride along as JSON in trailing `*_json` columns; for a
 * generated pool they are just `null` / `[]` and can be ignored while editing.
 *
 * CLI:
 *   npm run pool:export-csv -- [in.json] [out.csv]
 *   npm run pool:import-csv -- <in.csv> [out.json]
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { basename, dirname, resolve } from "node:path";

import {
  GENERAL_ATTRIBUTE_KEYS,
  PlayerPoolSchema,
  PlayerSchema,
  type Player,
} from "../schema/player.js";
import { parseCsv } from "./csv.js";
import { LOCAL_POOL_PATH, loadPlayerPool, resolveDefaultPoolPath } from "./players.js";

const SCALAR_COLUMNS = [
  "id",
  "name",
  "position",
  "age",
  "nfl_team",
  "years_pro",
  "overall",
  "dev_age_threshold",
  "decline_age_threshold",
  "free_agent",
  "retired",
  "scheme_tags",
] as const;

const STRUCT_COLUMNS = ["contract_json", "injury_history_json", "injury_status_json"] as const;

/** Columns that are not player attributes. */
const RESERVED_COLUMNS: ReadonlySet<string> = new Set<string>([
  ...SCALAR_COLUMNS,
  ...STRUCT_COLUMNS,
]);

/* --- write ----------------------------------------------------------- */

const csvCell = (v: string | number | boolean): string => {
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Attribute column order: known general attrs first, then the rest sorted. */
export function attributeColumns(players: readonly Player[]): string[] {
  const seen = new Set<string>();
  for (const p of players) for (const k of Object.keys(p.attributes)) seen.add(k);
  const general = GENERAL_ATTRIBUTE_KEYS.filter((k) => seen.has(k));
  const generalSet = new Set<string>(general);
  const rest = [...seen].filter((k) => !generalSet.has(k)).sort();
  return [...general, ...rest];
}

export function poolToCsv(players: readonly Player[]): string {
  const attrCols = attributeColumns(players);
  const header = [...SCALAR_COLUMNS, ...attrCols, ...STRUCT_COLUMNS];
  const lines = [header.map(csvCell).join(",")];

  for (const p of players) {
    const row: Array<string | number | boolean> = [
      p.id,
      p.name,
      p.position,
      p.age,
      p.nfl_team,
      p.years_pro,
      p.overall,
      p.dev_age_threshold,
      p.decline_age_threshold,
      p.free_agent,
      p.retired,
      p.scheme_tags.join("|"),
      ...attrCols.map((k) => p.attributes[k] ?? ""),
      JSON.stringify(p.contract),
      JSON.stringify(p.injury_history),
      JSON.stringify(p.injury_status),
    ];
    lines.push(row.map(csvCell).join(","));
  }
  return `${lines.join("\n")}\n`;
}

/* --- read ----------------------------------------------------------- */

export interface CsvToPoolResult {
  players: Player[];
  warnings: string[];
}

const clampRating = (
  n: number,
  col: string,
  rowNum: number,
  warnings: string[],
): number => {
  const c = Math.max(0, Math.min(99, Math.round(n)));
  if (Number.isFinite(n) && c !== n) warnings.push(`row ${rowNum}: ${col} ${n} clamped to ${c}`);
  return c;
};

export function csvToPool(csvText: string): CsvToPoolResult {
  const rows = parseCsv(csvText);
  const warnings: string[] = [];
  const players: Player[] = [];
  const seenIds = new Set<string>();

  rows.forEach((row, i) => {
    const rowNum = i + 2; // header is row 1
    const cell = (col: string): string => (row[col] ?? "").trim();
    const num = (col: string): number => Number(cell(col));
    const bool = (col: string): boolean => /^(true|1|yes)$/i.test(cell(col));
    const json = (col: string, dflt: unknown): unknown => {
      const v = cell(col);
      if (v === "") return dflt;
      try {
        return JSON.parse(v) as unknown;
      } catch {
        warnings.push(`row ${rowNum}: unparseable ${col}; using default`);
        return dflt;
      }
    };

    const attributes: Record<string, number> = {};
    for (const [col, raw] of Object.entries(row)) {
      if (RESERVED_COLUMNS.has(col)) continue;
      const v = raw.trim();
      if (v === "") continue; // blank cell -> attribute omitted
      const n = Number(v);
      if (!Number.isFinite(n)) {
        warnings.push(`row ${rowNum}: non-numeric ${col}="${raw}", skipped`);
        continue;
      }
      attributes[col] = clampRating(n, col, rowNum, warnings);
    }

    const candidate = {
      id: cell("id"),
      name: cell("name"),
      position: cell("position"),
      age: num("age"),
      nfl_team: cell("nfl_team"),
      years_pro: num("years_pro"),
      overall: clampRating(num("overall"), "overall", rowNum, warnings),
      attributes,
      scheme_tags: cell("scheme_tags")
        .split("|")
        .map((s) => s.trim())
        .filter(Boolean),
      dev_age_threshold: num("dev_age_threshold"),
      decline_age_threshold: num("decline_age_threshold"),
      injury_history: json("injury_history_json", []),
      contract: json("contract_json", null),
      free_agent: bool("free_agent"),
      injury_status: json("injury_status_json", null),
      retired: bool("retired"),
    };

    const parsed = PlayerSchema.safeParse(candidate);
    if (!parsed.success) {
      const detail = parsed.error.issues
        .map((issue) => `${issue.path.join(".")} ${issue.message}`)
        .join("; ");
      throw new Error(`row ${rowNum} (${candidate.name || candidate.id || "?"}): ${detail}`);
    }
    if (seenIds.has(parsed.data.id)) {
      throw new Error(`row ${rowNum}: duplicate id ${parsed.data.id}`);
    }
    seenIds.add(parsed.data.id);
    players.push(parsed.data);
  });

  players.sort((a, b) => b.overall - a.overall || a.name.localeCompare(b.name));
  return { players, warnings };
}

/* --- CLI ----------------------------------------------------------- */

const invokedDirectly =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  const [sub, argA, argB] = process.argv.slice(2);
  try {
    if (sub === "export") {
      const inPath = argA ? resolve(argA) : resolveDefaultPoolPath();
      const outPath = argB
        ? resolve(argB)
        : resolve(dirname(inPath), basename(inPath).replace(/\.json$/i, "") + ".csv");
      const pool = loadPlayerPool(inPath);
      writeFileSync(outPath, poolToCsv(pool), "utf8");
      console.log(`exported ${pool.length} players -> ${outPath}`);
    } else if (sub === "import") {
      if (!argA) throw new Error("usage: pool:import-csv -- <in.csv> [out.json]");
      const outPath = argB ? resolve(argB) : LOCAL_POOL_PATH;
      const { players, warnings } = csvToPool(readFileSync(resolve(argA), "utf8"));
      PlayerPoolSchema.parse(players);
      writeFileSync(outPath, `${JSON.stringify(players, null, 2)}\n`, "utf8");
      console.log(`imported ${players.length} players -> ${outPath}`);
      for (const w of warnings.slice(0, 20)) console.log(`  ${w}`);
      if (warnings.length > 20) console.log(`  ...and ${warnings.length - 20} more`);
    } else {
      throw new Error(`unknown subcommand "${sub ?? ""}" — use "export" or "import"`);
    }
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  }
}
