"""Artifact loaders — joblib resolvers + empirical PMF tables, cached."""

from __future__ import annotations

import functools
import importlib

import joblib
import numpy as np
import pandas as pd
import polars as pl

from lib_py.report import ARTIFACTS

_MODELS = ARTIFACTS / "models"
_DIST = ARTIFACTS / "distributions"

# model id -> (joblib stem, resolver module for cat_cols/ctx_bucket)
RESOLVER_META = {
    "M01": ("fourth_down", "02_fourth_down"),
    "M02": ("m02", "03_play_call"),
    "M03": ("m03", "04_shotgun"),
    "M04": ("m04", "05_dropback_outcome"),
    "M05": ("m05", "06_pass_depth"),
    "M09": ("m09", "10_pass_result"),
    "M10": ("m10", "11_yac"),
    "M11": ("m11", "12_scramble_yards"),
    "M13": ("m13", "14_run_location"),
    "M14": ("m14", "15_rush_yards"),
    "M15": ("m15", "16_fumbles"),
    "M20": ("m20", "18_field_goals"),
    "M21": ("m21", "19_punts"),
    "M25a": ("m25a", "25_penalties"),
    "M25b": ("m25b", "25_penalties"),
}


@functools.lru_cache(maxsize=None)
def resolver(mid: str):
    stem, modname = RESOLVER_META[mid]
    bundle = joblib.load(_MODELS / f"{stem}.joblib")
    mod = importlib.import_module(modname)
    spec = getattr(mod, "SPEC", None)
    if spec is not None:
        cat = set(getattr(spec, "cat_cols", []))
    else:  # M01 pre-dates the pipeline refactor
        cat = set(getattr(mod, "CAT_COLS", [])) | {"temp_missing"}
    return {
        "est": bundle["estimator"],
        "labels": bundle["labels"],
        "features": bundle["features"],
        "cat_cols": cat,
        "classes": list(bundle["estimator"].classes_),
    }


def _row(features, cat_cols, ctx: dict) -> pd.DataFrame:
    data = {}
    for f in features:
        v = ctx.get(f)
        if f in cat_cols:
            data[f] = [str(v)]
        else:
            data[f] = [float(v) if v is not None else np.nan]
    return pd.DataFrame(data)


_pp_cache: dict = {}


def _bucket(ctx: dict, feats: list[str]) -> tuple:
    key = []
    for f in feats:
        v = ctx.get(f)
        if f in ("ydstogo", "air_yards"):
            key.append(round(float(v) / 2) * 2 if v is not None else None)
        elif f in ("yardline_100", "kick_distance"):
            key.append(round(float(v) / 3) * 3 if v is not None else None)
        elif f in ("game_seconds_remaining", "half_seconds_remaining"):
            key.append(round(float(v) / 120) * 120 if v is not None else None)
        elif f in ("score_differential", "env_temp", "env_wind"):
            key.append(round(float(v) / 4) * 4 if v is not None else None)
        else:
            key.append(v)
    return tuple(key)


def predict_proba(mid: str, ctx: dict, logit_shift: dict[str, float] | None = None) -> dict[str, float]:
    r = resolver(mid)
    ck = (mid, _bucket(ctx, r["features"]))
    base = _pp_cache.get(ck)
    if base is None:
        p = r["est"].predict_proba(_row(r["features"], r["cat_cols"], ctx))[0]
        idx = {c: i for i, c in enumerate(r["est"].classes_)}
        base = {lab: float(p[idx[lab]]) for lab in r["labels"]}
        _pp_cache[ck] = base
    if not logit_shift:
        return base
    return _apply_shift(base, logit_shift)


def _apply_shift(probs: dict[str, float], shift: dict[str, float]) -> dict[str, float]:
    """Add per-class shifts in logit space and re-softmax (spec §12)."""
    labels = list(probs)
    lg = {l: np.log(max(probs[l], 1e-9)) + float(shift.get(l, 0.0)) for l in labels}
    mx = max(lg.values())
    ex = {l: np.exp(lg[l] - mx) for l in labels}
    s = sum(ex.values())
    return {l: ex[l] / s for l in labels}


def sample_class(mid: str, ctx: dict, rng: np.random.Generator,
                 logit_shift: dict[str, float] | None = None) -> str:
    probs = predict_proba(mid, ctx, logit_shift)
    labels = list(probs)
    return str(rng.choice(labels, p=_norm([probs[l] for l in labels])))


def _norm(x):
    a = np.asarray(x, float)
    a = np.clip(a, 1e-9, None)
    return a / a.sum()


# ---- empirical yardage PMFs (M10 YAC, M11 scramble, M14 rush) ----------

@functools.lru_cache(maxsize=None)
def yardage_pmf(stem: str) -> dict:
    """(category, ctx_bucket) -> (yards[], cumprob[]); + category-global fallback."""
    df = pl.read_parquet(_DIST / f"{stem}_exact.parquet")
    by_cb: dict[tuple[str, str], tuple[np.ndarray, np.ndarray]] = {}
    for (cat, bucket), g in df.group_by(["category", "ctx_bucket"]):
        y = g["yards"].to_numpy()
        p = _norm(g["prob"].to_numpy())
        by_cb[(cat, bucket)] = (y, np.cumsum(p))
    glob: dict[str, tuple[np.ndarray, np.ndarray]] = {}
    for (cat,), g in df.group_by(["category"]):
        agg = g.group_by("yards").agg(pl.col("prob").sum()).sort("yards")
        y = agg["yards"].to_numpy()
        p = _norm(agg["prob"].to_numpy())
        glob[cat] = (y, np.cumsum(p))
    return {"by_cb": by_cb, "glob": glob}


