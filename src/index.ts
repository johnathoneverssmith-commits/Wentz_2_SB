/**
 * Entry point placeholder.
 *
 * Phase 0 has no runnable game — this just loads and summarises the active
 * player pool (the local import if present, otherwise the committed sample)
 * so `npm start` does something meaningful. Phase 1 (core sim engine) grows
 * from here.
 */

import { basename } from "node:path";

import { loadPlayerPool, resolveDefaultPoolPath } from "./data/players.js";

function main(): void {
  const poolPath = resolveDefaultPoolPath();
  const pool = loadPlayerPool(poolPath, { strictAttributes: true });

  const sorted = [...pool].sort((a, b) => b.overall - a.overall);
  console.log(`Loaded ${pool.length} players from ${basename(poolPath)}:\n`);
  for (const p of sorted.slice(0, 25)) {
    console.log(
      `  ${String(p.overall).padStart(2)}  ${p.position.padEnd(4)} ${p.name}  ` +
        `(age ${p.age}, ${p.nfl_team})`,
    );
  }
  if (sorted.length > 25) console.log(`  ...and ${sorted.length - 25} more`);
}

main();
