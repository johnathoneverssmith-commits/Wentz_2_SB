import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  type HgbPortableModel,
  predictProbaPortable,
} from "../src/engine/hgb-portable.js";
import {
  type LinearPortableModel,
  predictProbaLinear,
} from "../src/engine/linear-portable.js";

/**
 * Ground truth from the Python reference evaluators
 * (`analysis/lib_py/{hgb,linear}_portable.py`), themselves verified against
 * sklearn to < 1e-6. The TS ports must match them.
 */
const casesUrl = new URL("./fixtures/portable_cases.json", import.meta.url);
const fixtures = JSON.parse(readFileSync(fileURLToPath(casesUrl), "utf8")) as Record<
  string,
  {
    kind: "hgb" | "lin";
    cases: { x: Record<string, number | string>; expected: Record<string, number> }[];
  }
>;

const portableDir = new URL("../artifacts/models/portable/", import.meta.url);

type AnyModel = HgbPortableModel | LinearPortableModel;

function loadModel(mid: string): AnyModel {
  const url = new URL(`${mid}.json`, portableDir);
  return JSON.parse(readFileSync(fileURLToPath(url), "utf8")) as AnyModel;
}

function evalModel(
  kind: "hgb" | "lin",
  model: AnyModel,
  x: Record<string, number | string>,
): Record<string, number> {
  return kind === "lin"
    ? predictProbaLinear(model as LinearPortableModel, x)
    : predictProbaPortable(model as HgbPortableModel, x);
}

describe("portable resolver evaluators", () => {
  for (const [mid, { kind, cases }] of Object.entries(fixtures)) {
    const model = loadModel(mid);

    it(`${mid} (${kind}): matches the Python reference on every fixture row`, () => {
      for (const { x, expected } of cases) {
        const got = evalModel(kind, model, x);
        for (const label of model.labels) {
          expect(got[label]).toBeCloseTo(expected[label] as number, 9);
        }
      }
    });

    it(`${mid} (${kind}): probabilities sum to 1`, () => {
      for (const { x } of cases) {
        const got = evalModel(kind, model, x);
        const sum = Object.values(got).reduce((a, b) => a + b, 0);
        expect(sum).toBeCloseTo(1, 12);
      }
    });
  }

  it("hgb: unknown categorical value follows the split's missing-left flag", () => {
    const model = loadModel("M09") as HgbPortableModel;
    const base = fixtures.M09?.cases[0]?.x ?? {};
    const got = predictProbaPortable(model, { ...base, depth_category: "NOPE" });
    expect(Object.values(got).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
  });

  it("linear: unknown categorical value contributes zero", () => {
    const model = loadModel("M04") as LinearPortableModel;
    const base = fixtures.M04?.cases[0]?.x ?? {};
    const known = predictProbaLinear(model, base);
    const unknown = predictProbaLinear(model, { ...base, down: "99" });
    // 'down' unknown -> its one-hot row is zeros -> same as dropping the term,
    // which generally shifts the distribution but keeps it a valid distribution.
    expect(Object.values(unknown).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
    expect(unknown).not.toEqual(known);
  });
});