def sample_exact_yards(stem: str, category: str, bucket: str, rng: np.random.Generator) -> int:
    t = yardage_pmf(stem)
    y, cum = t["by_cb"].get((category, bucket)) or t["glob"][category]
    return int(y[np.searchsorted(cum, rng.random())])


@functools.lru_cache(maxsize=None)
def air_yards_pmf() -> dict:
    df = pl.read_parquet(_DIST / "air_yards_exact.parquet")
    out: dict[tuple, tuple[np.ndarray, np.ndarray]] = {}
    for (cat, down, fp), g in df.group_by(["depth_category", "down", "fp_band"]):
        y = g["air_yards_int"].to_numpy()
        p = _norm(g["count"].to_numpy())
        out[(cat, int(down), fp)] = (y, np.cumsum(p))
    glob: dict[str, tuple] = {}
    for (cat,), g in df.group_by(["depth_category"]):
        agg = g.group_by("air_yards_int").agg(pl.col("count").sum()).sort("air_yards_int")
        glob[cat] = (agg["air_yards_int"].to_numpy(), np.cumsum(_norm(agg["count"].to_numpy())))
    return {"by": out, "glob": glob}


def sample_air_yards(cat: str, down: int, yardline_100: float, rng: np.random.Generator) -> int:
    fp = "opp_rz" if yardline_100 <= 20 else "opp_mid" if yardline_100 <= 50 else "own_half"
    t = air_yards_pmf()
    y, cum = t["by"].get((cat, down, fp)) or t["glob"][cat]
    return int(y[np.searchsorted(cum, rng.random())])


@functools.lru_cache(maxsize=None)
def clock_runoff() -> dict:
    df = pl.read_parquet(_DIST / "clock_runoff.parquet")
    out: dict[tuple, tuple[np.ndarray, np.ndarray]] = {}
    for (bucket, nh, cs), g in df.group_by(["outcome_bucket", "no_huddle", "clock_state"]):
        s = g["elapsed_s"].to_numpy()
        p = _norm(g["n"].to_numpy())
        out[(bucket, int(nh), cs)] = (s, np.cumsum(p))
    return out


def sample_runoff(bucket: str, no_huddle: int, clock_state: str, rng: np.random.Generator) -> int:
    t = clock_runoff()
    key = (bucket, no_huddle, clock_state)
    if key not in t:
        key = (bucket, 0, "normal")
    if key not in t:
        return 35
    s, cum = t[key]
    return int(s[np.searchsorted(cum, rng.random())])


@functools.lru_cache(maxsize=None)
def punt_tables() -> dict:
    dist = pl.read_parquet(_DIST / "punt_distance.parquet")
    ret = pl.read_parquet(_DIST / "punt_return_yards.parquet")
    by_fp: dict[int, tuple] = {}
    for (fp,), g in dist.group_by(["fp"]):
        by_fp[int(fp)] = (g["kd"].to_numpy(), np.cumsum(_norm(g["n"].to_numpy())))
    ry = (ret["ry"].to_numpy(), np.cumsum(_norm(ret["n"].to_numpy())))
    return {"dist": by_fp, "ret": ry}


def sample_punt_distance(yardline_100: float, rng: np.random.Generator) -> int:
    t = punt_tables()["dist"]
    fp = int(yardline_100 // 10 * 10)
    key = fp if fp in t else min(t, key=lambda k: abs(k - fp))
    y, cum = t[key]
    return int(y[np.searchsorted(cum, rng.random())])


def sample_punt_return(rng: np.random.Generator) -> int:
    y, cum = punt_tables()["ret"]
    return int(y[np.searchsorted(cum, rng.random())])


# ---- penalty enforcement (Model 25c) ----------------------------------

@functools.lru_cache(maxsize=None)
def penalty_tables() -> dict:
    enf = pl.read_parquet(_DIST / "penalty_enforcement.parquet")
    by: dict[tuple[str, str], tuple] = {}
    for (hz, fam), g in enf.group_by(["hazard_class", "play_family"]):
        buckets = g["bucket"].to_list()
        cum = np.cumsum(_norm(g["share"].to_numpy()))
        meta = {r["bucket"]: r for r in g.to_dicts()}
        by[(hz, fam)] = (buckets, cum, meta)
    dpi = pl.read_parquet(_DIST / "penalty_dpi_yards.parquet")
    dpi_pmf: dict[str, tuple] = {}
    for (band,), g in dpi.group_by(["fp_band"]):
        dpi_pmf[band] = (g["yards"].to_numpy(), np.cumsum(_norm(g["prob"].to_numpy())))
    return {"by": by, "dpi": dpi_pmf}


def sample_penalty_bucket(hazard: str, play_family: str, rng: np.random.Generator) -> dict:
    """Return the M25c enforcement row (share/off_share/mean_yards/p_auto_first/…)
    for a fired penalty of this hazard class + play family."""
    t = penalty_tables()["by"]
    key = (hazard, play_family)
    if key not in t:
        key = (hazard, "ALL" if hazard == "deadball" else "dropback")
    buckets, cum, meta = t[key]
    return meta[buckets[int(np.searchsorted(cum, rng.random()))]]


def sample_dpi_yards(fp_band: str, rng: np.random.Generator) -> int:
    t = penalty_tables()["dpi"]
    y, cum = t.get(fp_band) or next(iter(t.values()))
    return int(y[np.searchsorted(cum, rng.random())])
