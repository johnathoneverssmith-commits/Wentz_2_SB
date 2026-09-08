/**
 * Entry point placeholder.
 *
 * Phase 0 has no runnable game — this just loads and summarises the sample
 * player pool so `npm start` does something meaningful. Phase 1 (core sim
 * engine) will grow from here.
 */

import { loadPlayerPool } from "./data/players.js";

function main(): void {
  const pool = loadPlayerPool(undefined, { strictAttributes: true });

  const sorted = [...pool].sort((a, b) => b.overall - a.overall);
  console.log(`Loaded ${pool.length} players from the sample pool:\n`);
  for (const p of sorted) {
    console.log(
      `  ${String(p.overall).padStart(2)}  ${p.position.padEnd(4)} ${p.name}  ` +
        `(age ${p.age}, ${p.nfl_team})`,
    );
  }
}

main();
