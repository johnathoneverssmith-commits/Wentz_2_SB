"""Export the engine's empirical PMF / lookup tables to portable JSON.

`engine/loaders.py` reads seven parquet files (air-yд, m10/m11/m14 exact-yardage,
clock runoff, punt distance/return, penalty enforcement + DPI yд) and turns each
into a `{key: (values[], cumprob[])}` lookup. The TS runtime has no parquet
reader, so this writes the *already-built* lookups to
`artifacts/distributions/portable/<name>.json` — the runtime then just does a
`searchsorted` on `cum`. Verifies each JSON reproduces the parquet-built lookup
exactly. Run: analysis/.venv/Scripts/python analysis/28_export_distributions.py
"""

from __future__ import annotations

import lib_py  # thread-env

import json
import sys

import numpy as np
import polars as pl

from lib_py.report import ARTIFACTS

_DIST = ARTIFACTS / "distributions"
OUT = _DIST / "portable"


def _norm(x: np.ndarray) -> np.ndarray:
    a = np.clip(np.asarray(x, float), 1e-9, None)
    return a / a.sum()


def _pmf(vals, weights) -> dict:
    return {"v": [int(v) for v in vals], "cum": [float(c) for c in np.cumsum(_norm(weights))]}


def yardage(stem: str) -> dict:
    df = pl.read_parquet(_DIST / f"{stem}_exact.parquet")
    by_cb: dict = {}
    for (cat, bucket), g in df.group_by(["category", "ctx_bucket"]):
        by_cb.setdefault(cat, {})[bucket] = _pmf(g["yards"].to_numpy(), g["prob"].to_numpy())
    glob: dict = {}
    for (cat,), g in df.group_by(["category"]):
        agg = g.group_by("yards").agg(pl.col("prob").sum()).sort("yards")
        glob[cat] = _pmf(agg["yards"].to_numpy(), agg["prob"].to_numpy())
    return {"by_cb": by_cb, "glob": glob}


def air_yards() -> dict:
    df = pl.read_parquet(_DIST / "air_yards_exact.parquet")
    by: dict = {}
    for (cat, down, fp), g in df.group_by(["depth_category", "down", "fp_band"]):
        by.setdefault(cat, {}).setdefault(str(int(down)), {})[fp] = _pmf(
            g["air_yards_int"].to_numpy(), g["count"].to_numpy())
    glob: dict = {}
    for (cat,), g in df.group_by(["depth_category"]):
        agg = g.group_by("air_yards_int").agg(pl.col("count").sum()).sort("air_yards_int")
        glob[cat] = _pmf(agg["air_yards_int"].to_numpy(), agg["count"].to_numpy())
    return {"by": by, "glob": glob}


def clock() -> dict:
    df = pl.read_parquet(_DIST / "clock_runoff.parquet")
    by: dict = {}
    for (bucket, nh, cs), g in df.group_by(["outcome_bucket", "no_huddle", "clock_state"]):
        by.setdefault(bucket, {}).setdefault(str(int(nh)), {})[cs] = _pmf(
            g["elapsed_s"].to_numpy(), g["n"].to_numpy())
    return {"by": by}


def punt() -> dict:
    dist = pl.read_parquet(_DIST / "punt_distance.parquet")
    ret = pl.read_parquet(_DIST / "punt_return_yards.parquet")
    by_fp = {str(int(fp)): _pmf(g["kd"].to_numpy(), g["n"].to_numpy())
             for (fp,), g in dist.group_by(["fp"])}
    return {"dist": by_fp, "ret": _pmf(ret["ry"].to_numpy(), ret["n"].to_numpy())}


def rz_yac() -> dict:
    df = pl.read_parquet(_DIST / "rz_yac.parquet")
    return {band: _pmf(g["yac_int"].to_numpy(), g["count"].to_numpy())
            for (band,), g in df.group_by(["catch_band"])}


def penalty() -> dict:
    enf = pl.read_parquet(_DIST / "penalty_enforcement.parquet")
    by: dict = {}
    for (hz, fam), g in enf.group_by(["hazard_class", "play_family"]):
        rows = g.to_dicts()
        by.setdefault(hz, {})[fam] = {
            "buckets": [r["bucket"] for r in rows],
            "cum": [float(c) for c in np.cumsum(_norm(g["share"].to_numpy()))],
            "meta": {r["bucket"]: {k: (bool(v) if k == "is_spot_foul" else v)
                                   for k, v in r.items()} for r in rows},
        }
    dpi = pl.read_parquet(_DIST / "penalty_dpi_yards.parquet")
    dpi_pmf = {band: _pmf(g["yards"].to_numpy(), g["prob"].to_numpy())
               for (band,), g in dpi.group_by(["fp_band"])}
    return {"by": by, "dpi": dpi_pmf}


TABLES = {
    "m10_exact": lambda: yardage("m10"), "m11_exact": lambda: yardage("m11"),
    "m14_exact": lambda: yardage("m14"), "air_yards": air_yards, "clock_runoff": clock,
    "punt": punt, "penalty": penalty, "rz_yac": rz_yac,
}


def _leaves(obj):
    """Yield every {"v","cum"} leaf in a nested dict."""
    if isinstance(obj, dict):
        if "v" in obj and "cum" in obj:
            yield obj
        else:
            for v in obj.values():
                yield from _leaves(v)


def _verify() -> bool:
    """(1) every JSON leaf is a valid CDF; (2) the JSON `_draw` reproduces the
    same yardage a parquet-built searchsorted sampler would, over a seed sweep."""
    ok = True
    for name in TABLES:
        j = json.loads((OUT / f"{name}.json").read_text())
        for leaf in _leaves(j):
            c = leaf["cum"]
            if len(c) != len(leaf["v"]) or any(c[i] > c[i + 1] + 1e-12 for i in range(len(c) - 1)) \
               or abs(c[-1] - 1.0) > 1e-9:
                print(f"    BAD CDF in {name}"); ok = False

    def draw(leaf, r):
        return int(leaf["v"][int(np.searchsorted(leaf["cum"], r))])

    # cross-check: rebuild one lookup straight from parquet and match draws
    df = pl.read_parquet(_DIST / "m14_exact.parquet")
    (cat, bucket), g = next(iter(df.group_by(["category", "ctx_bucket"])))
    ref_v = g["yards"].to_numpy()
    ref_cum = np.cumsum(_norm(g["prob"].to_numpy()))
    jleaf = json.loads((OUT / "m14_exact.json").read_text())["by_cb"][cat][bucket]
    for r in np.linspace(0.001, 0.999, 500):
        a = int(ref_v[int(np.searchsorted(ref_cum, r))])
        b = draw(jleaf, r)
        if a != b:
            print(f"    DRAW MISMATCH m14 {cat}/{bucket} at r={r:.3f}: {a} != {b}"); ok = False
            break
    return ok


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    total = 0
    for name, fn in TABLES.items():
        p = OUT / f"{name}.json"
        p.write_text(json.dumps(fn(), separators=(",", ":"), default=str) + "\n", encoding="utf-8")
        kb = p.stat().st_size / 1024
        total += kb
        print(f"  {name:14s} {kb:6.1f} KB")
    print(f"  {'total':14s} {total:6.1f} KB")
    print("verifying against the parquet-built lookups...")
    if _verify():
        print("  OK — all leaf PMFs match")
    else:
        sys.exit(1)


if __name__ == "__main__":
    main()
