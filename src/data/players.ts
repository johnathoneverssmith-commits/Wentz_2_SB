/**
 * Player-pool loader + validator.
 *
 * `loadPlayerPool` reads a JSON file, validates it against `PlayerPoolSchema`,
 * and returns typed `Player[]`. Run directly to validate a file from the CLI:
 *
 *   npm run validate:data                 # checks data/players_sample.json
 *   tsx src/data/players.ts path/to.json  # checks any file
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import {
  PlayerPoolSchema,
  unknownAttributeKeys,
  type Player,
  type PlayerPool,
} from "../schema/player.js";

export const SAMPLE_POOL_PATH = resolve(
  fileURLToPath(new URL("../../data/players_sample.json", import.meta.url)),
);

export interface LoadOptions {
  /** Throw if any record carries an attribute key the schema doesn't know. */
  strictAttributes?: boolean;
}

export function parsePlayerPool(raw: unknown, opts: LoadOptions = {}): PlayerPool {
  const pool = PlayerPoolSchema.parse(raw);

  const ids = new Set<string>();
  for (const p of pool) {
    if (ids.has(p.id)) throw new Error(`duplicate player id: ${p.id}`);
    ids.add(p.id);
  }

  if (opts.strictAttributes) {
    const problems = pool
      .map((p) => ({ id: p.id, keys: unknownAttributeKeys(p.position, p.attributes) }))
      .filter((x) => x.keys.length > 0);
    if (problems.length > 0) {
      const detail = problems.map((x) => `  ${x.id}: ${x.keys.join(", ")}`).join("\n");
      throw new Error(`unknown attribute keys:\n${detail}`);
    }
  }

  return pool;
}

export function loadPlayerPool(path: string = SAMPLE_POOL_PATH, opts: LoadOptions = {}): PlayerPool {
  const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
  return parsePlayerPool(raw, opts);
}

/** Index a pool by id for O(1) lookup. */
export function indexById(pool: readonly Player[]): Map<string, Player> {
  return new Map(pool.map((p) => [p.id, p]));
}

/* --- CLI entry ---------------------------------------------------- */

const invokedDirectly =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  const target = process.argv[2] ? resolve(process.argv[2]) : SAMPLE_POOL_PATH;
  try {
    const pool = loadPlayerPool(target, { strictAttributes: true });
    const byPos = new Map<string, number>();
    for (const p of pool) byPos.set(p.position, (byPos.get(p.position) ?? 0) + 1);
    const breakdown = [...byPos.entries()].map(([k, v]) => `${k}:${v}`).join(" ");
    console.log(`OK  ${target}`);
    console.log(`    ${pool.length} players  (${breakdown})`);
  } catch (err) {
    console.error(`FAIL  ${target}`);
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  }
}
