/**
 * nflverse play-by-play loading (analysis-only).
 *
 * The runtime engine never touches these Parquet files — only the analysis
 * scripts do, to build the artifacts in `artifacts/`. This is the TypeScript
 * bootstrap of the spec's data-audit stage (§28); the Phase B model fitting
 * moves to Python (see analysis/README.md).
 */

import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { asyncBufferFromFile, parquetMetadataAsync, parquetReadObjects, parquetSchema } from "hyparquet";
import { compressors } from "hyparquet-compressors";

/** Primary current-era training seasons (spec §0, §6.5). */
export const PRIMARY_SEASONS = [2023, 2024, 2025] as const;
export type Season = (typeof PRIMARY_SEASONS)[number];

const dataDir = fileURLToPath(new URL("../../data/", import.meta.url));

export const pbpPath = (season: number): string =>
  resolve(dataDir, `play_by_play_${season}.parquet`);

export type PbpRow = Record<string, unknown>;

export interface SeasonSchema {
  season: number;
  path: string;
  fileBytes: number;
  numRows: number;
  /** column name -> parquet physical + logical type */
  columns: Map<string, { physicalType: string; logicalType: string | null; convertedType: string | null }>;
}

export async function readSchema(season: number): Promise<SeasonSchema> {
  const path = pbpPath(season);
  if (!existsSync(path)) {
    throw new Error(`missing ${path} — see analysis/README.md for how to fetch the Parquet files`);
  }
  const file = await asyncBufferFromFile(path);
  const meta = await parquetMetadataAsync(file);
  const schema = parquetSchema(meta);
  const columns = new Map<string, { physicalType: string; logicalType: string | null; convertedType: string | null }>();
  for (const child of schema.children) {
    const el = child.element;
    columns.set(el.name, {
      physicalType: String(el.type ?? "GROUP"),
      logicalType: el.logical_type ? JSON.stringify(el.logical_type) : null,
      convertedType: el.converted_type != null ? String(el.converted_type) : null,
    });
  }
  return {
    season,
    path,
    fileBytes: file.byteLength,
    numRows: Number(meta.num_rows),
    columns,
  };
}

/** Read an entire season as row objects. ~50k rows x 372 cols; a few seconds. */
export async function readSeason(season: number, columns?: string[]): Promise<PbpRow[]> {
  const file = await asyncBufferFromFile(pbpPath(season));
  const rows = await parquetReadObjects({
    file,
    compressors,
    ...(columns ? { columns } : {}),
  });
  return rows as PbpRow[];
}

/** JS runtime type of a value, for cross-season type-consistency checks. */
export function jsType(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (typeof v === "bigint") return "bigint";
  if (v instanceof Date) return "date";
  return typeof v;
}
