/**
 * Generate a full player pool from open NFL roster data.
 *
 * Pulls a season roster from nflverse (openly-licensed: real names, teams,
 * positions, ages, experience — all plain facts) and runs each player through
 * the heuristic ratings model in `src/model/ratings.ts` to produce a full,
 * schema-valid pool written to `data/players.local.json`.
 *
 * This is the OQ-1 answer (docs/decisions.md): the pool is *ours*, generated,
 * reproducible, and contains no third-party ratings data. Ratings are crude v0
 * and get calibrated once the Phase 1 sim engine exists.
 *
 * Usage:
 *   npm run generate:pool -- [options]
 *
 * Options:
 *   --season <year>     roster season to pull (default: current year, falls
 *                       back to the previous year if that file 404s)
 *   --out <path>        output file (default: data/players.local.json)
 *   --seed <string>     reroll seed for the ratings model (default "v0")
 *   --practice-squad    include practice-squad players (status DEV)
 *   --no-ir             exclude injured-reserve players (status RES)
 *
 * Data source: https://github.com/nflverse/nflverse-data (rosters release).
 */

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import { PlayerPoolSchema, PlayerSchema, POSITIONS, type Player, type Position } from "../schema/player.js";
import { parseCsv } from "./csv.js";
import { poolToCsv } from "./pool-csv.js";
import { LOCAL_POOL_PATH } from "./players.js";
import { buildPlayer, type PlayerSeed } from "../model/ratings.js";

const ROSTER_URL = (season: number): string =>
  `https://github.com/nflverse/nflverse-data/releases/download/rosters/roster_${season}.csv`;

const SNAP_COUNTS_URL = (season: number): string =>
  `https://github.com/nflverse/nflverse-data/releases/download/snap_counts/snap_counts_${season}.csv`;

/* --- roster row -> PlayerSeed ------------------------------------- */

const NFLVERSE_POSITION_MAP: Readonly<Record<string, Position>> = {
  QB: "QB",
  RB: "RB",
  HB: "RB",
  FB: "RB",
  WR: "WR",
  TE: "TE",
  T: "OT",
  OT: "OT",
  LT: "OT",
  RT: "OT",
  LEFT_TACKLE: "OT",
  RIGHT_TACKLE: "OT",
  G: "OG",
  OG: "OG",
  LG: "OG",
  RG: "OG",
  LEFT_GUARD: "OG",
  RIGHT_GUARD: "OG",
  OL: "OG",
  C: "C",
  CENTER: "C",
  DE: "EDGE",
  EDGE: "EDGE",
  DL: "DT",
  DT: "DT",
  NT: "DT",
  LB: "ILB",
  ILB: "ILB",
  MLB: "ILB",
  OLB: "OLB",
  LOLB: "OLB",
  ROLB: "OLB",
  CB: "CB",
  DB: "CB",
  S: "S",
  FS: "S",
  SS: "S",
  SAF: "S",
  K: "K",
  PK: "K",
  P: "P",
};

const normPos = (raw: string): string => raw.toUpperCase().replace(/[^A-Z_]/g, "");

const STATUS_RANK: Readonly<Record<string, number>> = { ACT: 3, RES: 2, DEV: 1 };

function resolvePosition(row: Record<string, string>): Position | null {
  for (const raw of [row.depth_chart_position, row.ngs_position, row.position]) {
    if (!raw) continue;
    const mapped = NFLVERSE_POSITION_MAP[normPos(raw)];
    if (mapped) return mapped;
  }
  return null;
}

/**
 * Aggregate per-game snap rows into one role signal per PFR player id:
 * `perf` in [0,1], blending average snap share with games played.
 * Regular season only.
 */
export function aggregateSnapCounts(
  rows: Array<Record<string, string>>,
): Map<string, number> {
  interface Acc {
    games: number;
    pctSum: number;
  }
  const acc = new Map<string, Acc>();
  for (const row of rows) {
    if ((row.game_type ?? "REG") !== "REG") continue;
    const id = row.pfr_player_id;
    if (!id) continue;
    const off = Number.parseFloat(row.offense_pct ?? "") || 0;
    const def = Number.parseFloat(row.defense_pct ?? "") || 0;
    const st = Number.parseFloat(row.st_pct ?? "") || 0;
    const share = Math.max(off, def, st);
    const a = acc.get(id) ?? { games: 0, pctSum: 0 };
    a.games += 1;
    a.pctSum += share;
    acc.set(id, a);
  }

  const perf = new Map<string, number>();
  for (const [id, a] of acc) {
    const avgShare = a.games > 0 ? a.pctSum / a.games : 0;
    const availability = Math.min(a.games, 17) / 17;
    perf.set(id, Math.max(0, Math.min(1, 0.65 * avgShare + 0.35 * availability)));
  }
  return perf;
}

