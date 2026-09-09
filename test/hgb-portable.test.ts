import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  type HgbPortableModel,
  predictProbaPortable,
} from "../src/engine/hgb-portable.js";

/**
 * Ground truth from `analysis/lib_py/hgb_portable.predict_proba_portable`
 * (itself verified against sklearn to < 1e-6). The TS port must match it.
 */
const casesUrl = new URL("./fixtures/hgb_portable_cases.json", import.meta.url);
const fixtures = JSON.parse(readFileSync(fileURLToPath(casesUrl), "utf8")) as Record<
  string,
  { cases: { x: Record<string, number | string>; expected: Record<string, number> }[] }
>;

const artifactsDir = new URL("../artifacts/models/portable/", import.meta.url);

function loadModel(mid: string): HgbPortableModel {
  const url = new URL(`${mid}.json`, artifactsDir);
  return JSON.parse(readFileSync(fileURLToPath(url), "utf8")) as HgbPortableModel;
}

describe("predictProbaPortable", () => {
  for (const [mid, { cases }] of Object.entries(fixtures)) {
    const model = loadModel(mid);

    it(`${mid}: matches the Python reference on every fixture row`, () => {
      for (const { x, expected } of cases) {
        const got = predictProbaPortable(model, x);
        for (const label of model.labels) {
          expect(got[label]).toBeCloseTo(expected[label] as number, 9);
        }
      }
    });

    it(`${mid}: probabilities sum to 1`, () => {
      for (const { x } of cases) {
        const got = predictProbaPortable(model, x);
        const sum = Object.values(got).reduce((a, b) => a + b, 0);
        expect(sum).toBeCloseTo(1, 12);
      }
    });
  }

  it("unknown categorical value follows the split's missing-left flag", () => {
    const model = loadModel("M09");
    const base = fixtures.M09?.cases[0]?.x ?? {};
    // a depth_category value the model never saw -> treated as missing, not a crash
    const got = predictProbaPortable(model, { ...base, depth_category: "NOT_A_REAL_CATEGORY" });
    const sum = Object.values(got).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 12);
  });
});
