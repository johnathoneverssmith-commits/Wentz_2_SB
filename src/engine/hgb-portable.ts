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
 * A model compiled once for walking: flat typed arrays per tree, features
 * resolved by index, categorical sets as `Set`s. The walk above re-read each
 * node's feature by *name* from the context object and scanned `cats_left`
 * with `includes`, at every node of every tree of every call — two thirds of
 * the engine's whole running time. Same comparisons, same leaf values, same
 * summation order, so the result is identical to the bit.
 */
interface CompiledTree {
  feat: Int32Array;
  thr: Float64Array;
  left: Int32Array;
  right: Int32Array;
  missingLeft: Uint8Array;
  isLeaf: Uint8Array;
  leaf: Float64Array;
  cats: (Set<string> | null)[];
}
interface CompiledModel {
  names: string[];
  categorical: boolean[];
  forests: CompiledTree[][];
  /** scratch space, reused by every call (the engine is single-threaded) */
  num: Float64Array;
  cat: (string | null)[];
  raws: number[];
}
const compiled = new WeakMap<HgbPortableModel, CompiledModel>();

function compileTree(nodes: HgbNode[], nFeatures: number): CompiledTree {
  const n = nodes.length;
  const c: CompiledTree = {
    feat: new Int32Array(n),
    thr: new Float64Array(n),
    left: new Int32Array(n),
    right: new Int32Array(n),
    missingLeft: new Uint8Array(n),
    isLeaf: new Uint8Array(n),
    leaf: new Float64Array(n),
    cats: new Array(n).fill(null),
  };
  nodes.forEach((node, i) => {
    if (node.v !== undefined) {
      c.isLeaf[i] = 1;
      c.leaf[i] = node.v;
      return;
    }
    const f = node.f ?? -1;
    c.feat[i] = f >= 0 && f < nFeatures ? f : -1;
    c.thr[i] = node.t ?? 0;
    c.left[i] = node.l ?? -1;
    c.right[i] = node.r ?? -1;
    c.missingLeft[i] = node.ml === 1 ? 1 : 0;
    if (node.cats_left) c.cats[i] = new Set(node.cats_left);
  });
  return c;
}

function compile(model: HgbPortableModel): CompiledModel {
  let m = compiled.get(model);
  if (!m) {
    const nf = model.features.length;
    m = {
      names: model.features.map((f) => f.name),
      categorical: model.features.map((f) => f.categorical),
      forests: model.trees_per_class.map((forest) => forest.map((tree) => compileTree(tree, nf))),
      num: new Float64Array(nf),
      cat: new Array(nf).fill(null),
      raws: new Array(model.trees_per_class.length).fill(0),
    };
    compiled.set(model, m);
  }
  return m;
}

function walk(tree: CompiledTree, num: Float64Array, cat: (string | null)[], categorical: boolean[]): number {
  let i = 0;
  const n = tree.feat.length;
  for (let guard = 0; guard < 1024; guard++) {
    if (i < 0 || i >= n) break;
    if (tree.isLeaf[i] === 1) return tree.leaf[i]!;
    const f = tree.feat[i]!;
    if (f < 0) break;
    let goLeft: boolean;
    if (categorical[f]) {
      const v = cat[f] ?? null;
      goLeft = v === null ? tree.missingLeft[i] === 1 : (tree.cats[i]?.has(v) ?? false);
    } else {
      const v = num[f]!;
      goLeft = Number.isNaN(v) ? tree.missingLeft[i] === 1 : v <= tree.thr[i]!;
    }
    i = goLeft ? tree.left[i]! : tree.right[i]!;
  }
  throw new Error("hgb-portable: malformed model (tree walk fell off the node array)");
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
  const m = compile(model);
  const nf = m.names.length;
  const { num, cat, raws, names, categorical, forests } = m;
  for (let f = 0; f < nf; f++) {
    const val = x[names[f]!];
    const missing = val === null || val === undefined;
    if (categorical[f]) cat[f] = missing ? null : String(val);
    else num[f] = missing ? NaN : Number(val);
  }
  for (let k = 0; k < forests.length; k++) {
    const forest = forests[k]!;
    let acc = model.baseline[k] ?? model.baseline[0] ?? 0;
    for (let j = 0; j < forest.length; j++) acc += walk(forest[j]!, num, cat, categorical);
    raws[k] = acc;
  }

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

/** The uncompiled walk, kept as the reference the compiled one is tested against. */
export function predictProbaPortableReference(model: HgbPortableModel, x: FeatureVec): Record<string, number> {
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
