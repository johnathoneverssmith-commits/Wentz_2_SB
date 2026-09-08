/**
 * Madden-style CSV -> `Player[]` importer.
 *
 * A bootstrap only. It maps a Madden-shaped roster/ratings export onto our
 * v0 schema so Phase 1 has a full pool to work with. The output is written to
 * `data/players.local.json`, which is git-ignored on purpose — this is EA's
 * ratings data and does not belong in the repo (see docs/decisions.md, OQ-1).
 * The real answer is a generate-from-public-stats model built once Phase 1
 * has settled the attribute vocabulary.
 *
 * Usage:
 *   npm run import:madden -- <input.csv> [output.json] [options]
 *
 * Options:
 *   --season <year>      season year, used with a rookieYear column to derive
 *                        years_pro when there is no explicit column
 *   --start-id <n>       first sequential id number (default 1)
 *   --id-col <name>      column holding a stable source id; when present, ids
 *                        become p_<zero-padded source id> instead of sequential
 *   --default-team <ab>  team to use when the row has none (default "FA")
 *
 * The importer is intentionally forgiving about column names: headers are
 * matched case- and punctuation-insensitively, and both Madden's long names
 * ("Throw Power Rating") and three-letter codes ("THP") are recognised.
 * Unknown columns are ignored; attributes not in this position's schema
 * subset are dropped.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import {
  GENERAL_ATTRIBUTE_KEYS,
  POSITION_ATTRIBUTE_KEYS,
  PlayerPoolSchema,
  PlayerSchema,
  POSITIONS,
  type Player,
  type Position,
} from "../schema/player.js";
import { LOCAL_POOL_PATH } from "./players.js";

/* ------------------------------------------------------------------ */
/* Mapping tables                                                       */
/* ------------------------------------------------------------------ */

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Madden position codes -> our schema positions. */
export const MADDEN_POSITION_MAP: Readonly<Record<string, Position>> = {
  QB: "QB",
  HB: "RB",
  RB: "RB",
  FB: "RB",
  WR: "WR",
  TE: "TE",
  LT: "OT",
  RT: "OT",
  OT: "OT",
  T: "OT",
  LG: "OG",
  RG: "OG",
  OG: "OG",
  G: "OG",
  C: "C",
  LE: "EDGE",
  RE: "EDGE",
  DE: "EDGE",
  EDGE: "EDGE",
  DT: "DT",
  NT: "DT",
  LOLB: "LB",
  ROLB: "LB",
  MLB: "LB",
  ILB: "LB",
  OLB: "LB",
  LB: "LB",
  CB: "CB",
  DB: "CB",
  FS: "S",
  SS: "S",
  S: "S",
  K: "K",
  PK: "K",
  P: "P",
};

/** Non-attribute fields we pull off a row, keyed by normalised alias. */
const FIELD_ALIASES: Readonly<Record<string, string>> = {
  name: "name",
  fullname: "name",
  playername: "name",
  fullnameforsearch: "name",
  firstname: "firstName",
  first: "firstName",
  lastname: "lastName",
  last: "lastName",
  position: "position",
  pos: "position",
  team: "team",
  teamname: "team",
  teamabbr: "team",
  teamabbreviation: "team",
  age: "age",
  yearspro: "yearsPro",
  yearsprofessional: "yearsPro",
  experience: "yearsPro",
  exp: "yearsPro",
  rookieyear: "rookieYear",
  overall: "overall",
  overallrating: "overall",
  ovr: "overall",
  playerbestovr: "overall",
};

