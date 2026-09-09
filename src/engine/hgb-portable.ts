/**
 * Runtime evaluator for the portable HGB resolvers exported by
 * `analysis/27_export_portable.py` (format `hgb-portable-1`).
 *
 * This is the TS port of `analysis/lib_py/hgb_portable.py::predict_proba_portable`
 * — keep the two behaviourally identical. Both reproduce
 * `sklearn.HistGradientBoostingClassifier.predict_proba` to < 1e-6 on real data.
 */

/** A decision-tree node: leaf `{ v }`, numeric split `{ f, t, ml, l, r }`, or
 * categorical split `{ f, catsLeft, ml, l, r }`. `f` indexes `model.features`. */
export interface HgbNode {
  /** leaf value (learning rate already baked in) */
  v?: number;
  /** internal feature index */
  f?: number;
  /** numeric split threshold: go left when `value <= t` */
  t?: number;
  /** categorical split: go left when the string value is in this set */
  cats_left?: string[];
  /** 1 = missing / unknown goes left, 0 = right */
  ml?: number;
  /** left child node index */
  l?: number;
  /** right child node index */
  r?: number;
}

export interface HgbPortableModel {
  format: "hgb-portable-1";
  objective: "binary" | "multiclass";
  /** raw-prediction class order (matches `_baseline_prediction` / tree order) */
  classes: string[];
  /** semantic label order the caller wants results keyed by */
  labels: string[];
  /** original context-key names the caller passes in `x` */
  feature_names: string[];
  /** per-class raw baseline (binary: single element) */
  baseline: number[];
  /** internal feature order the trees index: [categoricals][numerics] */
  features: { name: string; categorical: boolean }[];
  /** `trees_per_class[k]` = list of trees (each a node array) for class k */
  trees_per_class: HgbNode[][][];
  n_iterations: number;
}

export type FeatureVec = Record<string, number | string | null | undefined>;

function leafValue(nodes: HgbNode[], feats: HgbPortableModel["features"], x: FeatureVec): number {
  let i = 0;
  // Bounded by tree depth; the export caps leaves well under this.
  for (let guard = 0; guard < 1024; guard++) {
    const n = nodes[i];
    if (n === undefined) break;
    if (n.v !== undefined) return n.v;
    const meta = feats[n.f ?? -1];
    if (meta === undefined) break;
    const val = x[meta.name];
    const missing = val === null || val === undefined;
    let goLeft: boolean;
    if (meta.categorical) {
      goLeft = missing ? n.ml === 1 : (n.cats_left ?? []).includes(String(val));
    } else {
      const num = missing ? NaN : Number(val);
      goLeft = Number.isNaN(num) ? n.ml === 1 : num <= (n.t ?? 0);
    }
    i = (goLeft ? n.l : n.r) ?? -1;
  }
  throw new Error("hgb-portable: malformed model (tree walk fell off the node array)");
}

function softmax(xs: number[]): number[] {
  const m = Math.max(...xs);
  const ex = xs.map((v) => Math.exp(v - m));
  const s = ex.reduce((a, b) => a + b, 0);
  return ex.map((v) => v / s);
}

/**
 * Evaluate a portable HGB model. Returns `{ label: probability }` keyed by
 * `model.labels`. Categorical feature values are compared as strings; unknown
 * or missing values follow each split's missing-left flag.
 */
export function predictProbaPortable(
  model: HgbPortableModel,
  x: FeatureVec,
): Record<string, number> {
  const raws = model.trees_per_class.map((forest, k) => {
    let acc = model.baseline[k] ?? model.baseline[0] ?? 0;
    for (const tree of forest) acc += leafValue(tree, model.features, x);
    return acc;
  });

  const { classes, labels } = model;
  const byClass: Record<string, number> = {};
  if (model.objective === "binary") {
    const p1 = 1 / (1 + Math.exp(-(raws[0] ?? 0)));
    byClass[classes[0] ?? "0"] = 1 - p1;
    byClass[classes[1] ?? "1"] = p1;
  } else {
    const probs = softmax(raws);
    classes.forEach((c, i) => {
      byClass[c] = probs[i] ?? 0;
    });
  }
  return Object.fromEntries(labels.map((l) => [l, byClass[l] ?? 0]));
}
