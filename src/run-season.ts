/**
 * Headless season runner:
 *   npm run season -- [--seed N] [--year Y] [--seasons K] [--compact] [--through W]
 *
 * Sims a full NFL season (real 17-game schedule → standings → playoffs) and
 * prints the standings and bracket. `--seasons K` runs a K-year franchise, each
 * year fed the previous year's division finishes. `--through W` instead prints
 * the standings as of week W with clinch/elimination tags (no playoffs).
 */

import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import { broadcastGame } from "./engine/broadcast.js";
import { nflSchedule } from "./engine/schedule.js";
import {
  formatBoxScore,
  formatPlayoffPicture,
  formatSeasonReport,
  formatStaffCard,
  formatStandingsCompact,
  formatStandingsThrough,
} from "./engine/report.js";
import {
  boxScoreFor,
  playThroughWeek,
  simulateFranchise,
  simulateNflSeason,
  startSeason,
} from "./engine/season.js";

interface Args {
  seed: number;
  year: number;
  seasons: number;
  compact: boolean;
  through: number | null;
  picture: number | null;
  box: string | null;
  broadcast: string | null;
  staffCard: string | null;
  noStaff: boolean;
}

function parseArgs(argv: string[]): Args {
  const a: Args = {
    seed: 1,
    year: 2026,
    seasons: 1,
    compact: false,
    through: null,
    picture: null,
    box: null,
    broadcast: null,
    staffCard: null,
    noStaff: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const k = argv[i];
    const v = argv[i + 1];
    if (k === "--seed") (a.seed = Number(v)), (i += 1);
    else if (k === "--year") (a.year = Number(v)), (i += 1);
    else if (k === "--seasons") (a.seasons = Number(v)), (i += 1);
    else if (k === "--through") (a.through = Number(v)), (i += 1);
    else if (k === "--picture") (a.picture = Number(v)), (i += 1);
    else if (k === "--box") (a.box = v ?? null), (i += 1);
    else if (k === "--broadcast") (a.broadcast = v ?? null), (i += 1);
    else if (k === "--staff") (a.staffCard = v ?? null), (i += 1);
    else if (k === "--compact") a.compact = true;
    else if (k === "--no-staff") a.noStaff = true;
    else throw new Error(`unknown arg: ${k}`);
  }
  if (!Number.isFinite(a.seed) || !Number.isInteger(a.year) || a.seasons < 1) {
    throw new Error(
      "usage: --seed N --year Y --seasons K [--compact] [--through W] [--picture W] [--box AWAY@HOME]",
    );
  }
  for (const [name, w] of [
    ["--through", a.through],
    ["--picture", a.picture],
  ] as const) {
    if (w !== null && (w < 1 || w > 18)) throw new Error(`${name} W must be 1–18`);
  }
  for (const [name, v] of [
    ["--box", a.box],
    ["--broadcast", a.broadcast],
  ] as const) {
    if (v !== null && !/^[A-Z]{2,3}@[A-Z]{2,3}$/.test(v)) {
      throw new Error(`${name} must look like "KC@BUF"`);
    }
  }
  return a;
}

function run(a: Args): void {
  const seasonOpts = { year: a.year, staff: !a.noStaff };
  if (a.staffCard !== null) {
    console.log(formatStaffCard(a.staffCard.toUpperCase()));
    return;
  }
  if (a.broadcast !== null) {
    const [away, home] = a.broadcast.split("@") as [string, string];
    console.log(JSON.stringify(broadcastGame(a.seed, home, away)));
    return;
  }
  if (a.box !== null) {
    const [away, home] = a.box.split("@") as [string, string];
    const box = boxScoreFor(startSeason(a.seed, seasonOpts), { home, away });
    console.log(formatBoxScore(box));
    return;
  }
  if (a.picture !== null) {
    const p = playThroughWeek(startSeason(a.seed, seasonOpts), a.picture);
    console.log(formatPlayoffPicture(p, `NFL ${a.year}`));
    return;
  }
  if (a.through !== null) {
    const result = simulateNflSeason(a.seed, seasonOpts);
    console.log(
      formatStandingsThrough(result.games, nflSchedule({ year: a.year }), a.through, `NFL ${a.year}`),
    );
    return;
  }
  if (a.seasons === 1) {
    const result = simulateNflSeason(a.seed, seasonOpts);
    console.log(
      a.compact ? formatStandingsCompact(result) : formatSeasonReport(result, `NFL ${a.year}`),
    );
    return;
  }
  const seasons = simulateFranchise(a.seed, {
    startYear: a.year,
    seasons: a.seasons,
    staff: !a.noStaff,
  });
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