/** Madden rating columns -> our attribute keys (long name + 3-letter code). */
const ATTR_ALIASES: Readonly<Record<string, string>> = {
  // general
  speed: "speed", spd: "speed", speedrating: "speed",
  acceleration: "acceleration", acc: "acceleration", accelerationrating: "acceleration",
  strength: "strength", str: "strength", strengthrating: "strength",
  agility: "agility", agi: "agility", agilityrating: "agility",
  awareness: "awareness", awr: "awareness", awarenessrating: "awareness",
  injury: "injury", inj: "injury", injuryrating: "injury",
  stamina: "stamina", sta: "stamina", staminarating: "stamina",
  toughness: "toughness", tgh: "toughness", toughnessrating: "toughness",
  jumping: "jumping", jmp: "jumping", jumpingrating: "jumping",
  // QB
  throwpower: "throw_power", thp: "throw_power", throwpowerrating: "throw_power",
  throwaccuracyshort: "throw_accuracy_short", tas: "throw_accuracy_short",
  throwaccuracyshortrating: "throw_accuracy_short",
  throwaccuracymid: "throw_accuracy_mid", tam: "throw_accuracy_mid",
  throwaccuracymidrating: "throw_accuracy_mid",
  throwaccuracydeep: "throw_accuracy_deep", tad: "throw_accuracy_deep",
  throwaccuracydeeprating: "throw_accuracy_deep",
  playaction: "play_action", pac: "play_action", playactionrating: "play_action",
  breaksack: "break_sack", bsk: "break_sack", breaksackrating: "break_sack",
  throwonrun: "scrambling", tor: "scrambling", throwontherunrating: "scrambling",
  // RB
  carrying: "carrying", car: "carrying", carryingrating: "carrying",
  breaktackle: "break_tackle", btk: "break_tackle", breaktacklerating: "break_tackle",
  ballcarriervision: "ball_carrier_vision", bcv: "ball_carrier_vision",
  jukemove: "juke_move", jkm: "juke_move", jukemoverating: "juke_move",
  stiffarm: "stiff_arm", sfa: "stiff_arm", stiffarmrating: "stiff_arm",
  spinmove: "spin_move", spm: "spin_move", spinmoverating: "spin_move",
  // WR / TE
  catching: "catching", cth: "catching", catchingrating: "catching",
  shortrouterunning: "route_running_short", srr: "route_running_short",
  shortrouterunningrating: "route_running_short",
  mediumrouterunning: "route_running_mid", mrr: "route_running_mid",
  mediumrouterunningrating: "route_running_mid",
  deeprouterunning: "route_running_deep", drr: "route_running_deep",
  deeprouterunningrating: "route_running_deep",
  release: "release", rls: "release", releaserating: "release",
  catchintraffic: "catch_in_traffic", cit: "catch_in_traffic",
  spectacularcatch: "spectacular_catch", spc: "spectacular_catch",
  // OL
  passblock: "pass_block", pbk: "pass_block", passblockrating: "pass_block",
  runblock: "run_block", rbk: "run_block", runblockrating: "run_block",
  passblockpower: "pass_block_power", pbp: "pass_block_power",
  passblockfinesse: "pass_block_finesse", pbf: "pass_block_finesse",
  // DL / EDGE
  powermoves: "power_moves", pmv: "power_moves", powermovesrating: "power_moves",
  finessemoves: "finesse_moves", fmv: "finesse_moves", finessemovesrating: "finesse_moves",
  blockshedding: "block_shedding", bsh: "block_shedding", blocksheddingrating: "block_shedding",
  pursuit: "pursuit", pur: "pursuit", pursuitrating: "pursuit",
  // LB / DB / shared tackling + coverage
  tackle: "tackle", tak: "tackle", tacklerating: "tackle",
  playrecognition: "play_recognition", prc: "play_recognition",
  playrecognitionrating: "play_recognition",
  mancoverage: "man_coverage", mcv: "man_coverage", mancoveragerating: "man_coverage",
  zonecoverage: "zone_coverage", zcv: "zone_coverage", zonecoveragerating: "zone_coverage",
  press: "press", prs: "press", pressrating: "press",
  hitpower: "hit_power", pow: "hit_power", hitpowerrating: "hit_power",
  // K / P
  kickpower: "kick_power", kpw: "kick_power", kickpowerrating: "kick_power",
  kickaccuracy: "kick_accuracy", kac: "kick_accuracy", kickaccuracyrating: "kick_accuracy",
  puntpower: "punt_power", puntpowerrating: "punt_power",
  puntaccuracy: "punt_accuracy", puntaccuracyrating: "punt_accuracy",
};

