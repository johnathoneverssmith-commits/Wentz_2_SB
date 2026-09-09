/**
 * Runtime evaluator for the portable spline+logistic resolvers exported by
 * `analysis/27_export_portable.py` (format `linear-portable-1`).
 *
 * TS port of `analysis/lib_py/linear_portable.py::predict_proba_linear` — keep
 * the two behaviourally identical. Each numeric feature contributes to the
 * decision function via either an exact per-segment cubic (a SplineTransformer
 * feature; constant past the ends) or a plain linear term (a StandardScaler
 * feature). Categoricals are one-hot weight rows; an unknown category
 * contributes zero (`handle_unknown='ignore'`).
 */

export interface LinearCubicNumeric {
  kind: "pw_cubic";
  /** segment breakpoints (spline interior knots); `seg.length === breaks.length - 1` */
  breaks: number[];
  /** `seg[s][k]` = `[a, b, c, d]`, contribution `= a + b·u + c·u² + d·u³`, `u = x - breaks[s]` */
  seg: number[][][];
}

export interface LinearScalarNumeric {
  kind: "linear";
  mean: number;
  scale: number;
  /** per effective class */
  w: number[];
}

export type LinearNumeric = LinearCubicNumeric | LinearScalarNumeric;

export interface LinearPortableModel {
  format: "linear-portable-1";
  objective: "binary" | "multiclass";
  /** raw-prediction class order (LogisticRegression.classes_) */
  classes: string[];
  /** semantic label order to key results by */
  labels: string[];
  feature_names: string[];
  /** per effective class (1 for binary, n_classes for multinomial) */
  intercept: number[];
  numeric: Record<string, LinearNumeric>;
  /** `categorical[name][value]` = per-class weights; `_unknown` = zeros */
  categorical: Record<string, Record<string, number[]>>;
}

export type FeatureVec = Record<string, number | string | null | undefined>;

function numericContrib(entry: LinearNumeric, x: number, k: number): number {
  if (entry.kind === "linear") {
    return ((x - entry.mean) / entry.scale) * (entry.w[k] ?? 0);
  }
  const { breaks, seg } = entry;
  const first = breaks[0] ?? 0;
  const last = breaks[breaks.length - 1] ?? 0;
  let s: number;
  let u: number;
  if (x <= first) {
    s = 0;
    u = 0;
  } else if (x >= last) {
    s = seg.length - 1;
    u = last - (breaks[breaks.length - 2] ?? last);
  } else {
    s = 0;
    while (s + 1 < breaks.length - 1 && x >= (breaks[s + 1] ?? Infinity)) s++;
    u = x - (breaks[s] ?? 0);
  }
  const [a = 0, b = 0, c = 0, d = 0] = seg[s]?.[k] ?? [];
  return a + b * u + c * u * u + d * u * u * u;
}

/**
 * Evaluate a portable linear model. Returns `{ label: probability }` keyed by
 * `model.labels`. Categorical values are compared as strings; an unknown
 * category contributes zero. Numeric features are assumed present (the callers
 * always supply them).
 */
export function predictProbaLinear(
  model: LinearPortableModel,
  x: FeatureVec,
): Record<string, number> {
  const nEff = model.intercept.length;
  const dec = [...model.intercept];

  for (const [name, entry] of Object.entries(model.numeric)) {
    const v = x[name];
    if (v === null || v === undefined) continue;
    const num = Number(v);
    if (Number.isNaN(num)) continue;
    for (let k = 0; k < nEff; k++) dec[k] = (dec[k] ?? 0) + numericContrib(entry, num, k);
  }

  for (const [name, table] of Object.entries(model.categorical)) {
    const row = table[String(x[name])] ?? table._unknown ?? [];
    for (let k = 0; k < nEff; k++) dec[k] = (dec[k] ?? 0) + (row[k] ?? 0);
  }

  const { classes, labels } = model;
  const byClass: Record<string, number> = {};
  if (model.objective === "binary") {
    const p1 = 1 / (1 + Math.exp(-(dec[0] ?? 0)));
    byClass[classes[0] ?? "0"] = 1 - p1;
    byClass[classes[1] ?? "1"] = p1;
  } else {
    const m = Math.max(...dec);
    const ex = dec.map((d) => Math.exp(d - m));
    const sum = ex.reduce((p, q) => p + q, 0);
    for (let i = 0; i < classes.length; i++) {
      byClass[classes[i] as string] = (ex[i] ?? 0) / sum;
    }
  }
  return Object.fromEntries(labels.map((l) => [l, byClass[l] ?? 0]));
}
