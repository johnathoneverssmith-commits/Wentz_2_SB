/**
 * Artifact loaders + samplers — TS counterpart to `analysis/engine/loaders.py`.
 *
 * Reads the portable JSON the Python pipeline exports:
 *   artifacts/models/portable/<mid>.json          (16 classifier resolvers)
 *   artifacts/distributions/portable/<name>.json   (7 empirical PMF tables)
 *
 * `predictProba` / `sampleClass` dispatch to the HGB or linear evaluator and
 * apply a per-class logit shift (re-softmax). Unlike the Python engine this does
 * NOT bucket-cache `predictProba` — the TS evaluators are cheap and skipping the
 * cache is strictly more accurate; the §22 target is the empirical baseline, not
 * a bit-match of the Python cache.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  type HgbPortableModel,
  predictProbaPortable,
} from "./hgb-portable.js";
import {
  type LinearPortableModel,
  predictProbaLinear,
} from "./linear-portable.js";
import type { Rng } from "./rng.js";

type Ctx = Record<string, number | string>;
type Pmf = { v: number[]; cum: number[] };

const MODEL_DIR = new URL("../../artifacts/models/portable/", import.meta.url);
const DIST_DIR = new URL("../../artifacts/distributions/portable/", import.meta.url);

const LINEAR_IDS = new Set(["M04", "M08", "M11", "M13", "M15", "M20", "M21", "M25a", "M25b"]);

function readJson<T>(url: URL): T {
  return JSON.parse(readFileSync(fileURLToPath(url), "utf8")) as T;
}

// ---- resolvers ----------------------------------------------------------

interface Resolver {
  model: HgbPortableModel | LinearPortableModel;
  linear: boolean;
  labels: string[];
}

const _resolvers = new Map<string, Resolver>();

function resolver(mid: string): Resolver {
  let r = _resolvers.get(mid);
  if (!r) {
    const model = readJson<HgbPortableModel | LinearPortableModel>(
      new URL(`${mid}.json`, MODEL_DIR),
    );
    r = { model, linear: LINEAR_IDS.has(mid), labels: model.labels };
    _resolvers.set(mid, r);
  }
  return r;
}

/** Re-softmax after adding per-class shifts in log-prob space (spec §12). */
export function applyShift(
  probs: Record<string, number>,
  shift: Record<string, number>,
): Record<string, number> {
  const labels = Object.keys(probs);
  const lg = labels.map((l) => Math.log(Math.max(probs[l] ?? 0, 1e-9)) + (shift[l] ?? 0));
  const mx = Math.max(...lg);
  const ex = lg.map((v) => Math.exp(v - mx));
  const s = ex.reduce((p, q) => p + q, 0);
  const out: Record<string, number> = {};
  labels.forEach((l, i) => {
    out[l] = (ex[i] ?? 0) / s;
  });
  return out;
}

export function predictProba(
  mid: string,
  ctx: Ctx,
  logitShift?: Record<string, number> | null,
): Record<string, number> {
  const r = resolver(mid);
  const base = r.linear
    ? predictProbaLinear(r.model as LinearPortableModel, ctx)
    : predictProbaPortable(r.model as HgbPortableModel, ctx);
  return logitShift ? applyShift(base, logitShift) : base;
}

export function sampleClass(
  mid: string,
  ctx: Ctx,
  rng: Rng,
  logitShift?: Record<string, number> | null,
): string {
  const probs = predictProba(mid, ctx, logitShift);
  const labels = Object.keys(probs);
  return rng.choice(
    labels,
    labels.map((l) => Math.max(probs[l] ?? 0, 1e-9)),
  );
}

// ---- empirical PMF tables --------------------------------------------

const _tables = new Map<string, unknown>();

function table<T>(name: string): T {
  let t = _tables.get(name);
  if (!t) {
    t = readJson<T>(new URL(`${name}.json`, DIST_DIR));
    _tables.set(name, t);
  }
  return t as T;
}

/** numpy `searchsorted(cum, r, side="left")`, clamped to the last bin. */
function draw(leaf: Pmf, r: number): number {
  const { v, cum } = leaf;
  let i = 0;
  while (i < cum.length - 1 && (cum[i] as number) < r) i++;
  return v[i] as number;
}

export function sampleExactYards(stem: string, category: string, bucket: string, rng: Rng): number {
  const t = table<{ by_cb: Record<string, Record<string, Pmf>>; glob: Record<string, Pmf> }>(
    `${stem}_exact`,
  );
  const leaf = t.by_cb[category]?.[bucket] ?? t.glob[category];
  if (!leaf) throw new Error(`sampleExactYards: no PMF for ${stem} ${category}/${bucket}`);
  return draw(leaf, rng.random());
}