/**
 * Per-position age thresholds for the aging model. Placeholder values —
 * tracked as OQ-4 in docs/decisions.md, do not treat as final.
 */
export const AGING_CURVES: Readonly<Record<Position, { dev: number; decline: number }>> = {
  QB: { dev: 28, decline: 34 },
  RB: { dev: 24, decline: 28 },
  WR: { dev: 26, decline: 30 },
  TE: { dev: 26, decline: 31 },
  OT: { dev: 27, decline: 33 },
  OG: { dev: 27, decline: 33 },
  C: { dev: 27, decline: 33 },
  EDGE: { dev: 26, decline: 31 },
  DT: { dev: 27, decline: 31 },
  LB: { dev: 26, decline: 31 },
  CB: { dev: 25, decline: 30 },
  S: { dev: 26, decline: 31 },
  K: { dev: 30, decline: 40 },
  P: { dev: 30, decline: 40 },
};

const FREE_AGENT_TEAM_TOKENS = new Set(["", "fa", "freeagent", "none", "--", "-"]);

/* ------------------------------------------------------------------ */
/* CSV parsing                                                          */
/* ------------------------------------------------------------------ */

/** Minimal RFC-4180-ish CSV reader: quoted fields, "" escapes, CRLF or LF. */
export function parseCsv(text: string): Array<Record<string, string>> {
  const s = text.replace(/^﻿/, ""); // strip UTF-8 BOM
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  const endField = (): void => {
    row.push(field);
    field = "";
  };
  const endRow = (): void => {
    endField();
    rows.push(row);
    row = [];
  };

  for (let i = 0; i < s.length; i++) {
    const c = s.charAt(i);
    if (inQuotes) {
      if (c === '"') {
        if (s.charAt(i + 1) === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') inQuotes = true;
    else if (c === ",") endField();
    else if (c === "\n") endRow();
    else if (c === "\r") {
      if (s.charAt(i + 1) === "\n") i++;
      endRow();
    } else field += c;
  }
  if (field !== "" || row.length > 0) endRow();

  const headerRow = rows.shift();
  if (!headerRow) return [];
  const headers = headerRow.map((h) => h.trim());

  return rows
    .filter((r) => r.some((v) => v.trim() !== ""))
    .map((r) => {
      const obj: Record<string, string> = {};
      headers.forEach((h, idx) => {
        obj[h] = (r[idx] ?? "").trim();
      });
      return obj;
    });
}

/* ------------------------------------------------------------------ */
/* Conversion                                                           */
/* ------------------------------------------------------------------ */

export interface MaddenImportOptions {
  seasonYear?: number;
  startId?: number;
  idColumn?: string;
  defaultTeam?: string;
}

export interface MaddenImportResult {
  players: Player[];
  /** Non-fatal notes (e.g. dropped attributes, derived years_pro). */
  warnings: string[];
  /** Rows that could not be converted, with a reason. */
  skipped: Array<{ row: number; name: string; reason: string }>;
}

const toInt = (v: string | undefined): number | undefined => {
  if (v === undefined || v.trim() === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : undefined;
};

const clampRating = (n: number): number => Math.max(0, Math.min(99, n));

const normPos = (raw: string): string => raw.toUpperCase().replace(/[^A-Z]/g, "");

export function convertMaddenRows(
  rows: Array<Record<string, string>>,
  opts: MaddenImportOptions = {},
): MaddenImportResult {
  const warnings: string[] = [];
  const skipped: MaddenImportResult["skipped"] = [];
  const droppedAttrCount = new Map<string, number>();
  let yearsProDefaulted = 0;

  const idColNorm = opts.idColumn ? norm(opts.idColumn) : undefined;
  const defaultTeam = opts.defaultTeam ?? "FA";

  interface Draft {
    player: Omit<Player, "id">;
    sourceId: string | undefined;
    sortKey: number;
    name: string;
  }
  const drafts: Draft[] = [];

  rows.forEach((raw, index) => {
    const fields: Record<string, string> = {};
    const attrs: Record<string, number> = {};
    let sourceId: string | undefined;

    for (const [header, value] of Object.entries(raw)) {
      const key = norm(header);
      if (idColNorm && key === idColNorm) sourceId = value.trim();
      const field = FIELD_ALIASES[key];
      if (field !== undefined && value.trim() !== "") fields[field] = value.trim();
      const attr = ATTR_ALIASES[key];
      if (attr !== undefined) {
        const n = toInt(value);
        if (n !== undefined) attrs[attr] = clampRating(n);
      }
    }

    const name =
      fields.name ?? `${fields.firstName ?? ""} ${fields.lastName ?? ""}`.trim();
    const rowLabel = name || `row ${index + 2}`;

    if (!name) {
      skipped.push({ row: index + 2, name: rowLabel, reason: "no name" });
      return;
    }
    const rawPos = fields.position;
    if (!rawPos) {
      skipped.push({ row: index + 2, name: rowLabel, reason: "no position" });
      return;
    }
    const position = MADDEN_POSITION_MAP[normPos(rawPos)];
    if (!position) {
      skipped.push({
        row: index + 2,
        name: rowLabel,
        reason: `unmapped position: ${rawPos}`,
      });
      return;
    }
    const age = toInt(fields.age);
    if (age === undefined) {
      skipped.push({ row: index + 2, name: rowLabel, reason: "no age" });
      return;
    }
    const overall = toInt(fields.overall);
    if (overall === undefined) {
      skipped.push({ row: index + 2, name: rowLabel, reason: "no overall" });
      return;
    }

    // years_pro: explicit column, else derived from rookieYear + season, else 0.
    let yearsPro = toInt(fields.yearsPro);
    if (yearsPro === undefined) {
      const rookieYear = toInt(fields.rookieYear);
      if (rookieYear !== undefined && opts.seasonYear !== undefined) {
        yearsPro = Math.max(0, opts.seasonYear - rookieYear);
      } else {
        yearsPro = 0;
        yearsProDefaulted++;
      }
    }

    // Keep only attributes this position's schema subset defines.
    const allowed = new Set<string>([
      ...GENERAL_ATTRIBUTE_KEYS,
      ...POSITION_ATTRIBUTE_KEYS[position],
    ]);
    const attributes: Record<string, number> = {};
    for (const [k, v] of Object.entries(attrs)) {
      if (allowed.has(k)) attributes[k] = v;
      else droppedAttrCount.set(k, (droppedAttrCount.get(k) ?? 0) + 1);
    }

    let team = fields.team ?? defaultTeam;
    if (FREE_AGENT_TEAM_TOKENS.has(norm(team))) team = "FA";

    const curve = AGING_CURVES[position];

    drafts.push({
      name,
      sourceId: sourceId && sourceId !== "" ? sourceId : undefined,
      sortKey: overall,
      player: {
        name,
        position,
        age,
        nfl_team: team,
        years_pro: clampNonNeg(yearsPro),
        overall: clampRating(overall),
        attributes,
        scheme_tags: [], // not present in Madden exports
        dev_age_threshold: curve.dev,
        decline_age_threshold: curve.decline,
        injury_history: [],
        contract: null,
        free_agent: true, // whole import is a fantasy-draft pool
        injury_status: null,
        retired: false,
      },
    });
  });

  // Deterministic order: best overall first, then name.
  drafts.sort((a, b) => b.sortKey - a.sortKey || a.name.localeCompare(b.name));

  const usedIds = new Set<string>();
  const padId = (raw: string): string => `p_${raw.replace(/\D/g, "").padStart(5, "0")}`;
  let nextSeq = opts.startId ?? 1;
  const nextSequentialId = (): string => {
    let id = `p_${String(nextSeq).padStart(5, "0")}`;
    while (usedIds.has(id)) {
      nextSeq++;
      id = `p_${String(nextSeq).padStart(5, "0")}`;
    }
    nextSeq++;
    return id;
  };

  const players: Player[] = [];
  for (const d of drafts) {
    let id: string;
    if (d.sourceId !== undefined && /\d/.test(d.sourceId)) {
      id = padId(d.sourceId);
      if (usedIds.has(id)) {
        warnings.push(`${d.name}: duplicate source id ${d.sourceId}; assigned a sequential id`);
        id = nextSequentialId();
      }
    } else {
      id = nextSequentialId();
    }
    usedIds.add(id);

    const candidate = { id, ...d.player };
    const parsed = PlayerSchema.safeParse(candidate);
    if (!parsed.success) {
      skipped.push({
        row: -1,
        name: d.name,
        reason: `failed schema: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`,
      });
      continue;
    }
    players.push(parsed.data);
  }

  if (yearsProDefaulted > 0) {
    warnings.push(
      `defaulted years_pro to 0 for ${yearsProDefaulted} player(s) ` +
        `(no yearsPro/rookieYear column)`,
    );
  }
  if (droppedAttrCount.size > 0) {
    const names = [...droppedAttrCount.keys()].sort().join(", ");
    warnings.push(
      `dropped ${droppedAttrCount.size} off-position attribute column(s) ` +
        `not in the schema subset: ${names}`,
    );
  }

  return { players, warnings, skipped };
}

const clampNonNeg = (n: number): number => (n < 0 ? 0 : n);

export function importMaddenCsv(
  csvText: string,
  opts: MaddenImportOptions = {},
): MaddenImportResult {
  return convertMaddenRows(parseCsv(csvText), opts);
}

/* ------------------------------------------------------------------ */
/* CLI                                                                  */
/* ------------------------------------------------------------------ */

interface CliArgs {
  input: string;
  output: string;
  opts: MaddenImportOptions;
}

function parseCliArgs(argv: string[]): CliArgs {
  const positional: string[] = [];
  const opts: MaddenImportOptions = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? "";
    const takeValue = (): string => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`missing value for ${a}`);
      return v;
    };
    switch (a) {
      case "--season":
        opts.seasonYear = Number(takeValue());
        break;
      case "--start-id":
        opts.startId = Number(takeValue());
        break;
      case "--id-col":
        opts.idColumn = takeValue();
        break;
      case "--default-team":
        opts.defaultTeam = takeValue();
        break;
      default:
        if (a.startsWith("--")) throw new Error(`unknown option: ${a}`);
        positional.push(a);
    }
  }
  const input = positional[0];
  if (input === undefined) {
    throw new Error(
      "usage: npm run import:madden -- <input.csv> [output.json] " +
        "[--season Y] [--start-id N] [--id-col NAME] [--default-team AB]",
    );
  }
  return {
    input: resolve(input),
    output: positional[1] ? resolve(positional[1]) : LOCAL_POOL_PATH,
    opts,
  };
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  try {
    const { input, output, opts } = parseCliArgs(process.argv.slice(2));
    const csvText = readFileSync(input, "utf8");
    const { players, warnings, skipped } = importMaddenCsv(csvText, opts);

    // Final guard: the whole file must satisfy the pool schema.
    PlayerPoolSchema.parse(players);
    writeFileSync(output, `${JSON.stringify(players, null, 2)}\n`, "utf8");

    const byPos = new Map<Position, number>();
    for (const p of players) byPos.set(p.position, (byPos.get(p.position) ?? 0) + 1);
    const breakdown = POSITIONS.filter((p) => byPos.has(p))
      .map((p) => `${p}:${byPos.get(p)}`)
      .join(" ");

    console.log(`wrote ${players.length} players -> ${output}`);
    console.log(`  ${breakdown}`);
    if (skipped.length > 0) {
      console.log(`  skipped ${skipped.length} row(s):`);
      const byReason = new Map<string, number>();
      for (const s of skipped) byReason.set(s.reason, (byReason.get(s.reason) ?? 0) + 1);
      for (const [reason, count] of [...byReason.entries()].sort()) {
        console.log(`    ${reason} — ${count} row(s)`);
      }
    }
    if (warnings.length > 0) {
      const shown = warnings.slice(0, 15);
      console.log(`  ${warnings.length} warning(s):`);
      for (const w of shown) console.log(`    ${w}`);
      if (warnings.length > shown.length) {
        console.log(`    ...and ${warnings.length - shown.length} more`);
      }
    }
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  }
}