function ageFrom(row: Record<string, string>, asOf: Date, yearsExp: number): number {
  const bd = row.birth_date ? new Date(row.birth_date) : null;
  if (bd && !Number.isNaN(bd.getTime())) {
    const years = (asOf.getTime() - bd.getTime()) / (365.25 * 24 * 3600 * 1000);
    if (years >= 18 && years <= 50) return Math.round(years);
  }
  return Math.min(44, Math.max(20, 22 + yearsExp)); // fallback: rookies ~22
}

export interface BuildPoolOptions {
  seasonYear: number;
  seed?: string | undefined;
  includePracticeSquad?: boolean | undefined;
  includeIR?: boolean | undefined;
}

export interface BuildPoolResult {
  players: Player[];
  skipped: Array<{ name: string; reason: string }>;
  sourceRows: number;
  /** How many players received a snap-share signal (vs pedigree-only). */
  withPerfSignal: number;
}

export function buildPoolFromRosterRows(
  rows: Array<Record<string, string>>,
  opts: BuildPoolOptions,
  perfByPfrId?: ReadonlyMap<string, number>,
): BuildPoolResult {
  const includeIR = opts.includeIR ?? true;
  const includePS = opts.includePracticeSquad ?? false;
  const asOf = new Date(Date.UTC(opts.seasonYear, 8, 1)); // ~season kickoff

  const wanted = new Set(["ACT", ...(includeIR ? ["RES"] : []), ...(includePS ? ["DEV"] : [])]);

  // One row per player: the highest-ranked status wins.
  const byKey = new Map<string, Record<string, string>>();
  for (const row of rows) {
    if (!wanted.has(row.status ?? "")) continue;
    const key = row.gsis_id || row.esb_id || row.smart_id || `${row.full_name}|${row.position}`;
    if (!key) continue;
    const prev = byKey.get(key);
    if (
      !prev ||
      (STATUS_RANK[row.status ?? ""] ?? 0) > (STATUS_RANK[prev.status ?? ""] ?? 0)
    ) {
      byKey.set(key, row);
    }
  }

  const skipped: BuildPoolResult["skipped"] = [];
  let withPerfSignal = 0;

  // Validate with a throwaway id (PlayerSchema is a ZodEffects, so it has no
  // .omit()); real sequential ids are assigned after the overall-sort.
  const built: Player[] = [];
  for (const [key, row] of byKey) {
    const name = row.full_name || `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim();
    if (!name) {
      skipped.push({ name: key, reason: "no name" });
      continue;
    }
    const position = resolvePosition(row);
    if (!position) {
      skipped.push({ name, reason: `unmapped position: ${row.depth_chart_position || row.position}` });
      continue;
    }
    const yearsExp = Number.parseInt(row.years_exp ?? "", 10) || 0;
    const draftRaw = Number.parseInt(row.draft_number ?? "", 10);
    const draftNumber = Number.isFinite(draftRaw) && draftRaw > 0 ? draftRaw : null;

    const perfRaw = row.pfr_id ? perfByPfrId?.get(row.pfr_id) : undefined;
    const perf = perfRaw ?? null;
    if (perf !== null) withPerfSignal += 1;

    const seed: PlayerSeed = {
      key,
      name,
      position,
      age: ageFrom(row, asOf, yearsExp),
      yearsExp,
      draftNumber,
      team: row.team || "FA",
      onIR: row.status === "RES",
      practiceSquad: row.status === "DEV",
      perf,
    };

    const player = buildPlayer(seed, opts.seed !== undefined ? { seed: opts.seed } : {});
    const parsed = PlayerSchema.safeParse({ id: "p_00000", ...player });
    if (!parsed.success) {
      skipped.push({
        name,
        reason: `failed schema: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`,
      });
      continue;
    }
    built.push(parsed.data);
  }

  built.sort((a, b) => b.overall - a.overall || a.name.localeCompare(b.name));
  const players: Player[] = built.map((p, i) => ({
    ...p,
    id: `p_${String(i + 1).padStart(5, "0")}`,
  }));

  return { players, skipped, sourceRows: rows.length, withPerfSignal };
}

/* --- fetch ------------------------------------------------------------ */

export async function fetchRosterCsv(season: number): Promise<string> {
  const res = await fetch(ROSTER_URL(season), { redirect: "follow" });
  if (!res.ok) throw new Error(`roster fetch failed for ${season}: HTTP ${res.status}`);
  return res.text();
}

export async function fetchSnapCountsCsv(season: number): Promise<string> {
  const res = await fetch(SNAP_COUNTS_URL(season), { redirect: "follow" });
  if (!res.ok) throw new Error(`snap-counts fetch failed for ${season}: HTTP ${res.status}`);
  return res.text();
}

/** Try the given season's snap counts, then the prior one; null if neither. */
async function loadPerfSignal(season: number): Promise<Map<string, number> | null> {
  for (const s of [season, season - 1]) {
    try {
      return aggregateSnapCounts(parseCsv(await fetchSnapCountsCsv(s)));
    } catch {
      /* try older */
    }
  }
  return null;
}

/* --- CLI ------------------------------------------------------------- */

interface Cli {
  season: number;
  out: string;
  seed: string | undefined;
  includePracticeSquad: boolean;
  includeIR: boolean;
  useSnaps: boolean;
  alsoCsv: boolean;
}

function parseCliArgs(argv: string[]): Cli {
  const cli: Cli = {
    season: new Date().getUTCFullYear(),
    out: LOCAL_POOL_PATH,
    seed: undefined,
    includePracticeSquad: false,
    includeIR: true,
    useSnaps: true,
    alsoCsv: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? "";
    const val = (): string => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`missing value for ${a}`);
      return v;
    };
    switch (a) {
      case "--season":
        cli.season = Number(val());
        break;
      case "--out":
        cli.out = resolve(val());
        break;
      case "--seed":
        cli.seed = val();
        break;
      case "--practice-squad":
        cli.includePracticeSquad = true;
        break;
      case "--no-ir":
        cli.includeIR = false;
        break;
      case "--no-snaps":
        cli.useSnaps = false;
        break;
      case "--csv":
        cli.alsoCsv = true;
        break;
      default:
        throw new Error(`unknown option: ${a}`);
    }
  }
  if (!Number.isInteger(cli.season)) throw new Error("--season must be a year");
  return cli;
}

function summarise(players: Player[]): string {
  const byPos = new Map<Position, number>();
  for (const p of players) byPos.set(p.position, (byPos.get(p.position) ?? 0) + 1);
  const posLine = POSITIONS.filter((p) => byPos.has(p))
    .map((p) => `${p}:${byPos.get(p)}`)
    .join(" ");

  const ovr = players.map((p) => p.overall).sort((x, y) => x - y);
  const at = (q: number): number => ovr[Math.floor((ovr.length - 1) * q)] ?? 0;
  const ge = (n: number): number => ovr.filter((v) => v >= n).length;

  const top = players
    .slice(0, 15)
    .map((p) => `  ${String(p.overall).padStart(2)} ${p.position.padEnd(4)} ${p.name} (${p.nfl_team}, age ${p.age})`)
    .join("\n");

  return [
    `  ${posLine}`,
    `  overall  min ${at(0)}  p25 ${at(0.25)}  median ${at(0.5)}  p75 ${at(0.75)}  max ${at(1)}`,
    `  >=90 ${ge(90)}   >=80 ${ge(80)}   >=70 ${ge(70)}`,
    ``,
    `  top 15:`,
    top,
  ].join("\n");
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  try {
    const cli = parseCliArgs(process.argv.slice(2));

    let season = cli.season;
    let csv: string;
    try {
      csv = await fetchRosterCsv(season);
    } catch (err) {
      season = cli.season - 1;
      console.warn(`  ${(err as Error).message}; trying ${season}`);
      csv = await fetchRosterCsv(season);
    }

    const perf = cli.useSnaps ? await loadPerfSignal(season) : null;
    if (cli.useSnaps && !perf) {
      console.warn("  snap counts unavailable; rating on draft capital + tenure only");
    }

    const rows = parseCsv(csv);
    const { players, skipped, withPerfSignal } = buildPoolFromRosterRows(
      rows,
      {
        seasonYear: season,
        seed: cli.seed,
        includePracticeSquad: cli.includePracticeSquad,
        includeIR: cli.includeIR,
      },
      perf ?? undefined,
    );

    PlayerPoolSchema.parse(players);
    writeFileSync(cli.out, `${JSON.stringify(players, null, 2)}\n`, "utf8");

    console.log(`generated ${players.length} players from ${season} roster -> ${cli.out}`);
    if (cli.alsoCsv) {
      const csvPath = cli.out.replace(/\.json$/i, "") + ".csv";
      writeFileSync(csvPath, poolToCsv(players), "utf8");
      console.log(`  editable CSV -> ${csvPath}`);
    }
    console.log(`  ${withPerfSignal}/${players.length} priced on a snap-share signal`);
    console.log(summarise(players));
    if (skipped.length > 0) {
      const byReason = new Map<string, number>();
      for (const s of skipped) {
        const head = s.reason.split(":")[0] ?? s.reason;
        byReason.set(head, (byReason.get(head) ?? 0) + 1);
      }
      console.log(
        `  skipped ${skipped.length}: ` +
          [...byReason.entries()].map(([k, v]) => `${k} ×${v}`).join(", "),
      );
    }
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  }
}