export function sampleAirYards(cat: string, down: number, yardline100: number, rng: Rng): number {
  // Red zone is split finely (gl1..gl4) so air yards track the goal line; fall
  // back outward for thin cells. See analysis/06_pass_depth.write_exact_air_yards.
  const fps =
    yardline100 <= 2
      ? ["gl1", "gl2", "gl3"]
      : yardline100 <= 4
        ? ["gl2", "gl3", "gl1"]
        : yardline100 <= 7
          ? ["gl3", "gl4", "gl2"]
          : yardline100 <= 12
            ? ["gl4", "rz", "gl3"]
            : yardline100 <= 20
              ? ["rz", "gl4"]
              : yardline100 <= 50
                ? ["opp_mid"]
                : ["own_half"];
  const t = table<{
    by: Record<string, Record<string, Record<string, Pmf>>>;
    glob: Record<string, Pmf>;
  }>("air_yards");
  const byCatDown = t.by[cat]?.[String(Math.trunc(down))] ?? {};
  let leaf: Pmf | undefined;
  for (const f of fps) {
    if (byCatDown[f]) {
      leaf = byCatDown[f];
      break;
    }
  }
  leaf ??= t.glob[cat];
  if (!leaf) throw new Error(`sampleAirYards: no PMF for ${cat}/${down}/${fps.join(",")}`);
  return draw(leaf, rng.random());
}

export function sampleRunoff(bucket: string, noHuddle: number, clockState: string, rng: Rng): number {
  const t = table<{ by: Record<string, Record<string, Record<string, Pmf>>> }>("clock_runoff");
  const leaf =
    t.by[bucket]?.[String(Math.trunc(noHuddle))]?.[clockState] ?? t.by[bucket]?.["0"]?.["normal"];
  return leaf ? draw(leaf, rng.random()) : 35;
}

export function samplePuntDistance(yardline100: number, rng: Rng): number {
  const d = table<{ dist: Record<string, Pmf>; ret: Pmf }>("punt").dist;
  const fp = Math.trunc(yardline100 / 10) * 10;
  const key =
    String(fp) in d
      ? String(fp)
      : Object.keys(d).reduce((best, k) => (Math.abs(+k - fp) < Math.abs(+best - fp) ? k : best));
  return draw(d[key] as Pmf, rng.random());
}

export function samplePuntReturn(rng: Rng): number {
  return draw(table<{ ret: Pmf }>("punt").ret, rng.random());
}

/**
 * YAC for a red-zone completion caught `catchYl` yards short of the goal (1..25).
 * Empirical PMF by catch-position band — see analysis/11_yac.write_rz_yac.
 */
export function sampleRzYac(catchYl: number, rng: Rng): number {
  const c = catchYl;
  const band =
    c <= 1 ? "1" : c <= 2 ? "2" : c <= 3 ? "3" : c <= 5 ? "4-5" : c <= 8 ? "6-8" : c <= 12 ? "9-12" : c <= 18 ? "13-18" : "19-25";
  return draw(table<Record<string, Pmf>>("rz_yac")[band]!, rng.random());
}

// ---- penalty enforcement (Model 25c) --------------------------------

export interface PenaltyBucket {
  bucket: string;
  share: number;
  off_share: number;
  mean_yards: number;
  sd_yards: number;
  p_auto_first: number;
  is_spot_foul: boolean;
  [k: string]: unknown;
}

interface PenaltyFam {
  buckets: string[];
  cum: number[];
  meta: Record<string, PenaltyBucket>;
}

export function samplePenaltyBucket(hazard: string, playFamily: string, rng: Rng): PenaltyBucket {
  const by = table<{ by: Record<string, Record<string, PenaltyFam>> }>("penalty").by;
  const fam =
    by[hazard]?.[playFamily] ?? by[hazard]?.[hazard === "deadball" ? "ALL" : "dropback"];
  if (!fam) throw new Error(`samplePenaltyBucket: no table for ${hazard}/${playFamily}`);
  const r = rng.random();
  let i = 0;
  while (i < fam.cum.length - 1 && (fam.cum[i] as number) < r) i++;
  return fam.meta[fam.buckets[i] as string] as PenaltyBucket;
}

export function sampleDpiYards(fpBand: string, rng: Rng): number {
  const dpi = table<{ dpi: Record<string, Pmf> }>("penalty").dpi;
  const leaf = dpi[fpBand] ?? Object.values(dpi)[0];
  if (!leaf) throw new Error("sampleDpiYards: empty DPI table");
  return draw(leaf, rng.random());
}
