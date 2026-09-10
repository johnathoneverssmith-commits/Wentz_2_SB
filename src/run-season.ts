/**
 * Headless season runner:  npm run season -- [--seed N] [--year Y] [--seasons K] [--compact]
 *
 * Sims a full NFL season (real 17-game schedule → standings → playoffs) and
 * prints the standings and bracket. `--seasons K` runs a K-year franchise,
 * each year fed the previous year's division finishes.
 */

import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import { formatSeasonReport, formatStandingsCompact } from "./engine/report.js";
import { simulateFranchise, simulateNflSeason } from "./engine/season.js";

interface Args {
  seed: number;
  year: number;
  seasons: number;
  compact: boolean;
}

function parseArgs(argv: string[]): Args {
  const a: Args = { seed: 1, year: 2025, seasons: 1, compact: false };
  for (let i = 0; i < argv.length; i += 1) {
    const k = argv[i];
    const v = argv[i + 1];
    if (k === "--seed") (a.seed = Number(v)), (i += 1);
    else if (k === "--year") (a.year = Number(v)), (i += 1);
    else if (k === "--seasons") (a.seasons = Number(v)), (i += 1);
    else if (k === "--compact") a.compact = true;
    else throw new Error(`unknown arg: ${k}`);
  }
  if (!Number.isFinite(a.seed) || !Number.isInteger(a.year) || a.seasons < 1) {
    throw new Error("usage: --seed N --year Y --seasons K [--compact]");
  }
  return a;
}

function run(a: Args): void {
  if (a.seasons === 1) {
    const result = simulateNflSeason(a.seed, { year: a.year });
    console.log(
      a.compact ? formatStandingsCompact(result) : formatSeasonReport(result, `NFL ${a.year}`),
    );
    return;
  }
  const seasons = simulateFranchise(a.seed, { startYear: a.year, seasons: a.seasons });
  seasons.forEach((result, n) => {
    const year = a.year + n;
    if (a.compact) {
      console.log(`\n--- ${year} — champion: ${result.champion} ---`);
      console.log(formatStandingsCompact(result));
    } else {
      console.log(formatSeasonReport(result, `NFL ${year}`));
    }
  });
  console.log(
    `\nchampions: ${seasons.map((s, n) => `${a.year + n} ${s.champion}`).join("  ·  ")}`,
  );
}

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  try {
    run(parseArgs(process.argv.slice(2)));
  } catch (err) {
    console.error(`season: ${(err as Error).message}`);
    process.exitCode = 1;
  }
}
